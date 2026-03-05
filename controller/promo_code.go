package controller

import (
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetAllPromoCodes(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	codes, total, err := model.GetAllPromoCodes(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

func SearchPromoCodes(c *gin.Context) {
	keyword := c.Query("keyword")
	pageInfo := common.GetPageQuery(c)
	codes, total, err := model.SearchPromoCodes(keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

func GetPromoCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pc, err := model.GetPromoCodeById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": pc})
}

// promoCodeRequest is the shape expected from the frontend for create/update.
type promoCodeRequest struct {
	Id            int        `json:"id"`
	Code          string     `json:"code"`
	Name          string     `json:"name"`
	Type          string     `json:"type"`           // "quota" | "discount"
	QuotaValue    int        `json:"quota_value"`
	DiscountValue float64    `json:"discount_value"` // 0 < v < 1, e.g. 0.9
	MaxUses       int        `json:"max_uses"`       // 0 = unlimited
	ExpiresAt     *time.Time `json:"expires_at"`
	Enabled       bool       `json:"enabled"`
}

func validatePromoCodeRequest(c *gin.Context, req *promoCodeRequest, isCreate bool) bool {
	if utf8.RuneCountInString(req.Code) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "邀请码不能为空"})
		return false
	}
	if utf8.RuneCountInString(req.Code) > 64 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "邀请码长度不能超过64个字符"})
		return false
	}
	if req.Type != "quota" && req.Type != "discount" {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "类型必须为 quota 或 discount"})
		return false
	}
	if req.Type == "quota" && req.QuotaValue <= 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "额度类型的邀请码必须设置正数额度"})
		return false
	}
	if req.Type == "discount" && (req.DiscountValue <= 0 || req.DiscountValue >= 1) {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "折扣率必须大于0且小于1（例如0.9表示九折）"})
		return false
	}
	if req.MaxUses < 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "最大使用次数不能为负数"})
		return false
	}
	return true
}

func AddPromoCode(c *gin.Context) {
	var req promoCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if !validatePromoCodeRequest(c, &req, true) {
		return
	}
	pc := &model.PromoCode{
		Code:          req.Code,
		Name:          req.Name,
		Type:          req.Type,
		QuotaValue:    req.QuotaValue,
		DiscountValue: req.DiscountValue,
		MaxUses:       req.MaxUses,
		ExpiresAt:     req.ExpiresAt,
		Enabled:       req.Enabled,
	}
	if err := pc.Insert(); err != nil {
		// Unique constraint violation gives a clear enough DB error message.
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "创建失败：" + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": pc})
}

func UpdatePromoCode(c *gin.Context) {
	var req promoCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.Id == 0 {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "id 不能为空"})
		return
	}
	if !validatePromoCodeRequest(c, &req, false) {
		return
	}
	pc := &model.PromoCode{
		Id:            req.Id,
		Code:          req.Code,
		Name:          req.Name,
		Type:          req.Type,
		QuotaValue:    req.QuotaValue,
		DiscountValue: req.DiscountValue,
		MaxUses:       req.MaxUses,
		ExpiresAt:     req.ExpiresAt,
		Enabled:       req.Enabled,
	}
	if err := pc.Update(); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "更新失败：" + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": pc})
}

func DeletePromoCode(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pc, err := model.GetPromoCodeById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := pc.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}
