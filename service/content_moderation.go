package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

const (
	moderationSourceKeyword = "keyword"
	moderationSourceHash    = "hash"
	moderationSourceOpenAI  = "openai"

	moderationHashSetKey = "content_moderation:flagged_hashes"
)

type ModerationVerdict struct {
	Flagged        bool               `json:"flagged"`
	Source         string             `json:"source,omitempty"`
	MatchedKeyword string             `json:"matched_keyword,omitempty"`
	Category       string             `json:"highest_category,omitempty"`
	Score          float64            `json:"highest_score"`
	CategoryScores map[string]float64 `json:"category_scores,omitempty"`
	Thresholds     map[string]float64 `json:"thresholds,omitempty"`
}

// EvaluateOpenAIModeration flags a result when any category score reaches its
// threshold; the upstream flag is ignored. The highest-scoring category is
// reported whether or not it caused the hit.
func EvaluateOpenAIModeration(result OpenAIModerationResult, thresholds map[string]float64) ModerationVerdict {
	verdict := ModerationVerdict{Source: moderationSourceOpenAI, CategoryScores: result.CategoryScores, Thresholds: thresholds}
	for category, score := range result.CategoryScores {
		if threshold, ok := thresholds[category]; ok && score >= threshold {
			verdict.Flagged = true
		}
		if score > verdict.Score || (score == verdict.Score && (verdict.Category == "" || category < verdict.Category)) {
			verdict.Category = category
			verdict.Score = score
		}
	}
	return verdict
}

// moderationOutcome is the result of one moderation pass. blockAction is the
// record action used when the request is flagged and blocking is allowed.
type moderationOutcome struct {
	verdict         ModerationVerdict
	blockAction     string
	err             error
	upstreamLatency time.Duration
	inputHash       string
	sampledOut      bool
}

// runModeration applies keywords, the flagged-hash pre-check, sampling and the
// OpenAI endpoint in that order.
func runModeration(ctx context.Context, config *operation_setting.ContentModerationConfig, input ModerationInput, trackLoad bool) moderationOutcome {
	var outcome moderationOutcome
	if config.KeywordBlockingMode != operation_setting.ContentModerationAPIOnly {
		if keyword := matchModerationKeyword(config.BlockedKeywords, input.Text); keyword != "" {
			outcome.verdict = ModerationVerdict{Flagged: true, Source: moderationSourceKeyword, MatchedKeyword: keyword}
			outcome.blockAction = model.ContentModerationActionKeywordBlock
			return outcome
		}
		if config.KeywordBlockingMode == operation_setting.ContentModerationKeywordOnly {
			return outcome
		}
	}
	outcome.inputHash = moderationInputHash(input)
	if config.PreHashCheckEnabled && moderationHashFlagged(outcome.inputHash) {
		outcome.verdict = ModerationVerdict{Flagged: true, Source: moderationSourceHash}
		outcome.blockAction = model.ContentModerationActionHashBlock
		return outcome
	}
	if !moderationSampled(outcome.inputHash, config.SampleRate) {
		outcome.sampledOut = true
		return outcome
	}
	if len(config.APIKeys) == 0 {
		outcome.err = errNoModerationKey
		return outcome
	}
	result, latency, err := moderateWithKeyPool(ctx, config, input, trackLoad)
	outcome.upstreamLatency = latency
	if err != nil {
		outcome.err = err
		return outcome
	}
	outcome.verdict = EvaluateOpenAIModeration(result, config.Thresholds)
	if outcome.verdict.Flagged {
		outcome.blockAction = model.ContentModerationActionBlock
		addModerationHash(outcome.inputHash)
	}
	return outcome
}

// CheckModerationInput runs the saved configuration on an input without
// recording it, for the administrator test panel.
func CheckModerationInput(ctx context.Context, input ModerationInput) (ModerationVerdict, error) {
	outcome := runModeration(ctx, operation_setting.GetContentModerationConfig(), input, false)
	return outcome.verdict, outcome.err
}

