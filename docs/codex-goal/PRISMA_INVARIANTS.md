# CelebrateDeal Prisma Invariant Inventory

最後更新：2026-07-25 19:25（Asia/Taipei）

基準 revision：`35d8f59341bc`

## Inventory 基準

| 項目 | 結果 |
|---|---:|
| Prisma models | 51 |
| Migration directories | 11 |
| Isolated PostgreSQL version | 18.3 |
| Isolated database binding | loopback-only |
| Applied migrations in isolated DB | 11/11 |
| DB-backed security regression | 原有 3 files／45 tests；另新增 form concurrency 與 tenant-ledger FK 2 files／2 tests |

## Model 分類

| 類別 | 數量 | Models |
|---|---:|---|
| Identity／tenant root | 8 | `Vendor`、`User`、`UserSession`、`UserMfaFactor`、`UserRecoveryCode`、`PasswordResetToken`、`VendorMember`、`TrackingSetting` |
| Content／live／lead | 12 | `Video`、`Product`、`RegistrationForm`、`FormSubmission`、`Live`、`LiveProduct`、`MessageTemplate`、`AnalyticsEvent`、`InteractionRole`、`InteractionScript`、`InteractionEvent`、`Blacklist` |
| Affiliate／billing／payment／ops | 18 | `Affiliate`、`AffiliateClick`、`BillingPlan`、`VendorSubscription`、`VendorUsageLimit`、`UsageRecord`、`Invoice`、`Settlement`、`PayoutBatch`、`PayoutItem`、`PaymentAccount`、`PaymentTransaction`、`InventoryReservation`、`WebhookEvent`、`RefundRecord`、`AuditLog`、`AffiliateCommission`、`AffiliatePayout` |
| Team Funnel／attribution | 13 | `SalesTeam`、`TeamMembership`、`TeamMembershipRelationship`、`TeamFunnelTemplate`、`TeamFunnelTemplateVersion`、`TeamFunnelTemplateFieldLock`、`TeamFunnelTemplateProductSlot`、`PartnerFunnelPage`、`PartnerFunnelPageShareSetting`、`PartnerProductSlotOverride`、`TeamClickAttribution`、`TeamLeadAttribution`、`TeamConversionAttribution` |

## Migration chain

| Migration | 主要 invariant |
|---|---|
| `20260709090000_postgresql_baseline` | PostgreSQL baseline schema |
| `20260709110000_auth_sessions` | server-side sessions |
| `20260709113000_vendor_member_status` | membership lifecycle |
| `20260709170000_password_reset_tokens` | one-time reset token |
| `20260709193000_user_mfa` | factor/recovery code |
| `202607170001_team_funnel_domain` | team tenant/composite ownership |
| `20260721133000_inventory_reservations` | inventory reservation/payment binding |
| `20260724150000_harden_supabase_data_api` | RLS／API role hardening |
| `20260725112500_harden_tenant_ledger_foreign_keys` | refund／affiliate／payout tenant-ledger composite foreign keys |
| `20260725230000_encrypt_payout_bank_accounts` | bank account encryption |
| `20260725231500_harden_affiliate_commissions` | affiliate commission hardening |

## 已由資料庫強制的主要 invariants

### Identity／authentication

| Invariant | DB enforcement | 交易／程式 enforcement | 證據 |
|---|---|---|---|
| Vendor slug/email 唯一 | `@unique` | normalized create/update | schema + unit |
| User email 唯一 | `@unique` | normalized auth flow | schema + auth tests |
| Session token hash 唯一 | `@unique` | bounded expiry/revocation | schema + session tests |
| 每位使用者單一 MFA factor | `UserMfaFactor.userId @unique` | setup/verify state machine | schema + action tests |
| Password reset token hash 唯一 | `@unique` | conditional `usedAt: null` claim | isolated PostgreSQL concurrent consume |
| Vendor membership 唯一 | `@@unique([vendorId,userId])` | active member/role guard | schema + authorization matrix |

### Tenant／resource composition

