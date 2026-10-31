package model

import (
	"math"
	"net"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	sqlmysql "github.com/go-sql-driver/mysql"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func insertUserForPaymentGuardTest(t *testing.T, id int, quota int) *User {
	t.Helper()
	user := &User{
		Id:       id,
		Username: "payment_guard_user",
		Status:   common.UserStatusEnabled,
		Quota:    quota,
	}
	require.NoError(t, DB.Create(user).Error)
	return user
}

func insertSubscriptionPlanForPaymentGuardTest(t *testing.T, id int) *SubscriptionPlan {
	t.Helper()
	plan := &SubscriptionPlan{
		Id:            id,
		Title:         "Guard Plan",
		PriceAmount:   9.99,
		Currency:      "USD",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		Enabled:       true,
		TotalAmount:   1000,
	}
	require.NoError(t, DB.Create(plan).Error)
	return plan
}

func insertSubscriptionOrderForPaymentGuardTest(t *testing.T, tradeNo string, userID int, planID int, paymentProvider string) {
	t.Helper()
	order := &SubscriptionOrder{
		UserId:          userID,
		PlanId:          planID,
		Money:           9.99,
		TradeNo:         tradeNo,
		PaymentMethod:   paymentProvider,
		PaymentProvider: paymentProvider,
		Status:          common.TopUpStatusPending,
		CreateTime:      time.Now().Unix(),
	}
	require.NoError(t, order.Insert())
}

func insertTopUpForPaymentGuardTest(t *testing.T, tradeNo string, userID int, paymentProvider string) {
	t.Helper()
	topUp := &TopUp{
		UserId:          userID,
		Amount:          2,
		Money:           9.99,
		TradeNo:         tradeNo,
		PaymentMethod:   paymentProvider,
		PaymentProvider: paymentProvider,
		Status:          common.TopUpStatusPending,
		CreateTime:      time.Now().Unix(),
	}
	require.NoError(t, topUp.Insert())
}

func getTopUpStatusForPaymentGuardTest(t *testing.T, tradeNo string) string {
	t.Helper()
	topUp := GetTopUpByTradeNo(tradeNo)
	require.NotNil(t, topUp)
	return topUp.Status
}

func countUserSubscriptionsForPaymentGuardTest(t *testing.T, userID int) int64 {
	t.Helper()
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", userID).Count(&count).Error)
	return count
}

func getUserQuotaForPaymentGuardTest(t *testing.T, userID int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.Select("quota").Where("id = ?", userID).First(&user).Error)
	return user.Quota
}

func TestRechargeWaffoPancake_RejectsMismatchedPaymentMethod(t *testing.T) {
	truncateTables(t)

	insertUserForPaymentGuardTest(t, 101, 0)
	insertTopUpForPaymentGuardTest(t, "waffo-pancake-guard", 101, PaymentProviderStripe)

	err := RechargeWaffoPancake("waffo-pancake-guard")
	require.Error(t, err)

	topUp := GetTopUpByTradeNo("waffo-pancake-guard")
	require.NotNil(t, topUp)
	assert.Equal(t, common.TopUpStatusPending, topUp.Status)
	assert.Equal(t, 0, getUserQuotaForPaymentGuardTest(t, 101))
}

func TestUpdatePendingTopUpStatus_RejectsMismatchedPaymentProvider(t *testing.T) {
	testCases := []struct {
		name                    string
		tradeNo                 string
		storedPaymentProvider   string
		expectedPaymentProvider string
		targetStatus            string
	}{
		{
			name:                    "stripe expire",
			tradeNo:                 "stripe-expire-guard",
			storedPaymentProvider:   PaymentProviderCreem,
			expectedPaymentProvider: PaymentProviderStripe,
			targetStatus:            common.TopUpStatusExpired,
		},
		{
			name:                    "waffo failed",
			tradeNo:                 "waffo-failed-guard",
			storedPaymentProvider:   PaymentProviderStripe,
			expectedPaymentProvider: PaymentProviderWaffo,
			targetStatus:            common.TopUpStatusFailed,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			truncateTables(t)
			insertUserForPaymentGuardTest(t, 150, 0)
			insertTopUpForPaymentGuardTest(t, tc.tradeNo, 150, tc.storedPaymentProvider)

			err := UpdatePendingTopUpStatus(tc.tradeNo, tc.expectedPaymentProvider, tc.targetStatus)
			require.ErrorIs(t, err, ErrPaymentMethodMismatch)
			assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, tc.tradeNo))
		})
	}
}

