# G7-23 Live reminder durable reconciliation checkpoint

日期：2026-08-09

封存時間：2026-08-09T04:15:24.9387377Z

狀態：`ACCEPTED_LOCAL_EXTERNAL_GATE_PENDING`。既有已驗證報名者在直播排程、提醒模板、offset、狀態或標題改動後，現在會以 durable、tenant-scoped job 重新整理 reminder delivery；沒有寄送真實 Email、啟用正式 cron 或執行 Production。

## 產品問題與修正

- 新增 `LiveReminderReconciliationJob` 與第 46 個 migration，以 stable `createdAt + id` cursor 分批處理既有 `VERIFIED` 報名者。
- Live Studio 編輯與 Email template 更新會在同一個 Serializable transaction 排入 reconciliation job，並以商家可見 notice 告知提醒正在整理或已取消。
- 排程時間、提醒模板內容、offset、可寄送狀態與直播標題都納入 configuration digest；舊 `queued／failed` revision 會被 supersede，disabled、draft、ended 或已過期設定會取消舊提醒。
- A→B→A 回復時，只允許仍為 `superseded` 的未寄送 A 以 CAS 恢復；`sent／sending／exhausted` 不會重新排入。
- stale A worker 寫入前，會在同一個 Serializable transaction 驗證 `jobId／vendorId／liveId／configDigest／processing`。B 已提交後，舊 A 無法建立或恢復 delivery。
- delivery identity 與 provider-send current check 同時包含直播標題、表單報名、模板內容、直播時間與 offset；未改動的 current reminder 仍可正常送出，舊標題或舊設定會 fail closed。
- job 具備 lease recovery、bounded batch、attempt count、terminal lifecycle 與 sanitized cron aggregate；Email job route 先 reconciliation，再處理同次 due queue。

## Ownership

- Production、test、migration、runner 與 registry 範圍列於 `docs/ai-team/evidence/g7-23-source-manifest-20260809.txt`。
- Current source SHA-256 列於 `docs/ai-team/evidence/g7-23-source-digests-20260809.txt`。
- worktree 原本已有大量未提交與未追蹤變更；沒有 reset、clean、stash、restore、checkout 或 rebase。
- 沒有 stage、commit、push、merge 或 deploy。

## Deterministic evidence

- 最終 targeted Vitest：`6 files／242 tests PASS`，failed=`0`、skipped=`0`、exit code=`0`。
- Email focused suite：`15/15 PASS`，包含 unchanged current live reminder 實際進入 provider stub、changed title/template fail closed、A→B→A、suppression 與防重送。
- TypeScript `--noEmit`：`PASS`，exit code=`0`。
- scoped ESLint：`PASS`，exit code=`0`。
- 最終唯讀 reviewer：`NO_P0_P1_FINAL`。Reviewer 未修改檔案、未執行 DB 或外部操作。

診斷失敗均保留，不冒充通過：

- 最初 disposable DB run `8105fd9a5444f312` 的 5 個 DB tests 全部失敗；第二條診斷路徑將 5 個失敗分類為 `prisma_client_contract`，根因是 mirror client 與 current schema 不一致。Runner 改為在隔離環境明確 generate current schema client，沒有重跑同一失敗命令。
- 第一個 stale-batch unit assertion 為 `22/23`，原因是測試把固定 stale-lease 掃描也算入 cursor finalization 次數；改為直接驗證沒有 cursor／scheduledCount 完成寫入後為 `23/23 PASS`，assertion 沒有弱化。
- unchanged-current reminder 的第一個 fixture 為 `14/15`，worker 正確回 `not_due`；改用已到期但直播仍在未來的合法 1440 分鐘 offset 後為 `15/15 PASS`。
- 一次受控 build 在 title identity 修改期間取得混合 mirror，結果為 `SOURCE_QUALITY_FAILURE`、exit code=`1`、cleanup=`PASS`。Source 凍結並通過 TypeScript 後，改以新的穩定 mirror 執行最終 build。

## Disposable PostgreSQL evidence

Receipt：`.ai-team/reports/g7-23-live-reminder-reconciliation-disposable-20260809.json`

Receipt SHA-256：`3bc6d0b78cc73e1dcff139e4ecaa2ca228788bd602d0f82398ad464b1547c9ae`

- 執行時間：2026-08-09T03:50:52.177Z 至 2026-08-09T03:52:18.620Z。
- Prisma generate、validate、46 migrations deploy／status 與 exact Email integration suite 全部 `PASS`。
- DB tests：`8/8 PASS`、failed=`0`、skipped=`0`。
- 驗證 tenant isolation、job identity、A→B→A、schedule stale worker、title stale worker、verified-only cursor、cancel、lease recovery 與 concurrent claim。
- container 與 temp root cleanup 均為 `PASS`；loopback、synthetic fixtures、無 persistent volume、沒有外部 Email 或 Production side effect。

## Controlled production build

Receipt：`.ai-team/reports/g7-23-live-reminder-controlled-build-20260809.json`

Receipt SHA-256：`718c0fdfbdfdac469a721ffae1e10114467e48351ea0bf27f545c357afdaa7e9`

- 執行時間：2026-08-09T03:57:59.725Z 至 2026-08-09T04:15:03.115Z。
- no-env mirror、synthetic allowlisted config、Next production build、exit code `0` 與 mirror cleanup 全部 `PASS`。
- `dotenvCopied=false`、`inheritedApplicationEnvironment=false`、external／production operations=false。

## 尚未完成與人工 blocker

- Production cron 綁定、真實 provider delivery／bounce 與人工 release acceptance尚未執行，因此不宣告正式 Email provider ready。
- CAT04 的 staging／PayUni Sandbox provider reconciliation，以及 CAT10 的真人法律、財務、客服 SLA、外部 monitoring 與 release 簽核保持獨立 blocker；本工作沒有重跑 FIN-08AA、WP-196 或 WP-197。
- 非阻擋殘餘：delivery／job lifecycle 仍使用受 domain 與 tests 約束的 string 狀態；正式 provider 前仍需 sandbox／staging 驗收。

## 分數判斷

- 固定功能 `Email 通知` 由 `7.8` 重算為 `8.2/10`：core=`2.6`、recovery=`1.8`、UX=`1.4`、integrity/security=`1.0`、fresh evidence=`1.4`。
- CAT01 `產品核心功能` 由 `7.5` 調整為 `8.0`。依據是固定功能 inventory 全數至少 7，且 Email 最後一個已知 P1 已由 current source、46 migrations、8 個真實 DB invariants、242 個 targeted tests、production build 與最終 reviewer關閉。
- canonical total 由 `73.5` 調整為 `74.0`；CAT04=`6.0`、CAT10=`4.5` 仍未達 7，Goal 保持 active。
- CAT08 本輪不加分，因真實 provider、正式 cron 與外部 telemetry 仍缺，不以本機 reliability 重複計分。

## 回滾範圍

- `LiveReminderReconciliationJob` model 與單一 additive migration。
- reconciliation domain、Email delivery identity／guard／send-time recheck。
- Live／template actions、merchant notices、cron ordering 與 API registry。
- 對應 unit／DB／page／route tests、disposable runner、controlled build runner與本 checkpoint 文件。

## 下一個最高價值工作

維持 CAT04／CAT10 blocker 跳過，重新掃描固定功能 inventory 的 current P1。優先比較 checkout／付款 `7.5` 與 finance `7.5` 的剩餘可自動修功能缺口；不先回到 coverage。
