# PR #462 複審：第五批工作線 A 修正

- 分支：`codex/beta-l1d-lineA-auth`。複審範圍是 `git diff ce01f158..HEAD`，共 4 個 commit：e036ce68、0c8b2256、7ced4194、fcc0d70d（HEAD）。
- 對照的初審：`docs/review-2026Q4/42-pr462-lineA-review.md`
- 複審日期：2026-10-21。reviewer（Opus）只回報 findings，沒有修改程式。

## 自行執行的驗證

| 項目 | 結果 |
|---|---|
| `npm run typecheck` | 通過 |
| `eslint`（修正 commit 新增或修改的 .ts／.tsx） | 無錯誤 |
| vitest：safe-internal-path、wp4-preview-step-up、mfa verify／setup page、invitations accept page、actions、recent-mfa、auth、env、line-login、step-up notice、login | 11 個檔案、550 個測試全部通過 |
| node 實測 `safeInternalPath`（見下節） | 符合預期 |
| `*.db.test.ts`（account-rate-limit、vendor-member-invitation，包含新的重新啟用與調降測試） | **未執行**，本機沒有測試 DB（`localhost:54329`）。以下 DB 行為的判斷都來自讀程式碼與測試碼 |

## `safeInternalPath` 實測（tsx 直接 import `src/lib/safe-internal-path.ts`）

| 輸入 | 結果 |
|---|---|
| `/\t/evil.example`（真正的 TAB） | `undefined` → fallback |
| `/\n/evil.example` | `undefined` |
| `//evil.example` | `undefined` |
| `/\evil.example`（一個反斜線） | `undefined` |
| `\/evil.example` | `undefined` |
| `javascript:alert(1)` | `undefined` |
| `/ok?x=1` | `/ok?x=1` |
| `/ok?x=1#h` | `/ok?x=1#h` |
| `/a/../../evil` | `/evil`（正規化後仍在同源） |
| `/%09/evil.example`、`/%2F%2Fevil.example` | 原樣保留，解析後仍是 `https://app.example/...` 同源路徑 |
| `/ok?next=//evil` | `undefined`（字串中任何位置出現 `//` 都會拒絕，比較保守） |
| `/　/evil` | `undefined` |

`/mfa/verify` 的 page、`verifyMfaAction`、`auth.ts` 的 `safeMfaNextPath`、`line-login.ts`、`safeMfaReturnPath`、login 的 `next`，現在都統一用這個 validator。repo 裡還有 `api/billing/plans/select/route.ts:42` 自己寫的檢查，但它後面會用 `new URL` 比對 origin，再套 allowlist，所以安全。

## 初審 findings 逐條狀態

| # | 初審等級 | 狀態 | 說明 |
|---|---|---|---|
| 1 | MAJOR | **已修正** | `loginAction` 在「沒有 active vendor、不是平台 admin、但有待接受且未過期的邀請」時，允許建立 `vendorId = NULL` 的 session。登入後只能導向 `/invitations/accept…`：`invitationReturnPath` 會再用 `safeInternalPath` 驗證並比對路徑前綴，login page 也只把 `/invitations/accept` 開頭的 `next` 放進表單。沒有邀請時仍然回 `no_vendor`。接受頁改用 `getCurrentAuth({ allowUnverifiedMfa: true })` 加 `requireAuth({ nextPath })`，MFA 尚未驗證時會先到 `/mfa/verify` 再回到接受頁。新增 DB 測試涵蓋完整流程：停用 → 沒邀請時登入得到 `no_vendor` → 邀請 → 登入後回到 accept path、session 的 vendorId 為 null → 接受 → 角色為 active／support、`deactivatedAt` 為 null。頁面文字也已同步修改。 |
| 2 | MAJOR | **已修正** | 見上節實測，並新增 `src/app/mfa/verify/page.test.tsx` 與 `src/lib/safe-internal-path.test.ts`。 |
| 3 | MINOR | **已修正** | 新增 `mfa_verification_failures`（每帳號每 24 小時 50 次失敗）。超過後，每次失敗都會觸發 `mfa_verification_lock`，鎖 1 小時，並寫入 `mfa_verification_locked` audit。鎖定檢查放在驗證之前；讀取失敗回 `temporarily_unavailable`，是 fail-closed。失敗計數本身發生錯誤時也回 `temporarily_unavailable`，不會被當成驗證通過。估算每天最多約 73 次嘗試，30 天的猜中機率約 0.7%（初審估計約 48%）。 |
| 4 | MINOR | **已修正，另有新的取捨**（見 N1） | 新增 `login_account`：每個提交的 Email 15 分鐘內 10 次，在驗證密碼之前計數，不受 `RATE_LIMIT_PROVIDER` 影響。DB 錯誤時回 `temporarily_unavailable`，是 fail-closed。preflight 文字已加上「登入」。 |
| 5 | MINOR | **已修正** | `src/lib/wp4-preview-step-up.test.ts` 涵蓋：bound runtime 中的 fixture 會通過；`VERCEL_ENV=production`、`PAYUNI_ENV=production`、executor 關閉、缺少 loopback marker、非 fixture user、非 fixture vendor 都不會通過；fixture 沒有驗證時間或超過 15 分鐘時，仍要求重新驗證。 |
| 6 | MINOR | **已修正** | 兩個 migration 改名為 `20261021160000_account_rate_limit_bucket` 與 `20261021160100_vendor_member_invitation`，排在 #461 的 `20261021150000_*` 之後；第一個是純改名，內容沒有變。實測本分支有 153 個 model、122 個 migration 目錄，PRISMA_INVARIANTS 也寫 152／121（第一段）與 153／122（第二段），兩者一致。文件也註明 #461 先合併時為 154／123。 |
| 7 | MINOR | **已修正** | 新增 `changeVendorMemberRoleAction`，流程是 CSRF → owner → step-up。member 以 `id + vendorId + active` 查詢；不能改自己的角色；只能調降（`ROLE_RANK`：owner 3、admin 2、accountant／support 1，所以 accountant 與 support 之間平移仍要走邀請）。在 Serializable 交易內檢查 last owner；`update` 的 where 包含 `vendorId`、`status` 與原本的 `role`，併發修改時會失敗，不會互相覆蓋。DB 測試涵蓋調降、拒絕調升、拒絕改自己、跨租戶得到 not_found、owner 調降其他 owner，以及 audit。 |
| 8 | MINOR | **未處理** | PR 描述仍寫「`q1-original-retry-audit` 既有失敗未在 master 確認」，也還寫著舊的時間戳說明。這只是流程項目，不影響程式，但合併前需要補上 master 的對照結果並更新 PR 描述。 |
| 9 | NIT | **已修正** | `vendor_member_invitation_email_failed` 不再寫 vendorId（改放進 `after` snapshot），跟 suppressed 一樣只屬於平台層。 |
| 10 | NIT | 未處理 | `createVendorMemberInvitation` 仍使用預設隔離等級，可以接受。 |
| 11 | NIT | **已修正** | 接受 action 先確認 token 是 pending 才雜湊密碼。 |
| 12 | NIT | 接受風險 | 沒有變更。 |
| 13 | NIT | **已修正** | 兩個 migration、`wp4-runtime-boundary.ts`、`recent-mfa.ts`、`pending-vendor-invitations.tsx` 都已改回 LF（CR 數為 0）。`wp4-runtime-boundary.ts` 相對 master 只剩 +15 行。 |

