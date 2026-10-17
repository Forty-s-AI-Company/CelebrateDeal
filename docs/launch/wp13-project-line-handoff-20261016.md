# WP-13：每個 Project 選擇可共用的 LINE 官方帳號

本機子項已通過 canonical `assess_acceptance`，狀態 READY。商家在 `/settings/line` 集中新增多個官方帳號，各課程 `/projects/[id]` 用下拉選單選擇；同一帳號可以被多個課程共用。頁面提供「登入 LINE 官方帳號後台」外連，通道串接與學員 LINE Login 分開說明。首次新增帳號仍需在 LINE Developers 完成通道設定，沒有將一般 LINE Login 冒充官方帳號管理授權。

## 實際結果與驗證

| 驗證 | 結果 |
| --- | --- |
| 同來源 targeted unit | PASS，128 tests／15 files |
| 實際 PostgreSQL 整合 | PASS，18 tests／3 files；含跨租戶 FK、同 LINE 學員多課程綁定、帳號範圍 unfollow、切換後停止舊通知、新帳號綁定後同事件可重新入列、tenant cascade、舊資料回填與 OAuth 失效、原圖文選單 CAS／未知結果鎖 |
| Migration | PASS，132 migrations；僅本機 disposable PostgreSQL；container 與 tempRoot 清理 PASS |
| 實際 Next dev／Chromium | PASS，1 條完整登入與設定流程：新增兩帳號、兩課程共用帳號、其中一課改用另一帳號、資料庫結果核對、憑證不回填、專屬 webhook 顯示；2 張截圖均已人工檢視 |
| TypeScript | PASS，session 40461 exit 0 |
| 產品與改動測試 ESLint | PASS；未調低規則或加入 disable |
| diff whitespace | PASS |
| 獨立深度審查 | PASS；四次成功 terminal 均觀測 `claude-opus-5-5`，effort unknown；原始來源與修正範圍審查保留 |
| 第一次 review transport | TRUNCATED_REVIEW，model unknown；保留失敗，未當成審查通過 |
| Canonical acceptance | READY，無 blocker；revision `sha256:2739c4b14725e0a0cb78a60fb34fc6710fc393678100b02e0b90ac806f5f2fc4` |
| 真實 LINE Login／bot 驗證／推播／圖文選單發佈 | NOT_RUN |
| Production build／Preview／staging／remote CI | NOT_RUN；本次沒有推送或部署 |

Webhook regression 直接匯入 `/api/webhooks/line/[vendorId]/[accountId]` handler，驗證非預設帳號簽名可撤銷自己的身份；預設帳號簽名回 401，未知帳號回 404。某次 core 複審因 prompt 漏附既有 nested route，誤認沒有帳號專屬網址；finding 原文保留，以實際來源、上述測試及最終 boundary review 判定 rejected_with_reason。

前三次瀏覽器失敗分別為缺合成 ingress proof、狀態提示定位不唯一、讀到上一次儲存提示而過早查詢資料庫；修改任務專用測試後通過。一次 DB 測試失敗為舊單帳號 fixture 在建立第二商家後選錯帳號；修正 fixture 後 18 tests 全通過。所有失敗收據保留，沒有 skip、exclude 或降低 assertion。

## 尚未完成與已知限制

