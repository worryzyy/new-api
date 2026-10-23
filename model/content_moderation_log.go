package model

import "strings"

const (
	ContentModerationActionAllow        = "allow"
	ContentModerationActionBlock        = "block"
	ContentModerationActionKeywordBlock = "keyword_block"
	ContentModerationActionHashBlock    = "hash_block"
	ContentModerationActionError        = "error"

	// ContentModerationModeLogOnly marks records of exempt users, which are
	// never blocked and never counted toward automatic bans.
	ContentModerationModeLogOnly = "log_only"

	ContentModerationResultHit     = "hit"
	ContentModerationResultBlocked = "blocked"
	ContentModerationResultPass    = "pass"
	ContentModerationResultError   = "error"
)

// ContentModerationLog records one moderated request. Passing requests are only
// stored when recording of non-hits is enabled.
type ContentModerationLog struct {
	Id                int     `json:"id"`
	CreatedAt         int64   `json:"created_at" gorm:"index:idx_cm_user_created,priority:2;index:idx_cm_created"`
	RequestId         string  `json:"request_id" gorm:"type:varchar(64);index"`
	UserId            int     `json:"user_id" gorm:"index:idx_cm_user_created,priority:1"`
	Username          string  `json:"username" gorm:"type:varchar(64);index"`
	UserEmail         string  `json:"user_email" gorm:"type:varchar(128)"`
	TokenId           int     `json:"token_id"`
	TokenName         string  `json:"token_name" gorm:"type:varchar(128)"`
	GroupName         string  `json:"group_name" gorm:"type:varchar(64);index"`
	ModelName         string  `json:"model_name" gorm:"type:varchar(128)"`
	Endpoint          string  `json:"endpoint" gorm:"type:varchar(255)"`
	Mode              string  `json:"mode" gorm:"type:varchar(16)"`
	Action            string  `json:"action" gorm:"type:varchar(16);index"`
	Flagged           bool    `json:"flagged" gorm:"index"`
	Source            string  `json:"source" gorm:"type:varchar(16)"`
	MatchedKeyword    string  `json:"matched_keyword" gorm:"type:varchar(255)"`
	Category          string  `json:"category" gorm:"type:varchar(64)"`
	Score             float64 `json:"score"`
	CategoryScores    string  `json:"category_scores" gorm:"type:text"`
	ThresholdSnapshot string  `json:"threshold_snapshot" gorm:"type:text"`
	InputExcerpt      string  `json:"input_excerpt" gorm:"type:text"`
	InputHash         string  `json:"input_hash" gorm:"type:varchar(64)"`
	Error             string  `json:"error" gorm:"type:text"`
	UpstreamLatencyMs int     `json:"upstream_latency_ms"`
	QueueDelayMs      int     `json:"queue_delay_ms"`
	ViolationCount    int     `json:"violation_count"`
	AutoBanned        bool    `json:"auto_banned"`
	UserStatus        int     `json:"user_status" gorm:"-"`
}

type ContentModerationLogFilter struct {
	Result         string
	GroupName      string
	Endpoint       string
	Search         string
	StartTimestamp int64
	EndTimestamp   int64
}

func CreateContentModerationLog(log *ContentModerationLog) error {
	return DB.Create(log).Error
}

// CountUserViolationsSinceLastBan counts flagged records of a user inside the
// window that count toward automatic bans. Hash blocks and exempt-user records
// are excluded, and counting restarts after the latest automatic ban.
func CountUserViolationsSinceLastBan(userId int, since int64) (int64, error) {
	var lastBan ContentModerationLog
	if err := DB.Select("id").Where("user_id = ? AND auto_banned = ?", userId, true).
		Order("id desc").Limit(1).Find(&lastBan).Error; err != nil {
		return 0, err
	}
	var count int64
	err := DB.Model(&ContentModerationLog{}).
		Where("user_id = ? AND flagged = ? AND created_at >= ? AND id > ? AND action <> ? AND (mode IS NULL OR mode <> ?)",
			userId, true, since, lastBan.Id, ContentModerationActionHashBlock, ContentModerationModeLogOnly).
		Count(&count).Error
	return count, err
}

func GetContentModerationLogs(filter ContentModerationLogFilter, startIdx int, pageSize int) ([]*ContentModerationLog, int64, error) {
	tx := DB.Model(&ContentModerationLog{})
	switch filter.Result {
	case ContentModerationResultHit:
		tx = tx.Where("flagged = ?", true)
	case ContentModerationResultBlocked:
		tx = tx.Where("action IN ?", []string{ContentModerationActionBlock, ContentModerationActionKeywordBlock, ContentModerationActionHashBlock})
	case ContentModerationResultPass:
		tx = tx.Where("flagged = ? AND action <> ?", false, ContentModerationActionError)
	case ContentModerationResultError:
		tx = tx.Where("action = ?", ContentModerationActionError)
	}
	if filter.GroupName != "" {
		tx = tx.Where("group_name = ?", filter.GroupName)
	}
	if filter.Endpoint != "" {
		tx = tx.Where("endpoint = ?", filter.Endpoint)
	}
	if search := strings.ToLower(strings.TrimSpace(filter.Search)); search != "" {
		// LIKE escape syntax differs across databases; wildcards typed by an
		// administrator only widen the match, so they are left as is.
		pattern := "%" + search + "%"
		tx = tx.Where("LOWER(request_id) LIKE ? OR LOWER(username) LIKE ? OR LOWER(user_email) LIKE ? OR LOWER(token_name) LIKE ? OR LOWER(model_name) LIKE ? OR LOWER(input_excerpt) LIKE ?",
			pattern, pattern, pattern, pattern, pattern, pattern)
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
	if err := tx.Order("id desc").Offset(startIdx).Limit(pageSize).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	userIds := make([]int, 0, len(logs))
	for _, log := range logs {
		if log.UserId > 0 {
			userIds = append(userIds, log.UserId)
		}
	}
	if len(userIds) == 0 {
		return logs, total, nil
	}
	var users []User
	if err := DB.Unscoped().Select("id", "status").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	statuses := make(map[int]int, len(users))
	for _, user := range users {
		statuses[user.Id] = user.Status
	}
	for _, log := range logs {
		log.UserStatus = statuses[log.UserId]
	}
	return logs, total, nil
}

// DeleteContentModerationLogsBefore removes flagged or unflagged records older
// than the cutoff, so hits and non-hits keep separate retention periods.
func DeleteContentModerationLogsBefore(flagged bool, timestamp int64) (int64, error) {
	result := DB.Where("flagged = ? AND created_at < ?", flagged, timestamp).Delete(&ContentModerationLog{})
	return result.RowsAffected, result.Error
}
