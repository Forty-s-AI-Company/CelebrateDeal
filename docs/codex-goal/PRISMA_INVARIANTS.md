# CelebrateDeal Prisma Invariant Inventory

最後更新：2026-08-10（Asia/Taipei）

基準 revision：`35d8f59341bc`

## Inventory 基準

| 項目 | 結果 |
|---|---:|
| Prisma models | 89 |
| Migration directories | 53 |
| Isolated PostgreSQL version | 18.3 |
| Isolated database binding | loopback-only |
| Applied migrations in isolated DB | 53/53 current chain；由 no-dotenv mirror 在 loopback disposable PostgreSQL 完整 forward-apply 與 status 驗證 |
| DB-backed security regression | 原有 3 files／45 tests；另新增 form concurrency 與 tenant-ledger FK 2 files／2 tests |

## Model 分類

| 類別 | 數量 | Models |
|---|---:|---|
| Identity／tenant root | 8 | `Vendor`、`User`、`UserSession`、`UserMfaFactor`、`UserRecoveryCode`、`PasswordResetToken`、`VendorMember`、`TrackingSetting` |
| Content／live／lead | 18 | `Video`、`ImageAsset`、`Product`、`RegistrationForm`、`FormSubmission`、`Live`、`LiveProduct`、`LiveViewerSession`、`LiveStudioDraft`、`LiveReminderReconciliationJob`、`LiveChatMessage`、`LiveNotificationRule`、`MessageTemplate`、`AnalyticsEvent`、`InteractionRole`、`InteractionScript`、`InteractionEvent`、`Blacklist` |
| Affiliate／billing／payment／ops | 33 | `Affiliate`、`AffiliateClick`、`BillingPlan`、`VendorSubscription`、`PlatformReferralCode`、`PlatformReferralClick`、`PlatformReferralAttribution`、`PlatformReferralCommission`、`PlatformReferralCommissionLedgerEntry`、`PlatformReferralPayout`、`PlatformReferralPayoutBatch`、`VendorUsageLimit`、`UsageRecord`、`StreamUsageLedgerEntry`、`StreamUsageAllocationEntry`、`StreamUsageReconciliation`、`StreamOperationsAlert`、`Invoice`、`Settlement`、`PayoutBatch`、`PayoutItem`、`PaymentAccount`、`PaymentMethodReference`、`PaymentTransaction`、`InventoryReservation`、`WebhookEvent`、`RefundRecord`、`AuditLog`、`EmailDelivery`、`EmailSuppression`、`AffiliateCommission`、`AffiliatePayout`、`AffiliateCommissionLedgerEntry` |
| Team Funnel／attribution | 14 | `SalesTeam`、`TeamMembership`、`TeamMembershipRelationship`、`TeamFunnelTemplate`、`TeamFunnelTemplateVersion`、`TeamFunnelTemplateFieldLock`、`TeamFunnelTemplateProductSlot`、`PartnerFunnelPage`、`PartnerFunnelPageShareSetting`、`PartnerLiveShare`、`PartnerProductSlotOverride`、`TeamClickAttribution`、`TeamLeadAttribution`、`TeamConversionAttribution` |
| Course commerce／revenue share | 3 | `CourseCommissionAllocation`、`CourseCommissionLedgerEntry`、`CoursePayout` |
| Commerce order／fulfillment | 10 | `CommerceOrder`、`CommerceOrderItem`、`CommerceOrderEvent`、`CommerceOrderRefund`、`ShippingFulfillment`、`CommerceEntitlement`、`ServiceFulfillment`、`VendorDeliveryUrlAllowlist`、`ProductDeliveryConfig`、`CommerceOrderItemDeliverySnapshot` |
| Buyer support／refund handoff | 5 | `SupportCase`、`SupportCaseEvent`、`BuyerSupportOrderGrant`、`SupportRefundHandoff`、`SupportRefundHandoffRefund` |

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
| `20260728183500_harden_affiliate_commission_identity_and_status` | canonical commission idempotency and status policy |
| `20260728210000_add_affiliate_commission_accounting_ledger` | append-only affiliate commission accounting ledger |
| `20260806090000_affiliate_payout_contract` | fail-closed AffiliatePayout vendor/affiliate/month identity and non-negative amount contract |
| `20260807080000_course_fg_allocation` | course F/G immutable allocation snapshot, tenant bindings, append-only refund/dispute ledger |
| `20260808030000_stream_usage_attribution_allocation` | stream usage policy snapshot and tenant-scoped internal allocation child ledger |
| `20260808040000_partner_live_share` | opaque target-promoter Live share link with tenant/source-page binding and revocation |
| `20260807100000_course_payout_read_model` | course F/G recipient/month payable read model with fail-closed paid/void outcomes |
| `20260807110000_platform_referral_attribution` | platform plan referral code/click and immutable subscription attribution snapshot, separate from merchant Affiliate |
| `20260807130000_stream_usage_attribution_ledger` | immutable server-validated playback seconds with live/page/member attribution and event replay identity |
| `20260807150000_platform_referral_commission_ledger` | verified subscription payment commission accrual and append-only refund ledger, separate from merchant Affiliate |
| `20260807170000_platform_referral_payout_read_model` | platform referral owner/month payable read model and local payout batch grouping without external transfer |
| `20260807190000_checkout_idempotency` | nullable legacy-safe checkout key with vendor-scoped unique replay identity |
| `20260807210000_affiliate_gross_net_reference` | separate gross commission base and post-fee/refund net reference snapshot |
| `20260807220000_course_gross_net_reference` | separate course gross sales base and provider-net reference snapshot |
| `20260807221000_platform_referral_initial_only` | one platform referral commission per new subscription; renewal callbacks do not create a second commission |
| `20260807222000_affiliate_payout_gross_net_reference` | additive nullable AffiliatePayout gross/net reference columns for current schema compatibility |
| `20260807230000_live_viewer_quota_admission` | short-lived opaque live viewer session hash, composite vendor/live binding and expiry index for server-side quota admission |
| `20260808010000_live_product_tenant_binding` | backfill and enforce vendor-scoped LiveProduct parent relations, unique identity, and lookup index |
| `20260808020000_live_resource_tenant_binding` | fail-closed legacy preflight and vendor-scoped composite Live→Video／RegistrationForm foreign keys while preserving SET NULL deletion behavior |
| `20260808050000_platform_referral_dispute_ledger` | platform referral dispute case identity and opened／released／lost append-only ledger lifecycle; lost chargeback reverses only the remaining payable balance |
| `20260808060000_payment_method_reference` | opaque provider payment-method reference scoped to vendor or team membership; verified and unexpired reference required before Stream quota enablement |
| `20260808070000_merchant_payout_outcome_reference` | merchant payout paid outcome requires a sanitized human transfer reference |
| `20260808073000_affiliate_payout_outcome_reference` | affiliate payout paid outcome requires a sanitized human transfer reference |
| `20260808080000_g7_03_media_assets` | tenant-owned image assets and provider-ready video metadata |
| `20260808094500_g7_03_live_studio_drafts` | tenant-owned resumable live studio drafts with optimistic revision and expiry |
| `20260808110000_g7_04_commerce_orders` | order snapshots, refund events, and physical／digital／service fulfillment records |
| `20260808203000_g7_07_email_delivery` | durable Email queue, retry state, recipient suppression, and PII-safe delivery identity |
| `20260808220500_g7_09_support_cases` | tenant-scoped support cases and immutable case events |
| `20260808233000_g7_09c_buyer_support_access` | buyer support order access grants and refund handoff records |
| `20260808235500_g7_10_product_catalog_safety` | product revision, fulfillment confirmation, and catalog safety constraints |
| `20260809000000_g7_12_stream_usage_reconciliation` | provider usage reconciliation records and operations alerts |
| `20260809010000_g7_13_analytics_authenticity` | server-owned analytics authenticity and replay identity |
| `20260809020000_g7_13b_form_submission_verification` | one-time form submission verification state and token identity |
| `20260809030000_g7_21_live_reminder_email` | live reminder scheduling fields and delivery linkage |
| `20260809040000_g7_23_live_reminder_reconciliation` | durable live reminder revision and reconciliation state |
| `20260809050000_g7_26_split_refund_handoff` | split refund state and support handoff metadata |
| `20260809060000_g7_28_affiliate_payout_outcome_reason` | affiliate payout outcome reason snapshot |
| `20260809070000_g7_35_shipping_refund_states` | shipping and refund lifecycle state fields |
| `20260809071000_g7_35_shipping_refund_lifecycle` | shipping and refund lifecycle events |
| `20260809072000_g7_48_product_delivery_snapshot` | immutable buyer delivery snapshot |
| `20260810051000_g7_54_form_submission_search_indexes` | pg_trgm GIN indexes for tenant-scoped name／Email／phone contains search |
| `20260810060000_g7_55_email_delivery_operations` | manual retry audit metadata and tenant-scoped status／trigger filtering indexes |
| `20260815090000_g8_01_one_stop_webinar_domain` | webinar lifecycle、scheduled chat、notification rules and post-live delivery domain |
| `20260815100000_g8_02_interaction_role_semantics` | official／audience interaction role semantics and scheduled-role marker |
| `20260817120000_wp2_brand_sender_settings` | vendor sender identity、support Email and contact URL settings |

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
| Playback usage event 單一且不可竄改 | `eventId @unique`；live/vendor 與 page/member attribution snapshot | route/domain 驗證；相同 event replay 不新增 row，payload drift fail closed |
| Live viewer admission 不跨 tenant/live 且不保存 raw token | `LiveViewerSession.tokenHash @unique`；composite `[vendorId,liveId]` foreign key；expiry indexes | Serializable slot count；same-live token refresh；credits threshold fail closed；cookie 只保存 server-issued opaque token | route/domain/component unit + 24/24 loopback migration |
| Platform referral commission 不與 merchant affiliate 混用 | `PlatformReferralCommission.paymentTransactionId @unique`；獨立 commission ledger 與 owner snapshot；ledger `disputeCaseId` index | 僅讀取 server-created transaction metadata 與 immutable subscription attribution；refund／dispute ledger 不能低於零，chargeback lost 只沖銷一次 |
| Platform referral payout 不與 merchant/course payout 混用 | `PlatformReferralPayout.ownerUserId/monthKey @unique`；獨立 batch relation | payout 只彙整 platform referral ledger balance；batch 不保存銀行 credential、不執行 provider transfer |
| Checkout retry 不重複建立交易 | `PaymentTransaction @@unique([vendorId,checkoutIdempotencyKey])`；nullable 只保留 legacy rows | checkout route 要求 UUID key；SERIALIZABLE reservation 先檢查既有 key，完成後 replay 保存的 provider payload；key 綁定商品／金額／幣別 | route unit + loopback PostgreSQL concurrent duplicate regression |

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
| DB-I06 | LiveProduct tenant binding | 已加入 `vendorId`，並由 migration backfill legacy rows | composite FK 拒絕跨 vendor live/product 綁定 | action／seed writer 都傳入 authenticated vendor；migration preflight 對 missing parent 與 cross-tenant legacy row fail closed | 已完成本機 candidate migration 與 composite FK enforcement | 24/24 disposable migration；valid insert 與兩種 cross-vendor insert rejection PASS；外部 aggregate preflight 仍 pending |
| DB-I07 | Live/Video/Form tenant binding | 已新增 Video／RegistrationForm `[vendorId,id]` unique；Live 保留單欄 SET NULL FK並加 composite tenant FK | database bypass write 不能跨 vendor 綁定影片或表單；legacy mismatch 在 migration 前即 fail closed | server action query 同時限制 vendor/resource；資料庫再強制 composite binding | 已完成本機 candidate migration、preflight 與 valid/cross-tenant/delete regression | 25/25 disposable migration；外部 aggregate preflight 仍 pending |
| DB-I08a | Stream usage attribution allocation | `StreamUsageLedgerEntry` snapshot policy version/mode；新增 tenant-scoped `StreamUsageAllocationEntry` child ledger，raw provider aggregate 與 internal allocation 分離 | heartbeat replay／payload drift 不可重複建立 allocation；custom recipient 不可跨 vendor/team；allocation bps 必須合計 10000 | same transaction nested create、event unique idempotency、composite FK 與 recipient key unique | local contract and disposable semantic runner pending in FUNC-28；external aggregate preflight not requested |
| DB-I08b | Partner Live share binding | 新增 `PartnerLiveShare`，以 hash 保存 opaque token，並以 vendor/team/live/source page/target promoter composite FK 綁定 | B 可不建客製頁取得專屬 Live 連結；停用／過期／跨租戶／錯誤 webinar binding 必須 fail closed；raw token 不落庫 | service 以 authenticated A、direct-downline relationship、active lifecycle 驗證；public click／lead／usage 都重新解析 token | loopback migration 與 disposable negative regression；external aggregate preflight not requested |
| DB-I08 | Video provider identifiers | Cloudflare UID/playback 欄位沒有 unique | provider callback 可能對應多筆 Video | webhook `take:2`，ambiguous mapping 409 fail closed；vendor 不能編輯 provider 欄位 | provider binding table或可表達 null-safe 的 partial unique indexes | 釐清 live input與stream UID 是否允許共用／跨欄相等 |
| DB-I09 | Monetary/status fields | 金額為 `Int`、狀態為 `String`，沒有 DB CHECK | bypass service 可寫負數、非法狀態或 refunded>gross | runtime schema + transaction invariants | reviewed SQL CHECK constraints | existing violation aggregate=0；列出所有合法狀態 |
| DB-I10 | FormSubmission live/form tenant | submission 沒有 vendorId，live/form 為獨立 FK | bypass route 可把 live 與 form 跨 vendor 配對 | public route 驗證 live.vendorId/formId | 加 tenant snapshot 或 composite relation需資料模型決策 | 決定是否將 vendorId 正規化進 submission |

