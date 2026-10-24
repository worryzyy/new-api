package operation_setting

import (
	"net/url"
	"slices"
	"strings"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
)

// ContentModerationOptionKey stores the whole moderation config as one JSON
// option. It contains API keys, so it is never returned by the options API and
// is only written through the dedicated content moderation endpoint.
const ContentModerationOptionKey = "ContentModerationConfig"

const (
	ContentModerationModeOff      = "off"
	ContentModerationModeObserve  = "observe"
	ContentModerationModePreBlock = "pre_block"

	ContentModerationKeywordAndAPI = "keyword_and_api"
	ContentModerationKeywordOnly   = "keyword_only"
	ContentModerationAPIOnly       = "api_only"

	ContentModerationModelFilterAll     = "all"
	ContentModerationModelFilterInclude = "include"
	ContentModerationModelFilterExclude = "exclude"

	ContentModerationMaxWorkers          = 32
	ContentModerationMaxQueueSize        = 100000
	contentModerationMaxKeywords         = 10000
	contentModerationMaxKeywordLength    = 200
	contentModerationMaxFilterModels     = 1000
	contentModerationMaxFilterModelChars = 200

	contentModerationMaxSessionBlockTTL = 30 * 86400
)

// ContentModerationCategories lists the OpenAI omni-moderation categories with
// their default block thresholds.
var ContentModerationCategories = []struct {
	Name      string
	Threshold float64
}{
	{"harassment", 0.98},
	{"harassment/threatening", 0.90},
	{"hate", 0.65},
	{"hate/threatening", 0.65},
	{"illicit", 0.95},
	{"illicit/violent", 0.95},
	{"self-harm", 0.65},
	{"self-harm/intent", 0.85},
	{"self-harm/instructions", 0.65},
	{"sexual", 0.65},
	{"sexual/minors", 0.65},
	{"violence", 0.95},
	{"violence/graphic", 0.95},
}

type ContentModerationModelFilter struct {
	Type   string   `json:"type"`
	Models []string `json:"models"`
}

type ContentModerationConfig struct {
	Enabled     bool     `json:"enabled"`
	Mode        string   `json:"mode"`
	BaseURL     string   `json:"base_url"`
	Model       string   `json:"model"`
	APIKeys     []string `json:"api_keys"`
	TimeoutMs   int      `json:"timeout_ms"`
	RetryCount  int      `json:"retry_count"`
	SampleRate  int      `json:"sample_rate"`
	CheckImages bool     `json:"check_images"`

	AllGroups   bool                         `json:"all_groups"`
	Groups      []string                     `json:"groups"`
	ModelFilter ContentModerationModelFilter `json:"model_filter"`
	// ExemptUserIds are trusted users: their requests are checked and recorded
	// but never blocked and never counted toward automatic bans.
	ExemptUserIds []int `json:"exempt_user_ids"`

	Thresholds map[string]float64 `json:"thresholds"`

	WorkerCount         int  `json:"worker_count"`
	QueueSize           int  `json:"queue_size"`
	RecordNonHits       bool `json:"record_non_hits"`
	PreHashCheckEnabled bool `json:"pre_hash_check_enabled"`

	BlockStatus          int    `json:"block_status"`
	BlockMessage         string `json:"block_message"`
	AutoBanEnabled       bool   `json:"auto_ban_enabled"`
	BanThreshold         int    `json:"ban_threshold"`
	ViolationWindowHours int    `json:"violation_window_hours"`

	BlockedKeywords     []string `json:"blocked_keywords"`
	KeywordBlockingMode string   `json:"keyword_blocking_mode"`

	HitRetentionDays    int `json:"hit_retention_days"`
	NonHitRetentionDays int `json:"non_hit_retention_days"`

	// CyberPolicyExcludeFromBanCount keeps upstream cyber_policy rejections
	// out of the automatic ban count, both for the hit itself and for the
	// history counted by later violations.
	CyberPolicyExcludeFromBanCount bool `json:"cyber_policy_exclude_from_ban_count"`
	// CyberSessionBlockEnabled rejects, for the TTL, further requests of a
	// conversation that upstream already rejected with cyber_policy.
	CyberSessionBlockEnabled    bool `json:"cyber_session_block_enabled"`
	CyberSessionBlockTTLSeconds int  `json:"cyber_session_block_ttl_seconds"`
}

