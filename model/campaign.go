package model

import (
	"errors"
	"math"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	CampaignStatusDraft     = "draft"
	CampaignStatusPublished = "published"
	CampaignStatusEnded     = "ended"

	TopUpBonusTypeFixed   = "fixed"
	TopUpBonusTypePercent = "percent"

	maxTopUpBonusTiers    = 20
	maxCampaignTitleRunes = 100
	// MaxCampaignContentBytes bounds the campaign page HTML.
	MaxCampaignContentBytes = 512 * 1024
)

var ErrCampaignNotFound = common.NewMessage("Campaign not found")

// TopUpBonusTier grants a bonus to a single wallet top-up of at least
// MinAmount. Amounts are in top-up units (1 unit = QuotaPerUnit quota). A fixed
// tier adds Value units; a percent tier adds Value percent of the top-up,
// capped at MaxBonus units when MaxBonus is positive.
type TopUpBonusTier struct {
	MinAmount float64 `json:"min_amount"`
	Type      string  `json:"type"`
	Value     float64 `json:"value"`
	MaxBonus  float64 `json:"max_bonus"`
}

// Campaign is an event page with optional top-up bonus tiers. At most one
// campaign is published at a time; publishing another ends it. Earlier
// campaigns stay as history. StartTime and EndTime are Unix seconds, zero
// leaving that side open, and the window never starts before PublishedAt.
type Campaign struct {
	Id          int      `json:"id"`
	Title       string   `json:"title" gorm:"type:varchar(255)"`
	Content     LongText `json:"content"`
	BonusTiers  string   `json:"-" gorm:"type:text"`
	StartTime   int64    `json:"start_time" gorm:"bigint"`
	EndTime     int64    `json:"end_time" gorm:"bigint"`
	Status      string   `json:"status" gorm:"type:varchar(16);index"`
	PublishedAt int64    `json:"published_at" gorm:"bigint;index"`
	EndedAt     int64    `json:"ended_at" gorm:"bigint"`
	CreatedAt   int64    `json:"created_at" gorm:"bigint"`
	UpdatedAt   int64    `json:"updated_at" gorm:"bigint"`
}

// Tiers decodes the stored bonus tiers; an unreadable value grants nothing.
func (campaign *Campaign) Tiers() []TopUpBonusTier {
	tiers := []TopUpBonusTier{}
	if campaign.BonusTiers == "" {
		return tiers
	}
	if err := common.UnmarshalJsonStr(campaign.BonusTiers, &tiers); err != nil {
		return []TopUpBonusTier{}
	}
	return tiers
}

// coversOrderAt reports whether an order created at ts falls inside the
// window the campaign was live for.
func (campaign *Campaign) coversOrderAt(ts int64) bool {
	if campaign.PublishedAt == 0 || ts < max(campaign.StartTime, campaign.PublishedAt) {
		return false
	}
	end := campaign.EndTime
	if campaign.Status == CampaignStatusEnded && campaign.EndedAt > 0 && (end == 0 || campaign.EndedAt < end) {
		end = campaign.EndedAt
	}
	return end == 0 || ts < end
}

// ValidateCampaign checks a campaign an administrator saves and stores its
// tiers on it.
func ValidateCampaign(campaign *Campaign, tiers []TopUpBonusTier) error {
	if campaign.Title == "" || utf8.RuneCountInString(campaign.Title) > maxCampaignTitleRunes {
		return common.NewMessage("The campaign title must be 1 to {{max}} characters", map[string]any{"max": maxCampaignTitleRunes})
	}
	if len(campaign.Content) > MaxCampaignContentBytes {
		return common.NewMessage("The campaign page is larger than {{max}} KB", map[string]any{"max": MaxCampaignContentBytes / 1024})
	}
	if campaign.StartTime < 0 || campaign.EndTime < 0 || (campaign.StartTime > 0 && campaign.EndTime > 0 && campaign.EndTime <= campaign.StartTime) {
		return common.NewMessage("The end time must be after the start time")
	}
	if len(tiers) > maxTopUpBonusTiers {
		return common.NewMessage("At most {{max}} top-up bonus tiers are allowed", map[string]any{"max": maxTopUpBonusTiers})
	}
	seen := make(map[float64]bool, len(tiers))
	for _, tier := range tiers {
		if !isFinitePositive(tier.MinAmount) || !isFinitePositive(tier.Value) || math.IsNaN(tier.MaxBonus) || math.IsInf(tier.MaxBonus, 0) || tier.MaxBonus < 0 {
			return common.NewMessage("Each top-up bonus tier needs a positive minimum amount and bonus")
		}
		switch tier.Type {
		case TopUpBonusTypeFixed:
		case TopUpBonusTypePercent:
			if tier.Value > 100 {
				return common.NewMessage("A percentage top-up bonus cannot exceed 100%")
			}
		default:
			return common.NewMessage("Unknown top-up bonus type")
		}
		if seen[tier.MinAmount] {
			return common.NewMessage("Two top-up bonus tiers share the same minimum amount")
		}
		seen[tier.MinAmount] = true
	}
	encoded, err := common.Marshal(tiers)
	if err != nil {
		return err
	}
	campaign.BonusTiers = string(encoded)
	return nil
}

func isFinitePositive(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v > 0
}

func GetAllCampaigns() ([]*Campaign, error) {
	var campaigns []*Campaign
	err := DB.Order("id desc").Find(&campaigns).Error
	return campaigns, err
}