func matchModerationKeyword(keywords []string, text string) string {
	if text == "" || len(keywords) == 0 {
		return ""
	}
	lowered := make([]string, 0, len(keywords))
	for _, keyword := range keywords {
		lowered = append(lowered, strings.ToLower(keyword))
	}
	if found, words := AcSearch(strings.ToLower(text), lowered, true); found && len(words) > 0 {
		return words[0]
	}
	return ""
}

type moderationJob struct {
	check      bool
	input      ModerationInput
	outcome    moderationOutcome
	allowBlock bool
	logOnly    bool
	enqueuedAt time.Time

	requestId string
	userId    int
	username  string
	userEmail string
	tokenId   int
	tokenName string
	group     string
	modelName string
	endpoint  string
	mode      string
}

type moderationRuntimeStats struct {
	preBlockActive    atomic.Int64
	preBlockChecked   atomic.Int64
	preBlockAllowed   atomic.Int64
	preBlockBlocked   atomic.Int64
	preBlockErrors    atomic.Int64
	preBlockLatencyMs atomic.Int64

	activeWorkers atomic.Int64
	enqueued      atomic.Int64
	dropped       atomic.Int64
	processed     atomic.Int64
	asyncErrors   atomic.Int64

	lastCleanupAt            atomic.Int64
	lastCleanupDeletedHit    atomic.Int64
	lastCleanupDeletedNonHit atomic.Int64
}

var (
	moderationStats moderationRuntimeStats
	// The channel holds pointers up to the maximum queue size; the configured
	// queue size is enforced when enqueuing so it can change at runtime.
	moderationQueue   = make(chan *moderationJob, operation_setting.ContentModerationMaxQueueSize)
	moderationStarted atomic.Bool
)

