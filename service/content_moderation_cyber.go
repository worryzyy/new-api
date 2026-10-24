package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"slices"
	"strconv"
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

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// CyberPolicyErrorCode is the error code OpenAI (Codex) returns when its own
// cyber-security policy rejects a request: an HTTP 400 body or a
// response.failed stream event.
const CyberPolicyErrorCode = "cyber_policy"

const (
	moderationSourceUpstream = "upstream"

	cyberSessionBlockPrefix = "content_moderation:cyber_session_block:"
	cyberSessionScopePrefix = "content_moderation:cyber_session_scope:"
	// Redis commands carry at most this many keys, and one request looks up
	// at most cyberTranscriptMaxKeys transcript prefixes.
	cyberSessionRedisBatch = 128
	cyberTranscriptMaxKeys = 256
	// cyberSessionOverflowKey blocks a request whose transcript is longer
	// than the lookup bound once its source already produced a hit, so
	// padding a conversation cannot push the blocked prefix out of reach.
	cyberSessionOverflowKey  = "transcript_lookup_limit_exceeded"
	cyberSessionRedisTimeout = 500 * time.Millisecond
)

// cyberSessionHeaders carry an explicit conversation id from Codex and other
// coding clients.
var cyberSessionHeaders = []string{
	"session-id", "session_id", "conversation_id",
	"X-Session-Affinity", "X-Session-Id", "X-OpenCode-Session", "X-Conversation-ID",
}

var (
	cyberUserAgentProductPattern = regexp.MustCompile(`([A-Za-z0-9._-]+)/[A-Za-z0-9._-]+`)
	cyberUserAgentVersionPattern = regexp.MustCompile(`\bv?\d+(?:\.\d+){1,3}\b`)
)

var cyberStats struct {
	hits           atomic.Int64
	sessionBlocked atomic.Int64
}

func IsCyberPolicyCode(code string) bool {
	return strings.EqualFold(strings.TrimSpace(code), CyberPolicyErrorCode)
}

// IsCyberPolicyError reports an upstream cyber_policy rejection. It is final:
// another channel of the same upstream would reject the request again.
func IsCyberPolicyError(err *types.NewAPIError) bool {
	return err != nil && IsCyberPolicyCode(string(err.GetErrorCode()))
}

// RecordUpstreamCyberPolicy handles a request that upstream rejected with
// cyber_policy, as an error or as a failed stream. The client already got the
// upstream answer; this blocks the conversation when session blocking is on
// and writes the content audit record, which counts toward automatic bans
// unless cyber_policy is excluded from the count.
func RecordUpstreamCyberPolicy(c *gin.Context, info *relaycommon.RelayInfo, apiErr *types.NewAPIError) {
	if info == nil {
		return
	}
	var message string
	switch {
	case IsCyberPolicyError(apiErr):
		message = fmt.Sprintf("upstream status %d: %s", apiErr.StatusCode, apiErr.ToOpenAIError().Message)
	case info.StreamStatus != nil && IsCyberPolicyCode(info.StreamStatus.OutcomeSnapshot().ErrorCode):
		message = "upstream stream response.failed: " + info.CyberPolicyMessage
	default:
		return
	}
	cyberStats.hits.Add(1)
	config := operation_setting.GetContentModerationConfig()
	logOnly := slices.Contains(config.ExemptUserIds, info.UserId)
	logger.LogWarn(c, common.LogText("upstream rejected request with cyber_policy: user=%d token=%d", info.UserId, info.TokenId))
	if config.CyberSessionBlockEnabled && !logOnly {
		markCyberSessionBlocked(c, info.TokenId, cyberRequestBody(c), time.Duration(config.CyberSessionBlockTTLSeconds)*time.Second)
	}
	if !config.Enabled || !config.GroupInScope(info.UsingGroup) || !config.ModelInScope(info.OriginModelName) {
		return
	}
	entry := &model.ContentModerationLog{
		CreatedAt: common.GetTimestamp(),
		RequestId: c.GetString(common.RequestIdKey),
		UserId:    info.UserId,
		Username:  common.GetContextKeyString(c, constant.ContextKeyUserName),
		UserEmail: info.UserEmail,
		TokenId:   info.TokenId,
		TokenName: c.GetString("token_name"),
		GroupName: info.UsingGroup,
		ModelName: info.OriginModelName,
		Endpoint:  c.Request.URL.Path,
		Mode:      model.ContentModerationModePostUpstream,
		Action:    model.ContentModerationActionCyberPolicy,
		Flagged:   true,
		Source:    moderationSourceUpstream,
		Category:  CyberPolicyErrorCode,
		Score:     1,
		Error:     moderationExcerpt(ModerationInput{Text: message}),
	}
	if info.Request != nil {
		entry.InputExcerpt = moderationExcerpt(ExtractModerationInput(info.Request))
	}
	if logOnly {
		entry.Mode = model.ContentModerationModeLogOnly
	}
	gopool.Go(func() {
		if !logOnly && !config.CyberPolicyExcludeFromBanCount {
			countContentViolation(config, entry)
		}
		if err := model.CreateContentModerationLog(entry); err != nil {
			common.SysError(common.LogText("failed to record cyber_policy content moderation log: %s", err.Error()))
		}
	})
}