func DefaultContentModerationConfig() ContentModerationConfig {
	thresholds := make(map[string]float64, len(ContentModerationCategories))
	for _, category := range ContentModerationCategories {
		thresholds[category.Name] = category.Threshold
	}
	return ContentModerationConfig{
		Mode:                 ContentModerationModePreBlock,
		BaseURL:              "https://api.openai.com",
		Model:                "omni-moderation-latest",
		APIKeys:              []string{},
		TimeoutMs:            3000,
		RetryCount:           2,
		SampleRate:           100,
		CheckImages:          true,
		AllGroups:            true,
		Groups:               []string{},
		ModelFilter:          ContentModerationModelFilter{Type: ContentModerationModelFilterAll, Models: []string{}},
		ExemptUserIds:        []int{},
		Thresholds:           thresholds,
		WorkerCount:          4,
		QueueSize:            32768,
		BlockStatus:          403,
		AutoBanEnabled:       true,
		BanThreshold:         10,
		ViolationWindowHours: 720,
		BlockedKeywords:      []string{},
		KeywordBlockingMode:  ContentModerationKeywordAndAPI,
		HitRetentionDays:     180,
		NonHitRetentionDays:  3,

		CyberSessionBlockTTLSeconds: 3600,
	}
}

var contentModerationConfig atomic.Pointer[ContentModerationConfig]

func init() {
	config := DefaultContentModerationConfig()
	contentModerationConfig.Store(&config)
}

// GetContentModerationConfig returns the current immutable config snapshot.
func GetContentModerationConfig() *ContentModerationConfig {
	return contentModerationConfig.Load()
}

// LoadContentModerationConfig applies a stored option value. Invalid JSON keeps
// the previous config so a bad row never disables moderation silently.
func LoadContentModerationConfig(raw string) {
	config := DefaultContentModerationConfig()
	if strings.TrimSpace(raw) != "" {
		if err := common.UnmarshalJsonStr(raw, &config); err != nil {
			common.SysError(common.LogText("failed to parse content moderation config: %s", err.Error()))
			return
		}
	}
	config.Normalize()
	contentModerationConfig.Store(&config)
}

// Normalize fills defaults and removes duplicates; it never rejects a value.
func (c *ContentModerationConfig) Normalize() {
	defaults := DefaultContentModerationConfig()
	switch c.Mode {
	case ContentModerationModeOff, ContentModerationModeObserve, ContentModerationModePreBlock:
	default:
		c.Mode = defaults.Mode
	}
	c.BaseURL = strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	if c.BaseURL == "" {
		c.BaseURL = defaults.BaseURL
	}
	c.Model = strings.TrimSpace(c.Model)
	if c.Model == "" {
		c.Model = defaults.Model
	}
	c.APIKeys = uniqueTrimmed(c.APIKeys, false)
	if c.TimeoutMs <= 0 {
		c.TimeoutMs = defaults.TimeoutMs
	}
	c.TimeoutMs = min(c.TimeoutMs, 30000)
	c.RetryCount = min(max(c.RetryCount, 0), 5)
	c.SampleRate = min(max(c.SampleRate, 0), 100)
	c.Groups = uniqueTrimmed(c.Groups, false)
	slices.Sort(c.Groups)
	switch c.ModelFilter.Type {
	case ContentModerationModelFilterInclude, ContentModerationModelFilterExclude:
		c.ModelFilter.Models = uniqueTrimmed(c.ModelFilter.Models, true)
	default:
		c.ModelFilter = defaults.ModelFilter
	}
	exempt := make([]int, 0, len(c.ExemptUserIds))
	for _, id := range c.ExemptUserIds {
		if id > 0 && !slices.Contains(exempt, id) {
			exempt = append(exempt, id)
		}
	}
	slices.Sort(exempt)
	c.ExemptUserIds = exempt
	thresholds := defaults.Thresholds
	for category, value := range c.Thresholds {
		if _, known := thresholds[category]; known && value >= 0 && value <= 1 {
			thresholds[category] = value
		}
	}
	c.Thresholds = thresholds
	if c.WorkerCount <= 0 {
		c.WorkerCount = defaults.WorkerCount
	}
	c.WorkerCount = min(c.WorkerCount, ContentModerationMaxWorkers)
	if c.QueueSize <= 0 {
		c.QueueSize = defaults.QueueSize
	}
	c.QueueSize = min(c.QueueSize, ContentModerationMaxQueueSize)
	if c.BlockStatus < 400 || c.BlockStatus > 599 {
		c.BlockStatus = defaults.BlockStatus
	}
	c.BlockMessage = strings.TrimSpace(c.BlockMessage)
	if c.BanThreshold <= 0 {
		c.BanThreshold = defaults.BanThreshold
	}
	if c.ViolationWindowHours <= 0 {
		c.ViolationWindowHours = defaults.ViolationWindowHours
	}
	c.BlockedKeywords = uniqueTrimmed(c.BlockedKeywords, true)
	switch c.KeywordBlockingMode {
	case ContentModerationKeywordAndAPI, ContentModerationKeywordOnly, ContentModerationAPIOnly:
	default:
		c.KeywordBlockingMode = defaults.KeywordBlockingMode
	}
	if c.HitRetentionDays <= 0 {
		c.HitRetentionDays = defaults.HitRetentionDays
	}
	c.HitRetentionDays = min(c.HitRetentionDays, 3650)
	c.NonHitRetentionDays = min(max(c.NonHitRetentionDays, 1), 3)
	if c.CyberSessionBlockTTLSeconds <= 0 {
		c.CyberSessionBlockTTLSeconds = defaults.CyberSessionBlockTTLSeconds
	}
	c.CyberSessionBlockTTLSeconds = min(c.CyberSessionBlockTTLSeconds, contentModerationMaxSessionBlockTTL)
}

