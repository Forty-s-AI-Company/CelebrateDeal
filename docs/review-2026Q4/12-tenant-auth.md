# 12 多租戶與授權審查（B-02，Critical）

> 基線 `review-baseline-2026Q4` = `78621ca3`（審查時 HEAD 與基線相同）。全程唯讀，未連任何資料庫或 Supabase 專案。審查者：reviewer 子代理（Opus）；本檔由主對話依 reviewer 回報原文存檔。

## 前言

**方法**
1. 先讀 `01-system-map.md`、`docs/domain-workflows.md`「租戶與權限」一節和 multi-tenant skill，從 `src/lib/auth.ts`、`csrf.ts`、`api-security.ts`、`merchant-api-security.ts`、`student-portal-auth.ts`、`sensitive-data.ts`、`wp4-runtime-boundary.ts` 建立授權模型。
2. Route：122 條 `route.ts` 都 grep 過呼叫了哪些防護函式（100%）。系統地圖列出的 10 條「grep 不到防護」route 逐條讀完原始碼並追到 lib。28 條 `/api/admin/ops/**` 都追到 `authorizeWp4Ops` 或 `requireJobSecret`。另外約 30 條 route 讀完全文（約 25%）。
3. Server Actions：46 個 `"use server"` 檔、183 個 export 用腳本掃過「有沒有 actor guard／CSRF」（100%）。被標出的項目與 Critical 子集合共約 30 個函式逐一讀到最後的 Prisma 呼叫（約 16%）。
4. 針對整個 `src/app` grep `where: { id }` 這類只用 id 的查詢（81 處），逐一確認是平台層級還是有先做 vendor 綁定。
5. migration 掃 RLS／GRANT；測試掃跨租戶否定案例的關鍵字。
6. 跑既有單元測試：`auth`、`csrf`、`merchant-api-security`、`api-security`、`data-api-hardening-migration`、`team-funnel-access`，6 個檔、95 個測試全部通過。

**未覆蓋**
- `api/form-submissions`（797 行）、`api/live-interactions`（501 行）、`api/payments/checkout`（1099 行）只抽查 ID 綁定段落，沒有讀完整個業務邏輯。
- 144 個 `page.tsx` 只 grep 角色 guard，沒有逐頁讀。
- webhook 驗章與金額屬於其他軸線。
- `scripts/` 沒有審查。
- staging／production 的 Supabase 實際 GRANT、RLS 狀態、`RATE_LIMIT_PROVIDER` 與 `JOB_SECRET` 是否跨環境共用：都沒有驗證（需 owner 或受控 runner）。

**整體觀察**：tenant ownership 模式很一致。輸入 ID 都在最後的 `findFirst`／`updateMany` 帶上 `vendorId: vendor.id`，關聯大量使用 composite FK（例如 `UserOnboardingPreference.selectedProject`、`AffiliatePortalAccess`），拒絕時多半回統一的 404／not_found。這次沒找到可直接利用的跨租戶讀寫 IDOR。主要風險在**身份模型**和**驗證強度**，不在單一查詢漏綁。

## Findings