// ModerateRelayRequest runs the configured content moderation before billing.
// It returns an error only when a pre-block check flags the request.
func ModerateRelayRequest(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	config := operation_setting.GetContentModerationConfig()
	if !config.Enabled || config.Mode == operation_setting.ContentModerationModeOff {
		return nil
	}
	if info == nil || info.Request == nil || !config.GroupInScope(info.UsingGroup) || !config.ModelInScope(info.OriginModelName) {
		return nil
	}
	input := ExtractModerationInput(info.Request)
	if input.Text == "" && input.ImageURL == "" {
		return nil
	}
	job := &moderationJob{
		input:     input,
		logOnly:   slices.Contains(config.ExemptUserIds, info.UserId),
		requestId: c.GetString(common.RequestIdKey),
		userId:    info.UserId,
		username:  common.GetContextKeyString(c, constant.ContextKeyUserName),
		userEmail: info.UserEmail,
		tokenId:   info.TokenId,
		tokenName: c.GetString("token_name"),
		group:     info.UsingGroup,
		modelName: info.OriginModelName,
		endpoint:  c.Request.URL.Path,
		mode:      config.Mode,
	}
	if job.logOnly {
		job.mode = model.ContentModerationModeLogOnly
	}
	if config.Mode == operation_setting.ContentModerationModeObserve || job.logOnly {
		job.check = true
		enqueueModerationJob(config, job)
		return nil
	}

	moderationStats.preBlockActive.Add(1)
	started := time.Now()
	outcome := runModeration(c.Request.Context(), config, input, true)
	moderationStats.preBlockActive.Add(-1)
	moderationStats.preBlockChecked.Add(1)
	moderationStats.preBlockLatencyMs.Add(time.Since(started).Milliseconds())
	switch {
	case outcome.verdict.Flagged:
		moderationStats.preBlockBlocked.Add(1)
	case outcome.err != nil:
		moderationStats.preBlockErrors.Add(1)
		logger.LogWarn(c, common.LogText("content moderation check failed, request allowed: %s", outcome.err.Error()))
	default:
		moderationStats.preBlockAllowed.Add(1)
	}
	job.outcome = outcome
	job.allowBlock = true
	if moderationShouldRecord(config, outcome) {
		enqueueModerationJob(config, job)
	}
	if !outcome.verdict.Flagged {
		return nil
	}

	RequestPolicy(c).AddEvent(PolicyEvent{ErrorCode: string(types.ErrorCodeContentPolicyViolation), ErrorSource: "local", Decision: PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
	logger.LogWarn(c, common.LogText("content moderation blocked request: action=%s category=%s keyword=%s", outcome.blockAction, outcome.verdict.Category, outcome.verdict.MatchedKeyword))
	message := config.BlockMessage
	if message == "" {
		message = i18n.T(c, i18n.MsgRelayContentPolicyViolation)
	}
	if outcome.blockAction == model.ContentModerationActionHashBlock {
		message = fmt.Sprintf("%s (hash: %s)", message, outcome.inputHash)
	}
	return types.NewErrorWithStatusCode(errors.New(message), types.ErrorCodeContentPolicyViolation, config.BlockStatus, types.ErrOptionWithSkipRetry())
}

func moderationShouldRecord(config *operation_setting.ContentModerationConfig, outcome moderationOutcome) bool {
	if outcome.sampledOut {
		return false
	}
	return outcome.verdict.Flagged || config.RecordNonHits
}

func enqueueModerationJob(config *operation_setting.ContentModerationConfig, job *moderationJob) {
	if len(moderationQueue) >= config.QueueSize {
		moderationStats.dropped.Add(1)
		return
	}
	job.enqueuedAt = time.Now()
	select {
	case moderationQueue <- job:
		moderationStats.enqueued.Add(1)
	default:
		moderationStats.dropped.Add(1)
	}
}

// StartContentModerationRuntime starts the async workers and the retention
// cleanup. Workers above the configured count stay idle, so the count can
// change without a restart.
func StartContentModerationRuntime() {
	if !moderationStarted.CompareAndSwap(false, true) {
		return
	}
	for index := range operation_setting.ContentModerationMaxWorkers {
		go runModerationWorker(index)
	}
	go func() {
		time.Sleep(5 * time.Minute)
		for {
			cleanupContentModerationLogs()
			time.Sleep(24 * time.Hour)
		}
	}()
}

func runModerationWorker(index int) {
	for {
		if index >= operation_setting.GetContentModerationConfig().WorkerCount {
			time.Sleep(time.Second)
			continue
		}
		select {
		case job := <-moderationQueue:
			moderationStats.activeWorkers.Add(1)
			processModerationJob(job)
			moderationStats.activeWorkers.Add(-1)
		case <-time.After(time.Second):
		}
	}
}

func processModerationJob(job *moderationJob) {
	defer func() {
		if recovered := recover(); recovered != nil {
			common.SysError(common.LogText("content moderation worker panic: %v", recovered))
		}
	}()
	config := operation_setting.GetContentModerationConfig()
	if job.check {
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(config.TimeoutMs*(config.RetryCount+1)+1000)*time.Millisecond)
		job.outcome = runModeration(ctx, config, job.input, false)
		cancel()
		moderationStats.processed.Add(1)
		if job.outcome.err != nil {
			moderationStats.asyncErrors.Add(1)
			common.SysError(common.LogText("content moderation async check failed: %s", job.outcome.err.Error()))
		}
		if !moderationShouldRecord(config, job.outcome) {
			return
		}
	}
	recordModerationJob(config, job)
}

// recordModerationJob stores the record and, for flagged requests that count
// toward bans, disables the user once the violation threshold is reached.
func recordModerationJob(config *operation_setting.ContentModerationConfig, job *moderationJob) {
	outcome := job.outcome
	entry := &model.ContentModerationLog{
		CreatedAt:         common.GetTimestamp(),
		RequestId:         job.requestId,
		UserId:            job.userId,
		Username:          job.username,
		UserEmail:         job.userEmail,
		TokenId:           job.tokenId,
		TokenName:         job.tokenName,
		GroupName:         job.group,
		ModelName:         job.modelName,
		Endpoint:          job.endpoint,
		Mode:              job.mode,
		Action:            model.ContentModerationActionAllow,
		Flagged:           outcome.verdict.Flagged,
		Source:            outcome.verdict.Source,
		MatchedKeyword:    outcome.verdict.MatchedKeyword,
		Category:          outcome.verdict.Category,
		Score:             outcome.verdict.Score,
		InputExcerpt:      moderationExcerpt(job.input),
		InputHash:         outcome.inputHash,
		UpstreamLatencyMs: int(outcome.upstreamLatency.Milliseconds()),
	}
	if job.logOnly {
		entry.Mode = model.ContentModerationModeLogOnly
	}
	if job.check {
		entry.QueueDelayMs = int(time.Since(job.enqueuedAt).Milliseconds())
	}
	switch {
	case outcome.verdict.Flagged && job.allowBlock && !job.logOnly:
		entry.Action = outcome.blockAction
	case outcome.err != nil:
		entry.Action = model.ContentModerationActionError
		entry.Error = truncateRunes(outcome.err.Error(), 500)
	}
	if len(outcome.verdict.CategoryScores) > 0 {
		if encoded, err := common.Marshal(outcome.verdict.CategoryScores); err == nil {
			entry.CategoryScores = string(encoded)
		}
		if encoded, err := common.Marshal(config.Thresholds); err == nil {
			entry.ThresholdSnapshot = string(encoded)
		}
	}

	if outcome.verdict.Flagged && !job.logOnly && outcome.blockAction != model.ContentModerationActionHashBlock {
		countContentViolation(config, entry)
	}
	if err := model.CreateContentModerationLog(entry); err != nil {
		common.SysError(common.LogText("failed to record content moderation log: %s", err.Error()))
	}
}

// countContentViolation sets the violation count of a record that counts
// toward automatic bans and disables the user once the threshold is reached.
func countContentViolation(config *operation_setting.ContentModerationConfig, entry *model.ContentModerationLog) {
	if entry.UserId <= 0 {
		return
	}
	since := common.GetTimestamp() - int64(config.ViolationWindowHours)*3600
	count, err := model.CountUserViolationsSinceLastBan(entry.UserId, since, config.CyberPolicyExcludeFromBanCount)
	if err != nil {
		common.SysError(common.LogText("failed to count content violations for user %d: %s", entry.UserId, err.Error()))
	}
	entry.ViolationCount = int(count) + 1
	if config.AutoBanEnabled && entry.ViolationCount >= config.BanThreshold {
		entry.AutoBanned = disableUserForContentViolations(entry.UserId)
	}
}

// disableUserForContentViolations disables a user who reached the violation
// threshold. It reports true when the user is (already) disabled, which also
// restarts the violation count; administrators are never disabled.
func disableUserForContentViolations(userId int) bool {
	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.SysError(common.LogText("failed to load user %d for content moderation ban: %s", userId, err.Error()))
		return false
	}
	if user.Role >= common.RoleAdminUser {
		return false
	}
	if user.Status != common.UserStatusEnabled {
		return true
	}
	user.Status = common.UserStatusDisabled
	if err := user.Update(false); err != nil {
		common.SysError(common.LogText("failed to disable user %d for content violations: %s", userId, err.Error()))
		return false
	}
	if err := model.InvalidateUserTokensCache(userId); err != nil {
		common.SysError(common.LogText("failed to invalidate tokens cache for user %d: %s", userId, err.Error()))
	}
	common.SysLog(common.LogText("user %d disabled by content moderation", userId))
	return true
}