// Validate rejects values an administrator submitted that cannot be applied.
// It runs before Normalize so out-of-range input is reported instead of clamped.
func (c *ContentModerationConfig) Validate() error {
	switch c.Mode {
	case ContentModerationModeOff, ContentModerationModeObserve, ContentModerationModePreBlock:
	default:
		return common.NewMessage("Invalid moderation mode")
	}
	if baseURL := strings.TrimSpace(c.BaseURL); baseURL != "" {
		parsed, err := url.ParseRequestURI(baseURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return common.NewMessage("Invalid moderation API base URL")
		}
	}
	if c.TimeoutMs < 0 || c.TimeoutMs > 30000 || c.RetryCount < 0 || c.RetryCount > 5 ||
		c.SampleRate < 0 || c.SampleRate > 100 || c.WorkerCount < 0 || c.WorkerCount > ContentModerationMaxWorkers ||
		c.QueueSize < 0 || c.QueueSize > ContentModerationMaxQueueSize || c.BanThreshold < 0 || c.BanThreshold > 1000 ||
		c.ViolationWindowHours < 0 || c.ViolationWindowHours > 8760 || c.HitRetentionDays < 0 || c.HitRetentionDays > 3650 ||
		c.NonHitRetentionDays < 0 || c.NonHitRetentionDays > 3 ||
		c.CyberSessionBlockTTLSeconds < 0 || c.CyberSessionBlockTTLSeconds > contentModerationMaxSessionBlockTTL {
		return common.NewMessage("Moderation setting is out of range")
	}
	if c.BlockStatus != 0 && (c.BlockStatus < 400 || c.BlockStatus > 599) {
		return common.NewMessage("Block status must be between 400 and 599")
	}
	for _, value := range c.Thresholds {
		if value < 0 || value > 1 {
			return common.NewMessage("Moderation thresholds must be between 0 and 1")
		}
	}
	switch c.ModelFilter.Type {
	case "", ContentModerationModelFilterAll:
	case ContentModerationModelFilterInclude, ContentModerationModelFilterExclude:
		models := uniqueTrimmed(c.ModelFilter.Models, true)
		if len(models) == 0 {
			return common.NewMessage("Select at least one model for the model filter")
		}
		if len(models) > contentModerationMaxFilterModels || slices.ContainsFunc(models, func(m string) bool { return len(m) > contentModerationMaxFilterModelChars }) {
			return common.NewMessage("Too many models in the model filter")
		}
	default:
		return common.NewMessage("Invalid model filter")
	}
	if !c.AllGroups && len(uniqueTrimmed(c.Groups, false)) == 0 {
		return common.NewMessage("Select at least one group or audit all groups")
	}
	keywords := uniqueTrimmed(c.BlockedKeywords, true)
	if len(keywords) > contentModerationMaxKeywords || slices.ContainsFunc(keywords, func(k string) bool { return len(k) > contentModerationMaxKeywordLength }) {
		return common.NewMessage("Too many blocked keywords or a keyword is too long")
	}
	return nil
}

// ModelInScope applies the model filter with case-insensitive
// exact matching on the model name requested by the client.
func (c *ContentModerationConfig) ModelInScope(model string) bool {
	if c.ModelFilter.Type == ContentModerationModelFilterAll {
		return true
	}
	listed := slices.ContainsFunc(c.ModelFilter.Models, func(m string) bool { return strings.EqualFold(m, model) })
	if c.ModelFilter.Type == ContentModerationModelFilterInclude {
		return listed
	}
	return !listed
}

func (c *ContentModerationConfig) GroupInScope(group string) bool {
	return c.AllGroups || slices.Contains(c.Groups, group)
}

func uniqueTrimmed(values []string, caseInsensitive bool) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := value
		if caseInsensitive {
			key = strings.ToLower(value)
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result
}
