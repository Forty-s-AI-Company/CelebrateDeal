# G7-56 PayUni ambiguous refund outcome closure

日期：2026-08-10（Asia/Taipei）  
狀態：`LOCAL_IMPLEMENTATION_ACCEPTED`  
Canonical readiness：維持 `75.5/100`，CAT04=`6.0`、CAT10=`4.5`

## 產品問題與完成內容

PayUni refund request 在 network、authentication、provider response 或未知錯誤後，provider 端可能已收件，但舊流程會把本機 reservation 標成 failed，讓財務人員再次送出退款。這是可能造成重複退款的 P1。

- `request_contract` 是唯一可證明 request 尚未送到 provider 的分類，僅此分類會釋放 reservation。
- 其他不明結果會把 pending reservation 由 `request:<id>` 原子轉為 `ambiguous:<id>`，要求先做 query-only reconciliation。
- `request:<id>` 代表 provider call 可能仍在進行；即使 query 當下回 paid／no-refund，也不得釋放。
- 只有 `ambiguous:<id>` 且 provider snapshot 與目前本機 paid／partial total 完全一致時，才會將該 reservation 標成 failed。
- provider 已退款時，reconciliation 會完成既有 reservation，不會再次呼叫 refund API。
- provider success completion、no-refund release 與 processed reconciliation 都以 `id + pending status + exact providerEventId` 條件式更新；晚到 action 無法覆寫已被處理的 reservation。
- Billing dashboard 有 pending PayUni refund 時隱藏第二次退款表單，改提供 reconciliation 入口；terminal state 不再顯示退款表單。
- UI 新增 `refund_reconciliation_required` 可存取 alert，明確告知暫停重送與下一步。
- No-refund release 寫入 `resolve_payuni_refund_not_processed` audit；in-flight fail-closed 不寫此 audit。

## 驗證證據

### Deterministic／static

- Targeted Vitest：4 files／240 tests PASS。
- TypeScript：`npx tsc --noEmit --pretty false` PASS。
- Scoped ESLint：exit 0，0 errors／0 warnings。
- `git diff --check`：PASS；僅有既有 Windows CRLF warning，沒有 whitespace error。
- `npm audit --omit=dev --json`：0 vulnerabilities。
- `npm audit --json`：0 vulnerabilities，782 dependencies。

### Disposable PostgreSQL

Receipt：`.ai-team/reports/g7-56-refund-ambiguous-disposable-final-20260810.json`  
SHA-256：`34956164C97ACE23FAC91AB9050BF37CFF8EB7AF1B3E8E5BBACBE79BFE172646`

- runId：`46bcc50f4173cf08`
- 53 migrations generate／validate／deploy／status PASS。
- Exact suite 3/3 PASS：paid no-refund release、partial processed-total preservation、in-flight request no-refund fail-closed。
- in-flight case 保持 pending、providerEventId 不變、release audit count=0。
- loopback only、synthetic fixtures、no persistent volume；container 與 temp root cleanup PASS。
- 未讀 source `.env`，未送 Email，未操作外部／Production。

第一次 disposable attempt 因 `database-marker-write-failed` 未進測試，receipt `.ai-team/reports/g7-56-refund-ambiguous-disposable-20260810.json`（SHA-256 `B4191773797CF8863D76B059E69CC7757C9880E8DDF93ADCCEF4C58ECFDD3455`）保留為 `BLOCKED_OR_FAILED`。後續採 bounded marker readiness 路徑，沒有覆寫失敗結果。

### Controlled production build

Receipt：`.ai-team/reports/g7-56-refund-ambiguous-controlled-build-final-20260810.json`  
SHA-256：`7094A9685CDA57CB79FCA56582D11DE1EE74070009C0CC3795F9AE959B96C525`

- `exitCode=0`、`failureCategory=NOT_APPLICABLE`、mirror cleanup PASS。
- `inheritedApplicationEnvironment=false`、`dotenvCopied=false`。
- external operations／production operations 均為 false。

先前同名 immutable receipt 已存在，第二次 build 在完成後寫檔時以 `EEXIST` 失敗；此 runner failure 沒有被算成 PASS。改用新的 immutable final receipt 路徑後，另一次完整 controlled build 才取得上述 PASS。

## AI Team acceptance

- 第一輪 reviewer：`REJECT`，找到 in-flight `request:<id>` 可能被 no-refund query 提前釋放的 P1。
- 修正狀態區分、三處 conditional ownership mutation 與 DB／action tests 後，第二輪 reviewer：`ACCEPT`。
- Final finding：P0=0、P1=0；共用 disposable harness 仍使用 `g7-email` marker/config 名稱，列為非 release-blocking P2 traceability debt。
- Reviewer 為唯讀 source review，沒有冒充重跑測試；PASS 數據來自上述本機 receipts。

## 評分、阻擋與回滾

- 固定功能 `refund_support`：`8.7 → 9.0`。核心 2.8、錯誤復原 2.0、UX 1.6、完整性安全 1.0、fresh evidence 1.6。
- Canonical CAT04 與總分維持 `6.0`／`75.5`。本機 deterministic／disposable 證據不能取代 fresh staging／PayUni Sandbox provider reconciliation。
- CAT10 真人法務、退款政策、客服 SLA、財務與 release acceptance 仍 pending，本輪未預支分數。
- 未執行 Production deploy、正式 DB、正式付款／退款、正式寄信、push、merge，也未重跑 FIN-08AA、WP-196、WP-197 禁止路徑。
- 回滾範圍限於 PayUni refund action/reconciliation、billing dashboard/reconciliation notice、targeted tests 與 G7-56 QA runners；本輪無 schema migration。
- 下一個最高產品價值工作：Checkout commit 後 response-loss recovery／idempotency P1，避免已建立訂單後重新 admission 造成 orphan order 或重複 checkout。

