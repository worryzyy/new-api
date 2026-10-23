package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

const (
	moderationMaxTextRunes    = 10000
	moderationExcerptRunes    = 500
	moderationMaxImageURLSize = 8 << 20
	moderationQueueSize       = 2000
	moderationWorkerCount     = 2
)

// ModerationInput is the part of a relay request that moderation inspects:
// the latest user turn only, so replayed history is not re-judged each turn.
type ModerationInput struct {
	Text     string
	ImageURL string
}

type ModerationVerdict struct {
	Flagged        bool               `json:"flagged"`
	Source         string             `json:"source,omitempty"`
	MatchedKeyword string             `json:"matched_keyword,omitempty"`
	Category       string             `json:"category,omitempty"`
	Score          float64            `json:"score,omitempty"`
	CategoryScores map[string]float64 `json:"category_scores,omitempty"`
}

type moderationJob struct {
	input     ModerationInput
	requestId string
	userId    int
	username  string
	tokenId   int
	tokenName string
	group     string
	modelName string
	endpoint  string
}

var (
	moderationQueue     chan moderationJob
	moderationStartOnce sync.Once
)

// ModerateRelayRequest runs the configured content moderation before billing.
// It returns an error only when block mode flags the request; moderation
// failures never reject a request.
func ModerateRelayRequest(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	setting := operation_setting.GetContentModerationSetting()
	if setting.Mode != operation_setting.ContentModerationModeBlock && setting.Mode != operation_setting.ContentModerationModeObserve {
		return nil
	}
	if info == nil || info.Request == nil || !moderationAppliesTo(setting, info.UserId, info.UsingGroup, info.OriginModelName) {
		return nil
	}
	input := ExtractModerationInput(info.Request)
	if input.Text == "" && input.ImageURL == "" {
		return nil
	}
	moderationStartOnce.Do(startModerationWorkers)

	job := moderationJob{
		input:     input,
		requestId: c.GetString(common.RequestIdKey),
		userId:    info.UserId,
		username:  common.GetContextKeyString(c, constant.ContextKeyUserName),
		tokenId:   info.TokenId,
		tokenName: c.GetString("token_name"),
		group:     info.UsingGroup,
		modelName: info.OriginModelName,
		endpoint:  c.Request.URL.Path,
	}

	if setting.Mode == operation_setting.ContentModerationModeObserve {
		select {
		case moderationQueue <- job:
		default:
			common.SysError("content moderation queue is full, dropping an observe-mode check")
		}
		return nil
	}

	verdict, err := CheckModerationInput(c.Request.Context(), input)
	if err != nil {
		logger.LogWarn(c, common.LogText("content moderation check failed, request allowed: %s", err.Error()))
	}
	if !verdict.Flagged {
		return nil
	}
	recordContentViolation(job, verdict, model.ContentModerationActionBlock)
	RequestPolicy(c).AddEvent(PolicyEvent{ErrorCode: string(types.ErrorCodeContentPolicyViolation), ErrorSource: "local", Decision: PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
	logger.LogWarn(c, common.LogText("content moderation blocked request: source=%s category=%s keyword=%s", verdict.Source, verdict.Category, verdict.MatchedKeyword))
	return types.NewErrorWithStatusCode(errors.New(i18n.T(c, i18n.MsgRelayContentPolicyViolation)), types.ErrorCodeContentPolicyViolation, http.StatusForbidden, types.ErrOptionWithSkipRetry())
}

// CheckModerationInput applies the keyword list first and then, when enabled,
// the OpenAI moderation endpoint. A non-nil error means the OpenAI check could
// not complete; the returned verdict still reflects the keyword result.
func CheckModerationInput(ctx context.Context, input ModerationInput) (ModerationVerdict, error) {
	setting := operation_setting.GetContentModerationSetting()
	if keyword := matchModerationKeyword(setting.Keywords, input.Text); keyword != "" {
		return ModerationVerdict{Flagged: true, Source: model.ContentModerationSourceKeyword, MatchedKeyword: keyword}, nil
	}
	if !setting.OpenAIEnabled || strings.TrimSpace(setting.OpenAIAPIKey) == "" {
		return ModerationVerdict{}, nil
	}
	result, err := requestOpenAIModeration(ctx, setting, input)
	if err != nil {
		return ModerationVerdict{}, err
	}
	return EvaluateOpenAIModeration(result, setting.CategoryThresholds), nil
}

// ExtractModerationInput returns the text and first image of the latest user
// turn for each supported relay format.
func ExtractModerationInput(request dto.Request) ModerationInput {
	var input ModerationInput
	switch req := request.(type) {
	case *dto.GeneralOpenAIRequest:
		for i := len(req.Messages) - 1; i >= 0; i-- {
			if req.Messages[i].Role != "user" {
				continue
			}
			var text strings.Builder
			for _, part := range req.Messages[i].ParseContent() {
				switch part.Type {
				case dto.ContentTypeText:
					appendModerationText(&text, part.Text)
				case dto.ContentTypeImageURL:
					if image := part.GetImageMedia(); image != nil && input.ImageURL == "" {
						input.ImageURL = image.Url
					}
				}
			}
			input.Text = text.String()
			break
		}
		if len(req.Messages) == 0 {
			if prompt, ok := req.Prompt.(string); ok {
				input.Text = prompt
			}
		}
	case *dto.ClaudeRequest:
		for i := len(req.Messages) - 1; i >= 0; i-- {
			if req.Messages[i].Role != "user" {
				continue
			}
			if req.Messages[i].IsStringContent() {
				input.Text = req.Messages[i].GetStringContent()
				break
			}
			parts, _ := req.Messages[i].ParseContent()
			var text strings.Builder
			for _, part := range parts {
				switch part.Type {
				case dto.ContentTypeText:
					if part.Text != nil {
						appendModerationText(&text, *part.Text)
					}
				case "image":
					if input.ImageURL == "" && part.Source != nil {
						input.ImageURL = claudeImageURL(part.Source)
					}
				}
			}
			input.Text = text.String()
			break
		}
	case *dto.GeminiChatRequest:
		for i := len(req.Contents) - 1; i >= 0; i-- {
			if req.Contents[i].Role != "" && req.Contents[i].Role != "user" {
				continue
			}
			var text strings.Builder
			for _, part := range req.Contents[i].Parts {
				if part.Text != "" && !part.Thought {
					appendModerationText(&text, part.Text)
				}
				if input.ImageURL == "" && part.InlineData != nil && strings.HasPrefix(part.InlineData.MimeType, "image/") {
					input.ImageURL = "data:" + part.InlineData.MimeType + ";base64," + part.InlineData.Data
				}
			}
			input.Text = text.String()
			break
		}
	case *dto.OpenAIResponsesRequest:
		input = extractResponsesModerationInput(req)
	case *dto.ImageRequest:
		input.Text = req.Prompt
	}
	input.Text = stripSystemReminders(input.Text)
	return input
}

func extractResponsesModerationInput(req *dto.OpenAIResponsesRequest) ModerationInput {
	var input ModerationInput
	switch common.GetJsonType(req.Input) {
	case "string":
		_ = common.Unmarshal(req.Input, &input.Text)
		return input
	case "array":
	default:
		return input
	}
	var items []dto.Input
	if err := common.Unmarshal(req.Input, &items); err != nil {
		return input
	}
	for i := len(items) - 1; i >= 0; i-- {
		item := items[i]
		if item.Role != "user" || (item.Type != "" && item.Type != "message") {
			continue
		}
		if common.GetJsonType(item.Content) == "string" {
			_ = common.Unmarshal(item.Content, &input.Text)
			return input
		}
		var parts []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			ImageURL any    `json:"image_url"`
		}
		if err := common.Unmarshal(item.Content, &parts); err != nil {
			return input
		}
		var text strings.Builder
		for _, part := range parts {
			switch part.Type {
			case "input_text":
				appendModerationText(&text, part.Text)
			case "input_image":
				if url, ok := part.ImageURL.(string); ok && input.ImageURL == "" {
					input.ImageURL = url
				}
			}
		}
		input.Text = text.String()
		return input
	}
	return input
}

func appendModerationText(builder *strings.Builder, text string) {
	if text == "" {
		return
	}
	if builder.Len() > 0 {
		builder.WriteString("\n")
	}
	builder.WriteString(text)
}

func claudeImageURL(source *dto.ClaudeMessageSource) string {
	if source.Url != "" {
		return source.Url
	}
	data, ok := source.Data.(string)
	if !ok || data == "" || source.MediaType == "" {
		return ""
	}
	return "data:" + source.MediaType + ";base64," + data
}

// stripSystemReminders removes <system-reminder> blocks that coding agents
// inject into user turns; they are client scaffolding, not user input.
func stripSystemReminders(text string) string {
	const openTag, closeTag = "<system-reminder>", "</system-reminder>"
	for {
		start := strings.Index(text, openTag)
		if start < 0 {
			return strings.TrimSpace(text)
		}
		end := strings.Index(text[start:], closeTag)
		if end < 0 {
			return strings.TrimSpace(text[:start])
		}
		text = text[:start] + text[start+end+len(closeTag):]
	}
}

func splitModerationList(raw string) []string {
	var items []string
	for _, item := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == '\n' || r == '\r' }) {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}