## 複審新發現

| # | 等級 | 位置 | 問題與建議 |
|---|---|---|---|
| N1 | MINOR | `src/app/actions/auth-security-actions.ts:92-97`；`src/lib/account-rate-limit.ts`（`login_account`） | `login_account` 在驗證密碼之前就以「提交的 Email」計數，而且成功和失敗都算。任何人不需要密碼，只要每 15 分鐘送 10 次錯誤登入，就能持續讓指定帳號（例如平台 admin 的已知 Email）登入不了，回應是 `rate_limited`。這是帳號層限流常見的可用性取捨，但這次門檻偏低，又沒有任何旁路。建議擇一：(a) 驗證前只檢查不消耗，只在密碼錯誤時才 `consume`，這樣合法使用者正常登入不會累計；(b) 再加上「同一 Email 加同一來源」的 bucket，讓全域 per-Email 門檻可以放寬（例如 50 次／15 分）；(c) 至少寫進 runbook 與殘餘風險。這不阻擋合併，但請開追蹤項。 |
| N2 | NIT | `src/app/(app)/settings/security/page.tsx:53` | `changeVendorMemberRoleAction` 找不到成員時沿用 `member_not_found`，顯示的訊息是「找不到可停用的成員」。建議改成中性文字，或另外新增 error code。 |
| N3 | NIT | `src/app/actions/auth-security-actions.ts`（`invitationLogin`） | 只要有任何租戶對某個 Email 建立邀請，沒有 vendor 的帳號就能取得一個 `vendorId = NULL` 的 session。這個 session 只能進到 `requireAuth`（不需要 vendor）的頁面，例如個人安全設定，所有 vendor guard 仍會導向 `no_vendor`，所以沒有實際的資料暴露。記錄即可。 |
| N4 | NIT | `src/app/actions/auth-security-actions.ts`（`recordMfaVerificationFailure`） | 知道密碼的攻擊者可以反覆觸發 1 小時的 MFA 鎖定，讓本人也無法完成 MFA。前提是密碼已經外洩，畫面也會提示「請盡快變更密碼」，可以接受。 |

**BLOCKER：無。MAJOR：無。** 初審的兩個 MAJOR 都已修正，也都有測試。

## 合併前需要確認

1. 在有測試 DB 的環境跑 `src/lib/account-rate-limit.db.test.ts`、`src/lib/vendor-member-invitation.db.test.ts`、`src/lib/recent-mfa.db.test.ts`、`src/lib/password-reset.test.ts`，並把結果附在 PR。本次複審沒有跑這些測試。
2. 更新 PR 描述：時間戳改為 `160000`／`160100`，並補上 `q1-original-retry-audit` 在 master 的對照結果（m8）。
3. N1 開追蹤項（或在本 PR 改成只計失敗次數）。

上述 1、2 屬於合併時的流程確認，不需要再送一次程式審查。

**結論：可合併。**