func TestCompleteSubscriptionOrder_RejectsMismatchedPaymentProvider(t *testing.T) {
	truncateTables(t)

	insertUserForPaymentGuardTest(t, 202, 0)
	plan := insertSubscriptionPlanForPaymentGuardTest(t, 301)
	insertSubscriptionOrderForPaymentGuardTest(t, "sub-guard-order", 202, plan.Id, PaymentProviderStripe)

	err := CompleteSubscriptionOrder("sub-guard-order", `{"provider":"epay"}`, PaymentProviderEpay, "alipay")
	require.ErrorIs(t, err, ErrPaymentMethodMismatch)

	order := GetSubscriptionOrderByTradeNo("sub-guard-order")
	require.NotNil(t, order)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
	assert.Zero(t, countUserSubscriptionsForPaymentGuardTest(t, 202))

	topUp := GetTopUpByTradeNo("sub-guard-order")
	assert.Nil(t, topUp)
}

func TestExpireSubscriptionOrder_RejectsMismatchedPaymentProvider(t *testing.T) {
	truncateTables(t)

	insertUserForPaymentGuardTest(t, 303, 0)
	plan := insertSubscriptionPlanForPaymentGuardTest(t, 401)
	insertSubscriptionOrderForPaymentGuardTest(t, "sub-expire-guard", 303, plan.Id, PaymentProviderStripe)

	err := ExpireSubscriptionOrder("sub-expire-guard", PaymentProviderCreem)
	require.ErrorIs(t, err, ErrPaymentMethodMismatch)

	order := GetSubscriptionOrderByTradeNo("sub-expire-guard")
	require.NotNil(t, order)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
}

func createEpayTestOrder(t *testing.T, userId int, tradeNo string, provider string, status string) TopUp {
	t.Helper()
	topUp := TopUp{
		UserId:          userId,
		Amount:          2,
		Money:           10.0,
		TradeNo:         tradeNo,
		PaymentMethod:   "alipay",
		PaymentProvider: provider,
		CreateTime:      common.GetTimestamp(),
		Status:          status,
	}
	require.NoError(t, DB.Create(&topUp).Error)
	return topUp
}

func TestRechargeEpayCreditsQuotaExactlyOnce(t *testing.T) {
	truncateTables(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 501, 0)
	order := createEpayTestOrder(t, user.Id, "EPAYTESTONCE", PaymentProviderEpay, common.TopUpStatusPending)

	alreadyDone, err := RechargeEpay(order.TradeNo, "alipay", "10.00", "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)
	assert.Equal(t, 2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))

	reloaded := GetTopUpByTradeNo(order.TradeNo)
	require.NotNil(t, reloaded)
	assert.Equal(t, common.TopUpStatusSuccess, reloaded.Status)
	assert.NotZero(t, reloaded.CompleteTime)

	alreadyDone, err = RechargeEpay(order.TradeNo, "alipay", "10.00", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	assert.Equal(t, 2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))
}

func TestRechargeEpayKeepsRedisAndDatabaseCreditInSync(t *testing.T) {
	truncateTables(t)
	useUserCacheMiniRedis(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 5
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 502, 7)
	require.NoError(t, populateUserCache(*user))
	order := createEpayTestOrder(t, user.Id, "EPAYTESTREDISSYNC", PaymentProviderEpay, common.TopUpStatusPending)

	alreadyDone, err := RechargeEpay(order.TradeNo, "alipay", "10.00", "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)
	assert.Equal(t, 17, getUserQuotaForPaymentGuardTest(t, user.Id))
	cached, err := cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 17, cached.Quota)

	alreadyDone, err = RechargeEpay(order.TradeNo, "alipay", "10.00", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	cached, err = cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 17, cached.Quota)
}