| ID | 嚴重度 | 檔案:行號 | 問題 | 為何重要（情境） | 重現／測試 | 建議修法 | 估工 | 需 owner 決策 | 封測前必修 |
|---|---|---|---|---|---|---|---|---|---|
| B02-01 | BLOCKER | `src/lib/auth.ts:320-336`、`:215`、`:242`；`src/app/admin/layout.tsx:5`；`src/lib/auth.test.ts:224-228` | `requireFinanceAdmin` 只檢查 `isPlatformAdmin`。MFA 只在 `user.mfaFactor` 存在時才要求驗證，所以沒有 factor 的平台 admin 可以直接進入所有 `/admin/**`、退款（`actions.ts:2123-2125`）、月結／出款（`:1483`、`:1872`）、webhook 重送（`:2455`）、payout CSV（`admin/billing/payouts/[id]/csv/route.ts:14,27` 會解密銀行帳號）。PR #436 尚未合併，master 仍有這個漏洞，而且現有測試把它當成預期行為。 | 平台 admin 的密碼一旦外洩或被撞庫，攻擊者只靠單一因子就能跨所有租戶執行正式退款、匯出全部收款人銀行帳號、改結算與出款。這違反 domain-workflows「Platform admin 需 MFA」的規定。`scripts/bootstrap-platform-admin.ts` 建出來的第一個 admin 預設就沒有 factor。 | `npx vitest run src/lib/auth.test.ts` 中的「allows a platform administrator without MFA to use the admin area」測試通過，等於證實了漏洞。 | 合併 PR #436（沒有 factor 就導向 `/mfa/setup`），並把 :224 那條測試反轉成拒絕。上線前確認 production 所有 `platform_admin` 都已註冊 factor。staging QA finance 帳號也要有 factor。 | S | 否（已有 PR） | **是** |
| B02-02 | MAJOR | `src/app/actions/vendor-member-actions.ts:17`；`src/lib/affiliate-portal.ts:27`；`src/app/(app)/affiliates/[id]/access/page.tsx:20-24`；`src/app/actions/team-membership-actions.ts:101-104`；`src/lib/auth.ts:16,338-355`；`src/app/(app)/affiliates/commissions/page.tsx:27`；`src/app/actions.ts:1739-1741`；`src/app/actions/support-case-actions.ts:125,215` | 夥伴入口（affiliate portal）與團隊上下線都只能授權給既有的 `VendorMember`。成員角色只能是 owner/admin/accountant/support，沒有最小權限的 partner／promoter 角色。affiliate 入口實際上是後台成員身份加上一筆授權。 | 商家想讓外部推廣夥伴看自己的佣金帳本，就必須把對方加成商家成員：(a) accountant 透過 `requireVendorFinance` 可以看到**所有夥伴**的佣金（`/affiliates/commissions`），也能用 `recordAffiliatePayoutOutcomeAction` 把任何夥伴的出款標成 paid／void，還能進帳單、付款方式、匯出頁；(b) support 能讀所有買家客服案件（PII），並以商家名義回覆買家。這是「affiliate portal 與商家後台身份混用」，會造成同一租戶內的越權與個資外洩。 | 用 owner 建立 role=support 的成員，到 `/affiliates/[id]/access` 授權給這個成員，再用這個帳號開 `/support-cases`。目前沒有測試涵蓋這個情境。 | 新增不可進後台的 `partner` 成員角色（`requireVendorContext` 系列一律拒絕），或讓 `AffiliatePortalAccess`／團隊成員綁到獨立的 partner identity。補上 portal-only 帳號進不了後台的負向測試。 | M–L | **是**（產品身份模型） | 是，若封測包含 affiliate portal 或團隊漏斗 |
| B02-03 | MINOR（需驗證） | `prisma/migrations/20260724150000_harden_supabase_data_api/migration.sql`（只在當下對既有表開 RLS）；之後新增的 77 張表沒有 `ENABLE ROW LEVEL SECURITY`，例如 `CommerceOrder`、`SupportCase`、`PaymentMethodReference`、`EmailDelivery`、`BuyerSupportOrderGrant`、`LiveChatMessage`（20260808110000、20260808220500 等） | 租戶隔離 100% 在應用層。RLS 沒有任何 policy，只是用來擋 Supabase Data API 的預設拒絕；Prisma 以 owner 角色連線，會繞過 RLS。而 148 張表中有 77 張連 RLS 都沒開，Data API 能不能讀只取決於 `ALTER DEFAULT PRIVILEGES REVOKE` 是否真的對 anon／authenticated 生效。 | 如果 staging／prod 的預設權限沒有實際收回（例如 migration 執行角色和授權角色不同），任何拿到專案 URL 與 anon key 的人都能透過 PostgREST 讀訂單、客服、付款參考等 PII。應用層任何一處漏綁 vendorId 也沒有第二道防線。 | 在 staging 唯讀執行：`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where nspname='public' and relkind in ('r','p') and not relrowsecurity;` 以及 `has_table_privilege('anon', …)`。 | 加一個 forward migration 對所有表開 RLS。加 CI DB 測試：斷言每張表 `relrowsecurity=true`，且 anon／authenticated 沒有權限。新增表時同步登記到 PRISMA_INVARIANTS。 | S | 否 | 建議是（低成本） |
| B02-04 | MINOR | `src/lib/auth.ts:298-318`（`requireVendorSupportMfa`／`requireVendorManagerMfa` 名稱有 MFA 但不強制）、`:338-378` | 商家 owner／admin／accountant 的 MFA 是選用。綁卡、選方案扣款、成員管理（可新增 owner）、核准收款人銀行資料、LINE／Meta 憑證、PII 匯出都只靠密碼。函式名稱帶「Mfa」卻沒有強制，容易讓呼叫端誤以為受保護。 | 商家 owner 帳號被盜後，攻擊者可以新增 owner、改付款方式、匯出客戶與 payee 資料。 | 讀碼即可確認。`auth.test.ts` 沒有「沒有 factor 的商家 owner 被拒」的案例。 | 至少對 owner 與 finance 角色的高風險 action 要求已註冊 MFA，或做 step-up 驗證。函式改名或真的實作強制。 | M | **是** | 視封測商家規模決定 |
| B02-05 | MINOR | `src/lib/rate-limit.ts:151-154`；`src/lib/env.ts:329-341`；`src/app/actions/auth-security-actions.ts:224-235`；`.github/workflows/ci.yml:18` | `RATE_LIMIT_PROVIDER=cloudflare_waf` 時，app 內**所有**限流都直接放行，包括以 userId 為 key 的 MFA 驗證（5 次／分）、復原碼重產、magic link、成員邀請。preflight 卻把 WAF 當成合格的 production 設定。WAF 只能按來源 IP 計數，無法做每帳號限制。 | 密碼外洩後，攻擊者分散 IP 暴力猜 TOTP（±1 窗口，每次約 3/10⁶）沒有帳號層上限。B02-01 修好之後，這會是 admin 的下一道弱點。 | 讀碼即可確認。 | 帳號層的限流改用 DB 或 Upstash，不受 provider 影響（例如在 `UserMfaFactor` 記失敗次數並鎖定）。確認 production 實際使用哪個 provider。 | S–M | 是（確認 provider） | 建議是 |
| B02-06 | MINOR | `src/app/actions/vendor-member-actions.ts:58-66,92-93` | 任何自助註冊的 owner 都能用「新增成員」探測 email：回 `error=platform_user` 代表是平台 admin，回 `inactive_user` 代表已停權。若 email 屬於其他租戶的有效使用者，系統會直接建立 `status: active` 的成員資格，沒有邀請接受流程。 | 可以跨租戶列舉帳號，並精準找出平台 admin email 拿去做釣魚。也能在使用者不知情下把他加進陌生租戶。 | 註冊新商家後，對已知的 admin email 送出邀請，觀察回傳的 error 參數。 | 改成邀請 token 並需對方接受。所有分支回同一則訊息。 | M | 否 | 否 |
| B02-07 | MINOR | `src/lib/student-portal-auth.ts:16-19,283-347` | 學員 portal session 是加密的無狀態 bearer，TTL 30 天，伺服器端無法撤銷。`logoutStudentPortalAction` 只刪 cookie。 | cookie 外洩（共用裝置、XSS）後 30 天內都有效。退款、封鎖、email 變更都無法讓 session 失效。 | 讀碼即可確認。 | 加 DB session 表或 per-customer revocation epoch，並縮短 TTL。 | M | 否 | 否 |
| B02-08 | MINOR | `src/lib/sensitive-data.ts:6-19`；`src/lib/env.ts:87-98` | MFA secret、LINE／Meta 憑證、PII envelope、學員 session 的加密金鑰都從 `CSRF_SECRET` 衍生（非 production 會退回 `JOB_SECRET`）。envelope 只有 `v1`，沒有 key id，所以無法輪替。註：銀行帳號另用 `BANK_ACCOUNT_KEYRING_JSON`（`bank-account.ts:5,120`），系統地圖第 10 節第 7 點這部分不精確。 | CSRF_SECRET 外洩加上 DB 外洩，就能解出全部 MFA secret 與憑證；要輪替 CSRF_SECRET 也會讓既有密文全部失效。preflight 有強制 production 用獨立且至少 32 bytes 的值，算有緩解。 | 讀碼即可確認。 | 改用獨立的 `DATA_ENCRYPTION_KEYRING`，envelope 帶 kid，沿用 bank-account 的 keyring 模式。 | M | 是 | 否（但越晚改越貴） |
| B02-09 | MINOR（需驗證） | `src/app/api/cloudflare/direct-upload/route.ts:5-16`、`api/cloudflare/live-inputs`、`api/admin/ops/cloudflare/direct-upload/route.ts:10-53`、`api/admin/ops/test-*`；`src/lib/api-security.ts:30-32` | `JOB_SECRET` 是一把萬能 bearer，可用在 production 上能呼叫、且 body 帶任意 vendorId 的跨租戶端點：建立或替換任何租戶的影片、Live Input，或查詢任一 videoId 的狀態。payuni ops 有 `isWp4BoundNonProductionRuntime` 限制，production 會回 404，這部分沒問題（`wp4-runtime-boundary.ts:20-24,42-51`）。 | 若 production 與 Preview（GitHub Actions 24 個 workflow 會用）共用同一個 `JOB_SECRET` 值，Preview 端外洩就等於 production 跨租戶寫入權限外洩。 | 需 owner 確認 Vercel 各環境的 secret 是否不同。 | 依用途拆分 secret（cron、jobs、ops、cloudflare），production 值不得與 Preview 相同。評估 `/api/cloudflare/*` 這組只靠 JOB_SECRET 的端點是否應從 production 移除。 | S | 是 | 建議是 |
| B02-10 | NIT | `src/app/api/interaction-scripts/upsert/route.ts:11-13`；`src/app/api/orders/shipping/route.ts:4-17` | 303 轉址的 base 直接取自請求的 `Origin` header。目前 `assertServerActionSecurity` 會先拒絕外來 Origin，所以實際上無法利用，但寫法脆弱。 | 日後若有人改成「失敗時回傳錯誤路徑」而不是 throw，就會變成 open redirect。 | — | 改用現成的 `trustedRequestOrigin()`（`api-security.ts:86-90`）。 | S | 否 | 否 |
| B02-11 | NIT | `src/lib/csrf.ts:65-68`；`src/lib/api-security.ts:102` | Origin 與 Referer 都缺少（或 Origin 為 `null`）時，origin 檢查直接放行。Server Action 仍要求 session 綁定的 CSRF token，所以目前無法利用。 | 只用 `requireSameOriginRequest`、沒有 client header 也沒有 token 的 route，將來容易出現 CSRF 缺口。 | — | 狀態變更請求缺少 Origin 時一律拒絕，或統一要求 client header。 | S | 否 | 否 |
| B02-12 | NIT | `src/app/actions/consultation-actions.ts:381,442`；`interaction-actions.ts:893`；`funnel-operations-actions.ts:7` | `"use server"` 檔 export 了非 action 的 helper，Next 會把它們當成公開的 Server Action 端點。`reserveConsultationBooking` 會繞過 CSRF 與 zod 包裝；只是因為需要傳入 db 物件，目前無法利用。`getConsultationSlots` 是公開讀取且沒有限流。 | 增加不必要的攻擊面。 | — | helper 移到 `src/lib`，`"use server"` 檔只 export 真正的 action。 | S | 否 | 否 |
| B02-13 | NIT | `src/app/r/[code]/route.ts:9-29`；`src/lib/platform-referral.ts:32` | 推薦短連結沒有限流，每次 GET 都寫一筆 `PlatformReferralClick`。 | DB 被灌資料、推薦點擊數被灌水。 | — | 加 `checkRateLimit`，或用 visitor 加時間桶去重。 | S | 否 | 否 |
| B02-14 | NIT | `prisma/schema.prisma:68-84`（Vendor 沒有狀態欄位）；`src/lib/auth.ts:42-51,14` | 平台無法凍結整個租戶，只能逐一停用使用者。session cookie 沒有 `__Host-` 前綴。admin session 14 天，MFA 驗證一次就整段有效，敏感操作沒有重新驗證。 | 應變能力與 session 強度不足。 | — | 新增 `Vendor.suspendedAt` 並在 `chooseVendor` 檢查。cookie 改名 `__Host-celebrate_session`。admin 縮短 TTL，敏感操作加 step-up。 | M | 是 | 否 |

