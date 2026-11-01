package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TopUpBonus records the campaign bonus a wallet top-up earned. The unique
// trade number keeps the bonus a one-time grant per order.
type TopUpBonus struct {
	Id         int    `json:"id"`
	UserId     int    `json:"user_id" gorm:"index"`
	CampaignId int    `json:"campaign_id" gorm:"index"`
	TradeNo    string `json:"trade_no" gorm:"type:varchar(255);uniqueIndex"`
	TopUpQuota int    `json:"top_up_quota"`
	BonusQuota int    `json:"bonus_quota"`
	Rule       string `json:"rule" gorm:"type:varchar(255)"`
	CreatedAt  int64  `json:"created_at" gorm:"bigint"`
}

func (TopUpBonus) TableName() string {
	return "top_up_bonuses"
}

// grantTopUpBonus credits the bonus tier matching creditedQuota of the
// campaign that was live when the order was created. It runs inside the
// top-up transaction, after the order's own quota update. A bonus that would
// push the wallet past its limit is dropped instead of failing the top-up.
func grantTopUpBonus(tx *gorm.DB, topUp *TopUp, creditedQuota int) (*TopUpBonus, error) {
	if creditedQuota <= 0 || topUp.Amount <= 0 {
		return nil, nil
	}
	campaign, err := campaignForOrder(tx, topUp.CreateTime)
	if err != nil || campaign == nil {
		return nil, err
	}

	credited := decimal.NewFromInt(int64(creditedQuota))
	quotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	tiers := campaign.Tiers()
	var tier *TopUpBonusTier
	for i := range tiers {
		candidate := tiers[i]
		if credited.LessThan(decimal.NewFromFloat(candidate.MinAmount).Mul(quotaPerUnit)) {
			continue
		}
		if tier == nil || candidate.MinAmount > tier.MinAmount {
			tier = &candidate
		}
	}
	if tier == nil {
		return nil, nil
	}

	var bonus decimal.Decimal
	switch tier.Type {
	case TopUpBonusTypeFixed:
		bonus = decimal.NewFromFloat(tier.Value).Mul(quotaPerUnit)
	case TopUpBonusTypePercent:
		bonus = credited.Mul(decimal.NewFromFloat(tier.Value)).Div(decimal.NewFromInt(100))
		if tier.MaxBonus > 0 {
			bonus = decimal.Min(bonus, decimal.NewFromFloat(tier.MaxBonus).Mul(quotaPerUnit))
		}
	default:
		return nil, nil
	}
	bonusQuota, err := common.WalletQuotaFromDecimalStrict(bonus)
	if err != nil || bonusQuota <= 0 {
		return nil, nil
	}

	record := &TopUpBonus{
		UserId:     topUp.UserId,
		CampaignId: campaign.Id,
		TradeNo:    topUp.TradeNo,
		TopUpQuota: creditedQuota,
		BonusQuota: bonusQuota,
		Rule:       fmt.Sprintf("min_amount=%g type=%s value=%g max_bonus=%g", tier.MinAmount, tier.Type, tier.Value, tier.MaxBonus),
		CreatedAt:  common.GetTimestamp(),
	}
	created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(record)
	if created.Error != nil {
		return nil, created.Error
	}
	if created.RowsAffected == 0 {
		return nil, nil
	}
	if err := creditTopUpQuota(tx, topUp.UserId, bonusQuota, nil); err != nil {
		if !errors.Is(err, ErrTopUpQuotaLimitExceeded) && !errors.Is(err, ErrInvalidTopUpQuota) {
			return nil, err
		}
		common.SysError(common.LogText("top-up bonus skipped: user %d wallet is full trade_no=%s", topUp.UserId, topUp.TradeNo))
		return nil, tx.Delete(record).Error
	}
	return record, nil
}

// TopUpRewards are the extras a completed wallet top-up earns besides its own
// quota: the campaign bonus for the payer and the referral rebate for the
// payer's inviter. The rebate is computed on the paid quota only.
type TopUpRewards struct {
	bonus  *TopUpBonus
	rebate *InviteRebate
}

func grantTopUpRewards(tx *gorm.DB, topUp *TopUp, creditedQuota int) (*TopUpRewards, error) {
	bonus, err := grantTopUpBonus(tx, topUp, creditedQuota)
	if err != nil {
		return nil, err
	}
	rebate, err := grantInviteTopUpRebate(tx, topUp, creditedQuota)
	if err != nil {
		return nil, err
	}
	return &TopUpRewards{bonus: bonus, rebate: rebate}, nil
}

// BonusQuota is the extra quota the payer's wallet received, for the cache sync.
func (rewards *TopUpRewards) BonusQuota() int {
	if rewards == nil || rewards.bonus == nil {
		return 0
	}
	return rewards.bonus.BonusQuota
}

// recordLogs writes the log entries for the granted rewards once the top-up
// transaction has committed.
func (rewards *TopUpRewards) recordLogs() {
	if rewards == nil {
		return
	}
	if bonus := rewards.bonus; bonus != nil {
		common.SysLog(common.LogText("top-up bonus granted user_id=%d campaign_id=%d trade_no=%s bonus_quota=%d rule=%q", bonus.UserId, bonus.CampaignId, bonus.TradeNo, bonus.BonusQuota, bonus.Rule))
		RecordLog(bonus.UserId, LogTypeSystem, common.NewMessage("Top-up bonus {{quota}}", map[string]any{"quota": logger.FormatQuota(bonus.BonusQuota)}))
	}
	rewards.rebate.recordLog()
}
