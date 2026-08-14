# FUNC-2026-08-07-29 — Live partner share link

## 判定

`LOCAL_PRODUCT_EVIDENCE_PASS_NO_SCORE_CHANGE`

本工作包完成一條 server-owned 的 Live 合作分享鏈：B 可從 A 的既有 Team Funnel page 取得 target-bound Live share link，不需要建立另一個 partner page；click、lead/form submission 與 stream usage 都以 share token 解析同一組 A/B ownership snapshot。raw share code 只在建立回應中出現，資料庫只保存 SHA-256 token hash；瀏覽器在首次讀取後移除 URL query 的 `share`，但同源 API 仍使用記憶體中的 token 完成 attribution。

## 實際驗證

- WP29 disposable PostgreSQL runner：`PASS`；migration count `27`；validate/deploy/status、valid binding、duplicate target rejection、cross-tenant Live rejection、cross-tenant promoter rejection 均 `PASS`。
- Disposable cleanup：container 與 temp root 均 `PASS`；後續 `docker ps -a --filter name=celebratedeal-wp29-` 無殘留。
- WP29 targeted Vitest：6 files、66 tests `PASS`。
- API registry／Live share route/domain regression：3 files、12 tests `PASS`。
- Full Vitest：201 files、1413 tests，0 failed、0 skipped `PASS`。
- Node contracts：679/679 `PASS`。
- `npm run typecheck`、`npx prisma validate`、`npx prisma generate`、`npm run secret:scan` 均 `PASS`。
- Full ESLint exit `0`、0 errors；僅保留既有 `wp130-cloudflare-stream-webhook-contract-runner.mjs` 的 2 個 unused-vars warnings。
- `git diff --check` exit `0`；LF/CRLF 類訊息是既有工作樹提示，不是 diff error。

## 分數與邊界

- canonical total：`73.5`，本工作包 `current_goal_score_change=0`。
- CAT01 維持 `7.5`；CAT04 維持 `6.0`；CAT10 維持 `4.5`。
- 本機 deterministic／disposable evidence 不等於 staging、PayUni Sandbox、真人法律／財務／客服／Release owner 或 external monitoring acceptance，因此沒有套用 canonical score uplift。
- 沒有執行 Production、正式 DB、正式付款／退款／寄信、staging mutation、PayUni Sandbox、deployment、push 或 merge；沒有重試 FIN-08AA、WP-196、WP-197。
- 沒有讀取或保存 `.env*`、credential、token、cookie、正式客戶資料或付款資料；evidence 不包含 raw share code。

## 回滾

若要回滾，僅回滾本 WP29 owned source、migration、tests 與 evidence 文件；不要使用 reset、clean、stash、restore 或 checkout，也不要覆蓋其他 dirty ownership。資料庫若已在 disposable scope 外套用 migration，須由具體環境 owner 依 migration rollback policy 另行授權；本輪沒有操作正式或 staging DB。