// CheckCyberSessionBlocked rejects a request that continues a conversation
// upstream already rejected with cyber_policy. Redis failures let the request
// through.
func CheckCyberSessionBlocked(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	config := operation_setting.GetContentModerationConfig()
	if !config.CyberSessionBlockEnabled || !common.RedisEnabled || common.RDB == nil || info == nil {
		return nil
	}
	if slices.Contains(config.ExemptUserIds, info.UserId) {
		return nil
	}
	body := cyberRequestBody(c)
	if len(body) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), cyberSessionRedisTimeout)
	defer cancel()
	blockedKey, err := findCyberSessionBlocked(ctx, c, info.TokenId, body)
	if err != nil {
		logger.LogWarn(c, common.LogText("cyber session block lookup failed, request allowed: %s", err.Error()))
		return nil
	}
	if blockedKey == "" {
		return nil
	}
	cyberStats.sessionBlocked.Add(1)
	RequestPolicy(c).AddEvent(PolicyEvent{ErrorCode: string(types.ErrorCodeCyberSessionBlocked), ErrorSource: "local", Decision: PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
	logger.LogWarn(c, common.LogText("cyber session block rejected request: user=%d token=%d", info.UserId, info.TokenId))
	return types.WithOpenAIError(types.OpenAIError{
		Message: i18n.T(c, i18n.MsgRelayCyberSessionBlocked),
		Type:    "permission_error",
		Code:    string(types.ErrorCodeCyberSessionBlocked),
	}, 403, types.ErrOptionWithSkipRetry())
}

func findCyberSessionBlocked(ctx context.Context, c *gin.Context, tokenId int, body []byte) (string, error) {
	if explicitKey := cyberSessionExplicitKey(c, tokenId, body); explicitKey != "" {
		key, err := firstCyberSessionBlocked(ctx, []string{explicitKey})
		if err != nil || key != "" {
			return key, err
		}
	}
	// The coarse scope skips transcript hashing for sources that never
	// produced a hit.
	active, err := common.RDB.Exists(ctx, cyberSessionScopePrefix+cyberSessionScopeKey(c, tokenId)).Result()
	if err != nil || active == 0 {
		return "", err
	}
	transcript := deriveCyberTranscriptKeys(tokenId, body)
	if transcript.truncated {
		return cyberSessionOverflowKey, nil
	}
	return firstCyberSessionBlocked(ctx, transcript.lookupKeys)
}

func firstCyberSessionBlocked(ctx context.Context, keys []string) (string, error) {
	for batch := range slices.Chunk(keys, cyberSessionRedisBatch) {
		redisKeys := make([]string, len(batch))
		for i, key := range batch {
			redisKeys[i] = cyberSessionBlockPrefix + key
		}
		values, err := common.RDB.MGet(ctx, redisKeys...).Result()
		if err != nil {
			return "", err
		}
		for i, value := range values {
			if value != nil {
				return batch[i], nil
			}
		}
	}
	return "", nil
}

// markCyberSessionBlocked stores the explicit session key and the transcript
// keys of the rejected request, then activates the coarse scope.
func markCyberSessionBlocked(c *gin.Context, tokenId int, body []byte, ttl time.Duration) {
	if !common.RedisEnabled || common.RDB == nil || len(body) == 0 {
		return
	}
	keys := make([]string, 0, 3)
	if key := cyberSessionExplicitKey(c, tokenId, body); key != "" {
		keys = append(keys, key)
	}
	transcript := deriveCyberTranscriptKeys(tokenId, body)
	if n := len(transcript.lookupKeys); n > 0 {
		keys = append(keys, transcript.lookupKeys[n-1])
		if transcript.preLatestUserKey != "" && transcript.preLatestUserKey != transcript.lookupKeys[n-1] {
			keys = append(keys, transcript.preLatestUserKey)
		}
	}
	if len(keys) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), cyberSessionRedisTimeout)
	defer cancel()
	pipe := common.RDB.TxPipeline()
	for _, key := range keys {
		pipe.Set(ctx, cyberSessionBlockPrefix+key, "1", ttl)
	}
	if len(transcript.lookupKeys) > 0 {
		pipe.Set(ctx, cyberSessionScopePrefix+cyberSessionScopeKey(c, tokenId), "1", ttl)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		common.SysError(common.LogText("failed to store cyber session block: %s", err.Error()))
	}
}