func GetCampaignById(id int) (*Campaign, error) {
	var campaign Campaign
	err := DB.First(&campaign, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrCampaignNotFound
	}
	return &campaign, err
}

func CreateCampaign(campaign *Campaign) error {
	now := common.GetTimestamp()
	campaign.Id = 0
	campaign.Status = CampaignStatusDraft
	campaign.PublishedAt = 0
	campaign.EndedAt = 0
	campaign.CreatedAt = now
	campaign.UpdatedAt = now
	return DB.Create(campaign).Error
}

// UpdateCampaignContent saves the editable fields; the status is changed only
// by publishing or ending.
func UpdateCampaignContent(campaign *Campaign) error {
	result := DB.Model(&Campaign{}).Where("id = ?", campaign.Id).Updates(map[string]any{
		"title":       campaign.Title,
		"content":     campaign.Content,
		"bonus_tiers": campaign.BonusTiers,
		"start_time":  campaign.StartTime,
		"end_time":    campaign.EndTime,
		"updated_at":  common.GetTimestamp(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrCampaignNotFound
	}
	invalidateCurrentCampaign()
	return nil
}

// DeleteCampaign removes a campaign that is not published.
func DeleteCampaign(id int) error {
	result := DB.Where("id = ? AND status <> ?", id, CampaignStatusPublished).Delete(&Campaign{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return common.NewMessage("Only a campaign that is not published can be deleted")
	}
	return nil
}

// PublishCampaign makes the campaign the published one and ends the campaign
// published before it.
func PublishCampaign(id int) error {
	now := common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		var campaign Campaign
		if err := lockForUpdate(tx).First(&campaign, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCampaignNotFound
			}
			return err
		}
		if campaign.Status == CampaignStatusPublished {
			return nil
		}
		if err := tx.Model(&Campaign{}).Where("status = ? AND id <> ?", CampaignStatusPublished, id).
			Updates(map[string]any{"status": CampaignStatusEnded, "ended_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		return tx.Model(&Campaign{}).Where("id = ?", id).
			Updates(map[string]any{"status": CampaignStatusPublished, "published_at": now, "ended_at": 0, "updated_at": now}).Error
	})
	invalidateCurrentCampaign()
	return err
}

// EndCampaign takes the published campaign down; orders created before now
// still earn its bonus when they are paid.
func EndCampaign(id int) error {
	now := common.GetTimestamp()
	result := DB.Model(&Campaign{}).Where("id = ? AND status = ?", id, CampaignStatusPublished).
		Updates(map[string]any{"status": CampaignStatusEnded, "ended_at": now, "updated_at": now})
	invalidateCurrentCampaign()
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return common.NewMessage("Only a published campaign can be ended")
	}
	return nil
}

// campaignForOrder finds the campaign that was live when an order was
// created. Publishing a campaign ends the previous one, so the latest one
// published before the order is the only candidate.
func campaignForOrder(tx *gorm.DB, createdAt int64) (*Campaign, error) {
	var campaign Campaign
	err := tx.Where("status IN ? AND published_at > 0 AND published_at <= ?", []string{CampaignStatusPublished, CampaignStatusEnded}, createdAt).
		Order("published_at desc").Limit(1).Find(&campaign).Error
	if err != nil || campaign.Id == 0 || !campaign.coversOrderAt(createdAt) {
		return nil, err
	}
	return &campaign, nil
}

// CampaignBonusStat sums the bonuses a campaign has granted.
type CampaignBonusStat struct {
	CampaignId int   `json:"campaign_id"`
	Count      int64 `json:"count"`
	Quota      int64 `json:"quota"`
}

func GetCampaignBonusStats(ids []int) (map[int]CampaignBonusStat, error) {
	stats := make(map[int]CampaignBonusStat, len(ids))
	if len(ids) == 0 {
		return stats, nil
	}
	var rows []CampaignBonusStat
	err := DB.Model(&TopUpBonus{}).
		Select("campaign_id, count(*) as count, sum(bonus_quota) as quota").
		Where("campaign_id IN ?", ids).Group("campaign_id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		stats[row.CampaignId] = row
	}
	return stats, nil
}

// The public campaign endpoint is anonymous, so the published campaign is
// cached briefly instead of read on every page view.
var currentCampaignCache struct {
	sync.Mutex
	campaign *Campaign
	loadedAt time.Time
}

const currentCampaignTTL = 30 * time.Second

func invalidateCurrentCampaign() {
	currentCampaignCache.Lock()
	currentCampaignCache.loadedAt = time.Time{}
	currentCampaignCache.Unlock()
}

// GetCurrentCampaign returns the published campaign, or nil when none is.
func GetCurrentCampaign() (*Campaign, error) {
	currentCampaignCache.Lock()
	defer currentCampaignCache.Unlock()
	if !currentCampaignCache.loadedAt.IsZero() && time.Since(currentCampaignCache.loadedAt) < currentCampaignTTL {
		return currentCampaignCache.campaign, nil
	}
	var campaign Campaign
	if err := DB.Where("status = ?", CampaignStatusPublished).Order("published_at desc").Limit(1).Find(&campaign).Error; err != nil {
		return nil, err
	}
	currentCampaignCache.campaign = nil
	if campaign.Id != 0 {
		currentCampaignCache.campaign = &campaign
	}
	currentCampaignCache.loadedAt = time.Now()
	return currentCampaignCache.campaign, nil
}
