package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

const (
	ContentModerationModeOff     = "off"
	ContentModerationModeObserve = "observe"
	ContentModerationModeBlock   = "block"
)

type ContentModerationSetting struct {
	Mode string `json:"mode"`
	// Keywords is newline separated and matched case-insensitively.
	Keywords string `json:"keywords"`

	OpenAIEnabled bool   `json:"openai_enabled"`
	OpenAIBaseURL string `json:"openai_base_url"`
	OpenAIAPIKey  string `json:"openai_api_key"`
	OpenAIModel   string `json:"openai_model"`
	TimeoutMs     int    `json:"timeout_ms"`
	CheckImages   bool   `json:"check_images"`
	// CategoryThresholds overrides the upstream flag per category: a category
	// listed here is a violation exactly when its score reaches the threshold.
	CategoryThresholds map[string]float64 `json:"category_thresholds"`

	AutoBanEnabled     bool `json:"auto_ban_enabled"`
	AutoBanThreshold   int  `json:"auto_ban_threshold"`
	AutoBanWindowHours int  `json:"auto_ban_window_hours"`

	// Comma or newline separated lists; an empty include list means all.
	ExemptUserIds string `json:"exempt_user_ids"`
	IncludeGroups string `json:"include_groups"`
	IncludeModels string `json:"include_models"`
	ExcludeModels string `json:"exclude_models"`

	LogRetentionDays int `json:"log_retention_days"`
}

var contentModerationSetting = ContentModerationSetting{
	Mode:               ContentModerationModeOff,
	OpenAIBaseURL:      "https://api.openai.com",
	OpenAIModel:        "omni-moderation-latest",
	TimeoutMs:          3000,
	CategoryThresholds: map[string]float64{},
	AutoBanThreshold:   10,
	AutoBanWindowHours: 720,
	LogRetentionDays:   180,
}

func init() {
	config.GlobalConfig.Register("content_moderation_setting", &contentModerationSetting)
}

func GetContentModerationSetting() *ContentModerationSetting {
	return &contentModerationSetting
}