## Migration policy

1. 本 inventory 不直接建立或套用 Production migration。
2. 每個 constraint migration 先在 Staging/Production 執行只讀 aggregate preflight；任何 violation 必須先形成可審查的資料修復計畫，不能讓 migration 隱性刪改資料。
3. DB-I03、DB-I04、DB-I05、DB-I06、DB-I07 已完成本機候選 migration 與 isolated DB negative regression；DB-I08a 的 stream allocation migration 只在 FUNC-28 disposable scope 驗證，外部 aggregate preflight 仍未執行；下一順位仍是授權外部只讀 aggregate preflight，再處理 DB-I01／DB-I02 idempotency 與 DB-I08～DB-I10 的既有產品/模型 gaps。
4. 所有候選 migration 禁止 `DROP TABLE`、資料刪除、欄位 rename 或 down migration；先在 loopback-only PostgreSQL 套用與負向驗證。
5. Prisma service role 的 server-side 流程必須保持正常；anon/authenticated Data API policy 不作為 server-side FK 的替代品。

## 驗收判定

- 91/91 models 已納入 identity、tenant、payment、form、Team Funnel、commerce、support 或 supporting/telemetry 類別。
- 56 migration directories 已納入 canonical inventory，並由乾淨的 loopback disposable PostgreSQL 完整 forward-apply。
- 已有 DB-backed concurrency：password reset、payment logical order、refund ledger、commission、Cloudflare status、form deterministic submission。
- DB-I03～DB-I07 已有本機 reviewed migration、backfill/preflight policy 與跨 tenant negative regression；尚未取得 Production/Staging aggregate preflight，也未獲外部 migration 授權。
- DB-I01、DB-I02、DB-I08～DB-I10 仍為可重現的 schema gap；未完成語意決策、aggregate preflight 與 reviewed migration 前，Q07 不能標為 100。

## WP-06 candidate review（2026-07-28）

- `20260725230000_encrypt_payout_bank_accounts`：local envelope/backfill/tenant binding 測試通過，但沒有 key version、rotation 或 old-key recovery 契約；候選 verdict 為 `REWORK_REQUIRED`。
- `20260725231500_harden_affiliate_commissions`：BPS CHECK、non-null source identity unique、dirty-data fail-closed、schema atomicity 與 forward recovery 在 disposable DB 通過；但 PostgreSQL 對 `sourceId IS NULL` 允許多筆，且 `status` 仍是未約束字串，候選 verdict 為 `REWORK_REQUIRED`。
- 退款 adjustment 的負數金額是既有可追溯 accounting 行為，不能以一條「所有 commission amount 必須非負」constraint 破壞；後續 schema policy 必須區分原始佣金與 adjustment rows。