func cleanupContentModerationLogs() {
	config := operation_setting.GetContentModerationConfig()
	now := common.GetTimestamp()
	deletedHit, err := model.DeleteContentModerationLogsBefore(true, now-int64(config.HitRetentionDays)*86400)
	if err != nil {
		common.SysError(common.LogText("failed to clean content moderation hit records: %s", err.Error()))
	}
	deletedNonHit, err := model.DeleteContentModerationLogsBefore(false, now-int64(config.NonHitRetentionDays)*86400)
	if err != nil {
		common.SysError(common.LogText("failed to clean content moderation non-hit records: %s", err.Error()))
	}
	moderationStats.lastCleanupAt.Store(now)
	moderationStats.lastCleanupDeletedHit.Store(deletedHit)
	moderationStats.lastCleanupDeletedNonHit.Store(deletedNonHit)
}

// Flagged input hashes live in a Redis set without expiry; without Redis the
// pre-check is a no-op.
func moderationHashFlagged(hash string) bool {
	if !common.RedisEnabled || common.RDB == nil {
		return false
	}
	found, err := common.RDB.SIsMember(context.Background(), moderationHashSetKey, hash).Result()
	return err == nil && found
}

func addModerationHash(hash string) {
	if !common.RedisEnabled || common.RDB == nil || hash == "" {
		return
	}
	if err := common.RDB.SAdd(context.Background(), moderationHashSetKey, hash).Err(); err != nil {
		common.SysError(common.LogText("failed to store flagged content hash: %s", err.Error()))
	}
}

