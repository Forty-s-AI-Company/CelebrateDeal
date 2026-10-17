# WP-04：固定非正式排程目標仍不存在

2026-10-16 以唯讀 Vercel API 與 CLI 重新核對 `a25814740s-projects/celebrate-deal-staging`。專案確實存在，但這不等於已具備 WP-04 可用的固定 staging scheduler。

## 已查明

- Project ID：`prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn`，`live=false`。
- 最新 deployment `dpl_E9wbsvtxx8ChBjZnUifufjgs93dC` 為 READY，但 `target=null`、沒有 alias、來源為 CLI；無法證明是目前 Goal source。
- Custom environments：0。
- `vercel crons ls`：registered 0、undeployed 0、modified 0；`enabled=true` 只是功能狀態，不代表存在排程。
- 本輪只有唯讀盤點，沒有部署、註冊 Cron、建立 alias、修改 environment、觸發 job 或讀取 Secret。

## 仍缺少

- 固定、可識別且屬於目前 Goal source 的非 Production target。
- 與正式資料庫隔離的資料綁定證明。
- staging 使用 PayUni live 的付款隔離；NT$1／2／3 測試價格本身不是 Sandbox。
- 平台安全注入 job authentication，以及 edge path 可由 scheduler 正常通過。
- Vercel 以外的重複 scheduler 排除與單一 owner。
- 至少兩次連續心跳、失敗可見性、合成確認 Email 與提醒收件回執。
- LINE provider 實際送達另由 WP-13 驗證。

獨立 Claude Sonnet 複審實際觀測 `claude-sonnet-5-5`，結論為目前不可安全啟用 runtime scheduling；4 BLOCKER、5 MAJOR、1 MINOR。這些 finding 描述同一組缺少的外部環境事實，不代表產品程式失敗。依使用者「不要擴充底層接線與驗證」要求，不建立另一套 scheduler 平台，也不使用 Production 或 shared staging 資料繞過。

Evidence：

- `docs/ai-team/evidence/product-audit-20261011/WP-04/platform-recheck-after-wp19-20261016.json`
- `docs/ai-team/evidence/product-audit-20261011/WP-04/platform-recheck-sonnet-review-20261016.json`

AI_TEAM_HANDOFF
CURRENT_TASK_STATUS: BLOCKED（WP-04 層級；Goal 仍 active）
CURRENT_WORK_ITEM: WP-04 固定隔離的非 Production scheduler、心跳與合成通知驗收。
ACTUAL_RESULT: staging project 存在，但沒有固定 target、custom environment 或 Cron；資料／付款隔離及送達均未證明。
EVIDENCE: 本文件與上述兩份 sanitized evidence。
NEXT_ACTION: 只有在平台提供固定隔離 target、非正式 DB／付款邊界及安全 job binding 後才註冊排程；目前跳過 WP-04，不重做相同部署。
ROLLBACK: 本輪只有文件與 evidence，無平台或產品變更。
SAFETY_STATUS: PASS
PLAN_REVIEW_STATUS: BLOCKED_BY_EXTERNAL_ENVIRONMENT
GIT_PROMOTION_STATUS: NOT_REQUESTED
PRODUCTION_DEPLOYMENT: NOT_AUTHORIZED
COPY_TO_NEW_TASK: NO
