# CelebrateDeal Sol Finding Triage

稽核時間：2026-07-26（Asia/Taipei）
原則：Night Review 的模型輸出只作候選來源；沒有檔案、可達性與最小重現，不列 confirmed defect。

## SOL-GATE-001 — Root Server Action architecture ceiling 被繞過

- ID：SOL-GATE-001
- 標題：`src/app/actions.ts` 超過原 2300-line debt ceiling
- 嚴重度候選值：Medium（阻塞品質 Gate）
- 信心程度：High
- 證據：Night `TEST_RESULTS.md` 顯示 2345 > 2300；目前實體 2344 lines、測試計數 2345。2026-07-26 10:07 後測試 ceiling 被改為 2345。
- 影響範圍：Q02、Q03、G01；root Server Actions 維護性與 domain boundary。
- 狀態：Confirmed for implementation
- 是否允許 Terra 修改：是；限純機械 domain extraction 與恢復／強化 gate。
- 最小驗證方式：root 計數 ≤2300；assertion 不高於 2300；`src/app/actions.test.ts`、architecture test、typecheck、lint 通過。

## SOL-GATE-002 — Prisma migration inventory assertion 被改為 11

- ID：SOL-GATE-002
- 標題：兩個未完成 DB Review Gate 的 migration 被直接納入 canonical count
- 嚴重度候選值：High（資料／rollout governance）
- 信心程度：High
- 證據：Night 為 11 > 9；目前 expectation 與 inventory 文件都改為 11。`PROGRESS.md`、`QA_REPORT.md`、`QUALITY_SCORECARD.md` 仍只證明 9 migrations。
- 影響範圍：Q07、Q15、G06、Prisma schema、migration chain、外部 rollout。
- 狀態：Needs Sol review
- 是否允許 Terra 修改：否
- 最小驗證方式：逐一審查兩個 migration、schema diff、existing-data aggregate、isolated DB apply、negative/duplicate tests、backfill plan；在正式核准前維持 9-migration Gate，不得只改 count。

## SOL-DB-001 — 銀行帳戶加密 rollout candidate

- ID：SOL-DB-001
- 標題：`encrypt_payout_bank_accounts` 與 legacy backfill 尚未完成 rollout review
- 嚴重度候選值：High
- 信心程度：High
- 證據：新增 nullable encrypted envelope、legacy/display 欄位映射、application encryption helper、`--execute` backfill。Migration 本身不回填資料，script 會寫 DB，且 masked legacy payout 可能不可回復。
- 影響範圍：PaymentAccount、PayoutItem、CSV export、payout UI、seed、secret key binding、資料回填。
- 狀態：Needs Sol review
- 是否允許 Terra 修改：否
- 最小驗證方式：唯讀 row inventory、key source/rotation review、AAD/vendor binding、dry-run output、isolated clone backfill、mixed old/new row regression、CSV authorized boundary、rollback/forward-only plan。未授權不得執行 backfill。

## SOL-DB-002 — Affiliate commission constraint／uniqueness candidate

- ID：SOL-DB-002
- 標題：commission bounds 與 `(vendorId, sourceType, sourceId)` unique 尚未證明資料相容
- 嚴重度候選值：High
- 信心程度：High
- 證據：新增兩個 CHECK 與一個 unique index；現有 service 已加入 Zod bounds，但沒有在本次交接中看到 duplicate/null semantics aggregate 與 reviewed apply receipt。
- 影響範圍：Affiliate、AffiliateCommission、payment webhook、既有資料、partial/legacy source identity。
- 狀態：Needs Sol review
- 是否允許 Terra 修改：否
- 最小驗證方式：只讀 bounds/duplicate aggregate；確認 PostgreSQL unique 對 nullable `sourceId` 的語意；isolated DB apply；concurrent webhook 與 legitimate multi-source regression。

## SOL-GOAL-001 — Codex Security 52 candidates

- ID：SOL-GOAL-001
- 標題：Security reportable candidate pool 尚未逐項驗證
- 嚴重度候選值：High pool（個別嚴重度未確認）
- 信心程度：Medium
- 證據：CR-005 與報告只提供 52 項分類／嚴重度分布；缺目前 dirty snapshot 的逐項可達性、行號與重現。
- 影響範圍：auth、authorization、payment、webhook、availability、sensitive data、dependency。
- 狀態：Needs Sol review
- 是否允許 Terra 修改：否；Sol 先驗證後才能另派最小修正。
- 最小驗證方式：逐項對照目前 working tree，要求 source/sink、權限前置、可達性與 regression；無證據則 Rejected／Insufficient evidence。

