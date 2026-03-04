package ratio_setting

import (
	"github.com/QuantumNous/new-api/types"
)

var defaultCacheRatio = map[string]float64{
	"gemini-3-flash-preview":              0.1,
	"gemini-3-pro-preview":                0.1,
	"gemini-3.1-pro-preview":              0.1,
	"gpt-4":                               0.5,
	"o1":                                  0.5,
	"o1-2024-12-17":                       0.5,
	"o1-preview-2024-09-12":               0.5,
	"o1-preview":                          0.5,
	"o1-mini-2024-09-12":                  0.5,
	"o1-mini":                             0.5,
	"o3-mini":                             0.5,
	"o3-mini-2025-01-31":                  0.5,
	"gpt-4o-2024-11-20":                   0.5,
	"gpt-4o-2024-08-06":                   0.5,
	"gpt-4o":                              0.5,
	"gpt-4o-mini-2024-07-18":              0.5,
	"gpt-4o-mini":                         0.5,
	"gpt-4o-realtime-preview":             0.5,
	"gpt-4o-mini-realtime-preview":        0.5,
	"gpt-4.5-preview":                     0.5,
	"gpt-4.5-preview-2025-02-27":          0.5,
	"gpt-4.1":                             0.25,
	"gpt-4.1-mini":                        0.25,
	"gpt-4.1-nano":                        0.25,
	"gpt-5":                               0.1,
	"gpt-5-2025-08-07":                    0.1,
	"gpt-5-chat-latest":                   0.1,
	"gpt-5-mini":                          0.1,
	"gpt-5-mini-2025-08-07":               0.1,
	"gpt-5-nano":                          0.1,
	"gpt-5-nano-2025-08-07":               0.1,
	"deepseek-chat":                       0.25,
	"deepseek-reasoner":                   0.25,
	"deepseek-coder":                      0.25,
	"claude-3-sonnet-20240229":            0.1,
	"claude-3-opus-20240229":              0.1,
	"claude-3-haiku-20240307":             0.1,
	"claude-3-5-haiku-20241022":           0.1,
	"claude-haiku-4-5-20251001":           0.1,
	"claude-3-5-sonnet-20240620":          0.1,
	"claude-3-5-sonnet-20241022":          0.1,
	"claude-3-7-sonnet-20250219":          0.1,
	"claude-3-7-sonnet-20250219-thinking": 0.1,
	"claude-sonnet-4-20250514":            0.1,
	"claude-sonnet-4-20250514-thinking":   0.1,
	"claude-opus-4-20250514":              0.1,
	"claude-opus-4-20250514-thinking":     0.1,
	"claude-opus-4-1-20250805":            0.1,
	"claude-opus-4-1-20250805-thinking":   0.1,
	"claude-sonnet-4-5-20250929":          0.1,
	"claude-sonnet-4-5-20250929-thinking": 0.1,
	"claude-opus-4-5-20251101":            0.1,
	"claude-opus-4-5-20251101-thinking":   0.1,
	"claude-opus-4-6":                     0.1,
	"claude-opus-4-6-thinking":            0.1,
	"claude-opus-4-6-max":                 0.1,
	"claude-opus-4-6-high":                0.1,
	"claude-opus-4-6-medium":              0.1,
	"claude-opus-4-6-low":                 0.1,
}

var defaultCreateCacheRatio = map[string]float64{
	"claude-3-sonnet-20240229":            1.25,
	"claude-3-opus-20240229":              1.25,
	"claude-3-haiku-20240307":             1.25,
	"claude-3-5-haiku-20241022":           1.25,
	"claude-haiku-4-5-20251001":           1.25,
	"claude-3-5-sonnet-20240620":          1.25,
	"claude-3-5-sonnet-20241022":          1.25,
	"claude-3-7-sonnet-20250219":          1.25,
	"claude-3-7-sonnet-20250219-thinking": 1.25,
	"claude-sonnet-4-20250514":            1.25,
	"claude-sonnet-4-20250514-thinking":   1.25,
	"claude-opus-4-20250514":              1.25,
	"claude-opus-4-20250514-thinking":     1.25,
	"claude-opus-4-1-20250805":            1.25,
	"claude-opus-4-1-20250805-thinking":   1.25,
	"claude-sonnet-4-5-20250929":          1.25,
	"claude-sonnet-4-5-20250929-thinking": 1.25,
	"claude-opus-4-5-20251101":            1.25,
	"claude-opus-4-5-20251101-thinking":   1.25,
	"claude-opus-4-6":                     1.25,
	"claude-opus-4-6-thinking":            1.25,
	"claude-opus-4-6-max":                 1.25,
	"claude-opus-4-6-high":                1.25,
	"claude-opus-4-6-medium":              1.25,
	"claude-opus-4-6-low":                 1.25,
}

//var defaultCreateCacheRatio = map[string]float64{}

// defaultCreateCacheRatio1h stores the default 1h cache creation ratios.
// When set, these take priority over the auto-calculated value (5m × 1.6).
var defaultCreateCacheRatio1h = map[string]float64{}

var cacheRatioMap = types.NewRWMap[string, float64]()
var createCacheRatioMap = types.NewRWMap[string, float64]()
var createCacheRatio1hMap = types.NewRWMap[string, float64]()