// cyberRequestBody is the client request body the session block keys derive
// from; on the Responses WebSocket it is the current response.create event.
func cyberRequestBody(c *gin.Context) []byte {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil
	}
	body, err := storage.Bytes()
	if err != nil {
		return nil
	}
	return body
}

func cyberSessionExplicitKey(c *gin.Context, tokenId int, body []byte) string {
	sessionId := ""
	for _, header := range cyberSessionHeaders {
		if sessionId = strings.TrimSpace(c.GetHeader(header)); sessionId != "" {
			break
		}
	}
	if sessionId == "" {
		sessionId = strings.TrimSpace(cyberRequestPayload(body).Get("prompt_cache_key").String())
	}
	if sessionId == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("cyber-session:v1|token=" + strconv.Itoa(tokenId) + "|" + sessionId))
	return hex.EncodeToString(sum[:])
}

// cyberSessionScopeKey fingerprints the source of a request: token, client
// IP and the client products named in the User-Agent, without versions.
func cyberSessionScopeKey(c *gin.Context, tokenId int) string {
	raw := "cyber-scope:v1|token=" + strconv.Itoa(tokenId) +
		"|ip=" + strings.TrimSpace(c.ClientIP()) +
		"|ua=" + normalizeCyberUserAgent(c.GetHeader("User-Agent"))
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func normalizeCyberUserAgent(raw string) string {
	raw = strings.TrimSpace(raw)
	products := make([]string, 0, 4)
	for _, match := range cyberUserAgentProductPattern.FindAllStringSubmatch(raw, -1) {
		product := strings.ToLower(match[1])
		if !slices.Contains(products, product) {
			products = append(products, product)
		}
	}
	if len(products) > 0 {
		slices.Sort(products)
		return strings.Join(products, "+")
	}
	normalized := cyberUserAgentVersionPattern.ReplaceAllString(strings.ToLower(raw), "")
	return strings.Join(strings.Fields(normalized), " ")
}

// cyberRequestPayload unwraps a Responses WebSocket event envelope.
func cyberRequestPayload(body []byte) gjson.Result {
	root := gjson.ParseBytes(body)
	if strings.HasPrefix(strings.ToLower(root.Get("type").String()), "response.") {
		if response := root.Get("response"); response.IsObject() {
			return response
		}
	}
	return root
}

type cyberTranscriptKeys struct {
	// lookupKeys are cumulative hashes of the conversation history, one per
	// item, keeping the latest cyberTranscriptMaxKeys in order.
	lookupKeys []string
	// preLatestUserKey hashes the history before the latest user turn. It is
	// only set after a model-generated item, so a shared first-turn template
	// cannot block unrelated conversations.
	preLatestUserKey string
	truncated        bool
}

// deriveCyberTranscriptKeys hashes the conversation of a chat (messages) or
// Responses (input) request, so a follow-up request that resends the same
// history matches the rejected one.
func deriveCyberTranscriptKeys(tokenId int, body []byte) cyberTranscriptKeys {
	root := cyberRequestPayload(body)
	if !root.IsObject() {
		return cyberTranscriptKeys{}
	}
	hash := sha256.New()
	hash.Write([]byte("cyber-transcript:v1|token=" + strconv.Itoa(tokenId)))
	// Model and tools are configuration; instructions are model-visible
	// context and belong to the conversation identity.
	if instructions := root.Get("instructions"); instructions.Exists() && strings.TrimSpace(instructions.String()) != "" {
		canonical := instructions.String()
		if instructions.Type != gjson.String {
			canonical = canonicalCyberJSON(instructions.Raw)
		}
		hash.Write([]byte("|instructions=" + canonical))
	}

	sequence := root.Get("messages")
	if !sequence.Exists() {
		sequence = root.Get("input")
	}
	if sequence.Type == gjson.String {
		if strings.TrimSpace(sequence.String()) == "" {
			return cyberTranscriptKeys{}
		}
		hash.Write([]byte("|item=" + canonicalCyberJSON(sequence.Raw)))
		return cyberTranscriptKeys{lookupKeys: []string{hex.EncodeToString(hash.Sum(nil))}}
	}
	if !sequence.IsArray() {
		return cyberTranscriptKeys{}
	}
	result := cyberTranscriptKeys{lookupKeys: make([]string, 0, min(len(sequence.Array()), cyberTranscriptMaxKeys))}
	next := 0
	lastKey := ""
	modelGenerated := false
	sequence.ForEach(func(_, item gjson.Result) bool {
		canonical := canonicalCyberJSON(item.Raw)
		if strings.TrimSpace(canonical) == "" {
			return true
		}
		if cyberItemStartsUserTurn(item) && modelGenerated && lastKey != "" {
			result.preLatestUserKey = lastKey
		}
		hash.Write([]byte("|item=" + canonical))
		lastKey = hex.EncodeToString(hash.Sum(nil))
		if len(result.lookupKeys) < cyberTranscriptMaxKeys {
			result.lookupKeys = append(result.lookupKeys, lastKey)
		} else {
			result.lookupKeys[next] = lastKey
			next = (next + 1) % cyberTranscriptMaxKeys
			result.truncated = true
		}
		if cyberItemModelGenerated(item) {
			modelGenerated = true
		}
		return true
	})
	if result.truncated {
		result.lookupKeys = append(result.lookupKeys[next:], result.lookupKeys[:next]...)
	}
	return result
}

// canonicalCyberJSON re-encodes JSON so key order and whitespace do not change
// the hash.
func canonicalCyberJSON(raw string) string {
	var value any
	if err := common.UnmarshalJsonStr(raw, &value); err != nil {
		return raw
	}
	encoded, err := common.Marshal(value)
	if err != nil {
		return raw
	}
	return string(encoded)
}

func cyberItemStartsUserTurn(item gjson.Result) bool {
	if !strings.EqualFold(item.Get("role").String(), "user") {
		return strings.EqualFold(item.Get("type").String(), "input_text")
	}
	content := item.Get("content")
	if !content.IsArray() {
		return content.Exists()
	}
	userContent := false
	content.ForEach(func(_, block gjson.Result) bool {
		switch strings.ToLower(block.Get("type").String()) {
		case "tool_result", "function_call_output", "custom_tool_call_output", "computer_call_output":
		default:
			userContent = true
		}
		return !userContent
	})
	return userContent
}

func cyberItemModelGenerated(item gjson.Result) bool {
	switch strings.ToLower(item.Get("role").String()) {
	case "assistant", "model":
		return true
	}
	switch strings.ToLower(item.Get("type").String()) {
	case "output_text", "function_call", "tool_call", "custom_tool_call", "computer_call":
		return true
	}
	return false
}
