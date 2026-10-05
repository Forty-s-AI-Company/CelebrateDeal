# 剩餘功能交付矩陣

基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | 待產生 | PENDING |
| F2 | future-work F2：affiliate、階梯/多層佣金、扣繳/payout export、referral、upsell、tracking/webhooks、私訊/廣播 | 現行收入快照、退款、權限/provider 契約 | 主代理，待分批路由 | 先跨租戶/併發/退款回歸再接 UI；Critical review、精確 head CI | 待產生 | PENDING |
| F3.1 | #211 `b5397dbb45ddc4dc15a3059b7dec90b5a7771487`：editor parent echo、文件替換與 undo/redo lifecycle | 現行 FunnelPageEditor / FunnelStepPagesEditor | 主代理 writer；f3_inspect 唯讀 | parent echo 保留歷史；外部替換顯示新文件；undo/redo 不還原外部舊文件；真實瀏覽器測試 | `remaining-capabilities-f3.1-local-receipt-20261006.json`：14 unit、9 Chromium、lint/typecheck、獨立複審與 canonical READY；remote CI/merge 待交付 | LOCAL_ACCEPTED |
| F3.2 | 同來源：popup/template/flow 完整互動、team/video UI 與 guard inventory | F3.1、逐功能核對實際介面 | 主代理，待分批路由 | 完整瀏覽器互動與持久化；必要 disposable QA；舊 selector 只對應已交付 UI | 待產生 | PENDING |
| Q1 | `35d8f59341bcb776e548c69fe874a3f4d1fe2528`：精確 PENDING_REFUND consumer、固定 staging DB/source/tenant proof 已實作；真實 browser/provider 未驗 | 核准 process 注入、指定目前 handoff、平台 admin/MFA、現行退款契約 | 主代理 writer；course_critical 唯讀 Astra fallback | 權限/CSRF、單筆 processed RefundRecord、冪等/重複拒絕；真實 sandbox 必須另過 browser gate | `remaining-capabilities-q1-checkpoint-20261006.json`；76 targeted unit、83 migration/8 DB、TS/lint、Critical PASS；canonical BLOCKED browser | IMPLEMENTED_PENDING_EXTERNAL |
| Q2 | `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7`：owner/buyer/subscription recovery 與 ops | 固定非 Production 資源/環境契約 | 主代理，待分批路由 | 隔離、越權/錯環境拒絕、recovery 回歸與必要 staging 實測 | 待產生 | PENDING |
| A1 | `937f796d25d0e27db753b7786ea77ea3e773a686`、`bf45235f8b10fa1fded2da0a4c079e5b883cfef0`：未遷移應用/workflow | F1/F2/Q1/Q2 | 主代理直接處理 | 每個有用能力接現行 canonical vNext；無第二套 launcher/舊排程 | 待產生 | PENDING |
| E1 | future-work E1：歷史證據及 tmp/support 差異 | 每批候選 snapshot | 主代理 | 新 revision 綁定的 validation/review/CI/acceptance；不降低測試範圍 | 各批收據 | IN_PROGRESS |

## 執行契約

- 現行 canonical policy：一個 writer、一個唯讀 helper；每 task 最多四次 dispatch，depth 1，不遞迴。
- 本輪明確 user dispatch，`automatic_spawn=false` 不改寫。模型路由保存在各批 route receipt；主代理模型不因路由而宣稱切換，observed 未回報時為 unknown。
- 已確認 `.github/workflows/ci.yml` 同時監聽 push/pull_request；保留現有 lint、typecheck、unit/coverage、router 與 browser gate。
- 檢查未執行不得標 PASS；同一 snapshot 經 canonical acceptance 與精確 head CI 才可交付。正式環境操作未授權。