func TestRechargeEpayUpdatesPaymentMethodToActual(t *testing.T) {
	truncateTables(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 503, 0)
	order := createEpayTestOrder(t, user.Id, "EPAYTESTMETHOD", PaymentProviderEpay, common.TopUpStatusPending)

	alreadyDone, err := RechargeEpay(order.TradeNo, "wxpay", "10.00", "127.0.0.1")
	require.NoError(t, err)
	assert.False(t, alreadyDone)

	reloaded := GetTopUpByTradeNo(order.TradeNo)
	require.NotNil(t, reloaded)
	assert.Equal(t, "wxpay", reloaded.PaymentMethod)
	assert.Equal(t, 2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))
}

func TestRechargeEpayRejectsForeignAndNonPendingOrders(t *testing.T) {
	truncateTables(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 504, 7)

	t.Run("order from another payment provider", func(t *testing.T) {
		order := createEpayTestOrder(t, user.Id, "EPAYTESTSTRIPE", PaymentProviderStripe, common.TopUpStatusPending)
		_, err := RechargeEpay(order.TradeNo, "alipay", "10.00", "127.0.0.1")
		assert.ErrorIs(t, err, ErrPaymentMethodMismatch)
		assert.Equal(t, 7, getUserQuotaForPaymentGuardTest(t, user.Id))
	})

	t.Run("order that is not pending", func(t *testing.T) {
		order := createEpayTestOrder(t, user.Id, "EPAYTESTEXPIRED", PaymentProviderEpay, common.TopUpStatusExpired)
		_, err := RechargeEpay(order.TradeNo, "alipay", "10.00", "127.0.0.1")
		assert.ErrorIs(t, err, ErrTopUpStatusInvalid)
		assert.Equal(t, 7, getUserQuotaForPaymentGuardTest(t, user.Id))
	})

	t.Run("paid amount differs from the order", func(t *testing.T) {
		order := createEpayTestOrder(t, user.Id, "EPAYTESTUNDERPAID", PaymentProviderEpay, common.TopUpStatusPending)
		for _, paid := range []string{"0.01", "9.99", "10.01", ""} {
			_, err := RechargeEpay(order.TradeNo, "alipay", paid, "127.0.0.1")
			assert.ErrorIs(t, err, ErrPaymentAmountMismatch, "paid=%q", paid)
		}
		assert.Equal(t, 7, getUserQuotaForPaymentGuardTest(t, user.Id))
		assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, order.TradeNo))

		alreadyDone, err := RechargeEpay(order.TradeNo, "alipay", "10", "127.0.0.1")
		require.NoError(t, err)
		assert.False(t, alreadyDone)
		assert.Equal(t, 7+2*500000, getUserQuotaForPaymentGuardTest(t, user.Id))
	})

	t.Run("missing order", func(t *testing.T) {
		_, err := RechargeEpay("EPAYTESTMISSING", "alipay", "10.00", "127.0.0.1")
		assert.ErrorIs(t, err, ErrTopUpNotFound)
	})
}

func TestRechargeEpayRejectsQuotaOverflowBeforeCompletingOrder(t *testing.T) {
	truncateTables(t)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = float64(common.MaxWalletQuota + 1)
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	user := insertUserForPaymentGuardTest(t, 505, 3)
	order := createEpayTestOrder(t, user.Id, "EPAYTESTOVERFLOW", PaymentProviderEpay, common.TopUpStatusPending)

	_, err := RechargeEpay(order.TradeNo, "alipay", "10.00", "127.0.0.1")
	require.Error(t, err)
	assert.Equal(t, 3, getUserQuotaForPaymentGuardTest(t, user.Id))
	assert.Equal(t, common.TopUpStatusPending, getTopUpStatusForPaymentGuardTest(t, order.TradeNo))
}

