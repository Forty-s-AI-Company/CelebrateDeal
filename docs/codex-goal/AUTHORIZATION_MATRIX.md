# CelebrateDeal Route × Role × Tenant × MFA Matrix

最後更新：2026-07-25 19:25（Asia/Taipei）

基準 revision：`35d8f59341bc`

## API／route handlers

| Route 群組 | 數量 | 呼叫者／驗證 | Tenant／resource boundary | MFA | 同路徑測試 | 本輪判定 |
|---|---:|---|---|---|---|---|
| Vendor invoice CSV | 1 | authenticated vendor member | query 強制目前 `vendorId`；CSV injection neutralization | 未在 route 強制 | 有 | tenant boundary 通過；MFA 依 MVP 規格不強制 |
| Platform payout CSV | 1 | `requireFinanceAdmin` | platform-level batch | 強制 setup + session verification | 有 | 通過 |
| Admin ops／preflight／job | 9 | timing-safe `JOB_SECRET` | platform infrastructure；payload schema | 不適用 | 9/9 | 通過 |
| Public affiliate click | 1 | same-origin + client marker + rate limit | vendor/live existence；server visitor cookie；attribution policy | 不適用 | 有 | tenant boundary 通過；referral proof 為 D-002 |
| Public analytics | 1 | same-origin + client marker + rate limit | vendor/live pair exists | 不適用 | 有 | tenant boundary 通過；event authenticity 為 D-001 |
| Password reset request／confirm | 2 | same-origin + client marker + rate limit；confirm 另驗 token | account existence 不外洩；token conditional consume | 不適用 | 2/2 | static/unit＋isolated DB sequential/concurrent regression 通過 |
| Cloudflare browser ops | 2 | `JOB_SECRET` | provider account scope 由 env/runtime 管理 | 不適用 | 2/2 | code boundary 通過；external binding 為 Manual Exception |
| Cloudflare Stream webhook | 1 | official signature verification | provider UID 對應既有 Video | 不適用 | 有 | 通過 |
| Public form submission | 1 | same-origin／native form rule + rate limit | form/live binding；blacklist；immutable duplicate attribution | 不適用 | 有 | 通過 |
| Health | 1 | public read-only | 只回傳安全 DB state/category | 不適用 | 有 | 通過 |
| Public checkout | 1 | same-origin + client marker + rate limit | active product + vendor；lead/live；signed attribution cookie | 不適用 | 有 | pure/route＋payment logical-order isolated DB concurrency 通過 |
| CSP report | 1 | public + rate limit + bounded payload | 僅監控資料 | 不適用 | 有 | 通過 |
| Team Funnel authenticated APIs | 6 | same-origin；domain layer `requireTeamFunnelActor` | vendor + active membership + team relationship + resource ownership | 依 MVP 不強制 | 6/6 | policy tests 存在；webinar mutation E2E 尚待補 |
| Payment webhook | 1 | provider signature | provider event idempotency + payment/order invariants | 不適用 | 有 | pure/route＋isolated DB late/replay/concurrency/over-refund regression 通過 |

API route 總數：27。每一條 route 都有同路徑 `route.test.ts`；「有測試」不等於所有 role/tenant branch 已完整，缺口仍列在本文末。

## Server actions

| Action 群組 | 數量 | CSRF | Auth／role | Tenant／ownership | MFA |
|---|---:|---|---|---|---|
| Login／password reset | 3 | 全部 | public credential/token flow | account enumeration 防護 | 不適用 |
| Authenticated self-service／MFA／session | 10 | 全部 | `requireAuth` 或 session revoke | current user only | verification action 本身 |
| Vendor owner membership／plan | 4 | 全部 | `requireVendorOwner` | current vendor | 依 MVP 不強制 |
| Vendor operational CRUD | 17 | 全部 | `requireVendorManager` | current vendor + resource query | 依 MVP 不強制 |
| Team Funnel actions | 4 | 全部 | actor/membership policy | team relationship + resource ownership | 依 MVP 不強制 |
| Platform finance／refund／retry | 9 | 全部 | `requireFinanceAdmin` | platform scope | 強制 setup + session verification |

以 static inventory 解析到 47 個 exported async actions，全部先呼叫 `assertServerActionSecurity`。Team Funnel action 的 actor/tenant guard 位於 domain layer，不應僅從 route 檔案判斷為 public。

## Role 與 MFA 現況

| Role | Vendor read | Vendor operational write | Vendor owner action | Platform finance | MFA 現況 |
|---|---|---|---|---|---|
| platform_admin | 無 vendor 時不進 vendor app | 否 | 否 | 是 | `/admin/**` 強制 |
| owner | 是 | 是 | 是 | 否 | 可自願啟用；MVP 未強制 |
| admin | 是 | 是 | 否 | 否 | 可自願啟用；MVP 未強制 |
| accountant | 是 | 否 | 否 | 否 | 可自願啟用；MVP 未強制 |
| anonymous | 公開頁／表單／analytics／checkout only | 否 | 否 | 否 | 不適用 |

`CELEBRATEDEAL_PLAN.md` 寫「平台與財務權限強制 MFA」，但 `admin-mfa-hardening-plan.md` 的 MVP Phase B 僅要求 platform admin 進 `/admin/**` 強制，商家 finance role 延後到 100 個付費商家後。這是規格一致性決策 D-004，不在本輪擅自把所有 vendor 使用者鎖出系統。

## 已證明的負向邊界

- Platform finance 拒絕 owner/admin/accountant，且未 setup/verify MFA 時拒絕 platform admin。
- Vendor manager 拒絕 accountant 的 operational write。
- Team Funnel policy 覆蓋 owner、direct upline、unrelated member、foreign team/vendor、inactive membership。
- Template edit page 現已限制 content owner membership；同隊其他成員不能讀取版本或 webinar metadata。
- 所有 public JSON write route 使用 strict schema/body bound；高頻端點有 rate limit。
- Provider webhook 使用 signature，而不是 browser session 或 Referer。

## 尚待補證

1. Webinar binding 的 release-mode E2E negative case。
2. Browser journey 中 owner/admin/accountant/platform_admin 的導覽與直接 URL 負向矩陣。
3. D-001 analytics authenticity、D-002 referral proof、D-003 public contact Email、D-004 vendor finance MFA rollout。
4. Supabase residual platform-owner ACL 等外部 Manual Exceptions。

## 安全聲明

本 inventory 僅讀取 repository 與執行本機 static/targeted tests；未連線外部資料庫、未部署、未 stage/commit/push，也沒有付款、退款、Email 或 Webhook 重送。