## SOL-GOAL-002 — Webinar ownership release E2E gap

- ID：SOL-GOAL-002
- 標題：CR-015 mutation ownership 只有 static/targeted evidence
- 嚴重度候選值：Medium
- 信心程度：High
- 證據：`CODE_REVIEW_REPORT.md` 明列 integration regression pending；server-side owner predicate 已存在。
- 影響範圍：team template edit／webinar binding。
- 狀態：Needs Terra investigation
- 是否允許 Terra 修改：是；僅限 E2E negative regression，不能改 ownership 規則或 assertion 以迎合實作。
- 最小驗證方式：同 vendor/team 的 member A 嘗試綁定 member B webinar，server 拒絕且資料不變；合法 owner path 維持通過。

## SOL-NIGHT-001 — Cloudflare signature bypass／timing attack／IDOR

- ID：SOL-NIGHT-001
- 標題：本地模型重複聲稱 Cloudflare signature 可 bypass
- 嚴重度候選值：High／Medium（模型候選）
- 信心程度：High（拒絕）
- 證據：實作使用 HMAC-SHA256、timestamp tolerance、hex validation、length check 與 `timingSafeEqual`；Production 缺 official signature 時 fail closed。IDOR 與 signature primitive 無對應 object authorization 路徑。verifier／arbiter 亦拒絕重複候選。
- 影響範圍：Cloudflare Stream webhook verification。
- 狀態：Rejected
- 是否允許 Terra 修改：否
- 最小驗證方式：保留 valid／invalid／expired／missing-production route tests；若未來主張資訊洩漏，需先證明 reason code 對攻擊者形成可利用差異。

## SOL-NIGHT-002 — Inventory reservation BOLA／race 候選

- ID：SOL-NIGHT-002
- 標題：模型以 integration test 本身當作 BOLA／race 證據
- 嚴重度候選值：High
- 信心程度：High（拒絕）
- 證據：finding 位置全指向 `inventory-reservations.test.ts`；實作 mutation 同時使用 product ID、vendor ID、status predicate、SERIALIZABLE transaction 與 bounded retry；Night 實際 concurrency tests 通過。
- 影響範圍：checkout inventory reservation。
- 狀態：Rejected
- 是否允許 Terra 修改：否
- 最小驗證方式：只有能提供 cross-vendor product mutation 或 double-release 的可重現 DB case，才重新開啟。

## SOL-NIGHT-003 — Team Funnel CSRF／SQL injection／revalidation race

- ID：SOL-NIGHT-003
- 標題：partner action 的 generic security claims
- 嚴重度候選值：High／Medium
- 信心程度：High（拒絕主要 claims）
- 證據：每個 mutation 入口先呼叫 `assertServerActionSecurity`；資料存取使用 Prisma structured API，沒有 raw SQL；ownership 由 scoped service與 actor/resource predicate處理。模型沒有 payload、sink 或 DB state reproduction。
- 影響範圍：Team Funnel partner actions。
- 狀態：Rejected
- 是否允許 Terra 修改：否
- 最小驗證方式：若重新提出，必須提供 CSRF token bypass、raw-query sink 或 concurrent DB invariant 破壞的可執行測試。

## SOL-NIGHT-004 — Password／token／MFA sensitive data exposure

- ID：SOL-NIGHT-004
- 標題：模型把 hash/encrypted schema 欄位當明文 secret
- 嚴重度候選值：High
- 信心程度：High（拒絕）
- 證據：password 由 scrypt hash；session/reset token 儲存 hash；MFA 欄位為 `secretEncrypted` 且有 encrypt/decrypt tests。`REDACTED_SENSITIVE_LINE` 是 review sanitizer placeholder，不是 repository secret。
- 影響範圍：auth schema、migrations、tests。
- 狀態：Rejected
- 是否允許 Terra 修改：否
- 最小驗證方式：只有能證明 write path 寫入 plaintext、API 回傳 hash/secret 或 encryption key misuse，才重新開啟。

