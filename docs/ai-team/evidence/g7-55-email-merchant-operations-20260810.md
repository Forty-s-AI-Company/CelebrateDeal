# G7-55 Email 商家營運 checkpoint

日期：2026-08-10（Asia/Taipei）  
狀態：`LOCAL_IMPLEMENTATION_VERIFIED_BROWSER_PARTIAL`  
Canonical readiness：維持 `75.5/100`，CAT04=`6.0`、CAT10=`4.5`

## 完成內容

- 新增 tenant-scoped Email 寄送搜尋、狀態／通知類型篩選、每頁 25 筆分頁與清除條件。
- 完整 Email 只在伺服器端正規化後轉成 vendor-scoped hash 精確查詢，不進 URL、畫面結果或 audit。
- 新增 failed 與安全 exhausted 狀態的人工重新排程；只改 durable queue state，不直接呼叫 Email provider。
- 保留 `idempotencyKey`、加密 payload 與來源關聯；以 `vendorId + status + updatedAt` CAS、Serializable transaction 與 audit 防止跨租戶或重複操作。
- 永久 `provider_rejected`、suppressed、superseded、sent、sending、queued 不開放人工重排。
- 寄送前重新檢查 live reminder 與 form verification snapshot；過期或被新版取代的驗證信 fail closed。
- UI 提供 pending、disabled、防重送、confirm、成功／失敗回饋、`aria-busy`、live status、遮罩收件資訊與錯誤處理指引。
- Action 失敗時保留 trusted Server Component snapshot，同時明確標示「上次成功載入、本次條件尚未套用」，避免把舊 25 筆誤認為新查詢結果。
- Prisma 新增 `manualRetryCount`、`lastManualRetryAt` 與 vendor/status/trigger 查詢索引；canonical migrations 為 53。

## 驗證

- Disposable PostgreSQL receipt：`.ai-team/reports/g7-55-email-operations-disposable-20260810.json`
  - SHA-256：`b9f665038d858fc87194dd0c1e3b43ed1e7620a50808dd4464a0e7c522dfec2f`
  - runId：`9a5d17eb7e943e44`
  - 53 migrations、4/4 integration tests、container/temp cleanup 全部 PASS。
  - exact recipient hash、filter、跨商家隔離、idempotency/payload preservation、audit 與 requeue 全部 PASS。
- Targeted Vitest：10 files／40 tests PASS。
- Browser runner contracts：6/6 PASS。
- TypeScript：`npx tsc --noEmit --pretty false` PASS。
- Scoped ESLint：exit 0，0 errors；runner 的 dead legacy helper 有 1 個 warning。
- `git diff --check`：PASS。
- Reviewer：產品／action／tenant／PII／requeue 邊界重審為 `NO_P0_P1_P2`；最終 runner 時序修正後未另做一次完整 reviewer round。
- 最新受控 build：Prisma generate／validate、53 migrations、`next build --webpack`、loopback server 全部 PASS，source digest `fa51982141ebb259b93493f698b2c69c73f75d58b201742366366dafa02487e1`。

## Browser 結果與未完成項目

最新 receipt：`docs/ai-team/evidence/g7-55-email-operations-browser-qa-5e2da0dbc2398ef6.json`  
SHA-256：`EC2CC805987E05EF16255D8002DE00C99AFBA08C839EFD6CF62FA0031B6E169B`

- 結果為 `BLOCKED_OR_FAILED`，2/5 tests passed；不可標成 Browser PASS。
- 已實際通過：exact email search、URL privacy、pagination、安全 requeue、永久拒絕不重排、pending 防重送、tenant isolation、mobile RWD、Axe critical/serious 0。
- 未完成：filter、keyboard、expired-CSRF 三個 test 的 final PASS。
- 上一輪三項 runner 時序／斷言已修正後重新執行；本輪再次定位到 fixture contract 矛盾：filter 實際指定 `failed + live_reminder`，正確資料列為 fixture index 5，但斷言仍期待 index 3 的 `registration_confirmed`。
- Runner fixture 已新增明確 `liveReminderFailedId` 並改驗證相同篩選語意；diagnostic 保存上限由 20 調整為 80，方便追溯 Browser 失敗。修正後 pure contract 6/6 PASS。
- 本輪沒有再跑第三次完整 Browser，避免在同一路徑形成工具重試迴圈，因此 filters、keyboard、expired-CSRF 的 final Browser PASS 仍未取得。
- 先前失敗 receipt `cc446f300f4ae482`、`d41514a26aa30a11` 與最新 `5e2da0dbc2398ef6` 均保留，沒有覆寫或偽造成功。

## 評分、邊界與回滾

- `email_notifications` 固定功能由 `8.2 → 8.6`：核心 2.7、錯誤復原 1.9、UX 1.6、完整性安全 1.0、fresh evidence 1.4。
- Canonical 維持 `75.5`。本機 Email 商家操作證據不重複計入 CAT01／CAT02／CAT06／CAT07，也不能取代 CAT04 PayUni 或 CAT10 真人驗收。
- 未執行外部 Email 寄送、staging、Production、正式資料、正式付款／退款、push、merge、FIN-08AA、WP-196 或 WP-197 禁止路徑。
- 回滾範圍限於 G7-55 migration、Email delivery operations lib/action/page/component/tests、disposable/browser runners、Prisma inventory與本 evidence。Migration rollback 需另行人工規劃，未對任何正式資料庫執行。
- 下一步：恢復 Goal 後先跑一次修正後 G7-55 Browser QA；通過才把 Browser 狀態升為完整 PASS。