func TestRechargeEpayEnforcesFinalWalletQuotaLimit(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	testCases := []struct {
		name         string
		currentQuota int
		wantErr      bool
		wantQuota    int
		wantStatus   string
	}{
		{
			name:         "allows exact highest representable wallet balance",
			currentQuota: common.MaxWalletQuota - 1_000_000,
			wantQuota:    common.MaxWalletQuota,
			wantStatus:   common.TopUpStatusSuccess,
		},
		{
			name:         "rejects balance above wallet quota domain",
			currentQuota: common.MaxWalletQuota - 999_999,
			wantErr:      true,
			wantQuota:    common.MaxWalletQuota - 999_999,
			wantStatus:   common.TopUpStatusPending,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			truncateTables(t)
			user := insertUserForPaymentGuardTest(t, 506, tc.currentQuota)
			order := createEpayTestOrder(t, user.Id, "EPAYTESTWALLETLIMIT", PaymentProviderEpay, common.TopUpStatusPending)

			_, err := RechargeEpay(order.TradeNo, "alipay", "10.00", "127.0.0.1")
			if tc.wantErr {
				require.ErrorIs(t, err, ErrTopUpQuotaLimitExceeded)
			} else {
				require.NoError(t, err)
			}
			assert.Equal(t, tc.wantQuota, getUserQuotaForPaymentGuardTest(t, user.Id))
			assert.Equal(t, tc.wantStatus, getTopUpStatusForPaymentGuardTest(t, order.TradeNo))
		})
	}
}

func TestTopUpGrantsInviterRebateOnInviteeFirstWalletTopUpOnly(t *testing.T) {
	oldQuotaPerUnit := common.QuotaPerUnit
	oldPercent := common.InviterTopUpRebatePercent
	paymentSetting := operation_setting.GetPaymentSetting()
	oldConfirmed, oldTermsVersion := paymentSetting.ComplianceConfirmed, paymentSetting.ComplianceTermsVersion
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
		common.InviterTopUpRebatePercent = oldPercent
		paymentSetting.ComplianceConfirmed, paymentSetting.ComplianceTermsVersion = oldConfirmed, oldTermsVersion
	})

	const inviterId, inviteeId = 601, 602
	testCases := []struct {
		name              string
		percent           int
		complianceOff     bool
		noInviter         bool
		priorWalletTopUp  bool
		priorSubscription bool
		inviterAffQuota   int
		manualCompletion  bool
		wantRebate        int
	}{
		{name: "first top-up rebates the inviter", percent: 10, wantRebate: 100000},
		{name: "administrator completion rebates too", percent: 10, manualCompletion: true, wantRebate: 100000},
		{name: "earlier subscription purchase still allows the rebate", percent: 10, priorSubscription: true, wantRebate: 100000},
		{name: "earlier wallet top-up means no rebate", percent: 10, priorWalletTopUp: true},
		{name: "invitee without inviter", percent: 10, noInviter: true},
		{name: "rebate disabled", percent: 0},
		{name: "compliance not confirmed", percent: 10, complianceOff: true},
		{name: "full referral balance drops the rebate", percent: 10, inviterAffQuota: math.MaxInt32 - 99999},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			truncateTables(t)
			common.InviterTopUpRebatePercent = tc.percent
			paymentSetting.ComplianceConfirmed = !tc.complianceOff
			paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion

			require.NoError(t, DB.Create(&User{Id: inviterId, Username: "rebate_inviter", AffCode: "rebate-inviter", Status: common.UserStatusEnabled, AffQuota: tc.inviterAffQuota}).Error)
			invitee := &User{Id: inviteeId, Username: "rebate_invitee", AffCode: "rebate-invitee", Status: common.UserStatusEnabled, InviterId: inviterId}
			if tc.noInviter {
				invitee.InviterId = 0
			}
			require.NoError(t, DB.Create(invitee).Error)
			if tc.priorWalletTopUp {
				createEpayTestOrder(t, inviteeId, "REBATEPRIOR", PaymentProviderEpay, common.TopUpStatusSuccess)
			}
			if tc.priorSubscription {
				require.NoError(t, DB.Create(&TopUp{UserId: inviteeId, Money: 9.99, TradeNo: "REBATESUB", Status: common.TopUpStatusSuccess}).Error)
			}

			// Each order credits 2 units = 1,000,000 quota; a rebate is 10% of it.
			order := createEpayTestOrder(t, inviteeId, "REBATEFIRST", PaymentProviderEpay, common.TopUpStatusPending)
			if tc.manualCompletion {
				require.NoError(t, ManualCompleteTopUp(order.TradeNo, "127.0.0.1"))
			} else {
				_, err := RechargeEpay(order.TradeNo, "alipay", "10.00", "127.0.0.1")
				require.NoError(t, err)
			}
			second := createEpayTestOrder(t, inviteeId, "REBATESECOND", PaymentProviderEpay, common.TopUpStatusPending)
			_, err := RechargeEpay(second.TradeNo, "alipay", "10.00", "127.0.0.1")
			require.NoError(t, err)

			var inviter User
			require.NoError(t, DB.Select("aff_quota", "aff_history").Where("id = ?", inviterId).First(&inviter).Error)
			assert.Equal(t, tc.inviterAffQuota+tc.wantRebate, inviter.AffQuota)
			assert.Equal(t, tc.wantRebate, inviter.AffHistoryQuota)
			assert.Equal(t, 2*1000000, getUserQuotaForPaymentGuardTest(t, inviteeId), "the invitee's own top-ups are unaffected")

			var rebates []InviteRebate
			require.NoError(t, DB.Find(&rebates).Error)
			if tc.wantRebate == 0 {
				assert.Empty(t, rebates)
				return
			}
			require.Len(t, rebates, 1)
			assert.Equal(t, InviteRebate{Id: rebates[0].Id, InviterId: inviterId, InviteeId: inviteeId, TradeNo: "REBATEFIRST",
				TopUpQuota: 1000000, RebatePercent: 10, RebateQuota: tc.wantRebate, CreatedAt: rebates[0].CreatedAt}, rebates[0])
		})
	}
}

