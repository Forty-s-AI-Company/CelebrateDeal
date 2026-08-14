# FUNC-12 — Server-validated Stream usage attribution ledger

日期：2026-08-07  
結果：`COMPLETE_LOCAL_FUNCTIONAL_FIX_EXTERNAL_RECONCILIATION_PENDING`

## 本輪完成

- 新增 `StreamUsageLedgerEntry` 與 additive migration，保存 vendor、live、公開來源頁、team、template version、promoter、content owner、月份、秒數與 immutable `eventId`。
- 播放器每累積最多 60 秒送出 bounded heartbeat；不保存 visitor identifier，server 重新驗證 live 狀態與 Team Funnel page attribution。
- 相同 `eventId` 的相同 payload 只回 duplicate，不新增 row；payload drift 回 409；無效 live／page fail closed。
- billing settlement 讀取同 vendor／month 的 ledger seconds，換算分鐘後與既有 vendor aggregate 取較高值，避免重複計費。

## 可追溯驗收結果

- targeted：8 files，54 passed，0 failed，0 skipped。
- full Vitest：178 files，1298 passed，0 failed，0 skipped。
- Node contracts：620/620 passed。
- Prisma：validate／generate PASS；loopback-only disposable PostgreSQL migration `20260807130000_stream_usage_attribution_ledger` deploy PASS；`migrate status` 為 18/18 up to date；inventory 為 59 models／18 migration directories。
- API registry：30/30 route handlers 登錄，30/30 same-path tests。
- TypeScript PASS；full ESLint 0 errors，保留 2 個既有 warning。
- combined coverage 如實為 `FAIL_REMAINING_SOURCE_INVENTORY`：global statements／branches／functions／lines 為 39.06／44.97／47.40／59.43，低於未修改的 63／57／60／65；scripts attribution 27.15／35.48／33.23／46.52；src attribution 83.23／76.06／83.40／85.82。
- 相較 QUAL-12，global 四項提升 0.20／0.15／0.23／0.22 個百分點；沒有修改 threshold、inventory、exclude、skip 或 assertion。

## 邊界與評分

本輪只使用本機與 loopback disposable PostgreSQL；沒有 staging、PayUni、Production、正式付款／退款／寄信，也沒有讀取 `.env*`、Token、Cookie 或 Secret。沒有重試 FIN-08AA、WP-196、WP-197。

本機 ledger 與 settlement input 已閉環，但 owner／promoter／split／custom quota enforcement、Cloudflare provider reconciliation、staging／PayUni 證據與真人法律／客服／財務／release sign-off 仍 pending。因此 CAT04 維持 6.0、CAT06 維持 7.0、CAT10 維持 4.5、總分維持 73.5，Goal 不標記 COMPLETE。

證據報告：`.ai-team/reports/func12-stream-usage-attribution-ledger.json`。
