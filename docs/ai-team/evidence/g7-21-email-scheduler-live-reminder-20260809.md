# G7-21 Email scheduler and live reminder checkpoint

日期：2026-08-09

封存時間：2026-08-09T02:28:56.6987907Z

狀態：`ACCEPTED_LOCAL_EXTERNAL_GATE_PENDING`。Email due queue、直播提醒、排程入口、冪等 revision、suppression、操作介面、disposable PostgreSQL 與 Browser 已取得 current-source 證據；沒有寄送真實 Email、啟用正式 cron 或執行 Production。

## 產品問題與修正

- Email template 由單一報名通知擴充為明確分離的 `registration` 與 `live_reminder`；尚未串接 provider 的 cart、SMS、LINE 選項維持 disabled，不顯示成可用功能。
- Live Studio 可選直播提醒模板與提前分鐘數，草稿、建立、編輯、預覽與重新整理 recovery 都保留設定。
- 表單 Email ownership 驗證成功時，報名確認與直播提醒會建立獨立 delivery；提醒使用直播時間、offset 與 template revision 的 immutable snapshot。
- reminder delivery 使用 deterministic identity、Serializable transaction、suppression 與 revision supersede，避免同一版本重複排程；舊的未寄送提醒在新 revision 建立時會失效。
- `/api/jobs/email-deliveries` 新增 source-controlled Vercel Cron `GET` 入口，使用 timing-safe `CRON_SECRET`；既有受控人工／job runner `POST` 保留 `JOB_SECRET`。兩個入口共用 bounded due-queue processor 且回傳 sanitized aggregate。
- deliveries 與 template 頁面清楚標示 trigger、可用渠道、disabled 狀態與 delivery history，不把未接 provider 的能力呈現為已完成。

## Ownership

- G7-21 production、test、migration、runner 與文件範圍列於 `docs/ai-team/evidence/g7-21-source-manifest-20260809.txt`。
- Terra High Browser worker 只寫入 `tests/e2e/commerce-orders.spec.ts`、`scripts/g7-commerce-browser-qa.mjs`、`scripts/g7-commerce-browser-qa.test.mjs`；主代理未在 worker 執行期間修改這三個檔案。
- worktree 原本已有大量未提交變更；沒有 reset、clean、stash、restore、checkout 或 rebase。
- 沒有 stage、commit、push、merge 或 deploy。

## Deterministic tests

- current-tree Email／Live Studio／form verification：`14 files／299 tests PASS`，failed=`0`、skipped=`0`、exit code=`0`。
- Browser runner contracts：`13/13 PASS`，failed=`0`、skipped=`0`、exit code=`0`。
- source-manifest JavaScript／TypeScript scoped ESLint：`PASS`，exit code=`0`。
- 一次將 DB-only test 混入一般 Vitest，因本機 public schema 缺少 disposable migration table 而失敗；該次明確列為 diagnostic `NON_PASS`。同一 DB suite 已透過 marker-gated disposable runner 通過，沒有重跑相同錯誤命令。
- 兩次嘗試由 PowerShell 動態展開 ESLint path array，在 ESLint 啟動時被解析為單一 pattern 而失敗；改用逐一 literal path 後 `PASS`。這兩次為 shell invocation failure，不冒充 lint 結果。

## Disposable PostgreSQL evidence

Receipt：`.ai-team/reports/g7-21-email-disposable-20260809.json`

Receipt SHA-256：`1fc2e998a0e575204e6e3e16a51757fd9b632afeca5ff5c428afc8eab52a87af`

- Prisma validate、45 migrations deploy／status 與 dedicated Email DB integration 全部 `PASS`。
- DB tests：`2/2 PASS`、failed=`0`、skipped=`0`。
- 驗證 registration delivery 冪等／suppression，以及 live reminder schedule revision supersede。
- container 與 temp root exact cleanup 均為 `PASS`；synthetic fixtures、loopback only、沒有外部 Email 或 Production side effect。

## Browser、build 與 source-lineage evidence

最終 receipt：`docs/ai-team/evidence/g7-04-browser-qa-f569709aa8e496dc.json`

Receipt SHA-256：`37ee7c138da7347e88ebd343e4afbc10f4ae56143356c052435c01ef26b069fa`

