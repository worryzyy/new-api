package controller

import (
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

const contentModerationTestMaxRunes = 12000

func GetContentModerationStatus(c *gin.Context) {
	common.ApiSuccess(c, service.GetContentModerationStatus())
}

func GetContentModerationConfig(c *gin.Context) {
	common.ApiSuccess(c, service.GetContentModerationConfigView())
}

func UpdateContentModerationConfig(c *gin.Context) {
	var update service.ContentModerationConfigUpdate
	if err := common.DecodeJson(c.Request.Body, &update); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	if err := service.UpdateContentModerationConfig(update); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, err)
		return
	}
	recordManageAuditFor(c, 0, "content_moderation.config", map[string]any{
		"enabled": update.Enabled,
		"mode":    update.Mode,
	})
	common.ApiSuccess(c, service.GetContentModerationConfigView())
}

// TestContentModerationKeys checks the submitted keys (or the saved keys) and,
// with a prompt or image, the moderation verdict for that sample. Nothing is
// recorded.
func TestContentModerationKeys(c *gin.Context) {
	var req service.ModerationTestRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	if len([]rune(req.Prompt)) > contentModerationTestMaxRunes || len(req.Images) > 1 || len(req.APIKeys) > 50 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	for _, image := range req.Images {
		if len(image) > 8<<20 || (!strings.HasPrefix(image, "data:image/") && !strings.HasPrefix(image, "http://") && !strings.HasPrefix(image, "https://")) {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
			return
		}
	}
	common.ApiSuccess(c, service.TestModerationKeys(c.Request.Context(), req))
}

func GetContentModerationLogs(c *gin.Context) {
	page := common.GetPageQuery(c)
	filter := model.ContentModerationLogFilter{
		Result:    c.Query("result"),
		GroupName: c.Query("group"),
		Endpoint:  c.Query("endpoint"),
		Search:    c.Query("search"),
	}
	switch filter.Result {
	case "", model.ContentModerationResultHit, model.ContentModerationResultBlocked, model.ContentModerationResultPass, model.ContentModerationResultError:
	default:
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	for name, target := range map[string]*int64{"start_timestamp": &filter.StartTimestamp, "end_timestamp": &filter.EndTimestamp} {
		if raw := c.Query(name); raw != "" {
			parsed, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || parsed < 0 {
				common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
				return
			}
			*target = parsed
		}
	}
	logs, total, err := model.GetContentModerationLogs(filter, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetItems(logs)
	page.SetTotal(int(total))
	common.ApiSuccess(c, page)
}

// UnbanContentModerationUser re-enables a user disabled by moderation. The
// violation count already restarted when the ban was recorded.
func UnbanContentModerationUser(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("id"))
	if err != nil || userId <= 0 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	user, err := model.GetUserById(userId, true)
	if err != nil {
		common.ApiErrorT(c, "User does not exist")
		return
	}
	if user.Status != common.UserStatusEnabled {
		user.Status = common.UserStatusEnabled
		if err := user.Update(false); err != nil {
			common.ApiError(c, err)
			return
		}
		if err := model.InvalidateUserTokensCache(user.Id); err != nil {
			common.SysLog(common.LogText("failed to invalidate tokens cache for user %d: %s", user.Id, err.Error()))
		}
	}
	recordManageAuditFor(c, user.Id, "user.manage", map[string]any{
		"action":   "enable",
		"username": user.Username,
		"id":       user.Id,
		"source":   "content_moderation",
	})
	common.ApiSuccess(c, nil)
}

type contentModerationHashRequest struct {
	InputHash string `json:"input_hash"`
}

func DeleteContentModerationHash(c *gin.Context) {
	var req contentModerationHashRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	hash := strings.ToLower(strings.TrimSpace(req.InputHash))
	if decoded, err := hex.DecodeString(hash); err != nil || len(decoded) != 32 {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid content hash"))
		return
	}
	deleted, err := service.DeleteContentModerationHash(hash)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"input_hash": hash, "deleted": deleted})
}

func ClearContentModerationHashes(c *gin.Context) {
	deleted, err := service.ClearContentModerationHashes()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, 0, "content_moderation.clear_hashes", map[string]any{"deleted": deleted, "at": time.Now().Unix()})
	common.ApiSuccess(c, gin.H{"deleted": deleted})
}
