# G7-20 Finance async feedback checkpoint

日期：2026-08-09

封存時間：2026-08-08T23:42:33.2355302Z

狀態：`ACCEPTED_LOCAL`。本工作已取得 current-tree targeted tests、source-lineage attestation、hermetic production build、disposable PostgreSQL 與 6/6 Browser contract 證據；未執行正式財務操作，也未宣告 CAT04、CAT10 或 canonical 加分。

## 產品問題與修正

- 課程 payout、平台推薦 payout batch、付款方式設定／撤銷、webhook retry 與 affiliate commission void 原先使用一般 server-action button。送出期間缺少一致的 pending、disabled、防重送與可讀狀態。
- 上述高風險財務操作改用共用 `FormSubmitButton`，提供 pending label、disabled、`aria-busy`、可見 `status`／`alert` 與必要確認訊息。
- 商家與管理員 billing segment 新增可存取的 loading 與 error state。錯誤頁不輸出例外內容，重試期間停用按鈕並使用 Next.js 16 `unstable_retry`。
- payout 已付款／作廢、付款方式撤銷與 commission void 保留明確確認，避免誤觸。payment method provider setup failure 維持 fail closed。
- Browser contract 攔截本機 synthetic payout batch POST，確認 request 未完成時頁面出現 `aria-busy` 狀態且無法重複操作；釋放 request 後以安全 conflict 結果收束，沒有建立 payout batch。

## Ownership

- 本工作只寫入 source manifest 列出的 G7-20 檔案與本 checkpoint／scorecard／evidence index。
- worktree 原本已有大量未提交變更；沒有 reset、clean、stash、restore、checkout 或 rebase。
- 沒有 stage、commit、push、merge 或 deploy。

## Deterministic tests

- current-tree UI、source-attribution 與 domain actions：`12 test files／48 tests PASS`，exit code `0`。
- commerce runner：`12/12 PASS`，exit code `0`。
- scoped ESLint：`PASS`，exit code `0`。
- 最終 Browser receipt 的 30 個 source-lineage SHA-256 已逐檔與 current tree 比對，全部相符，exit code `0`。
- 最初把含 `(app)` 的路徑未加引號交給 PowerShell，shell 在測試啟動前解析失敗。修正為 literal quoted paths 後通過；未把第一次 shell failure 記成測試結果。
- 本機 `.next/dev/types` 曾有 stale route validator，因此沒有用本機 incremental typecheck 支持本 checkpoint。最終 hermetic production build 已重新產生隔離 types 並通過。

## Browser、build 與 disposable PostgreSQL evidence

最終 receipt：`docs/ai-team/evidence/g7-04-browser-qa-672e2b6fcf0940e4.json`

Receipt SHA-256：`80ef417d9465876300c25c06ac7e75470004a5864608d10b278a81d10c32c7f1`

執行時間：`2026-08-08T23:28:46.275Z` 至 `2026-08-08T23:36:53.030Z`

- source mirror、Prisma generate／validate、44 migrations deploy／status、Next production build、loopback server 與 Browser 全部 `PASS`。
- Browser contracts：`6/6 PASS`、`0 FAIL`、`0 SKIP`。
- 財務 contract：`finance admin payout batch prevents duplicate submission and exposes accessible pending feedback` 為 `PASS`。
- 原有商品、訂單、履約與公開 checkout 五項 contract 全部保留且通過。
- Axe critical／serious：`0`；RWD、tenant isolation、PII envelope leak 與 product catalog 均為 `PASS`。
- `finance-pending.png` SHA-256：`0cf54330fc51c55e6d71c72d845507e99d78aba7b8bcb7223e65082d0ee6549b`。
- cleanup：server、container、temp root 全部 `PASS`。
- receipt 宣告 `externalOperations=false`、`productionOperations=false`、`userBrowserProfileRead=false`、`dotenvContentsRead=false`。

失敗演進保留如下：

- `g7-04-browser-qa-779ed18a8a507c8b.json`：heading strict locator 同時命中頁面標題與空狀態標題，改成 exact locator。
- `g7-04-browser-qa-9808a37cb9ea9cfe.json`：Next route loading 在 action pending 期間卸載 form button。contract 改為接受 button pending 或 segment loading，但兩條路徑都必須有可見 `aria-busy` 狀態且操作不可重送。
- `g7-04-browser-qa-7949bfdf040e61fa.json`：pending、截圖、request release 與安全 conflict 已通過；最終 alert locator 同時命中頁面 alert 與 Next route announcer，收斂為 exact page alert。
- `g7-04-browser-qa-672e2b6fcf0940e4.json`：44 migrations、production build、6/6 Browser、Axe、RWD、安全邊界與三項 cleanup 全 PASS。

## 尚未完成與人工 blocker

- staging／PayUni Sandbox payout、退款與 reconciliation 尚未執行，不以本機 synthetic conflict 取代外部財務證據。
- CAT04 仍需新授權的 staging／PayUni Sandbox 證據；FIN-08AA、WP-196、WP-197 的禁重跑範圍沒有被觸碰。
- CAT10 仍需真人法律、財務、客服 SLA、監控 owner 與 release 簽核。
- 本工作沒有需要使用者立即處理的事項；上述 blocker 保留後繼續產品工作。

## 分數判斷

- 固定功能 `聯盟／課程／settlement／payout` 可由 `7.0` 重算為 `7.5/10`：core `2.3`、recovery `1.3`、UX `1.0→1.4`、integrity/security `1.0`、fresh evidence `1.4→1.5`。
- UX 加分來自高風險 action 的 pending、disabled、防重送、確認、成功／失敗與可存取狀態；fresh evidence 加分來自 current-tree 48 tests、production build、44 migrations、6/6 Browser 與 source-lineage attestation。
- core 與 recovery 維持原分，因本工作沒有新增 payout domain capability，也沒有 external provider reconciliation 證據。
- canonical 總分維持 `73.5`，CAT04=`6.0`、CAT10=`4.5`。本工作只更新固定功能 scorecard。

## 回滾範圍

- admin／merchant billing segment loading 與 error state
- course payout、platform referral payout、payment method、webhook retry 與 dashboard 的 `FormSubmitButton` wiring
- 對應 source-attribution、route-state、action 與 Browser tests
- G7-04 commerce runner 的第六項財務 contract、source attestation 與 screenshot receipt 欄位
- 固定功能 scorecard 的 finance entry

## 下一個最高價值工作

依固定 inventory 與目前產品能力重新盤點 `Email 通知` 的 7.0 分缺口，優先檢查排程、冪等寄送、重試、suppression／unsubscribe、delivery history 與操作回饋。若 current source 已完成，改選下一個有真實 P0／P1 缺口的產品功能，不重做已完成能力，也不轉去刷 coverage。