執行時間：`2026-08-09T02:15:35.808Z` 至 `2026-08-09T02:24:48.799Z`

- source mirror、Prisma generate／validate、45 migrations deploy／status、Next production build、loopback server 與 Browser 全部 `PASS`。
- Browser contracts：`7/7 PASS`、failed=`0`、skipped=`0`；既有商品、訂單、履約、checkout、finance contract 全數保留。
- Email contract 驗證 live reminder 可用、未串接渠道停用、Live Studio 分離 registration／reminder template、offset、keyboard、RWD 與 Axe。
- Axe critical／serious=`0`；RWD、tenant isolation、PII envelope leak、product catalog、Email reminder 全部 `PASS`。
- receipt digest 與 sibling `.sha256` 相符；41 個 attested source 逐檔與 current tree 比對，mismatch=`0`。
- server、container、temp root cleanup 全部 `PASS`；receipt 明確宣告 external／production operations=false、user browser profile read=false、dotenv contents read=false。

失敗演進保留如下：

- `2779d63ab7ae5981`：Email 渠道 locator 不符合實際 accessible name，改以語意名稱定位。
- `f35911a5c31709f4`：disabled option matcher 與 DOM attribute 判定不一致，改驗證實際 `disabled` attribute。
- `15bdb6ccdde4e187`：template variable 文字由 UI 合併顯示，改驗證完整變數清單內容。
- `8b9fe423ceebe33d`：Live Studio nested select label locator 不穩定，改以 control name 定位。
- `518ddb31c6d68b13`：contract 未先填 Step 1 必填欄位，修正為完成基本資料後進入 reminder step。
- `a760f70e26f0f44a`：7/7 PASS，但後續新增 stronger aria-current／panel assertion，source hash 因合理修改而不再作最終 receipt。
- `5ed39759c9862425`：既有履約 redirect 在 15 秒內未觀察到，保留失敗並加入 POST／HTTP／DB 診斷。
- `63603d4f0a65c1c1`：7/7 PASS，但新增 redirect diagnostics 後 source hash 改變，因此沒有作最終 receipt。
- `61be378d84e06ba5`：診斷嘗試讀 redirect response body，Playwright 不允許；修正為只在 non-redirect 回應讀 body。
- `f569709aa8e496dc`：redirect-safe diagnostics、45 migrations、production build、7/7 Browser、Axe、RWD、source lineage 與 cleanup 全 PASS。

## 尚未完成與人工 blocker

- Production cron 啟用、`CRON_SECRET` 平台綁定、真實 provider delivery／bounce 與人工 release acceptance 尚未執行。
- 修改既有直播的時間、提醒模板或 offset 時，尚未對每一筆先前已驗證報名者的既有未寄送 reminder 做 durable reconciliation。新驗證報名與同次 revision 建立已受保護，這項 residual 留作下一個產品 P1。
- CAT04 與 CAT10 的外部／真人 blocker 保留；沒有要求使用者立即處理，也沒有重跑 FIN-08AA、WP-196 或 WP-197 禁止路徑。

## 分數判斷

- 固定功能 `Email 通知` 由 `7.0` 重算為 `7.8/10`：core=`2.5`、recovery=`1.5`、UX=`1.3`、integrity/security=`1.0`、fresh evidence=`1.5`。
- 加分來自直播提醒、獨立排程入口、immutable schedule snapshot、revision supersede、disposable DB、production build、7/7 Browser 與 current-tree source-lineage。
- 外部 provider 與 Production cron 證據缺少，因此 fresh evidence 不超過 `1.5`，也不宣告正式寄送 ready。
- canonical 總分維持 `73.5`，CAT04=`6.0`、CAT10=`4.5`。

## 回滾範圍

- Live reminder schema、migration、template type、draft fields 與 Live Studio wiring。
- reminder delivery domain、verification route scheduling、cron GET／job POST route 與 `vercel.json` schedule。
- template／delivery UI、API registry、env 文件、deterministic／DB／Browser tests 與 runner attestation。
- 固定功能 scorecard 的 Email entry。

## 下一個最高價值工作

先封存 G7-22 onboarding ready-media P1，再處理既有 verified registrations 在直播排程、提醒模板或 offset 變更後的 reminder reconciliation，要求 durable、冪等、可取消舊 revision，並補上商家可見操作回饋與 deterministic DB evidence。