func ContentModerationHashCount() int64 {
	if !common.RedisEnabled || common.RDB == nil {
		return 0
	}
	count, _ := common.RDB.SCard(context.Background(), moderationHashSetKey).Result()
	return count
}

func DeleteContentModerationHash(hash string) (bool, error) {
	if !common.RedisEnabled || common.RDB == nil {
		return false, nil
	}
	removed, err := common.RDB.SRem(context.Background(), moderationHashSetKey, hash).Result()
	return removed > 0, err
}

func ClearContentModerationHashes() (int64, error) {
	count := ContentModerationHashCount()
	if count == 0 {
		return 0, nil
	}
	return count, common.RDB.Del(context.Background(), moderationHashSetKey).Err()
}

type ContentModerationStatus struct {
	Engine       string `json:"engine"`
	Enabled      bool   `json:"enabled"`
	Mode         string `json:"mode"`
	RedisEnabled bool   `json:"redis_enabled"`

	PreBlockActive       int64 `json:"pre_block_active"`
	PreBlockChecked      int64 `json:"pre_block_checked"`
	PreBlockAllowed      int64 `json:"pre_block_allowed"`
	PreBlockBlocked      int64 `json:"pre_block_blocked"`
	PreBlockErrors       int64 `json:"pre_block_errors"`
	PreBlockAvgLatencyMs int64 `json:"pre_block_avg_latency_ms"`

	WorkerCount       int     `json:"worker_count"`
	MaxWorkers        int     `json:"max_workers"`
	ActiveWorkers     int64   `json:"active_workers"`
	IdleWorkers       int64   `json:"idle_workers"`
	QueueSize         int     `json:"queue_size"`
	QueueLength       int     `json:"queue_length"`
	QueueUsagePercent float64 `json:"queue_usage_percent"`
	Enqueued          int64   `json:"enqueued"`
	Dropped           int64   `json:"dropped"`
	Processed         int64   `json:"processed"`
	AsyncErrors       int64   `json:"async_errors"`

	APIKeyCount          int                   `json:"api_key_count"`
	APIKeyAvailableCount int                   `json:"api_key_available_count"`
	APIKeyActive         int64                 `json:"api_key_active"`
	APIKeyTotalCalls     int64                 `json:"api_key_total_calls"`
	APIKeyLoads          []ModerationKeyLoad   `json:"api_key_loads"`
	APIKeyStatuses       []ModerationKeyStatus `json:"api_key_statuses"`

	FlaggedHashCount         int64 `json:"flagged_hash_count"`
	LastCleanupAt            int64 `json:"last_cleanup_at"`
	LastCleanupDeletedHit    int64 `json:"last_cleanup_deleted_hit"`
	LastCleanupDeletedNonHit int64 `json:"last_cleanup_deleted_non_hit"`

	CyberPolicyHits     int64 `json:"cyber_policy_hits"`
	CyberSessionBlocked int64 `json:"cyber_session_blocked"`
}