func moderationAppliesTo(setting *operation_setting.ContentModerationSetting, userId int, group string, modelName string) bool {
	for _, raw := range splitModerationList(setting.ExemptUserIds) {
		if id, err := strconv.Atoi(raw); err == nil && id == userId {
			return false
		}
	}
	if groups := splitModerationList(setting.IncludeGroups); len(groups) > 0 && !moderationListMatches(groups, group) {
		return false
	}
	if models := splitModerationList(setting.IncludeModels); len(models) > 0 && !moderationListMatches(models, modelName) {
		return false
	}
	return !moderationListMatches(splitModerationList(setting.ExcludeModels), modelName)
}

// moderationListMatches matches exact names, or prefixes for entries ending in "*".
func moderationListMatches(patterns []string, name string) bool {
	for _, pattern := range patterns {
		if prefix, ok := strings.CutSuffix(pattern, "*"); ok {
			if strings.HasPrefix(name, prefix) {
				return true
			}
			continue
		}
		if pattern == name {
			return true
		}
	}
	return false
}

func matchModerationKeyword(rawKeywords string, text string) string {
	if text == "" {
		return ""
	}
	var keywords []string
	for line := range strings.SplitSeq(rawKeywords, "\n") {
		if line = strings.ToLower(strings.TrimSpace(line)); line != "" {
			keywords = append(keywords, line)
		}
	}
	if len(keywords) == 0 {
		return ""
	}
	if found, words := AcSearch(strings.ToLower(text), keywords, true); found && len(words) > 0 {
		return words[0]
	}
	return ""
}

