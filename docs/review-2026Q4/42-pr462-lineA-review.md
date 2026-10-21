# PR #462 審查：第五批工作線 A（F-027／F-028／F-029，B02-04／05／06）

- 分支：`codex/beta-l1d-lineA-auth`（4 個 commit，ce01f158 為 HEAD）
- worktree：`C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineA`
- 審查日期：2026-10-21
- 審查者：reviewer（Opus），只回報 findings，未修改程式

## 範圍說明

分支基底是 `291acbd2`（#457），`origin/master` 已前進到 `ad453597`（#459）。`git diff origin/master..HEAD`（兩點）會把 #459 的變更顯示成反向刪除，共 184 個檔案，不能代表本 PR。實際審查用三點 diff `origin/master...HEAD`（78 個檔案，+2449／-503）。`git merge-tree` 確認與目前 master 合併無衝突，#459 沒有新增 migration。

## 自行執行的驗證

| 項目 | 結果 |
|---|---|
| `npm run typecheck` | 通過 |
| `eslint`（本 PR 新增或修改的 .ts／.tsx） | 無錯誤 |
| 16 個 targeted vitest 檔（recent-mfa、step-up notice、accept page、auth、env、actions、payment-method、student-portal、line、tracking、affiliate-remuneration、plans、三個 export route、password-reset） | 15 檔通過、572 個測試通過；`src/lib/password-reset.test.ts` 6 個失敗，原因都是連不到 `localhost:54329`（本機沒有測試 DB），不是程式錯誤 |
| `*.db.test.ts`（account-rate-limit、recent-mfa、vendor-member-invitation） | **未執行**（本機無測試 DB），以下對 DB 行為的判斷來自讀碼與 PR 描述 |

## Findings

| # | 等級 | 位置 | 問題 |
|---|---|---|---|
| 1 | MAJOR | `src/lib/vendor-member-invitation.ts:137-140`；`src/app/actions/auth-security-actions.ts:99-108`；`src/app/(app)/settings/security/page.tsx:283` | 沒有任何 active membership 的既有帳號無法接受邀請，「重新啟用成員」流程失效 |
| 2 | MAJOR（既有，但現在位於 step-up 主路徑） | `src/app/mfa/verify/page.tsx:12-14,36`；`src/app/actions/auth-security-actions.ts:48-51,229,270` | `/mfa/verify` 的 `next` 驗證器允許 `/\t/evil.example`，可造成 open redirect |
| 3 | MINOR | `src/lib/account-rate-limit.ts:22` | TOTP 帳號層上限只有「5 次／分」固定視窗，沒有日上限或鎖定，長期暴力猜測的成功率仍高 |
| 4 | MINOR | `src/app/actions/auth-security-actions.ts:84-92` | 登入密碼猜測沒有帳號層限流；`login-source-email` 走 IP 層，在 `cloudflare_waf` 下整段略過 |
| 5 | MINOR | `src/lib/wp4-runtime-boundary.ts:63-76` | `wp4PreviewStepUpActor` 沒有任何測試，沒有證明 production／非 fixture 不會拿到 synthetic factor |
| 6 | MINOR | `prisma/migrations/20261021150000_account_rate_limit_bucket/`；`docs/codex-goal/PRISMA_INVARIANTS.md` 新增段落 | 時間戳與 #461 的 `20261021150000_stream_usage_monthly_counter` 相同；inventory 計數也會互相衝突 |
| 7 | MINOR | `src/app/(app)/settings/security/page.tsx:283`；`src/app/actions/vendor-member-actions.ts`（已移除直接改角色） | owner 不能再單方面降級成員角色，降級需要被降級者「接受」 |
| 8 | MINOR | PR 描述 Verification 段 | `q1-original-retry-audit` 失敗「未在 master 確認」，合併前要確認不是本 PR 造成 |
| 9 | NIT | `src/app/actions/vendor-member-actions.ts:150-157` | 寄信失敗的 audit 帶 vendorId，只會出現在可寄送的對象上，理論上可區分平台 admin／停權帳號 |
| 10 | NIT | `src/lib/vendor-member-invitation.ts:59-78` | 建立邀請的交易不是 Serializable，同一 Email 併發邀請可能留下兩筆 pending |
| 11 | NIT | `src/app/actions/vendor-member-invitation-actions.ts:47-61` | 匿名請求在確認 token 有效之前就先跑 scrypt |
| 12 | NIT | `src/app/actions/vendor-member-actions.ts:135` | 收件人跨租戶上限（3 次／時）可被任一租戶用來壓住別人的邀請信 |
| 13 | NIT | `prisma/migrations/20261021150100_vendor_member_invitation/migration.sql`；`src/lib/wp4-runtime-boundary.ts`；`src/lib/recent-mfa.ts`；`src/components/pending-vendor-invitations.tsx` | 以 CRLF 提交；`wp4-runtime-boundary.ts` 從 LF 轉成 CRLF，產生整檔 diff |

