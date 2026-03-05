package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"gorm.io/gorm"
)

// PromoCode represents an admin-defined invite/promo code that grants benefits
// on registration via the existing ?aff= URL mechanism.
// Type "quota"    → QuotaValue extra quota credited at registration.
// Type "discount" → DiscountValue (0 < v < 1) stored on the user for future topups.
type PromoCode struct {
	Id            int            `json:"id"`
	Code          string         `json:"code" gorm:"type:varchar(64);uniqueIndex"`
	Name          string         `json:"name" gorm:"type:varchar(100)"`
	Type          string         `json:"type" gorm:"type:varchar(20);default:'quota'"` // "quota" | "discount"
	QuotaValue    int            `json:"quota_value" gorm:"default:0"`
	DiscountValue float64        `json:"discount_value" gorm:"default:0"` // e.g. 0.9 = 90% (10% off)
	MaxUses       int            `json:"max_uses" gorm:"default:0"`       // 0 = unlimited
	UsedCount     int            `json:"used_count" gorm:"default:0"`
	ExpiresAt     *time.Time     `json:"expires_at"`
	Enabled       bool           `json:"enabled" gorm:"default:true"`
	CreatedAt     time.Time      `json:"created_at"`
	DeletedAt     gorm.DeletedAt `gorm:"index"`
}

// GetPromoCodeByCode looks up an active promo code. Returns an error if not found
// or the code is disabled/expired/exhausted.
func GetPromoCodeByCode(code string) (*PromoCode, error) {
	if code == "" {
		return nil, errors.New("code is empty")
	}
	var pc PromoCode
	if err := DB.Where("code = ?", code).First(&pc).Error; err != nil {
		return nil, err
	}
	if !pc.Enabled {
		return nil, errors.New("promo code is disabled")
	}
	if pc.ExpiresAt != nil && pc.ExpiresAt.Before(time.Now()) {
		return nil, errors.New("promo code has expired")
	}
	if pc.MaxUses > 0 && pc.UsedCount >= pc.MaxUses {
		return nil, errors.New("promo code has reached its usage limit")
	}
	return &pc, nil
}

// IncrementPromoCodeUsage atomically increments the used_count of a promo code.
// When MaxUses > 0 it enforces the limit via a conditional UPDATE, preventing
// TOCTOU races under concurrent registrations.
func IncrementPromoCodeUsage(pc *PromoCode) error {
	var result *gorm.DB
	if pc.MaxUses > 0 {
		result = DB.Model(&PromoCode{}).
			Where("id = ? AND used_count < ?", pc.Id, pc.MaxUses).
			UpdateColumn("used_count", gorm.Expr("used_count + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("promo code usage limit reached")
		}
	} else {
		result = DB.Model(&PromoCode{}).
			Where("id = ?", pc.Id).
			UpdateColumn("used_count", gorm.Expr("used_count + 1"))
		if result.Error != nil {
			return result.Error
		}
	}
	return nil
}

func GetAllPromoCodes(startIdx int, num int) ([]*PromoCode, int64, error) {
	var total int64
	var codes []*PromoCode
	if err := DB.Model(&PromoCode{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := DB.Order("id desc").Limit(num).Offset(startIdx).Find(&codes).Error; err != nil {
		return nil, 0, err
	}
	return codes, total, nil
}

func SearchPromoCodes(keyword string, startIdx int, num int) ([]*PromoCode, int64, error) {
	var total int64
	var codes []*PromoCode
	query := DB.Model(&PromoCode{}).Where("name LIKE ? OR code LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("id desc").Limit(num).Offset(startIdx).Find(&codes).Error; err != nil {
		return nil, 0, err
	}
	return codes, total, nil
}

func GetPromoCodeById(id int) (*PromoCode, error) {
	if id == 0 {
		return nil, errors.New("id is empty")
	}
	var pc PromoCode
	if err := DB.First(&pc, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &pc, nil
}

func (pc *PromoCode) Insert() error {
	return DB.Create(pc).Error
}

func (pc *PromoCode) Update() error {
	return DB.Model(pc).Select("name", "code", "type", "quota_value", "discount_value", "max_uses", "expires_at", "enabled").Updates(pc).Error
}

func (pc *PromoCode) Delete() error {
	return DB.Delete(pc).Error
}

// GetUserTopupDiscount returns the user's stored promo discount (0 < v < 1),
// or 1.0 if the user has no discount configured.
func GetUserTopupDiscount(userId int) float64 {
	if userId == 0 {
		return 1.0
	}
	var user User
	if err := DB.Select("topup_discount").First(&user, "id = ?", userId).Error; err != nil {
		return 1.0
	}
	if user.TopupDiscount > 0 && user.TopupDiscount < 1 {
		return user.TopupDiscount
	}
	return 1.0
}

// SetUserTopupDiscount stores the promo discount rate on the user record.
func SetUserTopupDiscount(userId int, discount float64) error {
	if userId == 0 {
		return errors.New("invalid user id")
	}
	if discount <= 0 || discount >= 1 {
		return errors.New("discount must be between 0 and 1 (exclusive)")
	}
	return DB.Model(&User{}).Where("id = ?", userId).
		UpdateColumn("topup_discount", discount).Error
}

// ClearUserTopupDiscount removes the promo discount from a user after their
// first successful topup, so subsequent topups are charged at full price.
func ClearUserTopupDiscount(userId int) error {
	if userId == 0 {
		return errors.New("invalid user id")
	}
	return DB.Model(&User{}).Where("id = ?", userId).
		UpdateColumn("topup_discount", 0).Error
}

// ApplyFetchedPromoCode applies an already-validated promo code to a user.
// Use this when the caller has already called GetPromoCodeByCode to avoid a
// second DB lookup.
func ApplyFetchedPromoCode(pc *PromoCode, userId int) (applied bool, err error) {
	switch pc.Type {
	case "quota":
		if pc.QuotaValue > 0 {
			if err := IncreaseUserQuota(userId, pc.QuotaValue, true); err != nil {
				return false, err
			}
			RecordLog(userId, LogTypeSystem, fmt.Sprintf("通过邀请码赠送 %s", logger.LogQuota(pc.QuotaValue)))
		}
	case "discount":
		if pc.DiscountValue > 0 && pc.DiscountValue < 1 {
			if err := SetUserTopupDiscount(userId, pc.DiscountValue); err != nil {
				return false, err
			}
			RecordLog(userId, LogTypeSystem, fmt.Sprintf("通过邀请码获得充值折扣 %.0f%%", (1-pc.DiscountValue)*100))
		}
	}

	if err := IncrementPromoCodeUsage(pc); err != nil {
		// Non-fatal: log it but don't fail the registration.
		common.SysError("failed to increment promo code usage: " + err.Error())
	}

	return true, nil
}

// ApplyPromoCode validates and applies a promo code to a newly registered user.
// It returns true if a promo code was consumed (caller should skip user aff_code lookup).
func ApplyPromoCode(code string, userId int) (applied bool, err error) {
	pc, err := GetPromoCodeByCode(code)
	if err != nil {
		// Not a valid promo code — not an error from the caller's perspective,
		// just means we should fall through to user aff_code logic.
		return false, nil
	}
	return ApplyFetchedPromoCode(pc, userId)
}