## SOL-NIGHT-005 — Cloudflare diagnostics env／URL／token shape

- ID：SOL-NIGHT-005
- 標題：模型聲稱 diagnostics 缺 env handling、URL 錯誤、token 洩漏
- 嚴重度候選值：Medium
- 信心程度：High（拒絕）
- 證據：missing/example 值 fail closed；endpoint 使用官方 account-scoped `/client/v4/accounts/.../stream` 形狀；輸出只含 configured、length、shape，tests 明確驗證不序列化原值。
- 影響範圍：Cloudflare diagnostics。
- 狀態：Rejected
- 是否允許 Terra 修改：否
- 最小驗證方式：官方 API contract 變更或可重現 secret serialization。

## SOL-NIGHT-006 — CI／docs 內含 secrets

- ID：SOL-NIGHT-006
- 標題：模型把 placeholder／sanitized lines 誤報成 secrets
- 嚴重度候選值：High
- 信心程度：High（拒絕）
- 證據：Night review 看到的是 redacted placeholder；既有 repository scanner 與 Night 前 secret evidence 為 0。沒有具體 credential pattern、有效 token 或可使用值。
- 影響範圍：CI、docs、tests。
- 狀態：Rejected
- 是否允許 Terra 修改：否
- 最小驗證方式：以 safe scanner 指出具體檔案、分類與非敏感 fingerprint；禁止把 secret 值抄入報告。

## SOL-NIGHT-007 — Night Review formal success

- ID：SOL-NIGHT-007
- 標題：orchestrator phase success 被誤解為審查完成
- 嚴重度候選值：Medium（證據治理）
- 信心程度：High
- 證據：plan 找錯 repo；Gemini coverage/final audit permission denied；四份 handoff 空白；四份 synthesis parse error。
- 影響範圍：Night Review evidence、G06、後續優先順序。
- 狀態：Insufficient evidence
- 是否允許 Terra 修改：否
- 最小驗證方式：重新產生非空、指向正確 repo、可解析且含 source evidence 的 review；本次不要求重跑。

## Manual Exceptions

### SOL-MA-001 — Supabase residual ACL

- 嚴重度候選值：High；信心 High
- 證據：36 筆 platform-owner residual default ACL 待 owner／Support。
- 影響範圍：G03、Production Data API。
- 狀態：Manual Exception
- Terra：否
- 最小驗證：非敏感 catalog 摘要顯示 ACL=0、RLS 52/52、API grants=0、auto expose disabled。

### SOL-MA-002 — PayUni Production

- 嚴重度候選值：High；信心 High
- 證據：Production merchant／callback／signature 未簽核。
- 影響範圍：M02、F04、G05。
- 狀態：Manual Exception
- Terra：否
- 最小驗證：日期、Production、merchant、ReturnURL、NotifyURL、HashInfo、方法、簽核角色；禁止建立付款／退款。

### SOL-MA-003 — Sentry delivery

- 嚴重度候選值：Medium；信心 High
- 證據：既有 Test Notification 缺收件端回執。
- 影響範圍：Q13、M05、G05。
- 狀態：Manual Exception
- Terra：否
- 最小驗證：送達結果、接收類型、日期、方法、簽核角色；不得重送。

### SOL-MA-004 — Cloudflare exact binding

- 嚴重度候選值：High；信心 High
- 證據：Production token active／scope／account exact binding 未證明。
- 影響範圍：M04、G05。
- 狀態：Manual Exception
- Terra：否
- 最小驗證：active、Stream read/edit、account coverage、日期、方法、簽核角色。

### SOL-MA-005 — PostHog Production

- 嚴重度候選值：Medium；信心 High
- 證據：Production project/event 到達未簽核。
- 影響範圍：Q13、M05、G05。
- 狀態：Manual Exception
- Terra：否
- 最小驗證：一次受控無客戶資料事件到達；若已執行不得重送。

### SOL-MA-006 — Screen reader

- 嚴重度候選值：Medium；信心 High
- 證據：axe 不能替代真實 NVDA／VoiceOver journey。
- 影響範圍：Q10、Q16。
- 狀態：Manual Exception
- Terra：否
- 最小驗證：登入、MFA、建立直播、公開頁、checkout/admin 的真人驗收紀錄。
