package service

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExtractModerationInputUsesLatestUserTurn(t *testing.T) {
	tests := []struct {
		name    string
		request dto.Request
		want    ModerationInput
	}{
		{
			name: "openai chat skips history and assistant turns",
			request: &dto.GeneralOpenAIRequest{Messages: []dto.Message{
				{Role: "system", Content: "you are helpful"},
				{Role: "user", Content: "old question"},
				{Role: "assistant", Content: "old answer"},
				{Role: "user", Content: []any{
					map[string]any{"type": "text", "text": "describe"},
					map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/a.png"}},
					map[string]any{"type": "text", "text": "this image"},
				}},
			}},
			want: ModerationInput{Text: "describe\nthis image", ImageURL: "https://example.com/a.png"},
		},
		{
			name: "claude base64 image becomes data url and system reminders are removed",
			request: &dto.ClaudeRequest{Messages: []dto.ClaudeMessage{
				{Role: "user", Content: []any{
					map[string]any{"type": "text", "text": "<system-reminder>context</system-reminder>real prompt"},
					map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": "AAAA"}},
				}},
				{Role: "assistant", Content: "reply"},
			}},
			want: ModerationInput{Text: "real prompt", ImageURL: "data:image/png;base64,AAAA"},
		},
		{
			name: "claude string content",
			request: &dto.ClaudeRequest{Messages: []dto.ClaudeMessage{
				{Role: "user", Content: "plain prompt"},
			}},
			want: ModerationInput{Text: "plain prompt"},
		},
		{
			name: "gemini ignores model turns and thoughts",
			request: &dto.GeminiChatRequest{Contents: []dto.GeminiChatContent{
				{Role: "user", Parts: []dto.GeminiPart{{Text: "first"}, {Text: "hidden", Thought: true}, {InlineData: &dto.GeminiInlineData{MimeType: "image/jpeg", Data: "BBBB"}}}},
				{Role: "model", Parts: []dto.GeminiPart{{Text: "model reply"}}},
			}},
			want: ModerationInput{Text: "first", ImageURL: "data:image/jpeg;base64,BBBB"},
		},
		{
			name:    "responses string input",
			request: &dto.OpenAIResponsesRequest{Input: json.RawMessage(`"hello there"`)},
			want:    ModerationInput{Text: "hello there"},
		},
		{
			name: "responses array input takes last user message",
			request: &dto.OpenAIResponsesRequest{Input: json.RawMessage(`[
				{"role":"user","content":"earlier"},
				{"type":"function_call_output","output":"tool data"},
				{"type":"message","role":"user","content":[{"type":"input_text","text":"latest"},{"type":"input_image","image_url":"https://example.com/b.png"}]}
			]`)},
			want: ModerationInput{Text: "latest", ImageURL: "https://example.com/b.png"},
		},
		{
			name:    "image generation prompt",
			request: &dto.ImageRequest{Prompt: "a red cat"},
			want:    ModerationInput{Text: "a red cat"},
		},
		{
			name: "claude turn with only non-text blocks has nothing to check",
			request: &dto.ClaudeRequest{Messages: []dto.ClaudeMessage{
				{Role: "user", Content: []any{map[string]any{"type": "tool_result", "tool_use_id": "1", "content": "x"}}},
			}},
			want: ModerationInput{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ExtractModerationInput(tt.request))
		})
	}
}

func TestEvaluateOpenAIModeration(t *testing.T) {
	result := OpenAIModerationResult{
		Flagged:        true,
		Categories:     map[string]bool{"violence": true, "harassment": false, "sexual": true},
		CategoryScores: map[string]float64{"violence": 0.62, "harassment": 0.41, "sexual": 0.91},
	}
	tests := []struct {
		name       string
		thresholds map[string]float64
		flagged    bool
		category   string
		score      float64
	}{
		{name: "upstream flags pick the highest score", flagged: true, category: "sexual", score: 0.91},
		{name: "threshold can relax a flagged category", thresholds: map[string]float64{"sexual": 0.95, "violence": 0.9}, flagged: false},
		{name: "threshold can tighten an unflagged category", thresholds: map[string]float64{"sexual": 0.95, "violence": 0.9, "harassment": 0.4}, flagged: true, category: "harassment", score: 0.41},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			verdict := EvaluateOpenAIModeration(result, tt.thresholds)
			assert.Equal(t, tt.flagged, verdict.Flagged)
			assert.Equal(t, tt.category, verdict.Category)
			assert.InDelta(t, tt.score, verdict.Score, 1e-9)
		})
	}
}

