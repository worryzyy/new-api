package service

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	sqlmysql "github.com/go-sql-driver/mysql"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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

func TestEvaluateOpenAIModerationUsesThresholdsOnly(t *testing.T) {
	thresholds := operation_setting.DefaultContentModerationConfig().Thresholds
	tests := []struct {
		name     string
		result   OpenAIModerationResult
		flagged  bool
		category string
		score    float64
	}{
		{
			name:     "upstream flag below threshold is not a hit",
			result:   OpenAIModerationResult{Flagged: true, Categories: map[string]bool{"violence": true}, CategoryScores: map[string]float64{"violence": 0.9, "hate": 0.1}},
			flagged:  false,
			category: "violence", score: 0.9,
		},
		{
			name:     "score reaching a threshold is a hit even without the upstream flag",
			result:   OpenAIModerationResult{CategoryScores: map[string]float64{"hate": 0.65, "harassment": 0.9}},
			flagged:  true,
			category: "harassment", score: 0.9,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			verdict := EvaluateOpenAIModeration(tt.result, thresholds)
			assert.Equal(t, tt.flagged, verdict.Flagged)
			assert.Equal(t, tt.category, verdict.Category)
			assert.InDelta(t, tt.score, verdict.Score, 1e-9)
		})
	}
}

func TestContentModerationConfigValidateAndScope(t *testing.T) {
	valid := operation_setting.DefaultContentModerationConfig()
	require.NoError(t, valid.Validate())

	invalid := map[string]func(*operation_setting.ContentModerationConfig){
		"block status outside 4xx/5xx": func(c *operation_setting.ContentModerationConfig) { c.BlockStatus = 302 },
		"include filter without models": func(c *operation_setting.ContentModerationConfig) {
			c.ModelFilter = operation_setting.ContentModerationModelFilter{Type: "include"}
		},
		"threshold above 1":              func(c *operation_setting.ContentModerationConfig) { c.Thresholds = map[string]float64{"hate": 1.5} },
		"non-http base url":              func(c *operation_setting.ContentModerationConfig) { c.BaseURL = "ftp://example.com" },
		"specific groups without groups": func(c *operation_setting.ContentModerationConfig) { c.AllGroups = false },
		"retry count above 5":            func(c *operation_setting.ContentModerationConfig) { c.RetryCount = 6 },
	}
	for name, mutate := range invalid {
		t.Run(name, func(t *testing.T) {
			config := operation_setting.DefaultContentModerationConfig()
			mutate(&config)
			assert.Error(t, config.Validate())
		})
	}

	config := operation_setting.ContentModerationConfig{
		Mode:        "unknown",
		AllGroups:   false,
		Groups:      []string{"vip", " vip ", "default"},
		ModelFilter: operation_setting.ContentModerationModelFilter{Type: "exclude", Models: []string{"GPT-4o-mini"}},
		Thresholds:  map[string]float64{"hate": 0.4},
		APIKeys:     []string{"k1", "k1", " "},
	}
	config.Normalize()
	assert.Equal(t, operation_setting.ContentModerationModePreBlock, config.Mode)
	assert.Equal(t, []string{"default", "vip"}, config.Groups)
	assert.Equal(t, []string{"k1"}, config.APIKeys)
	assert.InDelta(t, 0.4, config.Thresholds["hate"], 1e-9)
	assert.InDelta(t, 0.95, config.Thresholds["violence"], 1e-9, "missing categories use defaults")
	assert.True(t, config.GroupInScope("vip"))
	assert.False(t, config.GroupInScope("free"))
	assert.False(t, config.ModelInScope("gpt-4o-mini"), "model filter ignores case")
	assert.True(t, config.ModelInScope("gpt-4o"))
}

func TestModerationHashSamplingAndExcerpt(t *testing.T) {
	first := moderationInputHash(ModerationInput{Text: "hello   world\n"})
	assert.Equal(t, first, moderationInputHash(ModerationInput{Text: "hello world"}), "whitespace is normalized")
	assert.NotEqual(t, first, moderationInputHash(ModerationInput{Text: "hello world", ImageURL: "https://example.com/a.png"}))
	assert.True(t, moderationSampled(first, 100))
	assert.False(t, moderationSampled(first, 0))
	assert.Equal(t, moderationSampled(first, 37), moderationSampled(first, 37), "sampling is deterministic")

	excerpt := moderationExcerpt(ModerationInput{Text: "key sk-abcdefghijklmnop at https://example.com/x?token=1", ImageURL: "data:image/png;base64,AAAA"})
	assert.Equal(t, "key [redacted] at [redacted] [image]", excerpt)
	assert.Len(t, []rune(moderationExcerpt(ModerationInput{Text: strings.Repeat("字", 500)})), moderationExcerptRunes)
}