type OpenAIModerationResult struct {
	Flagged        bool               `json:"flagged"`
	Categories     map[string]bool    `json:"categories"`
	CategoryScores map[string]float64 `json:"category_scores"`
}

type openAIModerationResponse struct {
	Results []OpenAIModerationResult `json:"results"`
	Error   *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// EvaluateOpenAIModeration decides whether a moderation result is a violation.
// Categories with a configured threshold are judged by score alone; other
// categories follow the upstream flag. The highest-scoring hit is reported.
func EvaluateOpenAIModeration(result OpenAIModerationResult, thresholds map[string]float64) ModerationVerdict {
	verdict := ModerationVerdict{Source: model.ContentModerationSourceOpenAI, CategoryScores: result.CategoryScores}
	categories := make(map[string]struct{}, len(result.Categories)+len(result.CategoryScores))
	for category := range result.Categories {
		categories[category] = struct{}{}
	}
	for category := range result.CategoryScores {
		categories[category] = struct{}{}
	}
	for category := range categories {
		score := result.CategoryScores[category]
		hit := result.Categories[category]
		if threshold, ok := thresholds[category]; ok && threshold > 0 {
			hit = score >= threshold
		}
		if !hit {
			continue
		}
		if !verdict.Flagged || score > verdict.Score || (score == verdict.Score && category < verdict.Category) {
			verdict.Category = category
			verdict.Score = score
		}
		verdict.Flagged = true
	}
	return verdict
}

func requestOpenAIModeration(ctx context.Context, setting *operation_setting.ContentModerationSetting, input ModerationInput) (OpenAIModerationResult, error) {
	parts := make([]map[string]any, 0, 2)
	if text := truncateRunes(input.Text, moderationMaxTextRunes); text != "" {
		parts = append(parts, map[string]any{"type": "text", "text": text})
	}
	if setting.CheckImages && input.ImageURL != "" && len(input.ImageURL) <= moderationMaxImageURLSize {
		parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": input.ImageURL}})
	}
	if len(parts) == 0 {
		return OpenAIModerationResult{}, nil
	}
	body, err := common.Marshal(map[string]any{"model": setting.OpenAIModel, "input": parts})
	if err != nil {
		return OpenAIModerationResult{}, err
	}

	timeout := time.Duration(max(setting.TimeoutMs, 500)) * time.Millisecond
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	baseURL := strings.TrimRight(strings.TrimSpace(setting.OpenAIBaseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	endpoint := baseURL + "/v1/moderations"
	if strings.HasSuffix(baseURL, "/v1") {
		endpoint = baseURL + "/moderations"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return OpenAIModerationResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(setting.OpenAIAPIKey))

	resp, err := GetHttpClient().Do(req)
	if err != nil {
		return OpenAIModerationResult{}, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return OpenAIModerationResult{}, err
	}
	var parsed openAIModerationResponse
	if err := common.Unmarshal(respBody, &parsed); err != nil {
		return OpenAIModerationResult{}, fmt.Errorf("moderation response status %d: %w", resp.StatusCode, err)
	}
	if resp.StatusCode != http.StatusOK || parsed.Error != nil {
		message := http.StatusText(resp.StatusCode)
		if parsed.Error != nil {
			message = parsed.Error.Message
		}
		return OpenAIModerationResult{}, fmt.Errorf("moderation request failed with status %d: %s", resp.StatusCode, message)
	}
	if len(parsed.Results) == 0 {
		return OpenAIModerationResult{}, errors.New("moderation response has no results")
	}
	return parsed.Results[0], nil
}

func truncateRunes(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return string([]rune(text)[:limit])
}

func startModerationWorkers() {
	moderationQueue = make(chan moderationJob, moderationQueueSize)
	for range moderationWorkerCount {
		go func() {
			for job := range moderationQueue {
				verdict, err := CheckModerationInput(context.Background(), job.input)
				if err != nil {
					common.SysError(common.LogText("content moderation observe check failed: %s", err.Error()))
				}
				if verdict.Flagged {
					recordContentViolation(job, verdict, model.ContentModerationActionObserve)
				}
			}
		}()
	}
	go func() {
		for {
			if days := operation_setting.GetContentModerationSetting().LogRetentionDays; days > 0 {
				cutoff := common.GetTimestamp() - int64(days)*86400
				if _, err := model.DeleteContentModerationLogsBefore(cutoff); err != nil {
					common.SysError(common.LogText("failed to clean content moderation logs: %s", err.Error()))
				}
			}
			time.Sleep(6 * time.Hour)
		}
	}()
}

// recordContentViolation stores the violation and, for blocked requests,
// disables the user once the configured number of violations is reached.
func recordContentViolation(job moderationJob, verdict ModerationVerdict, action string) {
	setting := operation_setting.GetContentModerationSetting()
	now := common.GetTimestamp()
	entry := &model.ContentModerationLog{
		CreatedAt:      now,
		RequestId:      job.requestId,
		UserId:         job.userId,
		Username:       job.username,
		TokenId:        job.tokenId,
		TokenName:      job.tokenName,
		GroupName:      job.group,
		ModelName:      job.modelName,
		Endpoint:       job.endpoint,
		Action:         action,
		Source:         verdict.Source,
		MatchedKeyword: verdict.MatchedKeyword,
		Category:       verdict.Category,
		Score:          verdict.Score,
		InputExcerpt:   truncateRunes(job.input.Text, moderationExcerptRunes),
	}
	if job.input.ImageURL != "" {
		entry.InputExcerpt += "\n[image]"
	}
	if len(verdict.CategoryScores) > 0 {
		if encoded, err := common.Marshal(verdict.CategoryScores); err == nil {
			entry.CategoryScores = string(encoded)
		}
	}

	if action == model.ContentModerationActionBlock && job.userId > 0 {
		since := now - int64(max(setting.AutoBanWindowHours, 1))*3600
		count, err := model.CountUserBlockedViolationsSince(job.userId, since)
		if err != nil {
			common.SysError(common.LogText("failed to count content violations for user %d: %s", job.userId, err.Error()))
		}
		entry.ViolationCount = int(count) + 1
		if setting.AutoBanEnabled && setting.AutoBanThreshold > 0 && entry.ViolationCount >= setting.AutoBanThreshold {
			entry.AutoBanned = disableUserForContentViolations(job.userId)
		}
	}
	if err := model.CreateContentModerationLog(entry); err != nil {
		common.SysError(common.LogText("failed to record content moderation log: %s", err.Error()))
	}
}

func disableUserForContentViolations(userId int) bool {
	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.SysError(common.LogText("failed to load user %d for content moderation ban: %s", userId, err.Error()))
		return false
	}
	if user.Role >= common.RoleAdminUser || user.Status != common.UserStatusEnabled {
		return false
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