// GetContentModerationStatus reports this process's runtime counters; they
// reset on restart and are not shared between nodes.
func GetContentModerationStatus() ContentModerationStatus {
	config := operation_setting.GetContentModerationConfig()
	status := ContentModerationStatus{
		Engine:                   moderationSourceOpenAI,
		Enabled:                  config.Enabled,
		Mode:                     config.Mode,
		RedisEnabled:             common.RedisEnabled,
		PreBlockActive:           moderationStats.preBlockActive.Load(),
		PreBlockChecked:          moderationStats.preBlockChecked.Load(),
		PreBlockAllowed:          moderationStats.preBlockAllowed.Load(),
		PreBlockBlocked:          moderationStats.preBlockBlocked.Load(),
		PreBlockErrors:           moderationStats.preBlockErrors.Load(),
		WorkerCount:              config.WorkerCount,
		MaxWorkers:               operation_setting.ContentModerationMaxWorkers,
		ActiveWorkers:            moderationStats.activeWorkers.Load(),
		QueueSize:                config.QueueSize,
		QueueLength:              len(moderationQueue),
		Enqueued:                 moderationStats.enqueued.Load(),
		Dropped:                  moderationStats.dropped.Load(),
		Processed:                moderationStats.processed.Load(),
		AsyncErrors:              moderationStats.asyncErrors.Load(),
		APIKeyCount:              len(config.APIKeys),
		APIKeyAvailableCount:     availableModerationKeyCount(config.APIKeys),
		APIKeyStatuses:           moderationKeyStatuses(config.APIKeys, true),
		FlaggedHashCount:         ContentModerationHashCount(),
		LastCleanupAt:            moderationStats.lastCleanupAt.Load(),
		LastCleanupDeletedHit:    moderationStats.lastCleanupDeletedHit.Load(),
		LastCleanupDeletedNonHit: moderationStats.lastCleanupDeletedNonHit.Load(),
		CyberPolicyHits:          cyberStats.hits.Load(),
		CyberSessionBlocked:      cyberStats.sessionBlocked.Load(),
	}
	if status.PreBlockChecked > 0 {
		status.PreBlockAvgLatencyMs = moderationStats.preBlockLatencyMs.Load() / status.PreBlockChecked
	}
	status.IdleWorkers = max(int64(config.WorkerCount)-status.ActiveWorkers, 0)
	if config.QueueSize > 0 {
		status.QueueUsagePercent = float64(status.QueueLength) * 100 / float64(config.QueueSize)
	}
	status.APIKeyLoads, status.APIKeyActive, status.APIKeyTotalCalls = moderationKeyLoads(config.APIKeys)
	return status
}

type ContentModerationConfigView struct {
	operation_setting.ContentModerationConfig
	APIKeys          []string              `json:"api_keys"`
	APIKeyConfigured bool                  `json:"api_key_configured"`
	APIKeyCount      int                   `json:"api_key_count"`
	APIKeyMasks      []string              `json:"api_key_masks"`
	APIKeyStatuses   []ModerationKeyStatus `json:"api_key_statuses"`
}

// GetContentModerationConfigView returns the config without plaintext keys.
func GetContentModerationConfigView() ContentModerationConfigView {
	config := operation_setting.GetContentModerationConfig()
	masks := make([]string, 0, len(config.APIKeys))
	for _, key := range config.APIKeys {
		masks = append(masks, maskModerationKey(key))
	}
	return ContentModerationConfigView{
		ContentModerationConfig: *config,
		APIKeys:                 []string{},
		APIKeyConfigured:        len(config.APIKeys) > 0,
		APIKeyCount:             len(config.APIKeys),
		APIKeyMasks:             masks,
		APIKeyStatuses:          moderationKeyStatuses(config.APIKeys, true),
	}
}

// ContentModerationConfigUpdate replaces all settings except the keys, which
// are changed through APIKeysMode, DeleteAPIKeyHashes and ClearAPIKeys so the
// stored keys never need to be sent back to the browser.
type ContentModerationConfigUpdate struct {
	operation_setting.ContentModerationConfig
	APIKeysMode        string   `json:"api_keys_mode"`
	DeleteAPIKeyHashes []string `json:"delete_api_key_hashes"`
	ClearAPIKeys       bool     `json:"clear_api_keys"`
}

func UpdateContentModerationConfig(update ContentModerationConfigUpdate) error {
	current := operation_setting.GetContentModerationConfig()
	next := update.ContentModerationConfig
	switch {
	case update.ClearAPIKeys:
		next.APIKeys = []string{}
	case update.APIKeysMode == "replace":
	default:
		kept := make([]string, 0, len(current.APIKeys))
		for _, key := range current.APIKeys {
			if !slices.Contains(update.DeleteAPIKeyHashes, moderationKeyHash(key)) {
				kept = append(kept, key)
			}
		}
		next.APIKeys = append(kept, next.APIKeys...)
	}
	if err := next.Validate(); err != nil {
		return err
	}
	next.Normalize()
	encoded, err := common.Marshal(next)
	if err != nil {
		return err
	}
	return model.UpdateOption(operation_setting.ContentModerationOptionKey, string(encoded))
}