func TestModerationKeyPoolRetriesAndFreezesFailingKey(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") == "Bearer bad-key" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid key"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"results":[{"flagged":true,"categories":{"violence":true},"category_scores":{"violence":0.99}}]}`))
	}))
	t.Cleanup(server.Close)
	if GetHttpClient() == nil {
		InitHttpClient()
	}

	config := operation_setting.DefaultContentModerationConfig()
	config.BaseURL = server.URL
	config.APIKeys = []string{"bad-key", "good-key"}
	config.RetryCount = 1
	moderationKeyCursor.Store(0)
	t.Cleanup(func() {
		moderationKeyMu.Lock()
		delete(moderationKeyStates, moderationKeyHash("bad-key"))
		delete(moderationKeyStates, moderationKeyHash("good-key"))
		moderationKeyMu.Unlock()
	})

	result, _, err := moderateWithKeyPool(t.Context(), &config, ModerationInput{Text: "x"}, true)
	require.NoError(t, err)
	assert.InDelta(t, 0.99, result.CategoryScores["violence"], 1e-9)
	assert.Equal(t, int64(2), calls.Load())

	statuses := moderationKeyStatuses(config.APIKeys, true)
	assert.Equal(t, "frozen", statuses[0].Status)
	assert.Equal(t, http.StatusUnauthorized, statuses[0].LastHTTPStatus)
	assert.Equal(t, "ok", statuses[1].Status)
	assert.Equal(t, "********-key", statuses[1].Masked)
	assert.Equal(t, 1, availableModerationKeyCount(config.APIKeys))

	_, _, err = moderateWithKeyPool(t.Context(), &config, ModerationInput{Text: "x"}, true)
	require.NoError(t, err)
	assert.Equal(t, int64(3), calls.Load(), "the frozen key is skipped")

	assert.Equal(t, int64(0), int64(moderationKeyFreeze(http.StatusBadRequest)))
	assert.Equal(t, int64(0), int64(moderationKeyFreeze(0)))
}

func TestContentViolationsAutoBanCounting(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.ContentModerationLog{}, &model.UserSession{}))
	truncate(t)
	t.Cleanup(func() { model.DB.Exec("DELETE FROM content_moderation_logs") })

	config := operation_setting.DefaultContentModerationConfig()
	config.BanThreshold = 2
	user := &model.User{Id: 501, Username: "cm_user", Status: common.UserStatusEnabled, Role: common.RoleCommonUser, Group: "default", AffCode: "cm501"}
	require.NoError(t, model.DB.Create(user).Error)
	admin := &model.User{Id: 502, Username: "cm_admin", Status: common.UserStatusEnabled, Role: common.RoleAdminUser, Group: "default", AffCode: "cm502"}
	require.NoError(t, model.DB.Create(admin).Error)
	statusOf := func(id int) int {
		var u model.User
		require.NoError(t, model.DB.First(&u, id).Error)
		return u.Status
	}
	violation := func(userId int, action string, logOnly bool) {
		recordModerationJob(&config, &moderationJob{
			userId:     userId,
			allowBlock: true,
			logOnly:    logOnly,
			input:      ModerationInput{Text: "bad"},
			outcome:    moderationOutcome{verdict: ModerationVerdict{Flagged: true, Source: moderationSourceKeyword}, blockAction: action},
		})
	}

	violation(user.Id, model.ContentModerationActionHashBlock, false)
	violation(user.Id, model.ContentModerationActionBlock, true)
	violation(user.Id, model.ContentModerationActionBlock, false)
	assert.Equal(t, common.UserStatusEnabled, statusOf(user.Id), "hash blocks and exempt-user records do not count")

	violation(user.Id, model.ContentModerationActionKeywordBlock, false)
	assert.Equal(t, common.UserStatusDisabled, statusOf(user.Id))
	var last model.ContentModerationLog
	require.NoError(t, model.DB.Where("user_id = ?", user.Id).Order("id desc").First(&last).Error)
	assert.Equal(t, 2, last.ViolationCount)
	assert.True(t, last.AutoBanned)
	assert.Equal(t, model.ContentModerationActionKeywordBlock, last.Action)

	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("status", common.UserStatusEnabled).Error)
	violation(user.Id, model.ContentModerationActionBlock, false)
	assert.Equal(t, common.UserStatusEnabled, statusOf(user.Id), "the count restarts after an automatic ban")

	for range 3 {
		violation(admin.Id, model.ContentModerationActionBlock, false)
	}
	assert.Equal(t, common.UserStatusEnabled, statusOf(admin.Id), "administrators are never auto-banned")
}

func TestUpdateContentModerationConfigKeepsAndRemovesKeys(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.Option{}))
	t.Cleanup(func() {
		model.DB.Exec("DELETE FROM options")
		operation_setting.LoadContentModerationConfig("")
	})
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	common.OptionMapRWMutex.Unlock()

	base := operation_setting.DefaultContentModerationConfig()
	update := ContentModerationConfigUpdate{ContentModerationConfig: base, APIKeysMode: "replace"}
	update.APIKeys = []string{"key-one", "key-two"}
	require.NoError(t, UpdateContentModerationConfig(update))
	assert.Equal(t, []string{"key-one", "key-two"}, operation_setting.GetContentModerationConfig().APIKeys)

	update = ContentModerationConfigUpdate{ContentModerationConfig: base, DeleteAPIKeyHashes: []string{moderationKeyHash("key-one")}}
	update.APIKeys = []string{"key-three"}
	require.NoError(t, UpdateContentModerationConfig(update))
	assert.Equal(t, []string{"key-two", "key-three"}, operation_setting.GetContentModerationConfig().APIKeys)

	view := GetContentModerationConfigView()
	assert.Empty(t, view.APIKeys, "plaintext keys are never returned")
	assert.Equal(t, []string{"********-two", "********hree"}, view.APIKeyMasks)

	update = ContentModerationConfigUpdate{ContentModerationConfig: base, ClearAPIKeys: true}
	require.NoError(t, UpdateContentModerationConfig(update))
	assert.Empty(t, operation_setting.GetContentModerationConfig().APIKeys)

	invalid := ContentModerationConfigUpdate{ContentModerationConfig: base}
	invalid.BlockStatus = 200
	assert.Error(t, UpdateContentModerationConfig(invalid))
}

// TestContentModerationDatabaseMatrix exercises the moderation tables and
// queries on real databases. MySQL and PostgreSQL run when
// CONTENT_MODERATION_MYSQL_DSN / CONTENT_MODERATION_POSTGRES_DSN point at a
// dedicated, empty loopback database.
func TestContentModerationDatabaseMatrix(t *testing.T) {
	cases := []struct {
		name   string
		env    string
		dbType common.DatabaseType
	}{
		{"sqlite", "", common.DatabaseTypeSQLite},
		{"mysql", "CONTENT_MODERATION_MYSQL_DSN", common.DatabaseTypeMySQL},
		{"postgres", "CONTENT_MODERATION_POSTGRES_DSN", common.DatabaseTypePostgreSQL},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var dialector gorm.Dialector
			switch tc.name {
			case "sqlite":
				dialector = sqlite.Open(t.TempDir() + "/moderation.db")
			case "mysql":
				dsn := os.Getenv(tc.env)
				if dsn == "" {
					t.Skip(tc.env + " is not configured")
				}
				config, err := sqlmysql.ParseDSN(dsn)
				require.NoError(t, err)
				host, _, err := net.SplitHostPort(config.Addr)
				require.NoError(t, err)
				require.True(t, net.ParseIP(host).IsLoopback(), "database tests only permit loopback instances")
				dialector = mysql.Open(dsn)
			default:
				dsn := os.Getenv(tc.env)
				if dsn == "" {
					t.Skip(tc.env + " is not configured")
				}
				parsed, err := url.Parse(dsn)
				require.NoError(t, err)
				require.True(t, net.ParseIP(parsed.Hostname()).IsLoopback(), "database tests only permit loopback instances")
				dialector = postgres.Open(dsn)
			}
			db, err := gorm.Open(dialector, &gorm.Config{})
			require.NoError(t, err)
			originalDB := model.DB
			model.DB = db
			common.SetDatabaseTypes(tc.dbType, tc.dbType)
			t.Cleanup(func() {
				model.DB = originalDB
				common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
				operation_setting.LoadContentModerationConfig("")
				if sqlDB, err := db.DB(); err == nil {
					_ = sqlDB.Close()
				}
			})
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.Option{}, &model.ContentModerationLog{}))
			}

			user := &model.User{Username: "cm_matrix", Status: common.UserStatusDisabled, Role: common.RoleCommonUser, Group: "default", AffCode: "cmmx"}
			require.NoError(t, db.Create(user).Error)
			now := common.GetTimestamp()
			records := []model.ContentModerationLog{
				{CreatedAt: now - 10, UserId: user.Id, Action: model.ContentModerationActionBlock, Flagged: true, Mode: "pre_block", GroupName: "vip", Endpoint: "/v1/responses", InputExcerpt: "contains SecretWord here"},
				{CreatedAt: now - 9, UserId: user.Id, Action: model.ContentModerationActionKeywordBlock, Flagged: true, Mode: "pre_block", GroupName: "default", Endpoint: "/v1/chat/completions"},
				{CreatedAt: now - 8, UserId: user.Id, Action: model.ContentModerationActionHashBlock, Flagged: true, Mode: "pre_block"},
				{CreatedAt: now - 7, UserId: user.Id, Action: model.ContentModerationActionAllow, Flagged: true, Mode: model.ContentModerationModeLogOnly},
				{CreatedAt: now - 6, UserId: user.Id, Action: model.ContentModerationActionAllow, Flagged: false, Mode: "pre_block"},
				{CreatedAt: now - 5, UserId: user.Id, Action: model.ContentModerationActionError, Flagged: false, Mode: "pre_block", Error: "timeout"},
				{CreatedAt: now - 400000, UserId: user.Id, Action: model.ContentModerationActionAllow, Flagged: false, Mode: "pre_block"},
			}
			for i := range records {
				require.NoError(t, model.CreateContentModerationLog(&records[i]))
			}

			count, err := model.CountUserViolationsSinceLastBan(user.Id, now-3600)
			require.NoError(t, err)
			assert.Equal(t, int64(2), count, "hash blocks, exempt-user records and non-hits do not count")
			require.NoError(t, model.CreateContentModerationLog(&model.ContentModerationLog{CreatedAt: now - 4, UserId: user.Id, Action: model.ContentModerationActionBlock, Flagged: true, Mode: "pre_block", AutoBanned: true}))
			count, err = model.CountUserViolationsSinceLastBan(user.Id, now-3600)
			require.NoError(t, err)
			assert.Equal(t, int64(0), count, "counting restarts after an automatic ban")

			filters := map[string]struct {
				filter model.ContentModerationLogFilter
				total  int64
			}{
				"hit":      {model.ContentModerationLogFilter{Result: model.ContentModerationResultHit}, 5},
				"blocked":  {model.ContentModerationLogFilter{Result: model.ContentModerationResultBlocked}, 4},
				"pass":     {model.ContentModerationLogFilter{Result: model.ContentModerationResultPass}, 2},
				"error":    {model.ContentModerationLogFilter{Result: model.ContentModerationResultError}, 1},
				"group":    {model.ContentModerationLogFilter{GroupName: "vip"}, 1},
				"endpoint": {model.ContentModerationLogFilter{Endpoint: "/v1/chat/completions"}, 1},
				"search":   {model.ContentModerationLogFilter{Search: "secretword"}, 1},
				"time":     {model.ContentModerationLogFilter{StartTimestamp: now - 3600, EndTimestamp: now - 9}, 2},
			}
			for name, expected := range filters {
				logs, total, err := model.GetContentModerationLogs(expected.filter, 0, 20)
				require.NoError(t, err, name)
				assert.Equal(t, expected.total, total, name)
				for _, log := range logs {
					assert.Equal(t, common.UserStatusDisabled, log.UserStatus, name)
				}
			}

			deleted, err := model.DeleteContentModerationLogsBefore(false, now-3600)
			require.NoError(t, err)
			assert.Equal(t, int64(1), deleted, "only the old non-hit is removed")

			common.OptionMapRWMutex.Lock()
			if common.OptionMap == nil {
				common.OptionMap = map[string]string{}
			}
			common.OptionMapRWMutex.Unlock()
			update := ContentModerationConfigUpdate{ContentModerationConfig: operation_setting.DefaultContentModerationConfig(), APIKeysMode: "replace"}
			update.APIKeys = []string{"matrix-key"}
			update.Enabled = true
			require.NoError(t, UpdateContentModerationConfig(update))
			var stored model.Option
			require.NoError(t, db.Where(map[string]any{"key": operation_setting.ContentModerationOptionKey}).First(&stored).Error)
			assert.Contains(t, stored.Value, "matrix-key")
		})
	}
}