### 10 條「grep 不到防護」route 的確認結果
| Route | 結論 |
|---|---|
| `__celebratedeal_wp187_fingerprint.json` | 刻意公開，只回固定的 lineage 常數，沒有敏感資料。 |
| `api/billing/plans/select` | 防護在 `createPlatformPlanCheckout`（`platform-plan-checkout.ts:269-270`）：CSRF 加 `requireVendorOwnerFinance`，價格只從伺服器讀。沒問題。 |
| `api/funnel/operations/reports` | `scopedPage`（`funnel-operations-service.ts:17-23`）：manager 角色，並用 vendorId 加 projectId 綁定。沒問題。 |
| `api/health` | 公開，只回 ok 或 failed 與延遲。沒問題。 |
| `api/interaction-scripts/upsert` | 委派給 `upsertInteractionScriptAction`（CSRF 加 manager 角色）。有 B02-10 的 NIT。 |
| `api/team-funnel/partner-page-actions`、`template-actions` | 委派給有 CSRF、`requireTeamFunnelActor`、vendor 加 team 綁定的 Server Action。沒問題。 |
| `lp/[slug]/[stepPath]/play` | 只處理已發布頁面（`loadPublicLandingPage`）加伺服器時間閘，轉址是相對路徑。沒問題。 |
| `portal/notify.link/[...target]` | 用 canonical URL 轉址，live 有綁 vendorId 與狀態。目標頁本身仍驗 session。可以由 vendorId 查到 slug，影響很低。 |
| `r/[code]` | 刻意公開。有 B02-13 的 NIT。 |

