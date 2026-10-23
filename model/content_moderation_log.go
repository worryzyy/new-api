package model

import "strings"

const (
	ContentModerationActionBlock   = "block"
	ContentModerationActionObserve = "observe"
	ContentModerationActionUnban   = "unban"

	ContentModerationSourceKeyword = "keyword"
	ContentModerationSourceOpenAI  = "openai"
)

// ContentModerationLog records one request that the content moderation flagged.
// Requests that pass are not stored.
type ContentModerationLog struct {
	Id             int     `json:"id"`
	CreatedAt      int64   `json:"created_at" gorm:"index:idx_cm_user_created,priority:2;index:idx_cm_created"`
	RequestId      string  `json:"request_id" gorm:"type:varchar(64);index"`
	UserId         int     `json:"user_id" gorm:"index:idx_cm_user_created,priority:1"`
	Username       string  `json:"username" gorm:"type:varchar(64);index"`
	TokenId        int     `json:"token_id"`
	TokenName      string  `json:"token_name" gorm:"type:varchar(128)"`
	GroupName      string  `json:"group_name" gorm:"type:varchar(64)"`
	ModelName      string  `json:"model_name" gorm:"type:varchar(128)"`
	Endpoint       string  `json:"endpoint" gorm:"type:varchar(255)"`
	Action         string  `json:"action" gorm:"type:varchar(16);index"`
	Source         string  `json:"source" gorm:"type:varchar(16)"`
	MatchedKeyword string  `json:"matched_keyword" gorm:"type:varchar(255)"`
	Category       string  `json:"category" gorm:"type:varchar(64)"`
	Score          float64 `json:"score"`
	CategoryScores string  `json:"category_scores" gorm:"type:text"`
	InputExcerpt   string  `json:"input_excerpt" gorm:"type:text"`
	ViolationCount int     `json:"violation_count"`
	AutoBanned     bool    `json:"auto_banned"`
}

type ContentModerationLogFilter struct {
	UserId         int
	Username       string
	Action         string
	Source         string
	StartTimestamp int64
	EndTimestamp   int64
}

func CreateContentModerationLog(log *ContentModerationLog) error {
	return DB.Create(log).Error
}

// CountUserBlockedViolationsSince counts blocked requests of a user after since.
// An administrator unban resets the count, so only violations after the latest
// unban record are counted.
func CountUserBlockedViolationsSince(userId int, since int64) (int64, error) {
	var lastUnban ContentModerationLog
	err := DB.Where("user_id = ? AND action = ?", userId, ContentModerationActionUnban).
		Order("id desc").Limit(1).Find(&lastUnban).Error
	if err != nil {
		return 0, err
	}
	since = max(since, lastUnban.CreatedAt)
	var count int64
	err = DB.Model(&ContentModerationLog{}).
		Where("user_id = ? AND action = ? AND created_at >= ? AND id > ?", userId, ContentModerationActionBlock, since, lastUnban.Id).
		Count(&count).Error
	return count, err
}

func GetContentModerationLogs(filter ContentModerationLogFilter, startIdx int, pageSize int) ([]*ContentModerationLog, int64, error) {
	tx := DB.Model(&ContentModerationLog{})
	if filter.UserId > 0 {
		tx = tx.Where("user_id = ?", filter.UserId)
	}
	if username := strings.TrimSpace(filter.Username); username != "" {
		tx = tx.Where("username = ?", username)
	}
	if filter.Action != "" {
		tx = tx.Where("action = ?", filter.Action)
	}
	if filter.Source != "" {
		tx = tx.Where("source = ?", filter.Source)
	}
	if filter.StartTimestamp > 0 {
		tx = tx.Where("created_at >= ?", filter.StartTimestamp)
	}
	if filter.EndTimestamp > 0 {
		tx = tx.Where("created_at <= ?", filter.EndTimestamp)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	logs := make([]*ContentModerationLog, 0)
	err := tx.Order("id desc").Offset(startIdx).Limit(pageSize).Find(&logs).Error
	return logs, total, err
}

func DeleteContentModerationLogsBefore(timestamp int64) (int64, error) {
	result := DB.Where("created_at < ?", timestamp).Delete(&ContentModerationLog{})
	return result.RowsAffected, result.Error
}
