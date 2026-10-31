package model

import (
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// InviteRebate records the rebate an inviter earned from an invitee's first
// wallet top-up. The unique invitee index makes the rebate a one-time grant
// even when two first top-ups of the same invitee complete concurrently.
type InviteRebate struct {
	Id            int    `json:"id"`
	InviterId     int    `json:"inviter_id" gorm:"index"`
	InviteeId     int    `json:"invitee_id" gorm:"uniqueIndex"`
	TradeNo       string `json:"trade_no" gorm:"type:varchar(255)"`
	TopUpQuota    int    `json:"top_up_quota"`
	RebatePercent int    `json:"rebate_percent"`
	RebateQuota   int    `json:"rebate_quota"`
	CreatedAt     int64  `json:"created_at" gorm:"bigint"`
}

// grantInviteTopUpRebate credits the invitee's inviter with
// InviterTopUpRebatePercent of creditedQuota when topUp is the invitee's first
// successful wallet top-up. It runs inside the top-up transaction, after the
// invitee's quota update, so the rebate commits or rolls back with the order.
// The rebate goes to the inviter's referral balance, like the invitation
// reward. It returns nil when no rebate applies.
func grantInviteTopUpRebate(tx *gorm.DB, topUp *TopUp, creditedQuota int) (*InviteRebate, error) {
	percent := common.InviterTopUpRebatePercent
	if percent <= 0 || creditedQuota <= 0 || topUp.Amount <= 0 || !operation_setting.IsPaymentComplianceConfirmed() {
		return nil, nil
	}

	var invitee User
	if err := tx.Select("id", "inviter_id").Where("id = ?", topUp.UserId).First(&invitee).Error; err != nil {
		return nil, err
	}
	if invitee.InviterId <= 0 || invitee.InviterId == invitee.Id {
		return nil, nil
	}

	// Subscription orders also write top_ups rows, with a zero amount; only
	// wallet top-ups count toward "first".
	var earlier int64
	if err := tx.Model(&TopUp{}).
		Where("user_id = ? AND status = ? AND amount > 0 AND id <> ?", topUp.UserId, common.TopUpStatusSuccess, topUp.Id).
		Count(&earlier).Error; err != nil {
		return nil, err
	}
	if earlier > 0 {
		return nil, nil
	}

	rebateQuota := common.QuotaFromDecimal(
		decimal.NewFromInt(int64(creditedQuota)).Mul(decimal.NewFromInt(int64(percent))).Div(decimal.NewFromInt(100)),
	)
	if rebateQuota <= 0 {
		return nil, nil
	}

	rebate := &InviteRebate{
		InviterId:     invitee.InviterId,
		InviteeId:     invitee.Id,
		TradeNo:       topUp.TradeNo,
		TopUpQuota:    creditedQuota,
		RebatePercent: percent,
		RebateQuota:   rebateQuota,
		CreatedAt:     common.GetTimestamp(),
	}
	created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(rebate)
	if created.Error != nil {
		return nil, created.Error
	}
	if created.RowsAffected == 0 {
		return nil, nil
	}

	// aff_quota and aff_history are 32-bit columns; a rebate that would
	// overflow them is dropped instead of failing the invitee's top-up.
	credited := tx.Model(&User{}).
		Where("id = ? AND aff_quota <= ? AND aff_history <= ?", invitee.InviterId, math.MaxInt32-rebateQuota, math.MaxInt32-rebateQuota).
		Updates(map[string]any{
			"aff_quota":   gorm.Expr("aff_quota + ?", rebateQuota),
			"aff_history": gorm.Expr("aff_history + ?", rebateQuota),
		})
	if credited.Error != nil {
		return nil, credited.Error
	}
	if credited.RowsAffected == 0 {
		common.SysError(common.LogText("invite rebate skipped: inviter %d is missing or its referral balance is full", invitee.InviterId))
		return nil, tx.Delete(rebate).Error
	}
	return rebate, nil
}

// recordLog writes the inviter's log entry for a granted rebate; it is a no-op
// for a nil rebate so callers can pass grantInviteTopUpRebate's result as is.
func (rebate *InviteRebate) recordLog() {
	if rebate == nil {
		return
	}
	common.SysLog(common.LogText("invite rebate granted inviter_id=%d invitee_id=%d trade_no=%s rebate_quota=%d", rebate.InviterId, rebate.InviteeId, rebate.TradeNo, rebate.RebateQuota))
	RecordLog(rebate.InviterId, LogTypeSystem, common.NewMessage("Referral rebate for an invitee's first top-up {{quota}}", map[string]any{"quota": logger.FormatQuota(rebate.RebateQuota)}))
}