| Invariant | DB enforcement | 狀態 |
|---|---|---|
| Product、Live、Affiliate、PaymentTransaction 可作 composite tenant reference | 各有 `@@unique([vendorId,id])` | 通過 |
| InventoryReservation vendor/product/payment 同 tenant | composite foreign keys | 通過 |
| Live team 與 seminar owner 同 team/vendor | composite foreign keys | 通過 |
| Team Funnel team/template/version/member/product/page 關係 | composite foreign keys + unique keys | 通過 |
| Click/lead/conversion attribution 單一來源 | unique affiliateClick/formSubmission/paymentTransaction keys | 通過 |
| Partner page 每 template/promoter 單份 | `@@unique([templateVersionId,promoterMembershipId])` | 通過 |
| Template version 序號唯一 | `@@unique([templateId,version])` | 通過 |
| Page slot override 單一 | `@@unique([pageId,productSlotId])` | 通過 |

### Payment／inventory／webhook

| Invariant | DB enforcement | 交易／狀態 enforcement | 證據 |
|---|---|---|---|
| 一筆 payment 只有一筆 inventory reservation | `paymentTransactionId @unique` | SERIALIZABLE reserve/commit/release | isolated DB concurrency |
| Provider webhook event 唯一 | `@@unique([provider,eventId])` | processed replay short-circuit + atomic retry claim | isolated DB route/concurrency |
| Payment status 不逆轉 | 無 enum/check constraint | logical status order + SERIALIZABLE transaction | isolated DB late callback |
| Refund 不超過付款、currency 一致 | 無 check constraint | transaction 內重新讀取 ledger、比較 remaining amount/currency | isolated DB over-refund/cross-month |
| Affiliate commission 不重複 | 無 unique constraint | payment SERIALIZABLE transaction 內 logical-order check | isolated DB concurrent webhook |
| Cloudflare provider status 單調 | 無 DB enum/check | conditional `updateMany` claim + transition resolver | isolated DB stale/recovery route |

### Public lead／form

| Invariant | DB enforcement | 程式 enforcement | 狀態 |
|---|---|---|---|
| 同 form/live/normalized-email 收斂為單筆 | deterministic `FormSubmission.id` primary key | pre-check + P2002 recovery | isolated DB concurrent request 通過；兩個 200 response、僅一個 duplicate、DB row count=1 |
| Lead attribution 每 submission 單筆 | `formSubmissionId @unique` | immutable `upsert(update:{})` | 通過 |
| Click attribution 每 vendor/click 單筆 | `@@unique([vendorId,affiliateClickId])` | immutable `upsert(update:{})` | 通過 |

## 已確認的 schema-level gaps

| ID | 範圍 | 目前 schema | 可造成的狀態 | 目前補償控制 | 最小候選修正 | 變更前必要證據 |
|---|---|---|---|---|---|---|
| DB-I01 | Payment order identity | `@@index([vendorId,orderNumber])`，沒有 unique | 相同 provider/order 可出現多筆，無 vendor callback 只能 fail closed | webhook/checkout 使用 transaction、server-generated order、ambiguous match 拒絕 | D-005：platform merchant 採 `[providerName,orderNumber]`；BYO 則需 account-scoped key | local duplicate aggregate=0；Production/Staging aggregate；merchant namespace 決策 |
| DB-I02 | Refund provider event | `@@index([paymentTransactionId,providerEventId])`，沒有 unique | future/direct write path 可重複記錄事件；直接 unique 又可能誤拒 provider trade-number fallback | payment webhook unique event + SERIALIZABLE ledger | D-006：拆分 idempotency/provider refund/event identity，或取得 provider 唯一性保證後加 compound unique | local duplicate aggregate=0；Production/Staging aggregate；PayUni partial-refund identifier semantics |
| DB-I03 | Refund tenant binding | 已在本機候選 migration 改為 composite FK `[vendorId,paymentTransactionId]` | 外部環境未套用前仍可能形成 vendor A refund 指向 vendor B payment | 現行 service 以 vendor/payment 一起查詢 | 本機 isolated DB 已套用候選 migration，跨 tenant write 為 Prisma `P2003` | local mismatch aggregate=0；Production/Staging 仍需只讀 aggregate preflight |
| DB-I04 | AffiliateCommission／AffiliatePayout tenant binding | 已在本機候選 migration 改為 nullable composite FK `[vendorId,affiliateId]` | 外部環境未套用前仍可能形成 vendor A ledger 指向 vendor B affiliate | 現行 domain query 綁 vendor | 本機 isolated DB 已套用候選 migration，兩種跨 tenant write 均為 Prisma `P2003` | local mismatch aggregate=0；Production/Staging 仍需只讀 aggregate preflight |
| DB-I05 | PayoutItem／Settlement tenant binding | 已為 Settlement 加 `[vendorId,id]` unique，PayoutItem 使用 composite FK | 外部環境未套用前 payout item vendor 仍可能與 settlement vendor 不一致 | payout service 由同一 vendor aggregate 建立 | 本機 isolated DB 已套用候選 migration，跨 tenant write 為 Prisma `P2003` | local mismatch aggregate=0；Production/Staging 仍需只讀 aggregate preflight |
| DB-I06 | LiveProduct tenant binding | join table沒有 `vendorId` | DB 可連接不同 vendor 的 live/product | action query 驗證目前 vendor | 加 `vendorId` 並改用兩個 composite FK | backfill tenant aggregate、zero mismatch |
| DB-I07 | Live/Video/Form tenant binding | `videoId`／`formId` 使用單欄 FK | bypass service 的 write 可跨 vendor 綁定資源 | server action query同時限制 vendor/resource | composite tenant FK；需要為 Video/RegistrationForm 建 tenant unique | zero mismatch aggregate |
| DB-I08 | Video provider identifiers | Cloudflare UID/playback 欄位沒有 unique | provider callback 可能對應多筆 Video | webhook `take:2`，ambiguous mapping 409 fail closed；vendor 不能編輯 provider 欄位 | provider binding table或可表達 null-safe 的 partial unique indexes | 釐清 live input與stream UID 是否允許共用／跨欄相等 |
| DB-I09 | Monetary/status fields | 金額為 `Int`、狀態為 `String`，沒有 DB CHECK | bypass service 可寫負數、非法狀態或 refunded>gross | runtime schema + transaction invariants | reviewed SQL CHECK constraints | existing violation aggregate=0；列出所有合法狀態 |
| DB-I10 | FormSubmission live/form tenant | submission 沒有 vendorId，live/form 為獨立 FK | bypass route 可把 live 與 form 跨 vendor 配對 | public route 驗證 live.vendorId/formId | 加 tenant snapshot 或 composite relation需資料模型決策 | 決定是否將 vendorId 正規化進 submission |

