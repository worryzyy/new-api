package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

type campaignRequest struct {
	Title      string                 `json:"title"`
	Content    string                 `json:"content"`
	StartTime  int64                  `json:"start_time"`
	EndTime    int64                  `json:"end_time"`
	BonusTiers []model.TopUpBonusTier `json:"bonus_tiers"`
}

type campaignResponse struct {
	*model.Campaign
	BonusTiers []model.TopUpBonusTier `json:"bonus_tiers"`
	BonusCount int64                  `json:"bonus_count"`
	BonusQuota int64                  `json:"bonus_quota"`
}

func campaignIdParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid ID"))
		return 0, false
	}
	return id, true
}

// bindCampaign reads and validates a campaign an administrator saves.
func bindCampaign(c *gin.Context) (*model.Campaign, bool) {
	var req campaignRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid request body"))
		return nil, false
	}
	campaign := &model.Campaign{
		Title:     strings.TrimSpace(req.Title),
		Content:   model.LongText(req.Content),
		StartTime: req.StartTime,
		EndTime:   req.EndTime,
	}
	if req.BonusTiers == nil {
		req.BonusTiers = []model.TopUpBonusTier{}
	}
	if err := model.ValidateCampaign(campaign, req.BonusTiers); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, err)
		return nil, false
	}
	return campaign, true
}

// GetCampaigns lists every campaign with the bonuses it granted. The page
// HTML is left out; GetCampaign returns it for editing.
func GetCampaigns(c *gin.Context) {
	campaigns, err := model.GetAllCampaigns()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ids := make([]int, len(campaigns))
	for i, campaign := range campaigns {
		ids[i] = campaign.Id
	}
	stats, err := model.GetCampaignBonusStats(ids)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]campaignResponse, len(campaigns))
	for i, campaign := range campaigns {
		stat := stats[campaign.Id]
		tiers := campaign.Tiers()
		campaign.Content = ""
		items[i] = campaignResponse{Campaign: campaign, BonusTiers: tiers, BonusCount: stat.Count, BonusQuota: stat.Quota}
	}
	common.ApiSuccess(c, items)
}

func GetCampaign(c *gin.Context) {
	id, ok := campaignIdParam(c)
	if !ok {
		return
	}
	campaign, err := model.GetCampaignById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, campaignResponse{Campaign: campaign, BonusTiers: campaign.Tiers()})
}

func CreateCampaign(c *gin.Context) {
	campaign, ok := bindCampaign(c)
	if !ok {
		return
	}
	if err := model.CreateCampaign(campaign); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": campaign.Id})
}

func UpdateCampaign(c *gin.Context) {
	id, ok := campaignIdParam(c)
	if !ok {
		return
	}
	campaign, ok := bindCampaign(c)
	if !ok {
		return
	}
	campaign.Id = id
	current, err := model.GetCampaignById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if current.Status == model.CampaignStatusPublished && len(campaign.Tiers()) > 0 && !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorT(c, "Payment, redemption, subscription, and invitation reward features are disabled. The administrator must confirm compliance terms before enabling them.")
		return
	}
	if err := model.UpdateCampaignContent(campaign); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func DeleteCampaign(c *gin.Context) {
	id, ok := campaignIdParam(c)
	if !ok {
		return
	}
	if err := model.DeleteCampaign(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// PublishCampaign shows the campaign to users and ends the one published
// before it. Bonus tiers grant quota, so they need payment compliance.
func PublishCampaign(c *gin.Context) {
	id, ok := campaignIdParam(c)
	if !ok {
		return
	}
	campaign, err := model.GetCampaignById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(campaign.Tiers()) > 0 && !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorT(c, "Payment, redemption, subscription, and invitation reward features are disabled. The administrator must confirm compliance terms before enabling them.")
		return
	}
	if err := model.PublishCampaign(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func EndCampaign(c *gin.Context) {
	id, ok := campaignIdParam(c)
	if !ok {
		return
	}
	if err := model.EndCampaign(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetCurrentCampaign serves the published campaign for the header link, the
// campaign page and the wallet. A campaign past its end time is reported as
// not visible so that pages hide it.
func GetCurrentCampaign(c *gin.Context) {
	campaign, err := model.GetCurrentCampaign()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	now := common.GetTimestamp()
	visible := campaign != nil && (campaign.EndTime == 0 || now < campaign.EndTime)
	data := gin.H{
		"visible": visible,
		"active":  visible && now >= campaign.StartTime,
	}
	if visible {
		data["id"] = campaign.Id
		data["title"] = campaign.Title
		data["content"] = campaign.Content
		data["start_time"] = campaign.StartTime
		data["end_time"] = campaign.EndTime
		data["tiers"] = campaign.Tiers()
	}
	common.ApiSuccess(c, data)
}
