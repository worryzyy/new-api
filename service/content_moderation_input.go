package service

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

const (
	moderationMaxTextRunes    = 12000
	moderationExcerptRunes    = 240
	moderationMaxImageURLSize = 8 << 20
)

// ModerationInput is the part of a relay request that moderation inspects:
// the latest user turn only, so replayed history is not re-judged each turn.
type ModerationInput struct {
	Text     string
	ImageURL string
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

func truncateRunes(text string, limit int) string {
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	return string([]rune(text)[:limit])
}

// moderationInputHash identifies a moderated input: whitespace-normalized text
// plus a digest of the image, so the same content always hashes the same.
func moderationInputHash(input ModerationInput) string {
	normalized := truncateRunes(strings.Join(strings.Fields(input.Text), " "), moderationMaxTextRunes)
	hash := sha256.New()
	hash.Write([]byte("text:" + normalized))
	if input.ImageURL != "" {
		imageDigest := sha256.Sum256([]byte(input.ImageURL))
		hash.Write([]byte("\nimage:" + hex.EncodeToString(imageDigest[:])))
	}
	return hex.EncodeToString(hash.Sum(nil))
}

// moderationSampled keeps a deterministic share of inputs: the same content is
// either always or never sampled at a given rate.
func moderationSampled(inputHash string, rate int) bool {
	if rate >= 100 {
		return true
	}
	if rate <= 0 {
		return false
	}
	raw, err := hex.DecodeString(inputHash[:4])
	if err != nil {
		return true
	}
	return int(binary.BigEndian.Uint16(raw)%100) < rate
}

var moderationRedactPatterns = []*regexp.Regexp{
	regexp.MustCompile(`https?://\S+`),
	regexp.MustCompile(`\bsk-[A-Za-z0-9_\-]{8,}`),
	regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`),
	regexp.MustCompile(`\b[A-Fa-f0-9]{32,}\b`),
	regexp.MustCompile(`[A-Za-z0-9+/_\-]{40,}={0,2}`),
}

// moderationExcerpt is the redacted, truncated input stored in records so
// secrets pasted into prompts do not end up in the audit table.
func moderationExcerpt(input ModerationInput) string {
	text := input.Text
	for _, pattern := range moderationRedactPatterns {
		text = pattern.ReplaceAllString(text, "[redacted]")
	}
	text = truncateRunes(strings.Join(strings.Fields(text), " "), moderationExcerptRunes)
	if input.ImageURL != "" {
		text += " [image]"
	}
	return strings.TrimSpace(text)
}

// moderationFullInput is the unredacted input stored with flagged records so
// administrators can review exactly what was sent.
func moderationFullInput(input ModerationInput) string {
	text := truncateRunes(input.Text, moderationMaxTextRunes)
	if utf8.RuneCountInString(input.Text) > moderationMaxTextRunes {
		text += "\n[truncated]"
	}
	if input.ImageURL != "" {
		text += "\n[image]"
	}
	return strings.TrimSpace(text)
}