**BLOCKER：無。**

### 1. MAJOR：無 active membership 的既有帳號無法接受邀請

- 情境：owner 停用成員 B（`deactivateVendorMemberAction` 會撤銷 B 的 session）。之後 owner 依頁面說明（「也可用來……重新啟用成員」）重新邀請 B。B 開啟連結，因為 B 有帳號，頁面要求先登入。`loginAction` 在 `!auth.isPlatformAdmin && !auth.vendor` 時直接導向 `/login?error=no_vendor`，不建立 session。B 永遠無法登入，`acceptVendorMemberInvitation` 永遠回 `login_required`。之前在其他租戶全部被停用、又被新商家邀請的帳號也一樣。
- 改版前 `createVendorMemberAction` 可以直接 upsert 成 active，這條路在本 PR 被移除。原本的測試「re-enables an inactive membership for an active user and sends a new invitation」被刪掉，沒有替代測試。DB 測試直接傳入 `actorUserId`，繞過了登入，所以沒有抓到。
- 建議（擇一）：(a) 接受頁對既有帳號提供「密碼 + （有 factor 時）TOTP」的就地驗證，在 action 內用 `authenticateUser` 驗證身分後再接受；(b) `loginAction` 在使用者有 pending 且未過期的邀請時，允許建立無 vendor 的 session，並導回 `/invitations/accept`。補一個「停用 → 重新邀請 → 本人登入 → 接受 → active」的 DB 測試。

### 2. MAJOR（既有）：`/mfa/verify` 的 `next` 可造成 open redirect

- 本 PR 新增的路徑本身安全：`recentMfaRedirectPath` 經 `withMfaReturnPath` → `safeMfaReturnPath`，會拒絕控制字元並用 URL parser 確認 origin，而且 `nextPath` 都是伺服器常數或 `encodeURIComponent` 後的路徑。`/mfa/setup` 也用 `safeMfaReturnPath`。
- 但 step-up 會把使用者導到 `/mfa/verify`。那裡的 page（`safeInternalPath`）與 `verifyMfaAction`（同名函式）只檢查 `startsWith("/")`、`!startsWith("//")`、不含 `\`。`/\t/evil.example/x` 能通過檢查，而 WHATWG URL parser 會移除 tab，結果是 `new URL("/\t/evil.example/x", "https://app")` → `https://evil.example/x`（已用 node 實測）。
- 情境：攻擊者寄出 `/mfa/verify?reason=step_up&next=%2F%09%2Fevil.example`。頁面看起來是正常的 step-up 提示，使用者輸入 TOTP 後被 `redirect(next)` 送到外站釣魚頁。本 PR 讓這個頁面成為常態流程，提高了可信度。
- 建議：page 與 `verifyMfaAction` 都改用 `safeMfaReturnPath`（找不到時用原本的 fallback），並補 `\t`、`\n`、`%09` 的測試。只改兩行；可以跟本 PR 一起修，或另開 PR 但要在合併前追蹤。

### 3. MINOR：TOTP 暴力猜測的殘餘風險