// createCacheTokenTypeMap overrides the cache creation token type for billing.
// Values: "5m" or "1h". If set, all cache creation tokens for that model are
// billed as the specified type regardless of what upstream actually returns.
var createCacheTokenTypeMap = types.NewRWMap[string, string]()

// globalCreateCacheTokenType is the global fallback override for all Claude models.
// Values: "" (disabled), "5m", "1h".
// Per-model JSON (createCacheTokenTypeMap) takes priority over this.
var globalCreateCacheTokenType = ""

// GetCacheRatioMap returns a copy of the cache ratio map
func GetCacheRatioMap() map[string]float64 {
	return cacheRatioMap.ReadAll()
}

// CacheRatio2JSONString converts the cache ratio map to a JSON string
func CacheRatio2JSONString() string {
	return cacheRatioMap.MarshalJSONString()
}

// CreateCacheRatio2JSONString converts the create cache ratio map to a JSON string
func CreateCacheRatio2JSONString() string {
	return createCacheRatioMap.MarshalJSONString()
}

// UpdateCacheRatioByJSONString updates the cache ratio map from a JSON string
func UpdateCacheRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonStringWithCallback(cacheRatioMap, jsonStr, InvalidateExposedDataCache)
}

// UpdateCreateCacheRatioByJSONString updates the create cache ratio map from a JSON string
func UpdateCreateCacheRatioByJSONString(jsonStr string) error {
	return types.LoadFromJsonStringWithCallback(createCacheRatioMap, jsonStr, InvalidateExposedDataCache)
}

// GetCacheRatio returns the cache ratio for a model
func GetCacheRatio(name string) (float64, bool) {
	ratio, ok := cacheRatioMap.Get(name)
	if !ok {
		return 1, false // Default to 1 if not found
	}
	return ratio, true
}

func GetCreateCacheRatio(name string) (float64, bool) {
	ratio, ok := createCacheRatioMap.Get(name)
	if !ok {
		return 1.25, false // Default to 1.25 if not found
	}
	return ratio, true
}

func GetCacheRatioCopy() map[string]float64 {
	return cacheRatioMap.ReadAll()
}

func GetCreateCacheRatioCopy() map[string]float64 {
	return createCacheRatioMap.ReadAll()
}

// CreateCacheRatio1h2JSONString converts the 1h create cache ratio map to a JSON string
func CreateCacheRatio1h2JSONString() string {
	return createCacheRatio1hMap.MarshalJSONString()
}

// UpdateCreateCacheRatio1hByJSONString updates the 1h create cache ratio map from a JSON string
func UpdateCreateCacheRatio1hByJSONString(jsonStr string) error {
	return types.LoadFromJsonStringWithCallback(createCacheRatio1hMap, jsonStr, InvalidateExposedDataCache)
}

// GetCreateCacheRatio1h returns the 1h cache creation ratio for a model.
// Returns (ratio, true) if found, (0, false) if not found.
func GetCreateCacheRatio1h(name string) (float64, bool) {
	return createCacheRatio1hMap.Get(name)
}

func GetCreateCacheRatio1hCopy() map[string]float64 {
	return createCacheRatio1hMap.ReadAll()
}

// CreateCacheTokenType2JSONString converts the cache creation token type map to a JSON string
func CreateCacheTokenType2JSONString() string {
	return createCacheTokenTypeMap.MarshalJSONString()
}

// UpdateCreateCacheTokenTypeByJSONString updates the cache creation token type map from a JSON string
func UpdateCreateCacheTokenTypeByJSONString(jsonStr string) error {
	return types.LoadFromJsonStringWithCallback(createCacheTokenTypeMap, jsonStr, InvalidateExposedDataCache)
}

// GetCreateCacheTokenType returns the forced token type ("5m" or "1h") for a model.
// Returns ("", false) if no override is configured for that model.
func GetCreateCacheTokenType(name string) (string, bool) {
	v, ok := createCacheTokenTypeMap.Get(name)
	if !ok || (v != "5m" && v != "1h") {
		return "", false
	}
	return v, true
}

func GetCreateCacheTokenTypeCopy() map[string]string {
	return createCacheTokenTypeMap.ReadAll()
}

// GetGlobalCreateCacheTokenType returns the global cache creation token type override.
// Returns "" if disabled.
func GetGlobalCreateCacheTokenType() string {
	return globalCreateCacheTokenType
}

// SetGlobalCreateCacheTokenType sets the global cache creation token type override.
func SetGlobalCreateCacheTokenType(v string) {
	if v == "5m" || v == "1h" {
		globalCreateCacheTokenType = v
	} else {
		globalCreateCacheTokenType = ""
	}
}

// GetEffectiveCreateCacheTokenType returns the effective token type for a model,
// checking per-model override first, then global setting.
// Returns ("", false) if neither is configured.
func GetEffectiveCreateCacheTokenType(name string) (string, bool) {
	// Per-model JSON takes priority
	if v, ok := GetCreateCacheTokenType(name); ok {
		return v, true
	}
	// Fall back to global setting
	if globalCreateCacheTokenType != "" {
		return globalCreateCacheTokenType, true
	}
	return "", false
}
