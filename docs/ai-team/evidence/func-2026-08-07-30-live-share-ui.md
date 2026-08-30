# FUNC-2026-08-07-30 — Live partner share merchant UI

## 判定

`LOCAL_PRODUCT_EVIDENCE_PASS_NO_SCORE_CHANGE`

本工作包把 WP29 的 Live partner share domain/API 接到商家可使用的 `/partner-pages` UI。A 可選擇自己擁有的可分享 Live page 與 direct-downline target，建立、重新建立或撤銷 target-bound share；建立成功後只在當次 server action state 顯示一次相對 share URL，資料庫與初始頁面資料不包含 raw share code。

## 實際驗證

- WP30 targeted route/domain/page/action/component Vitest：4 files、17 tests，0 failed、0 skipped `PASS`。
- Full Vitest：203 files、1417 tests，0 failed、0 skipped `PASS`。
- Node contracts：679/679 `PASS`。
- `npm run typecheck`、`npx prisma validate`、`npx prisma generate` 均 `PASS`。
- Full ESLint exit `0`、0 errors；僅保留既有 `wp130-cloudflare-stream-webhook-contract-runner.mjs` 的 2 個 unused-vars warnings。
- `npm run secret:scan` `PASS`；`git diff --check` exit `0`。
- WP29 的 disposable PostgreSQL receipt 已保留並未重跑；WP30 沒有新增 migration、staging、PayUni 或 Production 操作。

## 分數與邊界

- canonical total：`73.5`，本工作包 `current_goal_score_change=0`。
- CAT01 維持 `7.5`；CAT04 維持 `6.0`；CAT10 維持 `4.5`。
- CAT04 仍缺 fresh staging reconciliation 與 PayUni Sandbox/provider receipt；CAT10 仍缺真人 merchant、客服／財務 SLA owner、法務／隱私／條款／退款 review、external monitoring/alert delivery 與 release owner go/no-go/rollback evidence。
- 本機 deterministic UI/route evidence 不替代上述 canonical 外部與人工 acceptance，因此沒有套用分數 uplift。
- 沒有執行 Production、正式 DB、正式付款／退款／寄信、staging mutation、PayUni Sandbox、deployment、push 或 merge；沒有重試 FIN-08AA、WP-196、WP-197。

## 回滾

若要回滾，僅回滾本 WP30 owned UI、server action、測試與 evidence 文件；不要使用 reset、clean、stash、restore 或 checkout，也不要覆蓋其他 dirty ownership。本輪沒有操作正式或 staging DB。