- `mfa_verification: 5 次／60 秒`，固定視窗，成功與失敗都計數，沒有更長的視窗。以 ±1 個 TOTP 窗口估算，每次猜中機率約 3×10⁻⁶。每天 7,200 次約 2.2%，30 天約 48%。B02-05 的威脅模型正是「密碼外洩加上分散 IP 猜 TOTP」，本 PR 只把上限恢復成跟 Upstash 時一樣，沒有實質縮小。
- 建議：再加一個長視窗 scope（例如每帳號每 24 小時失敗 20 次就鎖定，並寄信給本人），或只累計失敗、成功後歸零。

### 4. MINOR：登入沒有帳號層限流

- `login-source-email:${email}` 走 `checkRateLimit`（IP 層），在 `cloudflare_waf` 下回 null。preflight 新訊息列出的帳號層項目沒有「登入」，所以文字不算錯，但對單一帳號的分散 IP 密碼猜測仍然沒有上限。
- 建議：新增 `login_account` scope（以正規化 Email 為 subject，例如 10 次／15 分），超過時回應與密碼錯誤相同，避免洩漏帳號存在，也避免被拿來鎖別人的帳號。或至少在 `docs/review-2026Q4/12-tenant-auth.md` 記為殘餘風險。

### 5. MINOR：`wp4PreviewStepUpActor` 沒有測試

- 判斷邏輯讀起來正確：必須同時符合 fixture userId、fixture vendorId、`isWp4BoundNonProductionRuntime()`（`VERCEL_ENV=preview`、`PAYUNI_ENV=sandbox`、executor flag、staging project／DB identity 或 loopback disposable）。synthetic factor 只替代「已註冊 factor」這一項，`session.mfaVerifiedAt` 仍然要在 15 分鐘內，production 一定拿不到。
- 但這是 F-027 唯一的豁免，目前沒有測試防止回歸。
- 建議：補單元測試，至少涵蓋 `VERCEL_ENV=production`、非 fixture user、非 fixture vendor、fixture 但 `mfaVerifiedAt` 為 null 或超過 15 分鐘，這四種都必須不是 `verified`。

### 6. MINOR：migration 時間戳與 #461 相同

- 已確認 #461（`codex/beta-l1d-lineB-live`，OPEN）有 `20261021150000_stream_usage_monthly_counter`。兩者排序是 `…150000_account…` < `…150000_stream…` < `…150100_vendor…`，不論誰後合併，新 migration 都會排在 master 最新一筆之前，`migration-order` 檢查應該會擋下。
- 後合併者需要：把自己的 migration 改成大於對方的時間戳（本 PR 若後合併，兩個都要改，例如 `20261021160000_*`、`20261021160100_*`）；同步更新 `PRISMA_INVARIANTS.md` 的名稱與「152／153 models、121／122 migrations」計數（目前分支實測為 153 個 model、122 個 migration 目錄，與文件一致）。
- 改名前這兩個 migration 不能套到任何共用環境。

### 7. MINOR：owner 無法單方面降級成員

- 現在改角色只能透過邀請，由被邀請者接受。owner 想把 admin 降成 support，對方可以不接受；owner 只剩「停用」，而停用後又會碰到 finding 1。
- 安全面不算缺口（停用可以立即生效），但功能退化，而且頁面文字承諾「變更既有成員角色」。
- 建議：降級（權限變小）另做 owner 直接執行的 action（需 step-up 與 last-owner 檢查）；升級維持邀請接受。或修改頁面文字。

### 8. MINOR：未確認的既有失敗

PR 描述寫「`q1-original-retry-audit` 既有失敗未在 master 確認」。依 AGENTS.md「沒跑的測試不能說通過」，合併前要在 master 上跑同一個測試，確認失敗不是本 PR 造成，並把結果寫進 PR。

### 9–13. NIT