### `/api/admin/ops/**`（28 條）
- 22 條 payuni：一律先檢查 `requireJobSecret`，再檢查 `isWp4BoundNonProductionRuntime`（VERCEL_ENV=preview、PAYUNI_ENV=sandbox、WP4_SANDBOX_EXECUTOR_ENABLED、staging project、DB identity），再比對 source SHA、拒絕帶 query 或 body。production 一律 404。
- `wp4-session` 只能幫固定的 fixture owner 建 MFA-verified session（`auth.ts:142-167`）。
- 其餘 6 條（cloudflare×2、provider-runtime、test-*）在 production 上可以呼叫，見 B02-09。

### CSRF／session／cookie 結論
- CSRF token 是 HMAC 加上 session fingerprint 綁定，TTL 2 小時，比對用 timing-safe。merchant JSON API 要求 client header、Origin 與 `x-csrf-token` 三者都要有。設計合理。
- 主 session：隨機 32 bytes，DB 只存 sha256，httpOnly、SameSite=Lax、production 開 Secure，TTL 14 天。重設密碼與停用成員時會撤銷 session。
- 學員 portal、buyer support、affiliate portal 三種身份的 cookie 分開。affiliate portal 沿用主 session，問題見 B02-02。

### Supabase／RLS 結論
- 沒有任何 RLS policy，也沒有 DB 層的租戶隔離。Prisma 以 owner 角色連線，會繞過 RLS。
- 應用層只要漏掉一處 `vendorId` 綁定，就可能外洩：訂單與收件 PII（`CommerceOrder*`、`ShippingFulfillment`）、客服案件（`SupportCase*`）、付款參考（`PaymentMethodReference`）、寄信紀錄（`EmailDelivery`）、聯盟收款人（加密的銀行與稅籍資料）、佣金帳本、直播聊天與私訊、學員學習進度。DB 層不會有任何阻擋。

