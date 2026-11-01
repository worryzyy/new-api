package operation_setting

import (
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

const (
	TopUpBonusTypeFixed   = "fixed"
	TopUpBonusTypePercent = "percent"

	TopUpBonusTiersOptionKey = "topup_bonus_setting.tiers"
	maxTopUpBonusTiers       = 20
)

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

// TopUpBonusSetting is the top-up bonus campaign. StartTime and EndTime are
// Unix seconds; zero leaves that side of the window open.
type TopUpBonusSetting struct {
	Enabled     bool             `json:"enabled"`
	StartTime   int64            `json:"start_time"`
	EndTime     int64            `json:"end_time"`
	Title       string           `json:"title"`
	Description string           `json:"description"`
	Tiers       []TopUpBonusTier `json:"tiers"`
}

var topUpBonusSetting = TopUpBonusSetting{
	Tiers: []TopUpBonusTier{},
}

func init() {
	config.GlobalConfig.Register("topup_bonus_setting", &topUpBonusSetting)
}

func GetTopUpBonusSetting() *TopUpBonusSetting {
	return &topUpBonusSetting
}

// IsActiveAt reports whether an order created at ts earns the bonus.
func (s *TopUpBonusSetting) IsActiveAt(ts int64) bool {
	return s.Enabled && len(s.Tiers) > 0 &&
		(s.StartTime == 0 || ts >= s.StartTime) &&
		(s.EndTime == 0 || ts < s.EndTime)
}

// ValidateTopUpBonusTiers checks the tiers JSON an administrator saves.
func ValidateTopUpBonusTiers(raw string) error {
	var tiers []TopUpBonusTier
	if err := common.UnmarshalJsonStr(raw, &tiers); err != nil {
		return common.NewMessage("Top-up bonus tiers must be a JSON array")
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
	return nil
}

func isFinitePositive(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v > 0
}