- 9：`vendor_member_invitation_email_failed` 帶 `vendorId`，平台 admin／停權帳號永遠不會產生這筆 audit。目前沒有租戶端 audit 頁面（只有 `/admin/billing/*` 會讀 AuditLog），所以只是潛在洩漏。建議改成平台層（不帶 vendorId），與 suppressed 一致。
- 10：`createVendorMemberInvitation` 的「撤銷舊邀請 → 建立新邀請」在 Read Committed 下執行，同一 Email 併發送出時可能兩筆都 pending，兩個連結都有效（都寄到同一個信箱，影響小）。可改成 Serializable，或加上 `(vendorId, email) WHERE acceptedAt IS NULL AND revokedAt IS NULL` 的 partial unique index。
- 11：`acceptVendorMemberInvitationAction` 在 `cloudflare_waf` 下沒有 app 層限流，會先對任意 token 跑 `hashPasswordAsync`。建議先用 `findPendingVendorMemberInvitation` 確認 token 有效，再做雜湊。
- 12：任一租戶對同一 Email 送出 3 次邀請，就能讓其他租戶在一小時內寄不出邀請給這個人（suppressed 只寫平台 audit，owner 看到的仍是「已建立邀請」）。影響小，記錄即可。
- 13：新增的 migration SQL 以 CRLF 提交（master 120 個 migration 中只有 1 個是 CRLF）。Prisma checksum 依檔案位元組計算，日後若有人做行尾正規化，已套用的 migration 就會被判為「已修改」。建議合併前轉成 LF（尚未套用到任何共用 DB，現在改沒有成本）。`wp4-runtime-boundary.ts` 由 LF 轉 CRLF，造成整檔 61 行 diff，掩蓋了實際只新增的 15 行。

## 依審查順序的結論

### 1. 金流

本 PR 沒有改金額計算。`createPlatformPlanCheckout` 只在最前面加了 step-up，價格仍取自伺服器的 plan 紀錄。`/api/billing/plans/select` 的 `REDIRECT_PATHS` 已包含 `/mfa/setup` 與 `/mfa/verify`，route transport 會正確轉成 303。綁卡（`startPaymentMethodSetupAction`、`revokePaymentMethodReferenceAction`）都有 step-up。撥款帳號（#457）沿用「表單內當下輸入 TOTP」，比 15 分鐘視窗更嚴格，方向一致；本 PR 只多加帳號層 DB 限流。**沒有金流層級的 findings。**

### 2. 租戶邊界

- `revokeVendorMemberInvitation` 用 `id + vendorId + pending` 條件更新，`loadPendingVendorInvitations` 也綁定 session vendor。
- 接受時的 vendor、role、Email 全部來自邀請列，不讀表單。既有帳號必須是已登入（有 factor 時須已驗證）的本人；沒有帳號時，已登入的其他使用者會被拒絕（`wrong_account`）。
- 「新增成員」對未知 Email、他租戶使用者、既有成員、平台 admin、停權帳號，同步路徑與回應都相同；差異只在 `after()` 之後，且只寫平台層 audit（見 NIT 9）。
- `recentMfaStatus` 以 session 為單位判斷，DB 測試涵蓋「A 租戶的新鮮驗證不會帶到 B 租戶成員」。

**沒有 BLOCKER／MAJOR 等級的租戶邊界問題。**

### 3. Auth 與權限

- `requireRecentMfa` 只讀 `user.mfaFactor`（DB include）與 `session.mfaVerifiedAt`（DB 的 `UserSession`）。寫入點只有 `createSession`（一般登入固定為 null；WP4 有 runtime 與 fixture 限制）與 `markCurrentSessionMfaVerified`（TOTP 或 recovery code 驗證成功後）。client 無法影響。未來超過 60 秒的時間戳視為不新鮮；actor 不完整時 fail closed。
- 套用範圍對照 B02-04 清單：綁卡、選方案、成員管理（邀請、撤銷、重寄、停用）、核准收款人、LINE、Meta、PII 匯出（電子發票、直播留言、聯盟報酬 CSV）都已覆蓋。沒有覆蓋的是：團隊成員操作與非 PII 的平台帳單 CSV（PR 已自述），以及退款（不在 B02-04 清單，退款回到買家原卡，風險較低）。MFA 重新註冊在已有 factor 時會被拒絕（`mfa_exists`），沒有繞道。
- 改名 `*Mfa` → `*Member` 正確反映行為；wp88 guard matrix 只改名稱，計數不變。
- 主要問題是 finding 2（verify 頁的 next）與 finding 5（WP4 豁免沒有測試）。