- 完整 WP-13 尚未驗收。真實測試官方帳號／Messaging API 與 Login channel 的非正式環境設定、安全注入、外部授權與實際收件 evidence 仍未取得，外部子項標示 WAITING_AUTHORIZATION。本次本機開發與測試已完成，不再等待這些輸入。
- 同一瀏覽器只保留最近一次開始的 LINE OAuth；不同分頁同時啟動時，較早流程需重新開始。
- 共享帳號有任何 `sending` 通知時，保守地暫停切換共用課程的帳號；失效租約由既有 worker 回收。
- A→B→A 不補發已停止的 A 舊事件，後續新事件正常處理。這項去重限制已記錄，不冒充歷史重送功能。
- 保留 MINOR／NIT：擁有者重新儲存憑證沿用原本啟用語意；直接連線診斷 action 未另拒絕停用狀態；圖文選單修改／刪除的 account scoping 依前置 owned read 與固定 draft identity，尚未加到寫入 predicate。沒有未處理 BLOCKER／MAJOR。
- Prisma 6 無法表達的 partial unique indexes／CHECK 需保留 SQL 約束，詳見 scope 文件；未宣稱 remote CI 或未來 migration 已驗證。
- 原 20 WP 完成數維持 **9/20，45%**。本機子項 READY 不增加整包完成數。未完成 WP-02、03、04、09、12、13、14、16、17、18、19。
- Email 測試收件者沿用 `a88221144@gmail.com`，本次沒有寄信。SMS 維持人類指定暫不實作；staging NT$1／2／3 與 PayUni 正式金流邊界不變；專案發布條件不變。

## 改動檔案清單

以下 37 個來源／測試檔案是本次新增或增量修改；並非這個長期 worktree 的全部變更。完整 hash 與 review coverage 在 `project-accounts-snapshot.json`。

產品／schema 共 21 檔：

- `prisma/schema.prisma`
- `prisma/migrations/20261016190000_project_line_accounts/migration.sql`
- `src/lib/line-account-routing.ts`
- `src/lib/line-login-browser-binding.ts`
- `src/lib/line-login.ts`
- `src/lib/line-notification.ts`
- `src/lib/line-notification-materializer.ts`（僅 Prisma delegate type）
- `src/lib/automation-workflow.ts`（僅 Prisma delegate type）
- `src/lib/line-rich-menu-sync.ts`
- `src/lib/line-webhook-events.ts`
- `src/app/actions/line-actions.ts`
- `src/app/actions/line-rich-menu-actions.ts`
- `src/app/actions/project-line-actions.ts`
- `src/app/(app)/settings/line/page.tsx`
- `src/app/(app)/projects/[id]/page.tsx`
- `src/components/line-official-account-form.tsx`
- `src/components/line-rich-menu-studio.tsx`
- `src/app/api/auth/line/start/route.ts`
- `src/app/api/auth/line/callback/route.ts`
- `src/app/api/webhooks/line/[vendorId]/route.ts`
- `src/app/api/webhooks/line/[vendorId]/[accountId]/route.ts`

測試共 16 檔：

- `src/lib/line-account-routing.test.ts`
- `src/lib/line-project-accounts.db.test.ts`
- `src/lib/line-login.test.ts`
- `src/lib/line-notification.test.ts`
- `src/lib/line-webhook-events.test.ts`
- `src/lib/line-rich-menu-draft.db.test.ts`
- `src/lib/line-rich-menu-sync.db.test.ts`
- `src/app/actions/line-actions.test.ts`
- `src/app/actions/line-rich-menu-actions.test.ts`
- `src/app/actions/project-line-actions.test.ts`
- `src/app/(app)/settings/line/page.test.tsx`
- `src/app/api/auth/line/start/route.test.ts`
- `src/app/api/auth/line/callback/route.test.ts`
- `src/app/api/webhooks/line/[vendorId]/route.test.ts`
- `tests/e2e/smoke.spec.ts`（僅既有 unique lookup 改為 scoped findFirst，以配合多帳號 schema；本次未跑完整 smoke）
- `tests/e2e/wp13-project-line-accounts.spec.ts`

任務專用 caller／收據放在 `.ai-team/reports/line-multiaccount-*`；沿用既有 disposable runner 與既有本機 Playwright 設定，未修改共享 runner、router、routing policy、CI workflow 或任何 AI Team 底層接線。既有 GitHub Actions 已設定每次 push 執行 ESLint 與 unit／coverage，本次未推送，remote CI 未執行。

## Ownership、回滾與 evidence

