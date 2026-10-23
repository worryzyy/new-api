package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

var errNoModerationKey = errors.New("no moderation api key available")

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

type moderationRequestError struct {
	status  int
	message string
}

func (e *moderationRequestError) Error() string {
	if e.status == 0 {
		return e.message
	}
	return fmt.Sprintf("moderation request failed with status %d: %s", e.status, e.message)
}

// moderationKeyState is the in-memory health and load of one API key. It is
// per process and resets on restart.
type moderationKeyState struct {
	frozenUntil    time.Time
	failureCount   int64
	successCount   int64
	lastError      string
	lastCheckedAt  int64
	lastLatencyMs  int64
	lastHTTPStatus int
	lastTested     bool

	active         int64
	total          int64
	success        int64
	errors         int64
	totalLatencyMs int64
}

var (
	moderationKeyMu     sync.Mutex
	moderationKeyStates = map[string]*moderationKeyState{}
	moderationKeyCursor atomic.Uint64
)

func moderationKeyHash(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func maskModerationKey(key string) string {
	if len(key) <= 4 {
		return "****"
	}
	return "********" + key[len(key)-4:]
}

// moderationKeyStateLocked must be called with moderationKeyMu held.
func moderationKeyStateLocked(hash string) *moderationKeyState {
	state := moderationKeyStates[hash]
	if state == nil {
		state = &moderationKeyState{}
		moderationKeyStates[hash] = state
	}
	return state
}

// moderationKeyFreeze returns how long a key is frozen after a failed call:
// auth failures for 10 minutes, rate limits for 1 minute, other upstream errors
// for 10 seconds; bad requests and network errors do not freeze the key.
func moderationKeyFreeze(status int) time.Duration {
	switch {
	case status == 0 || status == http.StatusBadRequest:
		return 0
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return 10 * time.Minute
	case status == http.StatusTooManyRequests || status == 529:
		return time.Minute
	default:
		return 10 * time.Second
	}
}

func pickModerationKey(keys []string, tried map[string]bool) string {
	if len(keys) == 0 {
		return ""
	}
	start := moderationKeyCursor.Add(1) - 1
	now := time.Now()
	moderationKeyMu.Lock()
	defer moderationKeyMu.Unlock()
	for offset := range len(keys) {
		key := keys[(start+uint64(offset))%uint64(len(keys))]
		if tried[key] {
			continue
		}
		if state := moderationKeyStates[moderationKeyHash(key)]; state != nil && now.Before(state.frozenUntil) {
			continue
		}
		return key
	}
	return ""
}

func availableModerationKeyCount(keys []string) int {
	now := time.Now()
	moderationKeyMu.Lock()
	defer moderationKeyMu.Unlock()
	count := 0
	for _, key := range keys {
		if state := moderationKeyStates[moderationKeyHash(key)]; state == nil || !now.Before(state.frozenUntil) {
			count++
		}
	}
	return count
}

func recordModerationKeyOutcome(key string, status int, latency time.Duration, err error, trackLoad bool, tested bool) {
	moderationKeyMu.Lock()
	defer moderationKeyMu.Unlock()
	state := moderationKeyStateLocked(moderationKeyHash(key))
	latencyMs := latency.Milliseconds()
	state.lastCheckedAt = common.GetTimestamp()
	state.lastLatencyMs = latencyMs
	state.lastHTTPStatus = status
	if tested {
		state.lastTested = true
	}
	if err == nil {
		state.successCount++
		state.lastError = ""
		state.frozenUntil = time.Time{}
	} else {
		state.lastError = truncateRunes(err.Error(), 180)
		if freeze := moderationKeyFreeze(status); freeze > 0 {
			state.frozenUntil = time.Now().Add(freeze)
			state.failureCount++
		}
	}
	if !trackLoad {
		return
	}
	state.total++
	state.totalLatencyMs += latencyMs
	if err == nil {
		state.success++
	} else {
		state.errors++
	}
}

func adjustModerationKeyActive(key string, delta int64) {
	moderationKeyMu.Lock()
	moderationKeyStateLocked(moderationKeyHash(key)).active += delta
	moderationKeyMu.Unlock()
}

// moderateWithKeyPool calls the moderation endpoint with round-robin keys,
// moving to the next key after a failure. A 400 response is not retried.
// trackLoad is set for synchronous pre-block checks, whose load is reported.
func moderateWithKeyPool(ctx context.Context, config *operation_setting.ContentModerationConfig, input ModerationInput, trackLoad bool) (OpenAIModerationResult, time.Duration, error) {
	tried := map[string]bool{}
	lastErr := errNoModerationKey
	var totalLatency time.Duration
	for attempt := range config.RetryCount + 1 {
		key := pickModerationKey(config.APIKeys, tried)
		if key == "" {
			break
		}
		tried[key] = true
		if trackLoad {
			adjustModerationKeyActive(key, 1)
		}
		result, status, latency, err := requestOpenAIModeration(ctx, config, key, input)
		if trackLoad {
			adjustModerationKeyActive(key, -1)
		}
		totalLatency += latency
		recordModerationKeyOutcome(key, status, latency, err, trackLoad, false)
		if err == nil {
			return result, totalLatency, nil
		}
		lastErr = err
		if status == http.StatusBadRequest || ctx.Err() != nil {
			break
		}
		select {
		case <-ctx.Done():
			return OpenAIModerationResult{}, totalLatency, lastErr
		case <-time.After(time.Duration(100*(attempt+1)) * time.Millisecond):
		}
	}
	return OpenAIModerationResult{}, totalLatency, lastErr
}

func requestOpenAIModeration(ctx context.Context, config *operation_setting.ContentModerationConfig, key string, input ModerationInput) (OpenAIModerationResult, int, time.Duration, error) {
	parts := make([]map[string]any, 0, 2)
	if text := truncateRunes(input.Text, moderationMaxTextRunes); text != "" {
		parts = append(parts, map[string]any{"type": "text", "text": text})
	}
	if config.CheckImages && input.ImageURL != "" && len(input.ImageURL) <= moderationMaxImageURLSize {
		parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]any{"url": input.ImageURL}})
	}
	if len(parts) == 0 {
		return OpenAIModerationResult{}, http.StatusOK, 0, nil
	}
	body, err := common.Marshal(map[string]any{"model": config.Model, "input": parts})
	if err != nil {
		return OpenAIModerationResult{}, 0, 0, err
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(config.TimeoutMs)*time.Millisecond)
	defer cancel()
	endpoint := config.BaseURL + "/v1/moderations"
	if strings.HasSuffix(config.BaseURL, "/v1") {
		endpoint = config.BaseURL + "/moderations"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return OpenAIModerationResult{}, 0, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	started := time.Now()
	resp, err := GetHttpClient().Do(req)
	if err != nil {
		return OpenAIModerationResult{}, 0, time.Since(started), &moderationRequestError{message: err.Error()}
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	latency := time.Since(started)
	if err != nil {
		return OpenAIModerationResult{}, resp.StatusCode, latency, &moderationRequestError{status: resp.StatusCode, message: err.Error()}
	}
	var parsed openAIModerationResponse
	parseErr := common.Unmarshal(respBody, &parsed)
	if resp.StatusCode != http.StatusOK || parsed.Error != nil {
		message := http.StatusText(resp.StatusCode)
		if parsed.Error != nil && parsed.Error.Message != "" {
			message = parsed.Error.Message
		}
		return OpenAIModerationResult{}, resp.StatusCode, latency, &moderationRequestError{status: resp.StatusCode, message: message}
	}
	if parseErr != nil {
		return OpenAIModerationResult{}, resp.StatusCode, latency, &moderationRequestError{status: resp.StatusCode, message: "invalid moderation response"}
	}
	if len(parsed.Results) == 0 {
		return OpenAIModerationResult{}, resp.StatusCode, latency, &moderationRequestError{status: resp.StatusCode, message: "moderation response has no results"}
	}
	return parsed.Results[0], resp.StatusCode, latency, nil
}

type ModerationKeyStatus struct {
	Index          int    `json:"index"`
	KeyHash        string `json:"key_hash"`
	Masked         string `json:"masked"`
	Status         string `json:"status"`
	Configured     bool   `json:"configured"`
	FailureCount   int64  `json:"failure_count"`
	SuccessCount   int64  `json:"success_count"`
	LastError      string `json:"last_error"`
	LastCheckedAt  int64  `json:"last_checked_at"`
	FrozenUntil    int64  `json:"frozen_until"`
	LastLatencyMs  int64  `json:"last_latency_ms"`
	LastHTTPStatus int    `json:"last_http_status"`
	LastTested     bool   `json:"last_tested"`
}

type ModerationKeyLoad struct {
	Index          int    `json:"index"`
	KeyHash        string `json:"key_hash"`
	Masked         string `json:"masked"`
	Status         string `json:"status"`
	Active         int64  `json:"active"`
	Total          int64  `json:"total"`
	Success        int64  `json:"success"`
	Errors         int64  `json:"errors"`
	AvgLatencyMs   int64  `json:"avg_latency_ms"`
	LastLatencyMs  int64  `json:"last_latency_ms"`
	LastHTTPStatus int    `json:"last_http_status"`
}

func moderationKeyHealth(state *moderationKeyState, now time.Time) string {
	switch {
	case state == nil:
		return "unknown"
	case now.Before(state.frozenUntil):
		return "frozen"
	case state.lastError != "":
		return "error"
	case state.successCount > 0 || state.lastTested:
		return "ok"
	default:
		return "unknown"
	}
}

func moderationKeyStatuses(keys []string, configured bool) []ModerationKeyStatus {
	now := time.Now()
	moderationKeyMu.Lock()
	defer moderationKeyMu.Unlock()
	statuses := make([]ModerationKeyStatus, 0, len(keys))
	for index, key := range keys {
		hash := moderationKeyHash(key)
		state := moderationKeyStates[hash]
		status := ModerationKeyStatus{Index: index + 1, KeyHash: hash, Masked: maskModerationKey(key), Status: moderationKeyHealth(state, now), Configured: configured}
		if state != nil {
			status.FailureCount = state.failureCount
			status.SuccessCount = state.successCount
			status.LastError = state.lastError
			status.LastCheckedAt = state.lastCheckedAt
			status.LastLatencyMs = state.lastLatencyMs
			status.LastHTTPStatus = state.lastHTTPStatus
			status.LastTested = state.lastTested
			if now.Before(state.frozenUntil) {
				status.FrozenUntil = state.frozenUntil.Unix()
			}
		}
		statuses = append(statuses, status)
	}
	return statuses
}

func moderationKeyLoads(keys []string) ([]ModerationKeyLoad, int64, int64) {
	now := time.Now()
	moderationKeyMu.Lock()
	defer moderationKeyMu.Unlock()
	loads := make([]ModerationKeyLoad, 0, len(keys))
	var active, total int64
	for index, key := range keys {
		hash := moderationKeyHash(key)
		state := moderationKeyStates[hash]
		load := ModerationKeyLoad{Index: index + 1, KeyHash: hash, Masked: maskModerationKey(key), Status: moderationKeyHealth(state, now)}
		if state != nil {
			load.Active = state.active
			load.Total = state.total
			load.Success = state.success
			load.Errors = state.errors
			load.LastLatencyMs = state.lastLatencyMs
			load.LastHTTPStatus = state.lastHTTPStatus
			if state.total > 0 {
				load.AvgLatencyMs = state.totalLatencyMs / state.total
			}
		}
		active += load.Active
		total += load.Total
		loads = append(loads, load)
	}
	return loads, active, total
}

type ModerationTestRequest struct {
	APIKeys    []string           `json:"api_keys"`
	BaseURL    string             `json:"base_url"`
	Model      string             `json:"model"`
	TimeoutMs  int                `json:"timeout_ms"`
	Thresholds map[string]float64 `json:"thresholds"`
	Prompt     string             `json:"prompt"`
	Images     []string           `json:"images"`
}

type ModerationTestResult struct {
	Items       []ModerationKeyStatus `json:"items"`
	AuditResult *ModerationVerdict    `json:"audit_result,omitempty"`
	ImageCount  int                   `json:"image_count"`
}

// TestModerationKeys checks each given key (or the saved keys) with a small
// request and, when a prompt or image is given, returns the verdict for it.
// Overrides in the request apply to this test only.
func TestModerationKeys(ctx context.Context, req ModerationTestRequest) ModerationTestResult {
	config := *operation_setting.GetContentModerationConfig()
	if req.BaseURL != "" {
		config.BaseURL = req.BaseURL
	}
	if req.Model != "" {
		config.Model = req.Model
	}
	if req.TimeoutMs > 0 {
		config.TimeoutMs = req.TimeoutMs
	}
	if len(req.Thresholds) > 0 {
		config.Thresholds = req.Thresholds
	}
	config.Normalize()
	configured := len(req.APIKeys) == 0
	keys := config.APIKeys
	if !configured {
		keys = req.APIKeys
		config.APIKeys = keys
		config.Normalize()
		keys = config.APIKeys
	}
	input := ModerationInput{Text: strings.TrimSpace(req.Prompt)}
	if len(req.Images) > 0 {
		input.ImageURL = req.Images[0]
		config.CheckImages = true
	}
	probe := input
	if probe.Text == "" && probe.ImageURL == "" {
		probe.Text = "moderation key test"
	}
	result := ModerationTestResult{ImageCount: min(len(req.Images), 1)}
	var auditDone bool
	for _, key := range keys {
		moderation, status, latency, err := requestOpenAIModeration(ctx, &config, key, probe)
		recordModerationKeyOutcome(key, status, latency, err, false, true)
		if err == nil && !auditDone && (input.Text != "" || input.ImageURL != "") {
			verdict := EvaluateOpenAIModeration(moderation, config.Thresholds)
			result.AuditResult = &verdict
			auditDone = true
		}
	}
	result.Items = moderationKeyStatuses(keys, configured)
	return result
}