### 4. 資料與 migration

- 兩個 migration 都是純新增、forward-only，都設定交易層級 `lock_timeout = 5s`、啟用 RLS。CHECK 與程式假設一致：`keyHash` 是 64 字元 hex、`count ≥ 1`、role 白名單、Email 已 trim 且小寫（`normalizeInvitationEmail`）、`tokenHash` 是 hex、accepted 與 revoked 互斥、`acceptedUserId` 有值時 `acceptedAt` 必須有值（SET NULL 之後仍成立）。
- `UserPolicyConsent_context_check` 在同一個 migration 交易內 DROP 後重建，只是擴大允許值，既有列（都是 `merchant_registration`）一定符合。重建時會在 ACCESS EXCLUSIVE 下掃描全表，但表很小、有 lock_timeout，可以接受。若要更保守，可改成 `NOT VALID` 再 `VALIDATE`（非必要）。
- 帳號層限流：key 是 `SHA-256("celebratedeal:account-rate-limit:v1" ‖ scope ‖ subject)`，subject 為 userId、vendorId、`vendorId:customerKeyHash` 或小寫 Email，不存明文。用單一 `INSERT … ON CONFLICT DO UPDATE` 以 DB 時鐘做原子遞增；新建 bucket 時清掉最多 50 筆閒置超過 24 小時的列（清理失敗不影響判斷）。`checkAccountRateLimit` 在 DB 錯誤時回 503（fail closed）；magic link 遇到 503 回「稍後再試」；密碼重設遇到錯誤時不寄信。`cloudflare_waf` 只讓 IP 層的 `checkRateLimit` 放行，帳號層不受影響。
- 問題見 finding 6 與 NIT 13。

### 5. 正確性與測試

- 邀請 token：`randomBytes(32)`（256 bit）、只存 SHA-256、72 小時、單次使用（Serializable 交易內的條件更新，P2034 對應到 invalid）、重發會撤銷舊連結。接受頁不會為非持有人洩漏任何資訊；對持有人只顯示「有沒有帳號」，持有人就是信箱主人，可以接受。
- 寄信失敗只寫 audit 的風險：owner 只看到「已建立邀請」，不知道信沒寄出。不過 pending 清單會持續顯示，owner 可以撤銷後重送，invitee 也不會被加入任何租戶，安全上可接受。建議後續在 pending 清單加上「平台已知寄送失敗」的中性提示，但不能洩漏帳號類型。
- 測試：step-up（setup、stale、fresh、跨租戶、匯出不讀資料）、限流（上限、WAF、視窗重置、scope 獨立、併發、只存 hash、清理、503、CHECK）、邀請（四種 Email 回應一致、撤銷綁租戶、本人才可接受、新帳號與政策同意、admin 和停權不可接受、過期／撤銷／偽造、last owner、併發單次使用、CHECK）大致完整。缺口：finding 1 的重新啟用路徑、finding 5 的 WP4 豁免、finding 2 的 next 驗證。
- Gate 固定數：本 PR 沒有修改 vitest coverage 門檻或設定；wp88 的 `sourceFiles 95` 與各 family 計數不變，只改名。沒有看到降低 assertion、skip 或用假資料掩蓋的情形。被刪除的舊測試，除了「re-enable inactive membership」之外，都有對應的新測試。

## 合併前必做

1. 修正 finding 1（重新啟用／無 vendor 帳號接受邀請），並補 DB 測試。
2. 修正 finding 2（`/mfa/verify` 改用 `safeMfaReturnPath`），並補測試。
3. 與 #461 協調 migration 時間戳；後合併者改名，並更新 PRISMA_INVARIANTS 計數。
4. 補 `wp4PreviewStepUpActor` 測試（finding 5）；在 master 確認 `q1-original-retry-audit`（finding 8）。
5. 建議：migration 轉 LF（NIT 13）；finding 3、4、7 可在本 PR 處理，或開追蹤項。

修正後需要在有測試 DB 的環境跑 `*.db.test.ts`（account-rate-limit、recent-mfa、vendor-member-invitation、password-reset），並附上結果。

**結論：需修正後再審。**