// TestInviteRebateDatabaseMatrix runs the rebate on real databases: the schema
// migrates repeatedly, and two first top-ups of one invitee completing at the
// same time both succeed while the inviter is rebated once. MySQL and
// PostgreSQL run when INVITE_REBATE_MYSQL_DSN / INVITE_REBATE_POSTGRES_DSN
// point at a loopback instance.
func TestInviteRebateDatabaseMatrix(t *testing.T) {
	cases := []struct {
		name   string
		env    string
		dbType common.DatabaseType
	}{
		{"sqlite", "", common.DatabaseTypeSQLite},
		{"mysql", "INVITE_REBATE_MYSQL_DSN", common.DatabaseTypeMySQL},
		{"postgres", "INVITE_REBATE_POSTGRES_DSN", common.DatabaseTypePostgreSQL},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var dialector gorm.Dialector
			switch tc.dbType {
			case common.DatabaseTypeSQLite:
				// Same pragmas as the default common.SQLitePath.
				dialector = sqlite.Open(t.TempDir() + "/rebate.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate")
			case common.DatabaseTypeMySQL:
				dsn := os.Getenv(tc.env)
				if dsn == "" {
					t.Skip(tc.env + " is not configured")
				}
				config, err := sqlmysql.ParseDSN(dsn)
				require.NoError(t, err)
				host, _, err := net.SplitHostPort(config.Addr)
				require.NoError(t, err)
				require.True(t, net.ParseIP(host).IsLoopback(), "database tests only permit loopback instances")
				dialector = mysql.Open(dsn)
			default:
				dsn := os.Getenv(tc.env)
				if dsn == "" {
					t.Skip(tc.env + " is not configured")
				}
				parsed, err := url.Parse(dsn)
				require.NoError(t, err)
				require.True(t, net.ParseIP(parsed.Hostname()).IsLoopback(), "database tests only permit loopback instances")
				dialector = postgres.Open(dsn)
			}
			db, err := gorm.Open(dialector, &gorm.Config{})
			require.NoError(t, err)

			originalDB, originalLogDB := DB, LOG_DB
			oldQuotaPerUnit, oldPercent := common.QuotaPerUnit, common.InviterTopUpRebatePercent
			paymentSetting := operation_setting.GetPaymentSetting()
			oldConfirmed, oldTermsVersion := paymentSetting.ComplianceConfirmed, paymentSetting.ComplianceTermsVersion
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(tc.dbType, tc.dbType)
			initCol()
			common.QuotaPerUnit = 500000
			common.InviterTopUpRebatePercent = 10
			paymentSetting.ComplianceConfirmed = true
			paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
			t.Cleanup(func() {
				DB, LOG_DB = originalDB, originalLogDB
				common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
				initCol()
				common.QuotaPerUnit, common.InviterTopUpRebatePercent = oldQuotaPerUnit, oldPercent
				paymentSetting.ComplianceConfirmed, paymentSetting.ComplianceTermsVersion = oldConfirmed, oldTermsVersion
				if sqlDB, err := db.DB(); err == nil {
					_ = sqlDB.Close()
				}
			})
			for range 2 {
				require.NoError(t, db.AutoMigrate(&User{}, &Log{}, &TopUp{}, &InviteRebate{}))
			}
			require.True(t, db.Migrator().HasIndex(&InviteRebate{}, "InviteeId"), "invitee_id must stay unique")
			for _, table := range []string{"invite_rebates", "top_ups", "logs", "users"} {
				require.NoError(t, db.Exec("DELETE FROM "+table).Error)
			}

			inviter := &User{Username: "rebate_mx_inviter", AffCode: "rebate-mx-inviter", Status: common.UserStatusEnabled, Group: "default"}
			require.NoError(t, db.Create(inviter).Error)
			invitee := &User{Username: "rebate_mx_invitee", AffCode: "rebate-mx-invitee", Status: common.UserStatusEnabled, Group: "default", InviterId: inviter.Id}
			require.NoError(t, db.Create(invitee).Error)
			first := createEpayTestOrder(t, invitee.Id, "REBATEMXA", PaymentProviderEpay, common.TopUpStatusPending)
			second := createEpayTestOrder(t, invitee.Id, "REBATEMXB", PaymentProviderEpay, common.TopUpStatusPending)

			var wg sync.WaitGroup
			errs := make([]error, 2)
			for i, tradeNo := range []string{first.TradeNo, second.TradeNo} {
				wg.Go(func() { _, errs[i] = RechargeEpay(tradeNo, "alipay", "10.00", "127.0.0.1") })
			}
			wg.Wait()
			require.NoError(t, errs[0])
			require.NoError(t, errs[1])

			assert.Equal(t, 2*1000000, getUserQuotaForPaymentGuardTest(t, invitee.Id))
			var reloaded User
			require.NoError(t, db.Select("aff_quota", "aff_history").Where("id = ?", inviter.Id).First(&reloaded).Error)
			assert.Equal(t, 100000, reloaded.AffQuota)
			assert.Equal(t, 100000, reloaded.AffHistoryQuota)
			var rebates int64
			require.NoError(t, db.Model(&InviteRebate{}).Where("invitee_id = ?", invitee.Id).Count(&rebates).Error)
			assert.Equal(t, int64(1), rebates)

			third := createEpayTestOrder(t, invitee.Id, "REBATEMXC", PaymentProviderEpay, common.TopUpStatusPending)
			_, err = RechargeEpay(third.TradeNo, "alipay", "10.00", "127.0.0.1")
			require.NoError(t, err)
			require.NoError(t, db.Select("aff_quota").Where("id = ?", inviter.Id).First(&reloaded).Error)
			assert.Equal(t, 100000, reloaded.AffQuota, "later top-ups are not rebated")
		})
	}
}
