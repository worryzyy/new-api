package controller

import (
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

const contentModerationTestMaxRunes = 10000

func GetContentModerationStatus(c *gin.Context) {
	setting := operation_setting.GetContentModerationSetting()
	common.ApiSuccess(c, gin.H{
		"openai_api_key_configured": strings.TrimSpace(setting.OpenAIAPIKey) != "",
	})
}

func GetContentModerationLogs(c *gin.Context) {
	page := common.GetPageQuery(c)
	filter := model.ContentModerationLogFilter{
		Username: c.Query("username"),
		Action:   c.Query("action"),
		Source:   c.Query("source"),
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
	if raw := c.Query("user_id"); raw != "" {
		userId, err := strconv.Atoi(raw)
		if err != nil || userId < 0 {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
			return
		}
		filter.UserId = userId
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

type contentModerationTestRequest struct {
	Text string `json:"text"`
}

// TestContentModeration runs the current keyword and OpenAI configuration on a
// sample text without recording a log, so administrators can verify settings.
func TestContentModeration(c *gin.Context) {
	var req contentModerationTestRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || strings.TrimSpace(req.Text) == "" || utf8.RuneCountInString(req.Text) > contentModerationTestMaxRunes {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	verdict, err := service.CheckModerationInput(c.Request.Context(), service.ModerationInput{Text: req.Text})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, verdict)
}

// UnbanContentModerationUser re-enables a user and records an unban entry that
// resets the user's violation count for automatic bans.
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
	if err := model.CreateContentModerationLog(&model.ContentModerationLog{
		CreatedAt: common.GetTimestamp(),
		UserId:    user.Id,
		Username:  user.Username,
		Action:    model.ContentModerationActionUnban,
		Source:    "admin",
	}); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, user.Id, "user.manage", map[string]any{
		"action":   "enable",
		"username": user.Username,
		"id":       user.Id,
		"source":   "content_moderation",
	})
	common.ApiSuccess(c, nil)
}