### 公開端點結論
- `/lp`、`/live`、`/form`、`/p` 都經過已發布或可用的查詢條件（`publicLandingPageCandidateWhere`、`publicLiveAvailabilityWhere`、`isActive` 加 sales project published），傳給 client 的資料是挑過欄位的 projection。
- `/checkout/[vendorId]/[productId]` 要求 `isActive` 加 `fulfillmentTypeConfirmed` 加 `priceCents>0`，且 vendorId 與 productId 綁在同一個查詢裡（`api/payments/checkout/route.ts:767-774`）。未掛在頁面上的 active 商品仍可以直接結帳，請 owner 確認這是預期行為。
- ID 都是 cuid，加上限流，列舉風險低。

## 第二租戶測試缺口
既有覆蓋不少：e2e 有 `admin-cross-tenant-*`、`owner-cross-tenant-*`、`accountant-foreign-*` 等 20 多支 spec；`tenant-ledger-invariants`、`team-funnel-access`、`affiliate-portal.db`、`course-community.db` 等都有。但以下高風險 action 在 action 或 lib 測試中**找不到**外租戶否定案例：

1. `vendor-member-actions.ts`（新增、停用、重寄邀請）：完全沒有測試檔。
2. `team-membership-actions.ts`（`addTeamMemberAction`、`transferTeamMemberAction`、`setTeamUplineAction`）：沒有外租戶 teamId 或 vendorMemberId 的案例。
3. `merchant-affiliate-payout-policy-actions.ts`：沒有外租戶案例。
4. `recordAffiliatePayoutOutcomeAction`（`actions.ts:1739`）：沒有「外租戶 payoutId」和「accountant 角色濫用」的案例。
5. `funnel-automation-actions.ts`／`funnel-automation-service`：沒有外租戶 pageId 或 ruleId 的案例。
6. `affiliate-portal-actions.ts`（`setAffiliatePortalAccessAction`）：沒有 action 層測試（lib DB 測試有）。
7. `course-curriculum-actions.ts`：沒有測試檔。
8. `form-submission-search-actions.ts`（PII 搜尋）：沒有斷言 vendorId 綁定。
9. 平台層 `course-payout-actions`、`platform-referral-payout-actions`、`affiliate-actions`：沒有「商家 finance 角色被拒」的案例。
10. 身份混用：沒有「只有 portal 授權的成員不能進後台／客服／佣金頁」的負向測試（對應 B02-02）。
11. MFA：缺少「沒有 factor 的 admin 被拒」（PR #436）與「沒有 factor 的商家 owner 執行高風險 action」的案例。
12. DB 層：沒有斷言「所有表都開 RLS，且 anon／authenticated 沒有權限」的 catalog 測試（對應 B02-03）。

## 給 ROADMAP 的三句結論
1. 封測前必須合併 PR #436，並確認 production 所有平台 admin 都已註冊 MFA。目前 master 只靠密碼就能取得跨租戶退款、出款與銀行帳號匯出的權限。
2. 應用層的 vendor ownership 綁定一致且有大量測試，沒找到可直接利用的跨租戶 IDOR。真正的結構風險是 affiliate／團隊夥伴共用後台 `VendorMember` 角色，需要 owner 決定是否新增最小權限的 partner 身份。
3. DB 層沒有租戶隔離，而且有一半的表沒開 RLS。建議用一個 forward migration 加 CI catalog 測試補上 Data API 的預設拒絕，同時把帳號層 MFA 限流、加密金鑰輪替、JOB_SECRET 跨環境隔離排進封測後第一批強化項目。
