# FUNC-2026-08-07-28：Stream usage attribution allocation

驗證時間：2026-08-07 16:46（Asia/Taipei）  
狀態：`LOCAL_FUNCTIONAL_CLOSURE`，不是 staging、PayUni 或人工 release acceptance。

## 本輪實際修正

- Live quota policy 升為 v2，支援 `PROMOTER`、`OWNER`、`SPLIT`、`CUSTOM` 四種 stream 用量歸屬；預設為 `PROMOTER`，SPLIT bps 必須合計 10000，CUSTOM recipient／bps 由 server parser 驗證。
- Stream usage ledger 保存 `policyVersion` 與 `attributionMode` snapshot，並在同一 Prisma transaction 內建立 `StreamUsageAllocationEntry` children。
- allocation 以 immutable `recipientKey` 做 event-level idempotency；同一 heartbeat replay 不會重複建立 child，payload drift 仍 fail closed。
- allocation recipient 使用 vendor／team／membership composite FK，跨商家 membership 不可寫入；`UNATTRIBUTED` 不會靜默轉嫁給 content owner。
- billing 保留 provider vendor aggregate，另外輸出 internal allocation totals；rolling migration 尚未到達時明確回報 `MIGRATION_REQUIRED`，不假裝 allocation 已存在。
- 新增直播建立／編輯頁的 attribution mode、split bps 與 custom JSON 設定；custom membership 會由 server 再查 authenticated vendor scope。

## 實際驗證

| 檢查 | 實際結果 |
|---|---|
| domain／schema targeted Vitest | 4 files、13 tests PASS；0 failed、0 skipped |
| full Vitest | 199 files、1399 tests PASS；0 failed、0 skipped |
| Node contracts | 679 tests PASS；0 failed、0 skipped |
| `npx prisma validate` | PASS |
| `npx prisma generate` | PASS |
| `npm run typecheck` | PASS |
| scoped ESLint | 0 errors、0 warnings in FUNC-28 source／tests／contract／runner scope |
| `npm run secret:scan` | `secret_scan_passed` |
| disposable PostgreSQL semantic runner | 26/26 migration validate/deploy/status PASS；valid allocation PASS；raw 45 seconds = allocated 45 seconds PASS；duplicate allocation rejected PASS；cross-vendor recipient rejected PASS；container/temp cleanup PASS |
| sanitized runner receipt | `.ai-team/reports/func-2026-08-07-28-stream-usage-attribution-disposable.json` |
| readiness truth reconciliation | `status=PASS`、10 categories、canonical total `73.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` |

## 分數與外部邊界

本輪 current score change 為 `0`，canonical total 仍為 `73.5`：CAT01 `7.5`、CAT04 `6.0`、CAT10 `4.5`。這次已把 Stream 內部歸屬從 raw heartbeat 推進到可稽核 allocation，但尚未取得新的 Sol／canonical score acceptance，因此不預支 CAT01 加分；readiness runner 顯示的 `score_change=0.5` 是歷史 WP-131 metadata，不是 FUNC-28 uplift。

CAT04 仍缺 fresh staging reconciliation、PayUni Sandbox provider receipt 與 payout/refund reconciliation external evidence；CAT10 仍缺真人 merchant、客服 SLA、法務／隱私／退款、財務、release owner 與 external monitoring evidence。

本輪未執行 staging、PayUni、Production、正式付款／退款／寄信、部署、push、merge 或 terminal no-go retry；未讀取 secrets、production data 或 raw payment data；未降低 coverage threshold、inventory、exclude、skip 或 assertion。最新 authoritative coverage 仍為 QUAL-19：40.73／46.56／49.25／61.16 對 63／57／60／65，coverage gate 仍 OPEN。

## 回滾與下一步

回滾只可依 FUNC-28 ownership 做 inverse patch；不得使用 reset、restore、clean、stash、checkout 或整檔覆蓋既有 dirty worktree。新 migration 只在 loopback disposable PostgreSQL forward-apply，container 與 temporary root 已清理。

下一步依產品價值順序是：先完成 FUNC-28 的 canonical acceptance reconciliation，並在不重試 FIN-08AA／WP-196／WP-197 的前提下，回到 CAT10 真人 owner／external monitoring evidence 或 CAT04 新授權 provider evidence。coverage 仍是獨立 QUAL-CLOSURE，不拿 coverage 微幅上升代替功能驗收。