## Migration policy

1. 本 inventory 不直接建立或套用 Production migration。
2. 每個 constraint migration 先在 Staging/Production 執行只讀 aggregate preflight；任何 violation 必須先形成可審查的資料修復計畫，不能讓 migration 隱性刪改資料。
3. DB-I03、DB-I04、DB-I05 已完成本機候選 migration 與 isolated DB negative regression；下一順位為它們的外部只讀 aggregate preflight、DB-I06／DB-I07 tenant integrity，再處理 DB-I01／DB-I02 idempotency；最後處理 DB-I08～DB-I10 需要產品/模型決策的項目。
4. 所有候選 migration 禁止 `DROP TABLE`、資料刪除、欄位 rename 或 down migration；先在 loopback-only PostgreSQL 套用與負向驗證。
5. Prisma service role 的 server-side 流程必須保持正常；anon/authenticated Data API policy 不作為 server-side FK 的替代品。

## 驗收判定

- 51/51 models 已納入 identity、tenant、payment、form、Team Funnel 或 supporting/telemetry 類別。
- 11/11 migrations 已在 isolated PostgreSQL 套用。
- 已有 DB-backed concurrency：password reset、payment logical order、refund ledger、commission、Cloudflare status、form deterministic submission。
- DB-I03～DB-I05 已有本機 reviewed migration、zero-mismatch aggregate 與跨 tenant negative regression；尚未取得 Production/Staging aggregate preflight，也未獲外部 migration 授權。
- DB-I01、DB-I02、DB-I06～DB-I10 仍為可重現的 schema gap；未完成語意決策、aggregate preflight 與 reviewed migration 前，Q07 不能標為 100。

## WP-06 candidate review（2026-07-28）

- `20260725230000_encrypt_payout_bank_accounts`：local envelope/backfill/tenant binding 測試通過，但沒有 key version、rotation 或 old-key recovery 契約；候選 verdict 為 `REWORK_REQUIRED`。
- `20260725231500_harden_affiliate_commissions`：BPS CHECK、non-null source identity unique、dirty-data fail-closed、schema atomicity 與 forward recovery 在 disposable DB 通過；但 PostgreSQL 對 `sourceId IS NULL` 允許多筆，且 `status` 仍是未約束字串，候選 verdict 為 `REWORK_REQUIRED`。
- 退款 adjustment 的負數金額是既有可追溯 accounting 行為，不能以一條「所有 commission amount 必須非負」constraint 破壞；後續 schema policy 必須區分原始佣金與 adjustment rows。