func TestModerationScopeAndKeywords(t *testing.T) {
	setting := &operation_setting.ContentModerationSetting{
		ExemptUserIds: "7, 9",
		IncludeGroups: "default\nvip",
		IncludeModels: "gpt-*,claude-sonnet",
		ExcludeModels: "gpt-4o-mini",
	}
	assert.True(t, moderationAppliesTo(setting, 1, "vip", "gpt-4o"))
	assert.False(t, moderationAppliesTo(setting, 9, "vip", "gpt-4o"), "exempt user")
	assert.False(t, moderationAppliesTo(setting, 1, "free", "gpt-4o"), "group not included")
	assert.False(t, moderationAppliesTo(setting, 1, "vip", "gemini-pro"), "model not included")
	assert.False(t, moderationAppliesTo(setting, 1, "vip", "gpt-4o-mini"), "model excluded")

	assert.Equal(t, "forbidden phrase", matchModerationKeyword("  \nForbidden Phrase\nother", "this has a FORBIDDEN phrase inside"))
	assert.Empty(t, matchModerationKeyword("forbidden", "clean text"))
}

func TestContentViolationsAutoBanAfterThresholdAndUnbanResets(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.ContentModerationLog{}, &model.UserSession{}))
	truncate(t)
	t.Cleanup(func() { model.DB.Exec("DELETE FROM content_moderation_logs") })

	setting := operation_setting.GetContentModerationSetting()
	original := *setting
	t.Cleanup(func() { *setting = original })
	setting.AutoBanEnabled = true
	setting.AutoBanThreshold = 2
	setting.AutoBanWindowHours = 24

	user := &model.User{Id: 501, Username: "cm_user", Status: common.UserStatusEnabled, Role: common.RoleCommonUser, Group: "default", AffCode: "cm501"}
	require.NoError(t, model.DB.Create(user).Error)
	admin := &model.User{Id: 502, Username: "cm_admin", Status: common.UserStatusEnabled, Role: common.RoleAdminUser, Group: "default", AffCode: "cm502"}
	require.NoError(t, model.DB.Create(admin).Error)

	verdict := ModerationVerdict{Flagged: true, Source: model.ContentModerationSourceKeyword, MatchedKeyword: "bad"}
	statusOf := func(id int) int {
		var u model.User
		require.NoError(t, model.DB.First(&u, id).Error)
		return u.Status
	}

	recordContentViolation(moderationJob{userId: user.Id, input: ModerationInput{Text: "bad"}}, verdict, model.ContentModerationActionObserve)
	recordContentViolation(moderationJob{userId: user.Id, input: ModerationInput{Text: "bad"}}, verdict, model.ContentModerationActionBlock)
	assert.Equal(t, common.UserStatusEnabled, statusOf(user.Id), "observe entries do not count toward a ban")

	recordContentViolation(moderationJob{userId: user.Id, input: ModerationInput{Text: "bad"}}, verdict, model.ContentModerationActionBlock)
	assert.Equal(t, common.UserStatusDisabled, statusOf(user.Id))
	var last model.ContentModerationLog
	require.NoError(t, model.DB.Where("user_id = ?", user.Id).Order("id desc").First(&last).Error)
	assert.Equal(t, 2, last.ViolationCount)
	assert.True(t, last.AutoBanned)

	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("status", common.UserStatusEnabled).Error)
	require.NoError(t, model.CreateContentModerationLog(&model.ContentModerationLog{CreatedAt: common.GetTimestamp(), UserId: user.Id, Action: model.ContentModerationActionUnban}))
	recordContentViolation(moderationJob{userId: user.Id, input: ModerationInput{Text: "bad"}}, verdict, model.ContentModerationActionBlock)
	assert.Equal(t, common.UserStatusEnabled, statusOf(user.Id), "unban resets the violation count")

	for range 3 {
		recordContentViolation(moderationJob{userId: admin.Id, input: ModerationInput{Text: "bad"}}, verdict, model.ContentModerationActionBlock)
	}
	assert.Equal(t, common.UserStatusEnabled, statusOf(admin.Id), "administrators are never auto-banned")
}