root 是唯一 writer；requested/effective team `ai-team-pro`。實作 route 建議 `gpt-6.1-sol / xhigh`，實際主代理 model／effort unknown；不以建議冒充觀測。native 子代理 0、depth 0／上限 1、parallel 1、writer 1、automatic spawn=false。依本對話已核准不限複審執行 5 次獨立 CLI review transport，4 次成功觀測 Opus，1 次截斷未取得模型資格。AGY 本次 NOT_CHECKED，未宣稱 unavailable 或虛構 fallback 原因；canonical gate 保存原推薦與實際 terminal 資格。

所有變更都在獨立 worktree `C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal`，detached HEAD `efb8b7e9a737ea30ea691870318d85bf74830331`。使用者原工作樹 `C:/Users/eden/Downloads/AI/CelebrateDeal` 未寫入，也沒有在該工作樹執行 checkout／reset／clean／stash／restore／rebase。未推送或部署。

回滾僅反向本次 37 檔增量與本次文件段落。21 個產品／schema 檔案另有 `project-accounts-owned-product.patch`，不包含之前 WP 的修改；16 個測試依本次清單另外反向。`project-accounts-rollback-manifest.json` 區分實際編輯前副本、全新檔案，以及依本輪已讀原文重建的兩個 OAuth route 文字版本。編輯前備份位於 `.ai-team/reports/line-multiaccount-before-20261016/`，來源副檔名加 `.before`，避免被測試 runner 當成真實測試。回滾 patch 尚未執行，套用前須先檢查它仍匹配當前來源；不得整個回復到 Git HEAD，否則會移除同一 worktree 先前已完成的 WP。此 schema migration 僅套用過可拋棄資料庫，所有測試 container／暫存資料均已清理；沒有正式資料需要回滾，不提供可直接套用真實資料庫的破壞性 down migration。

Evidence root：`docs/ai-team/evidence/product-audit-20261011/WP-13/`。

- `project-accounts-acceptance.json`、`project-accounts-acceptance-evidence.json`、`project-accounts-acceptance-route.json`
- `project-accounts-snapshot.json`、`project-accounts-review-qualification.json`、`project-accounts-findings.json`
- `project-accounts-unit.json`、`project-accounts-db.json`、`project-accounts-browser.json`、`project-accounts-exec-checks.json`
- `project-accounts-core-review.json`、`project-accounts-boundary-review.json`、`project-accounts-core-repair-review.json`、`project-accounts-boundary-repair-review.json`、`project-accounts-review-1.json`
- `project-accounts-browser-screenshots/` 兩張實際畫面；失敗收據 `project-accounts-*-failed-*.json` 均保留。

AI_TEAM_HANDOFF
CURRENT_TASK_STATUS: IN_PROGRESS
CURRENT_WORK_ITEM: WP13 多官方帳號與 Project 共用選擇，本機子項 READY；完整 Goal 未完成。
ACTUAL_RESULT: 128 units、18 disposable PG tests、132 migrations、1 Next dev browser flow、tsc／lint／獨立 critical review 通過；canonical acceptance READY。
EVIDENCE: docs/ai-team/evidence/product-audit-20261011/WP-13/project-accounts-acceptance.json；本文件含完整改動清單與未完成子項。
NEXT_ACTION: 可在本機版本設定 LINE 帳號並於 Project 選用；真實非正式 LINE 供應商驗證仍待安全設定，未視為已寄送成功。
ROLLBACK: 僅本次 ownership 精確增量及編輯前 .before 備份；不覆蓋其他 WP 或原 dirty 工作樹。
SAFETY_STATUS: PASS
PLAN_REVIEW_STATUS: PASS（本機 Critical 子項）
GIT_PROMOTION_STATUS: NOT_REQUESTED
PRODUCTION_DEPLOYMENT: NOT_AUTHORIZED
COPY_TO_NEW_TASK: NO
