# CelebrateDeal Prisma Invariant Inventory

最後更新：2026-10-06（Asia/Taipei）

基準 revision：`4ed3b463`

> 下列「Inventory 基準」的 PostgreSQL 18.3 與 66/71 套用數是原始 revision 的歷史收據；此前候選曾於 PostgreSQL 17.10 disposable DB 完整套用當時的 80/80 migration，並將 `public` schema 還原至隔離容器。目前候選 chain 已增至 86，該歷史收據不代表新 migration、Staging 或 Production 已套用。
> 下列「Inventory 基準」的 PostgreSQL 18.3 與 66/71 套用數是原始 revision 的歷史收據；此前候選曾於 PostgreSQL 17.10 disposable DB 完整套用當時的 80/80 migration，並將 `public` schema 還原至隔離容器。目前候選 chain 已增至 87，該歷史收據不代表新 migration、Staging 或 Production 已套用。

## Inventory 基準

| 項目 | 結果 |
|---|---:|
| Prisma models | 148 |
| Migration directories | 108 |
| Isolated PostgreSQL version | 18.3 |
| Isolated database binding | loopback-only |
| Applied migrations in isolated DB | 66/71 current chain；既有 66 條由 CI 與本機 disposable PostgreSQL 完整 forward-apply 與 status 驗證；已合併的 5 條 automation／CRM／sales workspace migration 尚待 isolated DB forward-apply |
| DB-backed security regression | 原有 3 files／45 tests；另新增 form concurrency 與 tenant-ledger FK 2 files／2 tests |

## Model 分類

| 類別 | 數量 | Models |
|---|---:|---|
| Identity／tenant root | 10 | `Vendor`、`User`、`UserSession`、`UserPolicyConsent`、`UserMfaFactor`、`UserRecoveryCode`、`PasswordResetToken`、`UserEmailChangeRequest`、`VendorMember`、`TrackingSetting` |
| Content／live／lead | 24 | `Video`、`VideoArchiveState`、`ImageAsset`、`Product`、`RegistrationForm`、`RegistrationFormRetryDraft`、`FormSubmission`、`Live`、`LiveMediaSession`、`LiveProduct`、`LiveViewerSession`、`LiveStudioDraft`、`LiveReminderReconciliationJob`、`LiveChatMessage`、`LiveNotificationRule`、`LiveQuestion`、`LiveInteractionRun`、`LiveInteractionResponse`、`MessageTemplate`、`AnalyticsEvent`、`InteractionRole`、`InteractionScript`、`InteractionEvent`、`Blacklist` |
| Affiliate／billing／payment／ops | 35 | `Affiliate`、`AffiliateClick`、`BillingPlan`、`VendorSubscription`、`PlatformReferralCode`、`PlatformReferralClick`、`PlatformReferralAttribution`、`PlatformReferralCommission`、`PlatformReferralCommissionLedgerEntry`、`PlatformReferralPayout`、`PlatformReferralPayoutBatch`、`VendorUsageLimit`、`UsageRecord`、`StreamUsageLedgerEntry`、`StreamUsageAllocationEntry`、`StreamUsageReconciliation`、`StreamOperationsAlert`、`Invoice`、`Settlement`、`PayoutBatch`、`PayoutItem`、`PaymentAccount`、`PaymentMethodReference`、`PaymentMethodSetupIntent`、`PaymentTransaction`、`PayUniLiveProbe`、`InventoryReservation`、`WebhookEvent`、`RefundRecord`、`AuditLog`、`EmailDelivery`、`EmailSuppression`、`AffiliateCommission`、`AffiliatePayout`、`AffiliateCommissionLedgerEntry` |
| Team Funnel／attribution | 14 | `SalesTeam`、`TeamMembership`、`TeamMembershipRelationship`、`TeamFunnelTemplate`、`TeamFunnelTemplateVersion`、`TeamFunnelTemplateFieldLock`、`TeamFunnelTemplateProductSlot`、`PartnerFunnelPage`、`PartnerFunnelPageShareSetting`、`PartnerLiveShare`、`PartnerProductSlotOverride`、`TeamClickAttribution`、`TeamLeadAttribution`、`TeamConversionAttribution` |
| Course commerce／revenue share | 3 | `CourseCommissionAllocation`、`CourseCommissionLedgerEntry`、`CoursePayout` |
| Commerce order／fulfillment | 11 | `CommerceOrder`、`CommerceOrderItem`、`CommerceOrderEvent`、`CommerceOrderRefund`、`ShippingFulfillment`、`CommerceEntitlement`、`ServiceFulfillment`、`VendorDeliveryUrlAllowlist`、`ProductDeliveryConfig`、`CommerceOrderItemDeliverySnapshot`、`PostPurchaseCredit` |
| Buyer support／refund handoff | 5 | `SupportCase`、`SupportCaseEvent`、`BuyerSupportOrderGrant`、`SupportRefundHandoff`、`SupportRefundHandoffRefund` |
| LINE identity／delivery／draft | 5 | `LineOfficialAccount`、`LineUserIdentity`、`LineLoginState`、`LineDelivery`、`LineRichMenuDraft` |
| Consultation scheduling | 2 | `ConsultationEvent`、`ConsultationBooking` |
| Automation／CRM／Sales workspace | 11 | `AutomationRule`、`AutomationExecutionLog`、`CustomerTagAssignment`、`AutomationVoucherGrant`、`CustomerCrmRecord`、`ConsultantNote`、`SalesProject`、`SalesProjectProduct`、`SalesProjectCustomer`、`UserOnboardingPreference`、`OnboardingTaskState` |
| Funnel 公開頁與來源紀錄 | 5 | `LandingPage`、`LandingPageVersion`、`LandingPageTemplate`、`FunnelVisit`、`FunnelSubmission` |
| Electronic invoicing | 2 | `ElectronicInvoice`、`ElectronicInvoiceAllowance` |

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
| `20260906013000_smart_automation_workflows` | automation rules, execution logs, customer tags, voucher grants |
| `20260908113000_automation_customer_funnel_identity` | commerce order automation customer identity |
| `20260908143000_customer_crm_cockpit` | CRM identity/status and consultant notes |
| `20260912103000_sales_workspace_onboarding` | sales projects, customer membership, onboarding preferences/state |
| `20260912123000_test_order_signal` | server-owned non-charging test-order marker and lookup index |
| `20260913100000_landing_pages` | tenant/project scoped landing pages and immutable published versions |
| `20260917100000_funnel_runtime_attribution` | landing page operations, funnel visits/submissions, and source attribution bindings |
| `20260920100000_automation_execution_live_scope` | nullable trusted live scope on automation execution logs; pending isolated DB apply |
| `20260921110000_post_purchase_upsell` | tenant-qualified product upsell/downsell relationships and immutable offer configuration |
| `20260922120000_inventory_reservation_items_snapshot` | immutable reservation item snapshots for atomic primary-product and order-bump stock reservations |
| `20260908031500_taiwan_b2c_electronic_invoice` | tenant-bound B2C invoice snapshots, encrypted request identity, retry state and refund allowances |
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
| `20260818090000_custom_checkout_fields` | product custom checkout field definitions |
| `20260819090000_wp1_video_archive_state` | tenant-scoped soft archive and restore state for videos; provider assets are retained |
| `20260905113000_line_official_account` | tenant-scoped encrypted LINE OA credentials, identities, login state and idempotent delivery outbox |
| `20260906003000_advanced_live_interactions` | tenant-bound interaction runs and immutable participant responses |
| `20260907090000_live_lucky_draw_purchase_claim` | verified registration identity and hashed lucky-draw claim material |
| `20260907180000_live_qa_spotlight` | tenant-bound viewer questions and one spotlight per live |
| `20260908100000_consultation_booking` | tenant-scoped consultation events/bookings, active-slot uniqueness and booking status |
| `20260908090000_vendor_feature_toggles` | tenant-scoped backend module visibility settings; additive, no data deletion |
| `20260908230000_evergreen_webinar_vendor_settings` | per-live evergreen scheduling, timeline anchors and merchant preview controls |
| `20260911070000_live_danmaku` | public danmaku state on Live |
| `20260911080000_live_interaction_tenant_integrity` | fail-closed run/live and registration/live composite ownership |
| `20260911020000_presenter_layout` | versioned presenter layout JSON and tenant-scoped private WHIP/WHEP session leases |
| `20260929170000_payment_method_setup_intent` | consent actor、短效 nonce 摘要、租戶與 membership scope、一次性 callback 消耗 |
| `20260930094500_payuni_live_probe` | 獨立 PAYUNi 1 元綁卡後第二筆扣款探針的租戶、狀態與訂單唯一性；不等於三方案付款 |
| `20261004140000_line_rich_menu_drafts` | 每商家唯一草稿、完整 JSON menu、revision CAS、owner cascade、RLS 無公開 policy |

## 已由資料庫強制的主要 invariants

### Identity／authentication

| Invariant | DB enforcement | 交易／程式 enforcement | 證據 |
|---|---|---|---|
| Vendor slug/email 唯一 | `@unique` | normalized create/update | schema + unit |
| User email 唯一 | `@unique` | normalized auth flow | schema + auth tests |
| Session token hash 唯一 | `@unique` | bounded expiry/revocation | schema + session tests |
| 每位使用者單一 MFA factor | `UserMfaFactor.userId @unique` | setup/verify state machine | schema + action tests |
| Password reset token hash 唯一 | `@unique` | conditional `usedAt: null` claim | isolated PostgreSQL concurrent consume |
| 登入 Email 變更：token hash 唯一、每位使用者最多一筆未完成請求 | `tokenHash @unique`、partial unique `UserEmailChangeRequest_one_open_per_user` | 請求與確認都先鎖 `User` 列；條件式 `consumedAt/revokedAt: null` claim | `src/lib/account-email-change.db.test.ts` |
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
| Live interaction response 不跨 tenant/live | composite `[vendorId,liveId,runId]` 與 `[liveId,formSubmissionId]` foreign keys；每場單一 spotlight partial unique | migration 對既存 mismatch fail closed；合法 submission 刪除只清空 response reference | empty-DB 64 migration replay + cross-live negative writes + delete regressions |

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
| DB-I01 | Payment order identity | 2026-10-21 起 `@@unique([providerName,orderNumber])`（`PaymentTransaction_providerName_orderNumber_key`，見下方 F-050 段） | 已關閉：相同 provider/order 無法再出現第二筆 | 訂單號由 `crypto.randomBytes` 產生；P2002 換號重試一次；webhook ambiguous match 仍拒絕 | 已完成（D-005 platform merchant 命名空間）；BYO 若改由商家自訂訂單號需另議 account-scoped key | migration preflight 遇重複即 `RAISE EXCEPTION`；Production/Staging 套用前仍建議先跑只讀 aggregate |
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
6. 新 migration 一律手寫或逐句人工檢查，禁止直接提交 `prisma migrate dev` 的輸出（會產生 `DROP INDEX`／`DROP CONSTRAINT`，見 `scripts/prisma-drift-allowlist.json`）。CI 以 `scripts/migration-order-check.mjs` 要求 `prisma/migrations/` 下每個新目錄都符合 `<YYYYMMDDHHMMSS>_<snake_case>` 且晚於 master 最新者、既有 migration 不得刪除／改名／修改，以 `scripts/prisma-drift-check.mjs` 要求 drift 與 allowlist 完全一致。
7. 新增 public 表必須維持 RLS 啟用且不對 anon／authenticated／PUBLIC 授權；`src/lib/rls-catalog.db.test.ts` 會檢查全部表。

## 驗收判定

- 116/116 models 已納入 identity、tenant、payment、form、Team Funnel、commerce、support、LINE、consultation、automation、CRM、sales workspace、Funnel 公開頁與 supporting/telemetry 類別。
- 74 migration directories 已納入 canonical inventory；66/74 已由既有驗證 forward-apply，新增 8 條 automation／CRM／sales workspace／Funnel foundation migration 尚待 isolated DB forward-apply。
- 已有 DB-backed concurrency：password reset、payment logical order、refund ledger、commission、Cloudflare status、form deterministic submission。
- DB-I03～DB-I07 已有本機 reviewed migration、backfill/preflight policy 與跨 tenant negative regression；尚未取得 Production/Staging aggregate preflight，也未獲外部 migration 授權。
- DB-I01、DB-I02、DB-I08～DB-I10 仍為可重現的 schema gap；未完成語意決策、aggregate preflight 與 reviewed migration 前，Q07 不能標為 100。

## WP-06 candidate review（2026-07-28）

- `20260725230000_encrypt_payout_bank_accounts`：local envelope/backfill/tenant binding 測試通過，但沒有 key version、rotation 或 old-key recovery 契約；候選 verdict 為 `REWORK_REQUIRED`。
- `20260725231500_harden_affiliate_commissions`：BPS CHECK、non-null source identity unique、dirty-data fail-closed、schema atomicity 與 forward recovery 在 disposable DB 通過；但 PostgreSQL 對 `sourceId IS NULL` 允許多筆，且 `status` 仍是未約束字串，候選 verdict 為 `REWORK_REQUIRED`。
- 退款 adjustment 的負數金額是既有可追溯 accounting 行為，不能以一條「所有 commission amount 必須非負」constraint 破壞；後續 schema policy 必須區分原始佣金與 adjustment rows。


## 學員登入 capability（2026-10-04 整合中）

新增 `StudentPortalAccessToken` 及 additive migration `20261004154500_student_portal_access_tokens`。tokenHash 全域唯一、vendor FK、vendor/customer/expiry 與 vendor/purpose/expiry 索引；CHECK 限制 15 分鐘期限與 digest 格式。RLS 啟用且沒有 anon/authenticated policy，只有 server database role 讀寫。

原始 checkout_redirect purpose 僅保留 enum 相容，公開 access route 只接受 magic_link，單筆訂單 grant 不可取得整個帳戶權限。Consume 必須符合 tenant、customer、purpose、issuedAt、有效期限及 consumedAt=null，透過單次 updateMany 競爭唯一成功者。本機 disposable PostgreSQL 17 已 forward-apply 全部 83 條 migration；13 項 DB 測試驗證單次競爭、tenant/customer、expiry/purpose、FK/unique/TTL、RLS catalog 與優惠券商品狀態。2 項登入／登出及 checkout grant 邊界 browser 測試通過；獨立審查 findings 已修正。RLS 證據限 catalog，不宣稱 Data API role 實測；不冒稱 Staging/Production 已套用。

## 2026-10-06 原生課程候選

新增 `CourseLesson` 與 `CourseLessonProgress`；前向 migration `20261006040000_native_course_learning`。三欄位 lesson 外鍵同時約束 tenant、course、lesson，進度具非負上限約束。此候選的 disposable PostgreSQL 證據尚待執行，不沿用上方歷史收據。

課程社群候選新增 `CourseCommunityPost`、`CourseCommunityReply`、`CourseCommunityReaction` 與前向 migration `20261006070000_course_community`。課程／租戶 composite FK、無 public policy 的 RLS、文字長度限制及 learner-qualified 唯一鍵；85 migrations 與 7 項 disposable PostgreSQL 回歸已通過。此結果不代表 staging／Production 或瀏覽器完成驗收。

本次 F1.2 最終候選：85 migration、9 PostgreSQL 邊界回歸、1 manager/learner Chromium 長討論旅程、8 unit、TS/lint及1067 Node TAP零skip PASS；Critical複審無findings、canonical READY。精確head CI及受保護合併待完成。

F2.1 本輪新增 `AffiliatePortalAccess` 與前向 migration `20261006080000_affiliate_portal_access`，商家成員／affiliate採 composite tenant FK；本輪isolated branch未接入待交付community migration。85migrations、5PG regression PASS，包含退款ledger與併發/CAS。尚未完成UI browser/獨立review/gate/CI，不能宣稱READY。


## 2026-10-07 商家扣繳與付款證明新增契約

本候選包含 137 models、91 migrations；上方歷史收據保留原始數字。本次 disposable PostgreSQL forward-apply 與 29 項回歸證據見 `docs/remaining-capabilities-f2-exact-cents-audit-browser-20261007.json`。

- `AffiliatePayeeProfile`：vendor／affiliate 複合綁定；銀行與稅籍密文、分類證明、revision 與核准者；修改使待簽快照失效。
- `AffiliateRemunerationSnapshot`：不可變收入／ledger、profile／policy revision、密文與整數扣繳快照；簽署者與狀態轉移受驗證。
- `AffiliateRemunerationExport`：租戶、affiliate 與精確快照綁定；不可變、唯一匯出 audit，重試不新增重複證明。
- `MerchantAffiliatePayoutPolicy`：商家明確啟用的匯款費用政策；管理員 CAS revision，變更使未完成快照失效。
- `MerchantAffiliatePolicy`：商家佣金計算政策與階梯設定；收入基礎、退款與政策版本契約。
- `MerchantAffiliatePolicyState`：商家目前政策版本與併發更新狀態。
- `MerchantAffiliateProductRate`：商家政策與商品佣金率綁定。
- `MerchantAffiliateCheckoutSnapshot`：checkout 當時不可變佣金政策與收入基礎。
- `MerchantAffiliateCheckoutRecipient`：checkout 快照的各層受益者與佣金分配。
- `MerchantAffiliateSalesCounter`：商家銷售階梯計數與交易隔離。
- `MerchantAffiliateCalculation`：精確訂單／佣金計算與冪等結果。
- `20261006120000_merchant_affiliate_policy_snapshots`：forward-only；驗證扣繳資料、不可變快照、匯出 audit、政策 revision 或付款金額／快照複合 FK。
- `20261007050000_affiliate_remuneration_snapshots`：forward-only；驗證扣繳資料、不可變快照、匯出 audit、政策 revision 或付款金額／快照複合 FK。
- `20261007060000_affiliate_remuneration_ledger_binding`：forward-only；驗證扣繳資料、不可變快照、匯出 audit、政策 revision 或付款金額／快照複合 FK。
- `20261007070000_affiliate_remuneration_export_audit`：forward-only；驗證扣繳資料、不可變快照、匯出 audit、政策 revision 或付款金額／快照複合 FK。
- `20261007080000_merchant_affiliate_payout_policy`：forward-only；驗證扣繳資料、不可變快照、匯出 audit、政策 revision 或付款金額／快照複合 FK。
- `20261007090000_affiliate_paid_remuneration_binding`：forward-only；驗證扣繳資料、不可變快照、匯出 audit、政策 revision 或付款金額／快照複合 FK。

F2.1 本輪新增 `AffiliatePortalAccess` 與前向 migration `20261006080000_affiliate_portal_access`，商家成員／affiliate採 composite tenant FK；本輪isolated branch未接入待交付community migration。85migrations、5PG regression PASS，包含退款ledger與併發/CAS。尚未完成UI browser/獨立review/gate/CI，不能宣稱READY。

F2.1 本輪新增 `AffiliatePortalAccess` 與前向 migration `20261006080000_affiliate_portal_access`，商家成員／affiliate採 composite tenant FK；本輪isolated branch未接入待交付community migration。85migrations、5PG regression PASS，包含退款ledger與併發/CAS。尚未完成UI browser/獨立review/gate/CI，不能宣稱READY。

## 2026-10-07 通知資料層候選

新增 `LearnerNotificationPreference`、`LearnerNotificationDelivery`、`LearnerNotificationVerification` 與前向 `20261007010000_learner_notifications`。129 models、86 migrations；owned disposable PostgreSQL 全部套用成功，10 項回歸通過，包含匿名角色實際 RLS 讀取隔離/寫入拒絕、跨租戶 composite FK、CAS、退款後取消同意與無權益 opt-in 拒絕。驗證聯絡方式、實際渠道、UI、獨立審查與 canonical gate 尚未完成；不可宣稱 READY。

新增前向 `20261007020000_learner_verification_delivery`，驗證碼僅加密保存；歷史 challenge 無可恢復 token，保持 suppressed。新增 status/attempt/claim/payload CHECK 與 due index；129 models、87 migrations。整批仍 NOT_READY。

新增 `LearnerNotificationSourceEvent` 與前向 `20261007030000_learner_notification_source_events`；domain mutation 同 transaction 寫 encrypted source payload，composite tenant/product FK、unique event identity、private default-deny RLS；consumer bounded preference cursor 與 revision CAS。130 models/88 migrations，整批仍 NOT_READY。

新增前向 `20261007040000_learner_notification_source_schedule`：`LearnerNotificationSourceEvent.availableAt` 與 occurredAt/consent cutoff 分離；既有來源 backfill 為 occurredAt，保留歷史時間與 payload，新增 tenant/completed/availableAt/id 索引。130 models/89 migrations；owned disposable PostgreSQL 已驗證實際 forward SQL/backfill、未到期不展開與 immediate default。學員明確確認的 consultation reminder 沿用既有 source outbox，發送前鎖定目前 booking/project/course binding；功能仍 NOT_READY，未宣稱 Production 或真實渠道送達。

## 本次通知與社群整合候選

接入來源 `efee6e262685402b8c6efd13b2fe91091b49c70c` 的 `CourseCommunityPost`、`CourseCommunityReply`、`CourseCommunityReaction` 與唯一 `20261006070000_course_community` migration；保留其 SQL 原文，不新增等價 migration。討論回覆與通知來源同 transaction，送出前鎖定 exact parent/reply 與原作者；整合候選仍待新測試、獨立 review 與 acceptance。


本次社群／夥伴入口整合候選有129models與86migrations；新整合驗證尚未完成，舊收據不代表本次PASS。
Q2 本輪前向新增 `20261006140000_subscription_refund_entitlement_state`；既有126models不變，VendorUsageLimit新增active/revoked權限狀態。初次86 migration完整套用及51 PostgreSQL回歸PASS；之後擴充native退款backfill至byo訂閱快照，需重新驗證新revision。歷史migration/checksum保持原樣。

Q2 新增 forward migration `20261007002000_reconcile_legacy_subscription_refund_state`：以既有完整 processed refund ledger 修復 native subscription 權益；保留較新 active subscription 與 usage counters，既有 migration checksum 不變。87 migrations disposable PostgreSQL 完整套用通過；latest-head DB/browser 收據仍待完成。

Server tracking adds nullable tenant-bound encrypted credential, test event code and nonnegative CAS revision via forward migration `20261007123000_server_tracking_credentials`; 126 models unchanged; 88 migrations and 5 real DB regressions PASS. No provider delivery verified.

本輪前向新增 `TrackingDelivery` 與 `20261007133000_tracking_payment_outbox`，保留付款交易內的單筆事件、租戶 FK 與持久化重試狀態。89 migrations 與新 DB 回歸尚待本輪 runner 驗證；不代表已套用 Production。

本輪前向新增 `20261007150000_tracking_authoritative_event_sources`：保留既有 Purchase order FK，擴充 Lead/FormSubmission、ViewContent/AnalyticsEvent、Schedule/ConsultationBooking 的租戶複合 FK 與 exclusive-source CHECK；context 以 tenant/source 綁定加密。兩個新增 unique index 都包含原 primary key，不會讓既有資料產生重複衝突。歷史 migration／58/79 preflight 完全不改；90 migrations 與四事件回歸仍待本輪 disposable PG 證據。
Current full integrated inventory:

Current integrated inventory:

## Current withholding + community + PWA integration 20261008

Current candidate: 140 Prisma models and 94 forward migrations; all historical SQL/checksum evidence retained. Exact protected-page inventory: 94 pages, 55 vendorManager, all other guard families unchanged. No assertion/coverage exclusion or test removal.
Current integrated inventory: `20261006120000_merchant_affiliate_policy_snapshots`, `MerchantAffiliatePolicy`, `MerchantAffiliatePolicyState`, `MerchantAffiliateProductRate`, `MerchantAffiliateCheckoutSnapshot`, `MerchantAffiliateCheckoutRecipient`, `MerchantAffiliateSalesCounter`, `MerchantAffiliateCalculation`
Current integrated inventory:

Commission integration with delivered community a5964d83: 136 models and 89 canonical forward migrations. Both community and immutable merchant-affiliate snapshot migrations retained. Updated exact inventory assertions without exclusions or reduced checks; fresh validation pending.


## Preserved private-chat inventory notes

> 下列「Inventory 基準」的 PostgreSQL 18.3 與 66/71 套用數是原始 revision 的歷史收據；此前候選曾於 PostgreSQL 17.10 disposable DB 完整套用當時的 80/80 migration，並將 `public` schema 還原至隔離容器。目前候選 chain 已增至 88，該歷史收據不代表新 migration、Staging 或 Production 已套用。
| Prisma models | 127 |
## 2026-10-07 本輪私訊資料層
新增 `LivePrivateChatMessage` 與前向 migration `20261007110000_live_private_chat_messages`。獨立 AES-GCM 密文表；vendor/live、live/submission、vendor/author composite FK、作者來源與密文格式 CHECK、conversation 索引、64hex唯一訊息ID。Disposable PostgreSQL 完整86 migration及12 DB回歸 PASS，含既有廣播6項、私訊6項、併發唯一及跨租戶拒絕。尚無完整私訊 API/UI/browser/review/gate，不能宣稱交付；歷史migration清單與收據保留。
Current integrated inventory:
## Private messaging + delivered community/PWA candidate 20261008
Current inventory: 130 models and 89 forward migrations, including `20261006070000_course_community` and `20261007110000_live_private_chat_messages`. Preserve every historical SQL/checksum and fixed staging replay window.

## 2026-10-08 notification / delivered-main integration

Current source inventory: 145 models and 99 forward migrations. Previous checkpoints retained in Git and historical sections: notification 133/92; delivered main 141/95; earlier portal 129/88. Current schema validate passed; complete disposable DB/browser acceptance remains pending. No historical migration checksum changed.

## 2026-10-17 post-purchase credit

新增 `PostPurchaseCredit` 與前向 migration `20261007120000_post_purchase_credit`，由 `codex/post-purchase-commerce-20261007` 的功能 commit 移植到現行 master。目前 143 models、102 forward migrations；既有 SQL／checksum 不變。
- `20261017120000_post_purchase_credit_release`：forward-only；新增 `releasedAt`，將 `(vendorId, sourceOrderId)` 改為 `releasedAt IS NULL` 的 partial unique；目標付款失敗／逾期且未收款時釋放抵扣額，釋放列不可再交付、退款失效或復原。
- `20261017130000_post_purchase_credit_window_supersede`：forward-only；來源付款 24 小時內才可建立抵扣額（`POST_PURCHASE_CREDIT_WINDOW_MS`）、已出貨實體來源不可升級；目標付款成功即設 `supersededAt` 並撤銷來源交付；決策：supersede 後來源退款仍撤銷目標（資金已退回），目標已收款時寫入 `post_purchase.manual_review_required` 事件交商家人工處理，不自動退款。
- `20261018090000_post_purchase_recovery_guard`：forward-only；resume 亦檢查 24 小時窗口與已出貨來源，失效即拒絕並釋放抵扣額；supersede 不移動已出貨來源（旗標 `superseded_source_already_shipped`）並在來源寫入 `post_purchase.superseded`；superseded 目標退款時兩張訂單皆旗標 `superseded_target_refunded`；新函式時間一律 UTC。

## 2026-10-18 learner notification review fixes

- `20261018100000_learner_notification_throughput_guards`：forward-only，無資料刪改。`LearnerNotificationSourceEvent` 新增 `failureCount`（預設 0）、`nextAttemptAt`、`lastErrorCode`、`deadLetteredAt`，CHECK `LearnerSourceEvent_failure_check`（0–5 次、錯誤碼格式、dead-letter 必為第 5 次且無下次時間）；失敗 source 以 failureCount CAS 指數退避，第 5 次 dead-letter，不再阻擋其他 source／tenant。`LearnerNotificationVerification` 新增可為 NULL 的 `destinationRateKeyHash`（tenant-scoped HMAC，CHECK 為 64 hex，既有 challenge 保持 NULL）與 `(vendorId, preferenceId, createdAt)`、`(vendorId, destinationRateKeyHash, createdAt)` 索引，支援每位學員 24 小時 5 次、每個 destination 3 次的驗證上限。`LearnerNotificationDelivery` 新增 `(vendorId, status, nextAttemptAt)` 索引供 vendor-fair 選取。RLS、grants 與 composite tenant FK 沿用原 migration。
- 目前 147 models、107 forward migrations；既有 SQL／checksum 不變。已套用至 loopback `celebratedeal_wp17_ci`，並由 disposable PostgreSQL QA 完整 forward-apply 107 條。

## 2026-10-19 WP-05 native registration retry

- `20261018110000_registration_form_retry_draft`：forward-only、純新增，不改既有 table、欄位或資料。新增 `RegistrationFormRetryDraft`：原生（無 JavaScript）報名 POST 被拒（400/403/404/429/503）時的 10 分鐘加密重試草稿，永遠不成為 `FormSubmission`。只存 capability 的 SHA-256 `idHash`（CHECK 64 hex；capability 僅在 HttpOnly、SameSite=Strict、`__Host-` cookie）、`sourcePath`（CHECK 只允許 `/form|p|lp/` 公開報名路徑的 percent-decoded 正規形式，一或兩段，可含 CJK 等 `toSlug()` 允許的字元，不含 `/?#%.`、空白、控制字元或反斜線；應用層再限制為字母、數字、`_`、`-`）、`encryptedPayload`（CHECK `v1.` AES-GCM envelope 且長度上限與應用 reader 一致）、`expiresAt`（CHECK 晚於 `createdAt` 且不超過 `createdAt + 10 minutes`）。`(vendorId, formId)` composite FK 指向 `RegistrationForm(vendorId, id)` ON DELETE CASCADE：草稿只能屬於表單所屬租戶，表單或 vendor 刪除時一併刪除。`vendorId` 一律取自伺服器讀到的表單紀錄；密文內含 idHash／vendorId／formId／sourcePath／expiresAt，搬移到其他列即解密驗證失敗。索引 `(expiresAt)`、`(vendorId, expiresAt)`、`(vendorId, formId)`；啟用 RLS（與近期 migration 相同，不新增 policy）。每租戶上限 128 個未過期列（以 `pg_try_advisory_xact_lock` 取得租戶鎖，取不到即回報無法保留、不排隊佔用連線；ReadCommitted），全域 2048 列為軟上限；每筆草稿另依表單實際欄位型別計算大小上限。草稿讀取回填後即刪除（單次使用）。過期列在每次讀寫時最多回收 100 筆，另由既有 `/api/jobs/email-deliveries` 排程批次清除。
- 目前 148 models、108 forward migrations；既有 SQL／checksum 不變。

## 2026-10-19 F-114 merchant registration policy consent

- `20261019120000_user_policy_consent`：forward-only、純新增，不改既有 table、欄位或資料。新增 `UserPolicyConsent`：使用者同意的服務條款與隱私權政策版本（append-only）。欄位 `userId`、`vendorId`（可空）、`context`（CHECK 只允許 `merchant_registration`）、`termsVersion`／`privacyVersion`（CHECK `^[0-9A-Za-z._-]{1,32}$`）、`acceptedAt`。版本一律由伺服器從 `src/lib/public-policy-content.ts` 的已發布 metadata 取得，表單只回傳顯示的版本供比對，不接受 client 指定版本。`(userId, context, termsVersion, privacyVersion)` 唯一（`UserPolicyConsent_user_context_versions_key`）；索引 `(vendorId, acceptedAt)`。`userId` FK ON DELETE CASCADE；`vendorId` FK ON DELETE SET NULL（工作空間刪除後同意紀錄仍隨使用者保留）。與註冊的 User／Vendor／VendorMember／audit 在同一交易建立，任一失敗整筆 rollback。啟用 RLS（與近期 migration 相同，不新增 policy）。
- 目前 149 models、109 forward migrations；既有 SQL／checksum 不變。已套用至 loopback disposable `celebratedeal_test`／`celebratedeal_ci`（PostgreSQL 17.10），`prisma migrate diff` 對此 model 無 drift。

## 2026-10-20 F-026／F-063／B04-04 RLS 與 migration 防護

- `20261020090000_enable_rls_all_tables`：forward-only，不改 table、欄位或資料。用 `DO` 迴圈對 Prisma migration schema（`current_schema()`，Supabase 為 `public`，CI 併發庫為 `wp17_ci`／`wp18_ci`；該 schema 沒有 `Vendor` 表即中止）中 `relkind in ('r','p')` 且 `relrowsecurity = false` 的表（含 `_prisma_migrations`）執行 `ENABLE ROW LEVEL SECURITY`。改動前先檢查 migration 角色對每張待處理表都有 owner 權限（`pg_has_role(current_user, owner, 'USAGE')`），不符就 `RAISE EXCEPTION` 列出全部表名，不會部分成功。不建立 policy、不用 `FORCE`，Prisma 以 table owner 連線，不受影響。預設權限沿用 `20260724150000_harden_supabase_data_api`，不重做。只處理尚未啟用的表，因此可重跑。交易層級 `lock_timeout = 2s`，依表名排序；ACCESS EXCLUSIVE 鎖持有到 commit，應在低流量時段部署；失敗時整個回滾，用 `prisma migrate resolve --rolled-back` 後重試。部署前置查詢見 `docs/operations/prisma-migration-guards-runbook.md`。
- `src/lib/rls-catalog.db.test.ts`：所有 public 表 `relrowsecurity = true`；`anon`／`authenticated` 與 PUBLIC 沒有任何表權限、沒有開放給它們的 policy、新表不會因預設權限開放。`scripts/run-combined-coverage.mjs` 在 migrate 之前建立 `anon`／`authenticated`／`service_role` 與 Supabase 預設的 `GRANT ALL` default privileges，讓斷言驗證到真實的 Data API 角色。
- `src/lib/prisma-unmanaged-indexes.db.test.ts`：Prisma 無法表達且 `migrate diff` 不比對的 4 個 partial unique 與 3 個 trgm GIN，比對完整 `pg_get_indexdef`。
- `scripts/prisma-drift-allowlist.json`：2026-10-20 `migrate diff` 基準 100 句（trgm 3、schema 未宣告索引 3、未宣告 FK 11、FK 形狀不符 3、default 1、FK 名稱 54、索引名稱 25）。
- 目前 149 models、110 forward migrations；既有 SQL／checksum 不變。已在 loopback PostgreSQL 17.10 全新 `celebratedeal_wp18_ci` 完整套用 110 條，150 張 public 表全數 `relrowsecurity = true`；已驗證部分啟用時重跑、`lock_timeout` 中止與 drift 檢查的正反案例。

## 2026-10-21 F-050／B04-06 訂單號唯一（DB-I01）

- `20261021110100_payment_order_number_unique`：forward-only，不改欄位或資料。先以 `DO` 區塊統計 `"orderNumber" IS NOT NULL` 時 `(providerName, orderNumber)` 的重複組數與列數，有重複就 `RAISE EXCEPTION`（只列數量，不列訂單號或租戶），再建立 `CREATE UNIQUE INDEX "PaymentTransaction_providerName_orderNumber_key" ON "PaymentTransaction"("providerName","orderNumber")`；交易層級 `lock_timeout = 5s`。PostgreSQL 唯一索引把 NULL 視為彼此不同，因此全索引與 `WHERE "orderNumber" IS NOT NULL` 的 partial 索引約束完全相同；改用全索引是為了能在 schema 以 `@@unique([providerName, orderNumber], map: "PaymentTransaction_providerName_orderNumber_key")` 宣告，`prisma-drift-check` 維持 100 句、無新 allowlist 項目。
- 程式：`src/lib/payment-order-number.ts` 產生 `CD-<UTC yymmdd>-<14 碼 Crockford base32>`（24 字元、70 bits，符合 `PAYUNI_ORDER_NUMBER`），checkout route、`invoice-actions`、`platform-plan-checkout` 三處共用；整個建立交易遇 order number 的 P2002 換號重跑一次，第二次仍撞號就照原錯誤處理。無 vendor 的 PayUni 回呼反查 `(providerName, orderNumber)` 改走此索引。
- 測試：`src/lib/payment-order-number.test.ts`、`src/lib/payment-order-number.db.test.ts`（跨租戶撞號 P2002、重試、provider 命名空間與 NULL、索引定義）。
- 目前 149 models、111 forward migrations；既有 SQL／checksum 不變。已在 loopback PostgreSQL 全新 `celebratedeal_wp18_ci` 完整套用，並以交易內測試確認 preflight 遇重複會中止。

## 2026-10-21 F-046／B03-11 PayUni 退款保留人工釋放

- `20261021110200_payuni_refund_hold_release`：forward-only、純新增欄位，不改既有資料。`RefundRecord` 新增 `providerNoRefundCheckCount`（預設 0）、`providerNoRefundFirstCheckedAt`、`providerNoRefundLastCheckedAt`、`holdReleasedAt`。CHECK `RefundRecord_provider_no_refund_check`（次數 ≥ 0；次數為 0 時兩個時間皆為 NULL，反之皆有值且 last ≥ first）、`RefundRecord_hold_release_check`（`holdReleasedAt` 只能出現在 `status = 'failed'`）。Prisma 6 不比對 CHECK，drift 檢查維持 100 句。
- 程式：`src/lib/payuni-refund-hold-release.ts`。對帳頁的 PayUni 查詢若顯示累計狀態與本機已處理狀態完全相同（沒有退款），記一次確認並寫 `confirm_payuni_refund_no_refund` audit；驗證後的 provider 回應與帳務不一致就把連續次數歸零；provider 連線失敗不計也不歸零。`requireFinanceAdmin` 的「查詢 PayUni 並釋放保留」action 會再查一次，連續確認（含這次）達 `PAYUNI_REFUND_HOLD_RELEASE_CONFIRMATIONS`（預設 3）且保留建立超過 `PAYUNI_REFUND_HOLD_RELEASE_WINDOW_HOURS`（預設 24 小時）才把唯一的 pending 保留標為 `failed`、寫 `holdReleasedAt` 與 `release_payuni_refund_hold` audit，全部在同一個 Serializable 交易；不會自動釋放。PR #455 複審 M-1：確認只在保留建立超過時間窗後、且距上一次計數至少 `PAYUNI_REFUND_HOLD_CONFIRMATION_INTERVAL_HOURS`（預設 6 小時）才計數；太早或間隔不足的查詢只寫 audit（`counted: false`），不改欄位。預設最早 36 小時才能釋放。
- 目前 149 models、112 forward migrations；既有 SQL／checksum 不變。已在 loopback `celebratedeal_wp18_ci` 套用並以 `src/lib/payuni-refund-hold-release.db.test.ts` 驗證 CHECK 與流程。

## 2026-10-21 F-049／B03-15 月結調整覆核

- `20261021110300_settlement_adjustment_approval`：forward-only、純新增 table。新增 `SettlementAdjustmentRequest`（`vendorId`、`settlementId`、`amountCents`、`reason`、`status`、`requestedBy`／`requestedAt`、`reviewedBy`／`reviewedAt`）。CHECK：`status` 只允許 `pending／approved／rejected／superseded`；`reason` 去空白後 1–500 字；只有 pending 沒有 reviewer，其餘狀態必有 `reviewedBy`＋`reviewedAt`；`approved` 時 `reviewedBy <> requestedBy`（第二人規則在 DB 也成立）。Partial unique `SettlementAdjustmentRequest_one_pending_per_settlement`（`settlementId` WHERE `status = 'pending'`）已登記到 `scripts/prisma-drift-allowlist.json` 的 `partialUniqueIndexes` 與 `src/lib/prisma-unmanaged-indexes.db.test.ts`。`(vendorId, settlementId)` composite FK 指向 `Settlement(vendorId, id)` ON DELETE CASCADE（與 Settlement 對 Vendor 一致），`vendorId` FK ON DELETE CASCADE。啟用 RLS（不新增 policy）。
- 程式：`src/lib/settlement-adjustment.ts`、`src/lib/money-input.ts`。調整金額只接受整數新台幣（可負、可千分位，上限 999,999,999 元），理由必填；`|金額| > FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS`（預設 5,000,000 分）時只建立 pending 申請，月結不變，需另一位平台管理員核准；較小的調整直接生效並把既有 pending 申請標為 superseded。核准時重新檢查未鎖定、調整後不為負數，所有寫入與 AuditLog 在同一個 Serializable 交易。退款金額也改為嚴格整數元；退款手續費欄位為最多兩位小數的嚴格格式。
- 目前 150 models、113 forward migrations；既有 SQL／checksum 不變。已在 loopback `celebratedeal_wp18_ci` 套用，drift 檢查維持 100 句。

## 2026-10-21 PR #455 複審修正（F-049 m-4）

- `20261021110400_settlement_adjustment_rejected_by_lock`：forward-only，不改資料。把 `SettlementAdjustmentRequest_status_check` 擴充為 `pending／approved／rejected／superseded／rejected_by_lock`。`lockSettlementAction` 在同一交易內把該月結的 pending 調整申請標為 `rejected_by_lock`（`reviewedBy` 為鎖單者、`reviewedAt` 為鎖定時間），並逐筆寫 `reject_settlement_adjustment_on_lock` audit；月結頁列出被自動退回的申請與申請人。
- 覆核門檻改為 `|新調整值| > 門檻` 或 `|新值 − 現值| > 門檻` 任一成立即需第二人（n-2）；金額輸入上限改為 NT$21,474,836，確保分值不超過 PostgreSQL `integer`（n-3）。
- 目前 150 models、114 forward migrations；既有 SQL／checksum 不變。

## 2026-10-21 F-038／B03-02 交易用途（月結只計買家訂單）

- `20261021130100_payment_transaction_purpose`：forward-only。新增 enum `PaymentTransactionPurpose`（`buyer_order／platform_subscription／invoice_payment／demo／unclassified`）與 `PaymentTransaction.purpose`（NOT NULL，預設 `unclassified`）。回填只依伺服器寫入的資料：`providerName = 'demo'` 一律為 `demo`（PR #458 審查 m-3，月結排除且不擋）；其次 `metadata.billingPurpose` 為 `platform_subscription_checkout`／`invoice_payment`／`buyer_order` 分別對應三種用途；沒有 `billingPurpose` 但有 `CommerceOrder.primaryPaymentTransactionId` 指向它（同 vendor）的列為 `buyer_order`；明確的方案費／帳單款標記優先於 CommerceOrder 連結；其餘維持 `unclassified`。交易層級 `lock_timeout = 5s`。
- 程式：checkout route 寫 `buyer_order`、`platform-plan-checkout` 寫 `platform_subscription`、`invoice-actions` 寫 `invoice_payment`；demo provider 建立的交易（含回呼建立的未知訂單）一律寫 `demo`（`paymentTransactionPurposeFor`）。fail-closed 只在訂閱為平台收款（`paymentMode = platform`）時生效。`calculateSettlement` 的營收與退款只計 `buyer_order`（或仍是 `unclassified` 但有 primary CommerceOrder 的列）；當月有 `unclassified` 且沒有 CommerceOrder 的已付款交易，或當月已處理退款屬於這類交易（PR #458 審查 M-3）時拋 `unclassified_payment_purpose`，月結不產生、不寫 Settlement／Invoice，需人工核對後以 SQL 更新 `purpose` 再重算。
- 部署前盤點：`SELECT purpose, count(*) FROM "PaymentTransaction" WHERE status IN ('paid','partially_refunded','refunded') GROUP BY 1;`，`unclassified` 非 0 時逐筆核對。已鎖定月份不重算，若曾把方案費／帳單款算入商家營收，需人工另立調整。
- 測試：`src/lib/settlement-revenue.db.test.ts`（精確金額、只有方案費／帳單款的月份撥款為 0、unclassified 拒絕、預設值）；回填 SQL 已在 loopback 拋棄式庫以 9 種 provider／metadata／CommerceOrder 組合驗證。
- 目前 150 models、115 forward migrations；既有 SQL／checksum 不變。

## 2026-10-21 F-039／B03-03 退款月份與負餘額結轉（D-32）

- `20261021130200_settlement_negative_carry_forward`：forward-only、純新增。`Settlement` 新增 `refundAmountCents`（計算時納入的買家退款，CHECK ≥ 0）、`carriedInCents`（上期結轉扣抵，CHECK ≤ 0）、`carriedOutCents`（結轉到下期的待扣款，CHECK ≤ 0 且只在 `finalPayoutAmountCents = 0` 時可非 0），預設皆 0。新增 `SettlementAdjustmentLedgerEntry`（`vendorId`、`kind`、`sourceMonthKey`、`targetMonthKey`、`amountCents`）：CHECK `kind` 只允許 `negative_balance_carry_forward`、兩個月份格式 `YYYY-MM` 且 target > source、`amountCents ≤ 0`；`(vendorId, kind, sourceMonthKey)` 唯一、`(vendorId, targetMonthKey)` 索引；`vendorId` FK ON DELETE CASCADE；啟用 RLS（不新增 policy）。交易層級 `lock_timeout = 5s`。
- 程式：`src/lib/settlement-period.ts`。退款月份一律取伺服器完成時間（UTC 月，與 `monthRange` 相同），該月月結已鎖定就順延到下一個未鎖定月份；套用於後台手動退款（不再接受表單 `monthKey`）、PayUni 退款完成、PayUni 退款對帳、付款 webhook 退款（不採用 provider 事件時間）。PayUni pending 保留的 `monthKey` 只是暫定值，轉 processed 時改寫。`calculateSettlement` 不再把 `grossRevenueCents` 截斷為 0，並加上 `targetMonthKey` 為本月的結轉；`generateSettlementForVendor` 在同一 Serializable 交易內確認退款與結轉沒有在計算後變動、淨額為負時撥款 0 並寫入（或更新）來源月份的結轉列。結轉列的目標月已鎖定時不再變更（`carry_forward_target_locked`）。手動調整（F-049）：負向調整不可讓撥款低於 0，正向調整可抵減結轉並同步更新結轉列。`lockSettlementAction` 改為 Serializable，並在鎖定前重新比對退款與結轉（`stale_settlement`，需先重新產生月結）。
- PR #458 審查 M-1：同一 migration 為 `AffiliateCommissionLedgerEntry` 新增 `settlementMonthKey`（可空，CHECK 只允許 `entryType = 'refund'` 且格式 `YYYY-MM`；索引 `AffiliateCommissionLedger_v_settlement_month_idx`）。退款沖回佣金時寫入該筆 RefundRecord 的 `monthKey`，月結扣佣金改為「`settlementMonthKey` = 本月」加上「`settlementMonthKey` 為 NULL 且佣金月份為本月（pending／approved／locked／void）」；void 佣金也計入，因為它的沖回現在也計入，同月相抵為 0，跨月時沖回落在退款月份。既有列為 NULL，沿用舊規則。
- PR #458 審查 M-2：撥款改用未截斷的淨手續費（當月手續費 − 當月手續費退回，可為負），`paymentGatewayFeeCents`／`transactionServiceFeeCents` 欄位與發票仍保留非負值。
- PR #458 審查 m-1：負向人工調整最多把撥款扣到 0，不會產生或加深結轉（重新產生月結時亦同，`splitNetPayable`）；正向調整可抵減結轉。
- 既有未鎖定月結的 `refundAmountCents` 為 0；若該月已有已處理退款，鎖定前必須重新產生月結。
- 測試：`src/lib/settlement-carry-forward.db.test.ts`（鎖定月份順延、webhook 退款不採用 provider 時間、精確金額的負餘額結轉與扣抵、來源月重算、鎖定前輸入變動、目標月已鎖、正負調整、DB CHECK）。
- 目前 151 models、116 forward migrations；既有 SQL／checksum 不變。

## 2026-10-21 F-072／B04-19 Funnel 封存取代刪除

- `20261021140000_landing_page_archive_restrict_funnel`：forward-only。`LandingPage` 新增 `archivedAt`（可為 NULL）與 CHECK `LandingPage_archived_unpublished_check`（`archivedAt` 有值時 `status <> 'published'` 且 `publishedVersionId IS NULL`）。`FunnelVisit_vendorId_pageId_fkey`、`FunnelSubmission_vendorId_pageId_fkey` 由 `ON DELETE CASCADE` 改為 `ON DELETE RESTRICT`（同名重建，`NOT VALID`；交易層級 `lock_timeout = 5s`；本檔不掃表），schema 同步為 `onDelete: Restrict`，drift 檢查不變。Vendor 刪除仍經兩表各自的 `vendorId` FK 串聯（`src/lib/landing-page-archive.db.test.ts` 的清理即驗證）；`SalesProject` 刪除若串到有流量的頁面會被擋下（目前沒有刪除專案的 app 路徑）。
- `20261021140100_landing_page_funnel_fk_validate`：只有兩句 `VALIDATE CONSTRAINT`。Prisma 把每個 migration 檔當成一個隱含交易，所以必須另開 migration，掃表時才只持有 SHARE UPDATE EXCLUSIVE（LandingPage 為 ROW SHARE），不擋 `/lp` 讀取與造訪寫入。
- 程式：`deleteLandingPage` 在 Serializable 交易內重讀頁面，曾發布（`publishedAt`、`status = published` 或已有 `LandingPageVersion`）或已有 `FunnelVisit`／`FunnelSubmission` 時改為封存（`archivedAt`、`status = draft`、`publishedVersionId = null`，已發布者補 `unpublishedAt`），只有從未發布且無流量的草稿才真正刪除。編輯器查詢（`requireScopedPage`、清單、編輯器載入、公開狀態診斷、營運與自動化設定）一律加 `archivedAt: null`；公開查詢（`publicLandingPageCandidateWhere`、funnel runtime、funnel checkout、報名 marketing hint）同樣排除封存頁，`/lp/[slug]` 因此回全站繁中 404。封存頁的 slug 仍佔用（全域唯一），並繼續以 Restrict 參照 form、live 與版本；目前沒有查看或還原封存頁的 UI（產品決策，留待 owner）。
- 測試：`src/lib/landing-page-archive.db.test.ts`（刪除／封存分流、保留造訪與版本、跨租戶否定、Restrict、CHECK、Vendor 串聯）、`src/lib/landing-page-service.test.ts`、`src/app/actions/landing-page-actions.test.ts`。

## 2026-10-21 F-073／B04-20 商家撥款帳號只存加密 envelope，變更後 24 小時才可撥款

- `20261021140200_payment_account_payout_verification`：forward-only，排在 archive migration 之後。`PaymentAccount` 新增 `bankAccountChangedAt`、`payoutEligibleAt`（可為 NULL、無 default）。部署當下仍為明文的 legacy 帳號（`bankAccountNumber` 非 NULL 且不以 `****` 開頭）**不會卡住部署**：同一交易先為每筆寫一列 `AuditLog`（`payment_account_legacy_plaintext_masked`，只記 `hasEncryptedAccount`、`requiresMerchantReentry`，不含帳號），再把帳號改為 `****` 加末四碼、戶名改為首字加 `＊`；沒有 envelope 的列因此不再符合撥款條件，需商家在 `/billing/payouts` 重新填寫。要保留可撥款狀態，部署前先跑 `scripts/backfill-bank-account-encryption.ts`。最後以 `NOT VALID` 加 CHECK `PaymentAccount_bankAccountNumber_masked_check`（`"bankAccountNumber" IS NULL OR "bankAccountNumber" LIKE '****%'`）。交易層級 `lock_timeout = 5s`。
- `20261021140300_payment_account_masked_check_validate`：只有 `VALIDATE CONSTRAINT`，獨立交易、SHARE UPDATE EXCLUSIVE。Prisma 6 不比對 CHECK，drift 檢查不變、無新 allowlist 項目。部署前置查詢見 `docs/operations/prisma-migration-guards-runbook.md` §6。
- 程式：`src/lib/vendor-payout-account.ts`（唯一寫入商家撥款帳號的 app 路徑）、`src/app/(app)/billing/payouts/actions.ts`：`assertServerActionSecurity` → `requireVendorOwnerFinance` → 須已啟用 MFA → **當下重新輸入 TOTP**（與 `/mfa/verify` 相同的 `verifyTotpCode`，不接受 recovery code；每人 15 分鐘 5 次）→ 寫入。vendorId 只取自 session。完整帳號只寫進以 vendor 為 AAD 的 envelope，legacy 欄位只存 `maskBankAccount` 結果；每次儲存都把帳號設為 `pending_verification`、`payoutEligibleAt = now + 24h`（平台設定的其他狀態如 `suspended` 不變），同一交易寫 `vendor_payout_account_saved` audit（只含銀行代碼、末四碼與生效時間），交易後寄信給所有 active owner（`src/lib/vendor-payout-account-notification.ts`；寄送失敗仍保留變更，回報 `saved_notification_failed`）。`selectPayoutAccount` 把 `active` 與 `pending_verification` 都算進「唯一一個 platform 帳號」，後者在 `payoutEligibleAt` 之前不可撥款，也不會退回改用舊帳號；`verified` 不再自動升為可撥款。`isEligiblePayoutAccount` 不接受「沒有 envelope 且 legacy 帳號已遮罩」的帳號。
- backfill 改為逐批（預設 100 列，`--batch-size` 1–500）獨立提交的 Serializable 交易（`timeout` 60 秒、`maxWait` 10 秒），以 cursor 唯讀掃描產生計畫；遮罩後沒有 envelope 的 PaymentAccount 列為 `unrecoverableMaskedAccounts`，拒絕執行。
- 測試：`src/app/(app)/billing/payouts/actions.db.test.ts`（envelope／遮罩、24 小時冷卻與 `selectPayoutAccount`、被偷 session 沒有 TOTP 無法改帳號、step-up 次數限制、active／verified 改回 pending、兩租戶否定、通知信、停權不可解除、多帳號拒絕、CSRF、CHECK）、`scripts/backfill-bank-account-encryption.db.test.ts`、`src/app/(app)/billing/payouts/page.test.tsx`、`src/lib/payout-account.test.ts`。
- 目前 151 models、120 forward migrations；既有 SQL／checksum 不變。已在 loopback 全新 `celebratedeal_dev`（5433）完整套用，並以交易內測試確認明文列會被遮罩並寫入 AuditLog、之後 VALIDATE 成功。

## 2026-10-21 F-092／B06-06 串流用量月計數列（心跳不再於 Serializable 交易掃整月帳本）

- `20261021150000_stream_usage_monthly_counter`：forward-only、純新增。新增 `StreamUsageMonthlyCounter`（主鍵 `(vendorId, monthKey)`、`watchSeconds` 預設 0、`createdAt`、`updatedAt`）：CHECK `monthKey` 為 `YYYY-MM`、`watchSeconds >= 0`；`vendorId` FK ON DELETE CASCADE；啟用 RLS（不新增 policy）。不回填：每個商家月份的第一個心跳以 `INSERT ... SELECT SUM(ledger) ... ON CONFLICT DO UPDATE` 從帳本播種一次，之後只做單列遞增。
- 不變量：`StreamUsageLedgerEntry` 仍是不可變的唯一事實來源；計數列是可重算的衍生總和。`recordStreamUsageLedgerEntry` 改為 READ COMMITTED：先以條件式 `UPDATE ... SET "watchSeconds" = "watchSeconds" + n WHERE GREATEST("watchSeconds", legacy) + n <= limit` 預留額度（無上限時照樣累加），預留成功即持有該列鎖直到交易結束，所以同商家的成員／頁面額度檢查、帳本與分配寫入依序執行；額度不足才拋 `StreamQuotaExceededError`（route 回 429 `stream_minutes_exhausted`）。交易失敗回滾時遞增一併回滾。P2034 或原生查詢的 `40001`／`40P01`（P2010）最多重試 3 次，仍失敗回 `usage_busy`（route 回 503、可重試），**不再轉成額度用完**。觀眾入場（`admitLiveViewer`，仍為 Serializable）改讀計數列（無列時退回帳本加總）。
- 同批修正：帳本 `create` 的巢狀 `allocations.create` 原本帶 `vendorId`，Prisma 對複合 FK 的 nested input 不接受此欄位，真實資料庫上每次心跳寫入都會失敗（單元測試以 mock 掩蓋）；已移除，`vendorId` 由父列帶入。另外真正的額度用完原本拋出未對應的 `StreamQuotaExceededError` 而回 500，現在回 429。
- 已知限制：滾動部署期間仍在跑舊版程式的實例只寫帳本、不更新計數列，計數列可能比帳本少記該段時間（開了 Skew Protection 會放大）；少記等於多放行額度。唯讀對帳查詢與只往上修的人工重新播種步驟見 `docs/operations/stream-usage-runbook.md`。部署順序必須先 `prisma migrate deploy` 再部署程式，否則有限額度商家的觀眾無法入場。
- PR #461 審查修正：交易明確使用 `{ isolationLevel: ReadCommitted, maxWait: 5s, timeout: 10s }`，P2028（等連線或等鎖逾時）直接回 `usage_busy`（503 可重試）；額度提醒只在跨過 80%／100% 門檻時寫入。
- 測試：`src/lib/stream-usage-counter.db.test.ts`（20 個併發心跳在有限額度下全數入帳、計數＝帳本＝1,200 秒；10 分鐘額度下 20 個併發心跳恰好 10 個成功、其餘只會是 `StreamQuotaExceededError`；既有帳本播種；同 eventId 併發只計一次；跨租戶；CHECK 與 vendor 串聯刪除）。同一個 20 併發案例在舊版 Serializable 邏輯下會出現多筆 `stream_minutes_exhausted`。
- 目前 152 models、121 forward migrations；既有 SQL／checksum 不變。

## 2026-10-21 F-028／B02-05 帳號層限流改用資料庫計數

- `20261021160000_account_rate_limit_bucket`：forward-only、純新增。新增 `AccountRateLimitBucket`（`keyHash` PK、`scope`、`windowStartedAt`、`count`、`updatedAt`，`updatedAt` 索引）。CHECK `keyHash` 必須是 64 字元小寫 hex、`count ≥ 1`。無 FK、無 tenant key（計數主體是帳號或收件人，不屬於單一商家）；啟用 RLS（不新增 policy）。交易層級 `lock_timeout = 5s`。Prisma 6 不比對 CHECK，drift 檢查不變、無新 allowlist 項目。
- `keyHash = SHA-256("celebratedeal:account-rate-limit:v1" ‖ scope ‖ subject)`，Email 不以明文落表。唯一寫入點 `src/lib/account-rate-limit.ts`：單一 `INSERT … ON CONFLICT DO UPDATE` 以資料庫時鐘（UTC）做固定視窗計數，原子遞增；新建 bucket 時順手刪除最多 50 筆閒置超過 24 小時的列，避免以隨機 Email 灌表。DB 錯誤一律回 503（fail closed）。
- 不受 `RATE_LIMIT_PROVIDER` 影響；`checkRateLimit`（`@/lib/rate-limit`）只負責 IP 層，`cloudflare_waf` 時只放行 IP 層。帳號層：MFA 驗證（每帳號 5 次／分）、復原碼重產（3 次／15 分）、撥款帳號 step-up（5 次／15 分）、學員 magic link（每商家＋學員 3 次／15 分）、成員邀請（每商家 5 次／分）、密碼重設信（每收件人 3 次／15 分，超過時不寄、回應不變）。#462 審查後補上：登入（每個提交的 Email 10 次／15 分，回 `rate_limited`，不透露帳號是否存在）、MFA 驗證失敗每帳號每日 50 次，超過後每次失敗鎖定 1 小時（`mfa_verification_lock`，同一張表，`windowStartedAt` 為鎖定起點；鎖定或讀取失敗時拒絕驗證）。preflight 新增 `ACCOUNT_RATE_LIMIT` 說明，不再把 WAF 當成帳號層的替代。
- 測試：`src/lib/account-rate-limit.db.test.ts`（上限、WAF 下仍擋、視窗重置、scope／subject 獨立、併發原子、只存 hash、閒置清理、503、CHECK）、`src/lib/password-reset.test.ts`（收件人上限）、`src/app/actions.test.ts`、`src/app/actions/student-portal-actions.test.ts`、`src/lib/env.test.ts`。
- 時間戳原為 `150000`，因與 #461 的 `20261021150000_stream_usage_monthly_counter` 相同而改為 `160000`（尚未套用到任何共用環境），排在 #461 之後。合併 #461 後為 153 models、122 forward migrations；既有 SQL／checksum 不變。

## 2026-10-21 F-029／B02-06 商家成員改為邀請 token，需對方接受

- `20261021160100_vendor_member_invitation`：forward-only、純新增。新增 `VendorMemberInvitation`（`vendorId` FK ON DELETE CASCADE；`invitedByUserId`、`acceptedUserId` FK ON DELETE SET NULL；`tokenHash` 唯一；`(vendorId, email)`、`expiresAt` 索引）。CHECK：`role` 只允許 owner／admin／accountant／support、`email` 必須已 trim 且小寫、`tokenHash` 為 64 字元 hex、`acceptedAt` 與 `revokedAt` 不可同時有值、`acceptedUserId` 只在 `acceptedAt` 有值時存在。啟用 RLS（不新增 policy）。同一 migration 把 `UserPolicyConsent_context_check` 放寬為 `merchant_registration`、`vendor_member_invitation`（只擴大允許值，既有列必然符合；表很小，重建 CHECK 的驗證掃描很短）。交易層級 `lock_timeout = 5s`。Prisma 6 不比對 CHECK，drift 檢查不變、無新 allowlist 項目。
- 程式：`src/lib/vendor-member-invitation.ts`。`createVendorMemberAction`（CSRF → owner → F-027 step-up → 輸入驗證 → IP 層＋每商家帳號層限流）只建立邀請（同商家同 Email 的舊待接受邀請一併撤銷），不建立或變更任何 `VendorMember`；未知 Email、他租戶使用者、既有成員、平台管理員、停權帳號一律回 `updated=member_invited`，租戶可見的 audit 一律為 `invite_vendor_member`。寄信在回應之後（`after()`）執行，平台管理員與停權帳號不寄、只寫平台層（無 vendorId）audit；每收件人跨租戶 3 次／小時（F-028）。邀請 72 小時有效，只存 token 的 SHA-256。
- 接受（`/invitations/accept`、`acceptVendorMemberInvitationAction`）：vendor、role、Email 只取自邀請列。既有帳號必須是已登入（若有 factor 須已驗證）的受邀帳號本人；沒有帳號時以表單密碼與政策同意建立新帳號（`UserPolicyConsent.context = vendor_member_invitation`）。平台管理員與停權帳號不可接受。檢查、`acceptedAt` 條件更新（單次使用）、`VendorMember` upsert、last-owner 檢查與 audit 在同一 Serializable 交易。
- #462 審查 M1：沒有 active membership 的既有帳號（例如停用後再被邀請的成員）若有待接受且未過期的邀請，可以登入（session `vendorId` 為 NULL），登入後只會回到 `/invitations/accept`（登入表單的 `next` 只接受該路徑）；沒有邀請時仍回 `no_vendor`。接受頁不需要 vendor context，MFA 未驗證的 session 先到 `/mfa/verify` 再回來。m7：owner 可直接調降其他成員角色（`changeVendorMemberRoleAction`，step-up、只允許權限變小、Serializable 與 last-owner 檢查）；調高角色仍需邀請。
- 移除 `platform_user`、`inactive_user` 回應碼。既有成員的「重寄設定密碼邀請」與「停用」不變（皆加上 F-027 step-up）。
- 測試：`src/lib/vendor-member-invitation.db.test.ts`（四種 Email 回應一致且不建 membership、寄信對象、跨租戶撤銷否定、本人登入才可接受、新帳號與政策同意、平台管理員／停權不可接受、過期／撤銷／偽造 token、last owner、併發單次使用、CHECK）、`src/app/actions.test.ts`、`src/app/invitations/accept/page.test.tsx`。
- 時間戳原為 `150100`，改為 `160100` 以排在 #461 之後。目前 154 models、123 forward migrations；既有 SQL／checksum 不變。

## 2026-10-22 F-001／F-002（B01-01、B01-02）封測模組的伺服器端閘門

- `20261021171100_vendor_beta_feature_grants`：forward-only、純新增。`Vendor` 新增 `betaFeatureGrants TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`，加上 CHECK `Vendor_betaFeatureGrants_check`（陣列只能包含 `courses`、`billing`、`funnel_binding`、`consultation_booking`、`browser_live`、`danmaku`）。常數預設值在 PostgreSQL 11+ 只改 metadata，不重寫表；交易層級 `lock_timeout = 5s`。不回填：既有與新商家一律從空陣列開始，也就是六個封測模組全部關閉（D-02）。Prisma 6 不比對 CHECK，drift 檢查不變、無新 allowlist 項目。
- 不變量：只有平台管理員（`requireFinanceAdmin`）能透過 `updateVendorBetaFeatureGrantsAction`（`/admin/vendor-features`）寫入，寫入時以讀到的舊值做 compare-and-set 並寫 AuditLog；商家的 `updateVendorFeaturesAction` 只寫 `enabledFeatureModules`，`parseVendorFeatureModules` 除了 `consultation_booking`（同時是商家開關）之外不接受封測模組，`consultation_booking` 寫入後仍需平台授權才生效。判斷一律走 `isFeatureEnabled`（`src/lib/vendor-feature-toggles.ts`）：封測模組需要平台授權；`consultation_booking` 同時是商家自己的開關，兩者都開才算開。讀不到或格式不對的授權一律視為關閉。
- 入口：Server Action 用 `requireFeature`（丟 `FeatureDisabledError`，訊息「此功能目前尚未開放。」）、頁面用 `requireFeatureOrNotFound`／`requireVendorFeatureOrNotFound`（繁中 404）、route handler 用 `featureGateResponse`／`featureDisabledResponse`（404 JSON `FEATURE_DISABLED`）；買家、學員、觀眾入口以所要求紀錄的 `vendorId` 讀旗標（`isVendorFeatureEnabled`）。`funnel_binding` 關閉時，發佈就緒、直播配額入場、團隊直播分享、onboarding、dashboard 與工作區導引都不再要求已驗證的平台服務付款方式（`isCardBindingRequired*`）；其他配額（觀看分鐘、點數、人數）照常檢查。
- 測試：`src/lib/feature-gates.matrix.test.ts`（模組 × 入口，關閉被擋、開啟放行，另以靜態清單鎖定每個入口）、`src/lib/feature-gates.db.test.ts`（預設全關、只讀被要求的商家、CHECK）、`src/lib/vendor-feature-toggles.test.ts`、`src/app/actions/vendor-beta-feature-actions.test.ts`。
- PR #465 審查修正：`courses` 關閉時課程商品不可購買（`isProductPurchasable`／`purchasableProductWhere`：結帳頁 404、`/api/payments/checkout` 主商品 404 `FEATURE_DISABLED`、加購 409、漏斗商品清單與直播間商品不列出）；商家仍可編輯並下架既有課程商品，只擋新建與上架（`course_feature_disabled`）。平台管理員同時改動商家開關時，`enabledFeatureModules` 也做 compare-and-set。WP4 Sandbox 夾具商家建立時帶 `billing`、`funnel_binding` 授權，既有夾具補上缺少的授權（只在 WP4 preview／Sandbox 邊界內執行）。
- 部署前盤點（D-02，資料不刪）：以唯讀查詢列出有效 `ConsultationEvent` 與未來預約、有效課程商品、`Video.sourceType = 'browser_live'` 的已排程直播，決定逐商家授權或先通知商家；`billing` 關閉期間月結排程仍會開立內部帳單（排程預設關閉，見 `docs/launch/scheduled-jobs-runbook.md`），開放 billing 前需先清理。
- 目前 154 models、124 forward migrations；既有 SQL／checksum 不變。

## 2026-10-24 名單型一頁式網站獨立發布（無 migration）

- Owner 決策：Funnel `flow.goal = "audience"` 的已發布版本不再要求所屬 `SalesProject` 已發布。`sell`、`webinar`、`custom` 與舊版頁面文件不變。沒有新增 model、欄位或 migration；目前仍為 154 models、124 forward migrations。
- 公開查詢不變量：`publicLandingPageCandidateWhere`（proxy 預檢與 `loadPublicLandingPage`）與 `resolvePublicFunnelRuntime` 共用 `publicFunnelProjectGateWhere()`：`project` 已發布，**或**（`project.status <> archived`，且 `publishedVersion.content` 的 JSON path `flow.goal` 等於 `"audience"`，且 `flow.steps` 不含任何銷售或 Webinar 步驟類型：`sales_page`、`order_form`、`upsell`、`downsell`、`thank_you_page`、`webinar_*`）。條件在同一句 SQL 內判斷，proxy 仍只回 `id`。解析內容的呼叫端再以 `publicProjectGateSatisfied` 對照解析後的內容（另檢查每一頁沒有 `commerce` 綁定、付款類元件或 checkout-contact 表單）；這個程式端檢查才是權威，兩者不一致時一律關閉（`invalid_content`）。`status = published`、`publishedVersionId`、`archivedAt: null`、slug 唯一、版本與租戶一致、表單與直播必須屬於同一 vendor＋project 等檢查都保留。
- 已知取捨（封測接受）：proxy 對每個 `/lp` 文件請求都會讓資料庫讀取已發布版本的 JSONB 做 path 比對（內容不回傳）。若成本變高，改為發布時在 `LandingPageVersion` 存一個布林欄位（需 forward migration），查詢改比對該欄位。
- 專案未發布時的限制：綁定直播的名單網站不能發布（`landing_page_audience_live_requires_project`），已發布者回 404（`live_requires_published_project`，直播不會早於專案公開）；結帳與商品區塊一律不能出現在獨立發布的網站（含有就回到專案閘門，`resolvePublishedFunnelCheckout` 仍要求專案已發布）；預約區塊不顯示時段（`publicConsultationEvents` 不變）；表單自己的 `/form/[slug]` 仍要求專案已發布；專案封存後一律 404。
- 名單收集：`publishLandingPage` 發布可獨立發布的名單網站時，若頁面有名單表單或問卷節點、沒有綁定報名表也沒有直播，先找這個頁面自己的自動表單（同 vendor＋project、slug 為 `lead-auto-<pageId>` 或 `lead-auto-<pageId>-<隨機值>`），有啟用中的就沿用、全部停用就不再建立；都沒有才在同一個發布交易內建立一張 `RegistrationForm`（名稱「<網站名稱>｜名單表單（自動建立）」，`vendorId`、`projectId` 取自已驗證的編輯範圍，欄位為必填姓名、Email，加上頁面問卷的答案欄位），並寫入 `LandingPage.draftFormId` 與版本 `formId`。全域 slug 已被別的租戶占用時改用加隨機值的 slug，不沿用對方的表單；同時發布造成的 slug 衝突回「請再按一次發布」。`saveLandingPageDraft` 收到空的 formId 時，不會解除這個頁面自己的自動表單綁定。發布回傳與 action 狀態都帶 `formId`。既有的手動綁定不會被取代，其他目標不會自動建立表單。
- `/api/form-submissions`：表單所屬專案未發布時，只接受經 `resolveTrustedFunnelSubmission` 重新解析成功的名單網站來源（已發布版本綁定此表單、沒有直播、有伺服器記錄的造訪），且來源頁的 vendor 與 project 必須等於表單的 vendor 與 project；其他情況維持 404 `Form not found`。限流與 Origin 檢查不變。原生表單重試草稿以 `independentFunnelBindsForm` 做同樣的綁定檢查。
- 測試：`src/lib/audience-funnel-independent-publish.db.test.ts`（未發布專案的公開網址與名單寫入、報表、跨租戶與同商家跨專案、取消發布與封存、重複發布只有一張自動表單、發布失敗時自動表單回滾、改標籤的銷售頁與其結帳仍關閉、專案封存後關閉、其他目標仍關閉）、`src/lib/landing-page-service.test.ts`、`src/lib/funnel-runtime.test.ts`、`src/lib/public-landing-page-status.test.ts`、`src/lib/funnel-registration-surface.test.ts`、`src/components/landing-pages/funnel-page-document-renderer.test.tsx`。

## 2026-10-24 名單型網站獨立發布上限與新增步驟限制（無 migration）

- 沒有新增 model、欄位或 migration；目前仍為 154 models、124 forward migrations。只讀取既有的 `LandingPage`、`LandingPageVersion`、`SalesProject`、`PaymentMethodReference`、`VendorSubscription`／`BillingPlan`。
- 獨立發布上限（#478 審查建議、owner 決定實作）：當 `publishLandingPage` 會讓頁面「只因名單型網站獨立發布而公開」時（內容通過 `isIndependentlyPublishedFunnel`、沒有綁定直播、所屬專案未發布），同一 vendor 已經這樣公開的其他頁面數量必須小於 `INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT`（3，`src/lib/independent-publish-limit.ts`），否則丟出 `landing_page_independent_publish_limit`，整個發布交易回滾（不建立版本、不建立自動名單表單）。計數範圍：`vendorId` 取自已驗證的編輯範圍、跨該 vendor 所有專案；只算 `status = published`、有 `publishedVersionId`、`archivedAt: null`、專案未發布也未封存、已發布版本通過 SQL 預篩（`independentAudienceVersionWhere`）且解析後通過 `isIndependentlyPublishedFunnel`、沒有直播的頁面。已發布專案內的頁面、草稿、取消發布與封存的頁面都不計。
- 不受上限：該 vendor 有有效且已驗證的商家付款方式（沿用 `verifiedVendorPaymentMethodWhere`），或有 `status = active`、`startedAt <= now`、`endedAt` 為空或晚於現在、方案 `monthlyPriceCents > 0` 的 `VendorSubscription`。`pending_payment`、已結束或免費方案都不算。
- 併發：`publishLandingPage` 的交易明確使用 `isolationLevel: ReadCommitted`，第一個語句就取 `pg_advisory_xact_lock(hashtextextended('landing-page-independent-publish:<vendorId>', 0))`，同一 vendor 的發布依序執行；之後每個語句都是新的 READ COMMITTED snapshot，看得到等待期間已提交的發布，不會超過上限。若改成 REPEATABLE READ／SERIALIZABLE，snapshot 可能早於取鎖，上限就可能被突破，所以不得更改。不同 vendor 不互相等待。
- 計數方式：SQL 先過濾（`independentlyPublishedPageCandidatesWhere`：已發布、未封存、專案未發布也未封存、已發布版本 `liveId` 為空、goal 為 audience、沒有銷售或 Webinar 步驟），再依 `id` 每批 25 筆解析內容排除含商品結帳設定、付款元件或結帳聯絡表單的頁面；找到 3 個符合的就停止，最多解析 500 筆。完整掃描時訊息顯示確切數量；提前停止或達掃描上限時訊息不寫數字，達掃描上限但不足 3 個時視為已達上限（寧可擋）。
- 平台緊急開關：伺服器環境變數 `INDEPENDENT_AUDIENCE_PUBLISH_DISABLED=1`（或 `true`）暫停所有商家（含付費、已驗證付款方式）的新獨立發布，回 `landing_page_independent_publish_disabled`，狀態說明原因並連到專案頁；已公開的頁面維持公開、可重新發布；已發布專案內的頁面不受影響。未設定或其他值＝開啟（預設）。目前沒有平台設定 model，因此以環境變數實作並登記在 `.env.example`；這是在商家 Email 驗證上線前的過渡措施。
- 既有頁面：上限只檢查新的獨立發布。已經以這種方式公開的頁面（含上線前發布、超過上限的頁面）不會被取消發布，重新發布也不佔新名額。
- 專案狀態：目前 `publishSalesProjectAction` 是 `SalesProject.status` 唯一的寫入者，沒有「取消發布專案」或「解除封存專案」的路徑。日後若新增，必須對該專案已發布的名單網站套用上限與緊急開關，或把超出的頁面改回草稿，否則這些頁面會不經發布檢查就變成獨立公開（程式註解在 `publishSalesProjectAction`）。
- 新增步驟規則是使用體驗與資料整潔規則，不是安全邊界（goal 由商家宣告，舊文件可繞過）；能否不發布專案就公開只由 `isIndependentlyPublishedFunnel`／`publicFunnelProjectGateWhere` 決定。
- Email 驗證：商家帳號目前沒有已儲存的 Email 驗證訊號（`/register` 建立 `User` 時不寄驗證信，`User` 沒有 `emailVerifiedAt`；`/verify-registration` 是訪客報名確認），所以本次沒有 Email 驗證條件；若要加上需新增欄位（forward migration）與驗證信流程。（2026-10-25 已補上，見「商家 Email 驗證與 Turnstile」一節。）
- 發布狀態：`getLandingPagePublicationStatus` 對未發布、專案未發布的名單網站先跑同一個計數（唯讀，發布交易內會在鎖後重算），達上限時說明原因並附「發布所屬專案」「新增並驗證商家付款方式」（僅在 `funnel_binding` 開放時）「升級付費方案」連結；發布被擋時 action 也回傳同一份狀態。名單網站因內容需要專案發布時，訊息會逐一列出步驟與頁面（例如「步驟『感謝頁』屬於銷售流程」「頁面『名單頁』含付款元件」）。
- 新增步驟：`funnelStepGroupsAddableForGoal` 是唯一規則（`audience`：名單、資訊；`sell`／`custom`：銷售、名單、資訊；`webinar`：再加 Webinar）。`addFunnelStep`（含 `save_steps` 的 `add` 指令）、`duplicateFunnelStep`、管理頁的新增步驟選單，以及 `createLandingPage`／`saveLandingPageDraft` 的整份儲存（`stepsAddedOutsideGoal`：與目前草稿比對 id＋type，新增的才拒絕，`landing_page_step_type_not_allowed`）都套用。`parseFunnelFlow` 不變，已含銷售步驟的名單網站仍可讀取與儲存，並維持需要專案發布。
- 測試：`src/lib/audience-independent-publish-limit.db.test.ts`（第 4 個被擋且交易無殘留、取消發布與封存釋出名額、付費方案與已驗證付款方式不受限、待驗證／過期付款方式與免費／已結束方案不算、已發布專案的頁面不計、跨專案合計、4 個併發只成功 1 個、上線前的頁面維持公開且可重新發布、30 個含付款元件的已發布名單頁不佔名額且數量訊息正確、緊急開關、跨 vendor 互不影響）、`src/lib/audience-funnel-independent-publish.db.test.ts`（只有名單步驟但頁面含商品結帳設定或付款元件：SQL 預篩放行、loader／runtime 關閉、`resolvePublishedFunnelCheckout` 為 null、狀態訊息點名頁面）、`src/lib/landing-page-service.test.ts`、`src/app/actions/landing-page-actions.test.ts`、`src/lib/funnel-flow.test.ts`、`src/components/landing-pages/funnel-display-labels.test.ts`、`src/components/landing-pages/funnel-operations-panel-actions.test.tsx`。

## 2026-10-24 一頁式網站 R4：舊版頁面轉換與報名按鈕動作（無 migration）

- 沒有新增 model、欄位或 migration；目前仍為 154 models、124 forward migrations。變更只在 `LandingPage.draftContent`／`LandingPageVersion.content` 的 JSON 契約。
- `PageDocument` 節點動作新增 `{ type: "registration", formId, useBoundLive }`（`useBoundLive` 預設 `true`，嚴格 schema，不接受 slug 或其他欄位）。只存表單 id：公開 slug 與目前綁定的直播在渲染時由伺服器記錄解析（公開頁用已發布版本載入的表單與直播，編輯器用目前專案的啟用表單與所選直播），表單改 slug、直播改綁都會跟著變，絕不信任文件內存的 slug。
- 驗證不變量：`registrationFormIdsInContent` 會收集這些 `formId`，所以 `validateBindings`（儲存、發布、回復版本、複製）、`publicLiveBindingValid` 與公開載入的表單檢查（同 vendor＋project、`isActive`）都與舊版 `{ type: "registration" }` 動作相同；表單停用時不能發布，已發布頁回 `form_unavailable`。既有文件可原樣解析（新增的 union 成員，不改舊成員）。
- 舊版（schema v1）草稿只在編輯器端轉換成 `PageDocument`，商家儲存前不寫入；已發布的舊版版本在重新發布前仍由舊版渲染器顯示。
- 測試：`src/lib/legacy-landing-page-converter.test.ts`、`src/lib/funnel-registration-action.test.ts`、`src/lib/landing-page-service.test.ts`（跨租戶／跨專案表單拒絕、停用表單擋發布、公開頁 `form_unavailable` 與目前 slug）、`src/components/landing-pages/legacy-landing-page-render.test.tsx`、`src/components/landing-pages/funnel-registration-links.test.tsx`、`src/components/landing-page-workspace.test.tsx`。
## 2026-10-25 商家註冊改為邀請制（無 migration）

- 沒有新增 model、欄位或 migration；目前仍為 154 models、124 forward migrations。邀請不存資料表：`src/lib/merchant-registration-invite.ts` 簽出 `mri1.<base64url JSON {purpose:"merchant_registration", email, exp, jti}>.<HMAC-SHA256>`，金鑰是 `deriveSensitiveDataKey("merchant-registration-invite:r2:9ecb5a622edbf327")`（2026-10-25 由可猜的 `merchant-registration-invite-v2` 改為帶隨機後綴的名稱：修正前的 CSRF fingerprint oracle 可為任何用途字串衍生金鑰，不論是否用過，而 staging 的舊 oracle 一直運作到當天切換別名為止。改名時尚未簽發任何邀請，所以不接受舊鑰。邀請與 `merchant-invite-email:r2:bcaa6cb59eb97af3` 雜湊的安全性仍**以 CSRF 金鑰分離修正 PR #485 已部署到該環境為前提**，見 O-25；名稱集中在 `src/lib/derived-key-purposes.ts`）（由 `CSRF_SECRET`，未設定時 `JOB_SECRET` 衍生，與 CSRF／MFA 等用途分開），有效 14 天，常數時間比對簽章後才解析 payload。
- `REGISTRATION_MODE`（`src/lib/registration-mode.ts`）：未設定、空白或其他值＝`invite`；只有 `open` 開放自助註冊。`ProductionEnvSchema` 接受 `invite`／`open`，其他值讓 preflight 失敗；Preview／Production 設 `open` 會出 warning。
- `registerAction` 在 invite 模式下於 CSRF 之後、任何寫入前重新驗證表單隱藏欄位 `invite`，並要求送出的 Email（trim＋lowercase）等於 token 內的 Email；不符合時不建立 `User`／`Vendor`／`VendorMember`／`UserPolicyConsent`／`AuditLog`。只要帶了有效、未撤銷且 Email 相符的邀請（不論模式），`registration_completed` 稽核紀錄的 `after.registrationInvite.jti` 就記錄使用的邀請，不存 token。`User.email` 唯一，所以一個邀請最多建立一個帳號。
- 撤銷：有 `merchant_registration_invite_revoked`（`vendorId: null`、`targetType: "MerchantRegistrationInvite"`、`targetId: jti`）稽核紀錄的 token，`registerAction` 回 `invite_revoked`、不寫入任何資料，`/register` 顯示已撤銷。查詢走既有的 `AuditLog @@index([targetType, targetId])`，一次索引查詢。已用該邀請建立的帳號不受影響。
- `/admin/merchant-invitations`（`requireFinanceAdmin`：平台管理員＋已驗證 MFA；產生與撤銷另需 `requireRecentMfa` 15 分鐘 step-up）產生連結但不寄信，先寫 `AuditLog`（`vendorId: null`、`action: "merchant_registration_invite_created"`、`targetType: "MerchantRegistrationInvite"`、`targetId: jti`、`after: { maskedEmail, emailHash, expiresAt }`）才回傳連結。稽核紀錄不存明碼 Email、token 或自由文字：`maskedEmail` 為 `maskEmailRecipient` 遮罩，`emailHash` 為 `HMAC(deriveSensitiveDataKey("merchant-invite-email-v1"), 正規化 Email)`。頁面列出最近 30 筆，狀態以 jti 對應 `registration_completed` 的 `after.registrationInvite.jti`（以 `[action, createdAt]` 索引、`createdAt >= 最早邀請` 限縮）與撤銷紀錄判斷，不以 Email 查詢 `User`。
- 商家 Email 驗證仍未實作（見上一節）；正式開放註冊（`REGISTRATION_MODE=open`）前必須先補 Email 驗證欄位與寄信流程（forward migration）及 Turnstile。（2026-10-25 已補上，見下節。）
- 測試：`src/lib/merchant-registration-invite.test.ts`、`src/lib/merchant-registration-invite-records.test.ts`、`src/lib/registration-mode.test.ts`、`src/lib/env.test.ts`、`src/app/actions/registration-actions.test.ts`、`src/app/actions/registration-actions.db.test.ts`、`src/app/actions/merchant-invitation-actions.test.ts`、`src/app/admin/merchant-invitations/page.test.tsx`、`src/app/register/page.test.tsx`、`tests/e2e/registration-onboarding.spec.ts`、`tests/e2e/accessibility.spec.ts`。

## 2026-10-25 商家 Email 驗證與 Turnstile

- `20261025120000_user_email_verified_at`：forward-only、純新增。`User` 新增可為 NULL 的 `emailVerifiedAt TIMESTAMP(3)`（無預設值，只改 metadata、不重寫表；交易層級 `lock_timeout = 5s`）。**不回填**：既有帳號維持 NULL，視為「舊帳號、已請求驗證」，登入、後台與已公開頁面不受影響。沒有新的 CHECK、索引或 RLS 變更；Prisma 6 drift 檢查不變。目前 154 models、125 forward migrations；既有 SQL／checksum 不變。
- 只有「平台自己寄出、收件人開啟」的連結會設定 `emailVerifiedAt`：(1) 商家驗證信（`src/lib/merchant-email-verification.ts`）；(2) 接受成員邀請（邀請 token 只由平台寄到該 Email、只存 SHA-256；新帳號建立時即帶 `emailVerifiedAt`，既有帳號在同一 Serializable 交易內以 `id + email + emailVerifiedAt IS NULL` 更新）；(3) 完成密碼重設（重設連結只寄到帳號 Email；Email 不可變更；已有時間戳時不覆寫）。商家註冊邀請（#484）是平台管理員手動轉交的持有者連結，**不算**信箱證明，邀請註冊的帳號仍需驗證。
- 驗證連結：`mev1.<base64url JSON {purpose:"merchant_email_verification", userId, exp, jti}>.<MAC>`，MAC = `HMAC-SHA256(deriveSensitiveDataKey("merchant-email-verification:r2:5a881e5879ba6156"), "mev1-mac:" + body + "\0" + 帳號目前的 Email)`。**token 不含 Email**（外洩的連結不會洩漏信箱），MAC 綁定 Email；確認時先嚴格解析 payload（有界、strict schema、未過期）取 `userId`，載入該使用者，以資料庫中的 Email 重算 MAC 並常數時間比對，Email 變更即失效。用途字串帶隨機後綴（repo 公開；#485 前的 oracle 可衍生任何可猜字串的金鑰）；不變量：任何公開部署仍跑 #485 前的程式時，不得上線新用途。`src/lib/merchant-email-verification-token.test.ts` 以合成根金鑰鎖住衍生金鑰與 MAC 的 golden 值。已登記在 `DERIVED_KEY_ROTATIONS.merchantEmailVerification`（無 legacy），程式只經由 registry 取用；`src/lib/derived-key-purpose-registry.test.ts` 靜態掃描所有正式程式的 `deriveSensitiveDataKey`／`encryptSensitiveValue`／`decryptSensitiveValue` 用途，未登記又未列入（附理由的）允許清單就讓 CI 失敗，目前允許清單只有尚未輪替的第 4 級加密與雜湊索引用途，以及執行時才由 registry 取值的變數。有效 24 小時。沒有 token 資料表；稽核只記 `jti`，不存 token 或連結。信中連結開 `/verify-email?token=`，頁面只顯示「確認驗證 Email」按鈕、不顯示任何 Email；真正的更新是 `POST /api/auth/email-verification/confirm`（需 Origin、同源、IP 限流 20 次／分鐘），避免信箱掃描器預先開啟連結就完成驗證。兩者都送 `Referrer-Policy: no-referrer`。最後的 DB 操作為 `user.updateMany({ where: { id: token.userId, email: <MAC 已比對的資料庫 Email>, status: "active", emailVerifiedAt: null } })`，所以 Email 變更後舊連結失效、他人帳號或停權帳號不受影響；重複開啟回 `already_verified`（冪等）。稽核：`merchant_email_verification_sent`／`_email_failed`／`_suppressed`（`targetType: "User"`）、`merchant_email_verified`。
- 寄送：註冊交易提交後以 `after()` 寄第一封（不阻擋回應）；已登入者在 `/verify-email` 可「重新寄送驗證信」（`resendMerchantEmailVerificationAction`：CSRF → `requireAuth` → 已驗證就不寄 → IP 層 10 次／15 分鐘 → Turnstile → 帳號層）。帳號層 `ACCOUNT_RATE_LIMITS.merchant_email_verification` 每收件 Email 3 封／小時（含註冊時那封，PostgreSQL 計數、計數器失敗即不寄）。只寄到 session 使用者自己儲存的 Email，表單內沒有任何 user 或 Email 欄位被讀取。沿用既有 Resend `sendTransactionalEmail`，沒有新增寄信供應商。
- 閘門（封測最小範圍）：`independentPublishAllowance` 在平台緊急開關之後、付費／付款方式放行之前檢查 `vendorOwnerEmailVerified`；未驗證的商家**新的**獨立發布名額為 0，回 `landing_page_independent_publish_email_unverified`，發布狀態附「驗證 Email」（`/verify-email`）與「發布所屬專案」連結；已公開的頁面維持公開、可重新發布；已發布專案內的頁面不受影響；付費方案也適用。驗證完成後回到一般上限（3）。判斷方式（`vendorEmailVerificationState`）：商家的「創辦帳號」＝ Email 等於 `Vendor.email`、`status = active` 且仍是該商家 active 成員的 `User`（`/register` 以同一 Email 建立兩者，且兩欄都唯一），存在時只看它的 `emailVerifiedAt`，所以邀請已驗證的共同 owner 進拋棄式商家本身不能解除限制；沒有這樣的創辦帳號時（非 `/register` 建立、創辦人停權或已離開）才以「任一 active owner 已驗證」判斷。**這只是減速，不保證「一個信箱只解鎖一個商家」**：plus-addressing 等別名讓一個人擁有許多可驗證的地址，刻意停用創辦人（需 owner step-up MFA）也能走到退回規則。真正限制拋棄式帳號的是 Turnstile、註冊限流（IP 層 4 次／15 分鐘）與每商家的獨立發布上限。每次「只因退回規則」而允許的新獨立發布，都在發布交易內寫一筆 `independent_publish_email_gate_owner_fallback` 稽核（`targetType: "LandingPage"`、`after: { reason }`，reason 為 `no_founder_account`／`founder_suspended`／`founder_left_vendor`，不含 Email）。人工處理見 `docs/goal-beta-prep-2026Q4/BETA-OPS.md`（創辦人完成密碼重設即視為已驗證）。後台提示是有標籤的一般區塊（`<section aria-label="Email 驗證提醒">`），不是 live region，避免與各頁自己的 `role="status"` 訊息重疊；提示與閘門一致：商家已驗證時不顯示；未驗證時，能讓商家通過驗證的帳號看到重新寄送流程，其他成員只看到遮罩後的創辦帳號 Email（「請商家註冊帳號（…）完成 Email 驗證」），沒有替他人寄信的按鈕。查詢都在發布交易內、取 per-vendor advisory lock 之後執行，`vendorId` 只來自已驗證的編輯範圍。
- 部署順序：auth 每個請求都讀 `User` 的全部欄位，所以 **migration 必須先於程式**。staging：`staging-migrate.yml` `status` → `deploy` → 再切 alias；Production 同理（需先完成 O-4、O-19、O-20）。
- 成員邀請接受時遇到 P2034（序列化衝突）改回可重試的 `retry`（「請再按一次接受邀請」），不再顯示「邀請無效」。
- 寄給第三方的信（報名確認、開播提醒、直播後追蹤、自動化 `send_email_notification`、訂單信、學員 magic link）**這次不設閘門**：這些都由收件人自己的動作（報名、購買）觸發，報名信另有收件人雙重確認（`form_submission_verification`），自動化信只用平台固定文案；若在 `dispatchEmailDelivery` 集中擋未驗證商家，會讓既有（未驗證的）封測商家已排程的提醒全部停寄。列為後續：商家自訂 `MessageTemplate` 內容寄給第三方前，評估是否要求商家已驗證。
- Turnstile：`/register` 與重新寄送驗證信都在任何寫入或寄信前呼叫 Cloudflare siteverify（`src/lib/turnstile.ts`，5 秒逾時，`action` 分別為 `merchant_register`、`merchant_verify_email_resend`）。網路錯誤、逾時、非 2xx、格式不符、拒絕、`action` 不相符（含缺少）或 `hostname` 不在允許清單（canonical app URL 主機、該次 Vercel preview 的 `VERCEL_URL`、`TURNSTILE_ALLOWED_HOSTNAMES`）一律拒絕（fail closed）；只有 Cloudflare 文件公開的測試 secret 略過 hostname 與 action 比對，而測試金鑰在 Vercel Preview／Production 一律視為設定錯誤。`NEXT_PUBLIC_TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` 都未設定時停用（表單照常可用，preflight 警告）；只設定一個時一律拒絕且 preflight 失敗；Preview／Production 設 `REGISTRATION_MODE=open` 而 Turnstile 或寄信（`RESEND_API_KEY`、`EMAIL_FROM`）未設定時 preflight 失敗。CSP（report-only）的 `script-src`、`frame-src`、`connect-src` 加入 `https://challenges.cloudflare.com`。測試只使用 Cloudflare 文件公開的測試金鑰。
- 測試：`src/lib/merchant-email-verification-token.test.ts`、`src/lib/merchant-email-verification.db.test.ts`（綁定、冪等、Email 變更、停權、過期、寄送與帳號層限流、供應商失敗、成員邀請與密碼重設設定驗證、創辦帳號判斷）、`src/lib/audience-independent-publish-limit.db.test.ts`（未驗證 0 個、驗證後一般上限、付費也適用、既有公開頁不受影響、共同 owner 無法解除、跨商家不互通、無創辦帳號時的退回規則）、`src/lib/turnstile.test.ts`、`src/lib/env.test.ts`、`src/app/actions/registration-actions.test.ts`、`src/app/actions/registration-actions.db.test.ts`（註冊後經 mock 供應商寄出可用的驗證連結）、`src/app/actions/email-verification-actions.test.ts`、`src/app/api/auth/email-verification/confirm/route.test.ts`、`src/app/verify-email/page.test.tsx`、`src/app/register/page.test.tsx`、`src/app/(app)/layout.test.tsx`、`next.config.test.ts`。

## 2026-10-25 衍生金鑰依用途輪替（B04-03，無 migration）

- 沒有新增 model、欄位或 migration；目前仍為 154 models、124 forward migrations。變更只在既有字串欄位的內容格式，舊格式持續可讀。
- `UserMfaFactor.secretEncrypted`：新寫入一律為 `m2.<iv>.<tag>.<data>`（AES-256-GCM，金鑰 `mfa-encryption:r2:…`）；舊格式 `<iv>.<tag>.<data>`（金鑰 `mfa-encryption`）仍可解密。`/mfa/verify` TOTP 成功後以 `updateMany where { userId, secretEncrypted: 舊密文 }` 的 compare-and-swap 改存新格式；`scripts/reencrypt-mfa-secrets.ts` 以同一 CAS 批次處理（預設 dry run；`--execute` 需確認值；先以舊鑰解密成功並驗證新密文可解回同一 secret 才寫入；可重跑）。全部環境都沒有舊格式後，才可移除舊鑰（`DERIVED_KEY_ROTATIONS.mfaEncryption.legacy`）。
- **部署前提不變量**：repo 是公開的，新用途名稱推上 GitHub 後任何人都看得到；推送任何新用途名稱之前，必須沒有任何可公開連線的部署仍執行 #485 之前的程式碼（Preview 與舊部署一律留在 Vercel Authentication 之後，絕不可把舊部署重新 alias 到公開網域）。production 服務任何人之前必須先輪替根金鑰並重新註冊管理員 MFA，步驟與 2026-10-25 查核紀錄見 `docs/staging-production-env-vars.md` §7 第 7 點。
- 第 3 級舊鑰除了停用日，另以 `ROTATION_EFFECTIVE_AT`（2026-10-27 00:00 台灣時間；staging alias 必須在此之前切換，否則先調整常數）檢查 token 內的 `issuedAt`／`expiresAt`，生效後才簽發的舊鑰 token 一律拒絕；自動化優惠券以 `AutomationVoucherGrant.createdAt` 判斷。
- 應用層 AES-GCM 解密固定 16-byte tag：`sensitive-data.ts`、`mfa.ts` 先確認 tag 為 16 bytes 並指定 `authTagLength: 16`；`bank-account.ts`、`affiliate-tax-identity.ts` 原本就檢查長度，另指定 `authTagLength: 16`。PayUni `decryptInfo` 不在此列（另案，見 `docs/staging-production-env-vars.md` §7 第 7 點）。
- 同批改名（第 1、2 級，不接受舊鑰）：私訊 conversation binding `live-private-chat-conversation-binding:v1` → `…:r2:…`、CSRF MAC `csrf-hmac-v1` → `csrf-hmac:r2:…`（CSRF token 最長 2 小時，部署後舊 token 失效，行為同過期）、商家邀請簽章與邀請稽核 Email 雜湊（見上一節）。
- `UserRecoveryCode.codeHash`：新雜湊為 `hmac-sha256-v2:<digest>`（金鑰 `mfa-recovery-code-authentication:r2:…`）；`hmac-sha256-v1` 仍以舊鑰驗證，更早的 password-hash 格式不變。復原碼一次性，不做重算雜湊。
- 測試：`src/lib/mfa.test.ts`、`src/lib/derived-key-rotation.test.ts`、`src/lib/sensitive-data.test.ts`（舊與新用途 golden key）、`src/app/actions.test.ts`（lazy re-encrypt 與失敗不擋登入）、`scripts/reencrypt-mfa-secrets.db.test.ts`（dry run 不寫入、apply 冪等、錯誤根金鑰不寫入、不可讀列阻擋、CAS 不覆寫重新註冊、目標資料庫守門）。

## 2026-10-25 商家成員「夥伴」角色

- `20261025180000_vendor_member_invitation_partner_role`：forward-only、只放寬允許值。`VendorMemberInvitation_role_check` 重建為 `owner`／`admin`／`accountant`／`support`／`partner`（既有列必然符合；邀請表每商家筆數有界，驗證掃描很短；交易層級 `lock_timeout = 5s`）。`VendorMember.role` 本來就沒有 CHECK，這次也不新增（既有資料的角色值未經盤點，不在這次加上限制）。沒有新 model、欄位、索引或 RLS 變更；Prisma 6 不比對 CHECK，drift 檢查不變。目前 154 models、126 forward migrations；既有 SQL／checksum 不變。
- 權限邊界（`src/lib/vendor-roles.ts`）：只排除 `partner`。`auth.chooseVendor` 從**非 partner** 的 active membership 中選出目前的 vendor context，所以 `partner` **永遠不會**成為 `auth.vendor`／`auth.member`，即使 session 的 `vendorId` 指向它。所有讀 `auth.vendor`／`auth.member` 的 guard、頁面、Server Action 與 API route（含直接呼叫 `getCurrentAuth()` 的 route）因此預設拒絕夥伴，不需各自加角色判斷。其他角色（含未盤點的舊角色，例如 `member`、`editor`、`manager`）維持原本行為：成為 vendor context，再由 manager／support／finance／owner 等 guard 各自判斷（`insufficient_role`）。`partnerPortalOnly` ＝ 有 active partner membership 且沒有任何非 partner 的 active membership（平台管理員除外）。`requireVendorContext` 另外再檢查一次 partner（縱深防禦），並把 `partnerPortalOnly` 帳號導向 `/affiliate-portal`；`requireVendorOwner` 不經過它，也同樣導向。`src/lib/live-private-chat.ts` 對 legacy session 重算 vendor 選擇時採用相同規則。
- 夥伴入口（`/affiliate-portal`、`/affiliate-portal/[vendorSlug]/[affiliateId]`、`…/remuneration` 與 `affiliate-remuneration-actions` 的夥伴端 action）只用 `requireAuth` 與 `userId`，授權仍完全來自 `AffiliatePortalAccess`（active、affiliate active、member／user active），行為不變。
- 角色等級：`partner` 最低（`ROLE_RANK.partner = 0`）。owner 可直接把 admin／accountant／support 調降為 partner；從 partner 調高一律要透過邀請並由本人接受。接受邀請、last-owner 檢查、Serializable 交易與 audit 沿用既有流程；以邀請把既有 support 改成 partner 時，同一 session 立刻失去後台。
- 登入與導向：`authenticateUser` 回傳 `partnerPortalOnly` 與 `partnerVendorId`；只有夥伴身分的帳號可以登入（不再回 `no_vendor`），session 與 `login_success` 稽核的 `vendorId` 記錄夥伴所屬商家；登入、MFA 驗證預設 next、接受邀請後、`/` 與 `/verify-email` 的「回到帳號」都依 `signedInHomePath` 導向 `/affiliate-portal`。夥伴的 MFA 設定、確認與救援碼確認都回 `/mfa/setup`（夥伴沒有 `/settings/security`）。同時是 A 商家夥伴、B 商家客服的帳號進入 B 的後台。
- 停用成員（`deactivateVendorMemberAction`）：在同一 Serializable 交易內計算該帳號**其他** active membership 數。為 0 時依 `userId` 撤銷該帳號所有 session（含 `vendorId` 為 NULL 的邀請登入 session 與記錄其他商家的 session）；否則只撤銷 `userId`＋本商家 `vendorId` 的 session，不登出該帳號在其他租戶仍合法使用的 session。
- 後台選單：夥伴只有「夥伴入口」；其他角色只有在**目前商家、目前成員**有有效的 `AffiliatePortalAccess` 時才顯示「夥伴入口」（`hasActiveAffiliatePortalAccess`，條件與入口清單相同並綁定 `vendorId`＋`vendorMemberId`＋`userId`）；原本對所有人顯示的帳號選單連結已移除。商家 Email 驗證橫幅（#487）只顯示給 owner。`/affiliates/[id]/access` 的成員選單先列 partner，再列其他角色，游標為 `p.<id>`／`o.<id>` 並驗證屬於本商家、該群組。
- 已知限制：夥伴看不到 `/settings/security`（在後台 layout 之下），改密碼請用忘記密碼流程；MFA 在 `/mfa/setup` 設定。同一帳號若只在另一個商家有入口授權，目前商家的選單不會出現連結（依「綁定目前 vendor 與 member」的規則），可直接開 `/affiliate-portal`。團隊漏斗（`/partner-pages`、`/team-templates`、`/team-template`）屬於後台，夥伴同樣被拒絕；`/settings/team` 的候選成員仍會列出 partner（後續處理）。被調降為 partner 的創辦帳號仍決定 Email 發布門檻（後續處理）。
- 測試：`src/lib/vendor-roles.test.ts`、`src/lib/auth.test.ts`（每個商家 guard 對夥伴導向入口、MFA、跨商家選擇、舊角色維持原行為）、`src/lib/mfa-enrollment.test.ts`、`src/lib/vendor-member-invitation.db.test.ts`（PostgreSQL：邀請／接受／登入、guard／layout／action／API 拒絕矩陣與 owner 正向對照、入口仍可用、停用撤銷 session（含無 vendor 的 session，且不撤銷其他租戶仍有效的 session）、調降規則、support 經邀請變夥伴、入口連結綁定與跨租戶否定、CHECK）、`src/app/actions.test.ts`（夥伴登入導向）、`src/app/(app)/layout.test.tsx`（橫幅只給 owner、入口連結）、`src/components/app-shell.test.ts`（選單）、`src/app/(app)/affiliates/[id]/access/page.test.tsx`（partner 優先與分頁）、`src/app/invitations/accept/page.test.tsx`。

## 2026-10-27 一頁式網站黑金展示元件與範本（無 migration）

- 沒有新增 model、欄位或 migration；目前仍為 154 models、126 forward migrations。變更只在 `LandingPage.draftContent`／`LandingPageVersion.content` 的 `PageDocument` JSON 契約，舊文件照常解析。
- `FUNNEL_NODE_TYPES` 新增 10 種沒有子節點的展示元件：`nav_bar`（可放在 root、section、row）、`shape_divider`（root、section、row）、`section_title`、`icon_list`、`stats`、`logo_strip`、`image_cards`、`content_cards`、`video_gallery`、`testimonial_wall`（row、各欄、content_box）。內容全放在 `props`（JSON），讀取端 `@/lib/funnel-showcase` 每次渲染都重新驗證：文字截斷、連結走 `safeContentHref`、圖片走 `safeContentAssetUrl`、顏色走樣式同一份允許清單、列舉值不在清單就用預設值，項目數上限 24。
- `FUNNEL_BLOCK_CATEGORIES` 新增 `social_proof`、`content_showcase`、`call_to_action`（只影響版型區塊分類，不寫入文件）。
- `section.props` 新增選用的 `backgroundImage`（經 `funnelBackgroundImageValue`，只接受 HTTPS 或本站路徑且不含 CSS 斷字元）、`backgroundPosition`、`overlayColor`、`overlayOpacity`（0–100）、`overlayFade`；`content_box.props` 新增選用的 `decoration`（`frame`／`corners`）與 `decorationColor`。未設定時渲染結果與之前完全相同。
- 影片牆：YouTube 網址只解析出 11 碼影片 id，訪客按下播放後才載入 `https://www.youtube-nocookie.com/embed/<id>`（iframe 加 sandbox）；其他安全網址在新分頁開啟。`next.config.ts` 的 report-only CSP `frame-src` 加上 `https://www.youtube-nocookie.com`。
- 編輯器圖片上傳沿用 `/api/media/images/presign` → R2 PUT → `/api/media/images/complete`（商家 API actor 與 CSRF 檢查不變），只把回傳的公開 HTTPS 網址寫進 props。
- 範本 `custom-luxury-course`（`src/lib/funnel-template-luxury-course.ts`）帶自己的頁面字型／配色（`FunnelTemplateGalleryItem.theme`）；其他範本行為不變。
- 測試：`src/lib/funnel-showcase.test.ts`、`src/components/landing-pages/funnel-showcase-elements.test.tsx`、`src/lib/funnel-template-gallery.test.ts`、`src/lib/funnel-block-library.test.ts`、`src/lib/funnel-element-inspector.test.ts`、`next.config.test.ts`。

## 2026-10-27 一頁式網站自訂程式碼、頁面自訂 CSS 與追蹤整合

- `20261027150000_tracking_setting_browser_tags`：forward-only、純新增。`TrackingSetting` 新增可為 NULL 的 `ga4MeasurementId TEXT` 與 `enableBrowserTags BOOLEAN NOT NULL DEFAULT false`（常數預設值在 PostgreSQL 11+ 只改 metadata；交易層級 `lock_timeout = 5s`）。**不回填**：`enableBrowserTags` 預設關閉，既有只為伺服器端 Conversions API 填 Meta Pixel ID 的商家，公開頁行為完全不變。沒有新 model、CHECK、索引或 RLS 變更；`scripts/prisma-drift-check.mjs` 通過（100/100 allowlisted）。目前 154 models、127 forward migrations；既有 SQL／checksum 不變。
- **部署順序**：`auth` 每個請求都以 `vendor: { include: { tracking: true } }` 讀取 `TrackingSetting` 全部欄位，所以 **migration 必須先於程式**（同 2026-10-25 `emailVerifiedAt`）。共用 `node_modules` 的 worktree 執行 `prisma generate` 後，未套用此 migration 的本機資料庫在讀取 `TrackingSetting` 時會失敗。
- 追蹤 ID 格式（`src/lib/tracking-integration-ids.ts`，儲存時與渲染前都驗證）：GA4 `^G-[A-Z0-9]{4,16}$`、GTM `^GTM-[A-Z0-9]{4,12}$`、Meta Pixel 沿用 `META_PIXEL_ID_PATTERN`（`^\d{5,32}$`）、TikTok `^[A-Z0-9]{10,32}$`；英文字母轉大寫；只驗證這次有變動的欄位（原封不動送回的舊值照舊保留，不會被渲染，因為渲染前與伺服器 transport 都會再驗證），變動欄位格式不符時整份設定不寫入。公開頁（`src/app/lp/[slug]/layout.tsx`）只在 `enableBrowserTags && enablePageView` 時以平台產生的標準 snippet 載入 GA4 與 Meta Pixel；**GTM 容器不載入**（容器可執行任意自訂 HTML／JS，等於商家程式碼跑在平台網域）。查詢條件與公開頁相同（`publicLandingPageCandidateWhere`、slug 唯一），只選 4 個欄位，錯誤時不載入。
- `PageDocument` 契約（JSON 欄位，無 migration）：
  - `raw_html` 節點（編輯器顯示「自訂程式碼」）的基礎 `props` 可有 `html`（舊資料可能是 `content`）、`css`、`js` 三個字串，UTF-8 上限 HTML 50,000、CSS 20,000、JS 50,000 bytes；其他節點型別的字串 prop 仍為 10,000 字元。程式碼不支援桌機／手機覆寫：渲染只讀基礎 props，覆寫內的同名欄位被忽略（舊資料不會因此整份失效）。
  - `settings.customCss`（選填）：頁面自訂 CSS 原始碼，最大 20,000 bytes，必須通過 `compileFunnelCustomCss`（`src/lib/funnel-custom-css.ts`）。渲染時重新編譯，只輸出每個選擇器都加上 `[data-funnel-content]` 前綴的結果；`html`／`body`／`:root` 改寫成容器本身。
  - `src/app/actions/landing-page-actions.ts` 的整份內容上限由 128 KiB 提高到 512 KiB（一個自訂程式碼節點最多約 120 KB，JSON 跳脫後更大）。
- 伺服器閘門（`src/lib/funnel-custom-code-guard.ts`）套用在每條寫入 `LandingPage.draftContent` 的路徑：建立、儲存、`save_steps`、回復歷史版本、複製頁面（視為全部新增）；刪除與發布另有檢查。`saveFunnelOperations` 只改 `flow` 中繼資料、沿用已解析的內容，不會改動自訂程式碼。
  - 比對新舊內容（位置＝`<step:id|page>/node:<id>` 或 `/page_css`）；任何新增、修改、刪除都只限 `owner`／`admin`（角色取自 session 的 active membership）。
  - 新內容只要含非空 JS，儲存者（發布時為發布者）的 `User.emailVerifiedAt` 必須不為 NULL（比「只在 JS 變動時」更嚴格）。
  - 緊急開關 `FUNNEL_CUSTOM_CODE_DISABLED`（"1"／"true"）：公開頁載入時移除所有 JS 與頁面自訂 CSS（節點以 `sandbox=""`、不執行腳本顯示 HTML／CSS），並拒絕新增或修改 JS（刪除仍可）。後台（編輯器 `/landing-pages/[id]/edit`、Funnel 管理 `/landing-pages/[id]/operations`）與 `/lp/*` 由 server layout（`FunnelCustomCodeRuntime`）把開關狀態傳給 iframe；context 預設 fail-closed，沒有被伺服器明確允許的畫面一律 `sandbox=""`。`src/app/lp/full-page-navigation.test.ts` 鎖住「會渲染自訂程式碼的路由都在 runtime 之下」。
  - 隔離範圍：沙箱擋住平台 Cookie、父頁 DOM、頂層導向、儲存、表單與 fetch／XHR／WebSocket（meta CSP `connect-src 'none'`）。**資料仍可離開沙箱**：`img-src https:` 可當 beacon，iframe 也能把自己導向外部頁面（新文件不受原 meta CSP 限制，但仍在沙箱內）。所以這是「保護平台帳號與其他租戶」的邊界，不是防止商家收集訪客在 iframe 內輸入的資料；後者靠首屏與頁尾揭露、Email 驗證、稽核與緊急開關處理。
  - 頁面自訂 CSS 的 `@font-face` 字型名稱與 `@keyframes` 名稱一律加上 `cdm-` 前綴，並同步改寫同一份 CSS 中 `font-family`／`font`／`animation` 的引用，避免取代平台字型堆疊或動畫。
  - 公開 slug 保留清單（`RESERVED_LANDING_PAGE_SLUGS`：login、signin、signup、register、admin、account、dashboard、settings、support、verify、password、auth 等，及任何含 `celebratedeal` 的 slug）：建立與「變更」slug 時拒絕（`landing_page_slug_reserved`；`saveFunnelOperations` 同規則）；既有頁面沿用原 slug 與公開載入不受影響。
  - `/lp` 文件樹（含政策頁、結帳表單、根 404）連往非 `/lp` 路由一律整頁載入（`FullPageLink`），不用 next/link，避免商家 GA4／Pixel 跟著 client 導覽留在平台頁；`src/app/lp/full-page-navigation.test.ts` 走訪 import graph 鎖住。
  - 稽核：有變動的儲存與 `LandingPage` 更新在同一交易寫入 `AuditLog`（`action: "funnel_custom_code_saved"`、`targetType: "LandingPage"`、`actorId`＝使用者、`after: { operation, changes: [{ location, kind, change, fields, bytes }] }`）；發布含自訂程式碼的版本時在發布交易內寫 `funnel_custom_code_published`（`after: { version, killSwitchActive, nodes: [{ location, bytes, sha256 前 16 碼 }], pageCss }`）。永遠不存程式碼本身。
- 測試：`src/lib/funnel-custom-css.test.ts`、`src/lib/funnel-custom-code.test.ts`、`src/lib/funnel-custom-code-guard.test.ts`、`src/lib/landing-page-custom-code.test.ts`、`src/lib/landing-page-custom-code.db.test.ts`（PostgreSQL：儲存與稽核同一交易，以 trigger 讓稽核失敗時草稿回滾）、`src/app/lp/full-page-navigation.test.ts`、`src/components/landing-pages/sandboxed-html.test.tsx`、`src/lib/tracking-integration-ids.test.ts`、`src/app/actions/tracking-settings-actions.test.ts`、`next.config.test.ts`、`tests/browser-dev/funnel-custom-code.spec.ts`（`node scripts/funnel-elements-browser-qa.mjs`）。

## 2026-10-27 一頁式網站範本庫與「我的範本」

- `20261028090000_landing_page_templates`：forward-only、純新增，不改既有 table、欄位或資料。新增 `LandingPageTemplate`（`id`、`vendorId`、`name`、`content` JSONB、`sourcePageId`、`createdById`、`createdAt`、`updatedAt`）。`vendorId` FK → `Vendor` ON DELETE CASCADE；`createdById` FK → `User` ON DELETE SET NULL；`sourcePageId` **刻意不建 FK**（只供參考），刪除或封存來源頁不會被範本擋下，也不會連帶刪除範本。`@@unique([vendorId, id])`、`@@index([vendorId, updatedAt])`。CHECK：`name` 已 trim 且 1–80 字（`LandingPageTemplate_name_check`，與 `LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH` 一致）、`content` 必須是 JSON object（`LandingPageTemplate_content_check`）。啟用 RLS（不新增 policy）。交易層級 `lock_timeout = 5s`。Prisma 6 不比對 CHECK，drift 檢查不變、無新 allowlist 項目。目前 155 models、128 forward migrations（排在 `20261027150000_tracking_setting_browser_tags` 之後）；既有 SQL／checksum 不變。
- 內容來源：`saveLandingPageTemplateFromStep` 只接受 `pageId`、`stepId`、`name`；伺服器以 `vendorId + projectId + archivedAt: null` 讀出該頁的 `draftContent`，取出步驟的 PageDocument，經 `stripTemplateBindings` 清除綁定後以穩定 id（`tpl_n*`、`tpl_page`）存入。**不接受 client 傳來的 PageDocument**。清除項目（`src/lib/landing-page-template-document.ts`）：`commerce`（商品、加購、同意條款）、`flow`、`revision` 歸零、`settings.tracking`／`settings.affiliate` 重設為平台預設、popup 的 `pageId`、節點與 desktop/mobile `overrides.props` 中的資源 id（`TEMPLATE_RESOURCE_PROP_KEYS`：預約行事曆 `eventId`／`calendarId`／`bookingEventId`／`consultationEventId`、表單／直播、媒體庫、商品／價格／checkout／優惠、追蹤與推薦 id）、`registration`（報名表）與 `next_step`（步驟連結）動作改為 `none`——包含 `actions` 以及 `props`、desktop/mobile `overrides.props` 內任何深度、形狀像動作的物件（renderer 在 `actions` 為空時會讀 `props.action`）。`submit_form.formId` 與 `show_popup.popupId` 指向同一頁的表單節點／彈窗，保留並在重新產生 id 時對應到新 id（找不到的 `show_popup` 改為 `none`、`submit_form` 去掉 `formId`）。文字、樣式、圖片網址、HTML id 與 `raw_html` 原樣保留。讀取時（`readStoredTemplateDocument`）再 strip 一次。名稱另外排除控制字元與 bidi 格式字元（U+061C、U+200E/F、U+202A–202E、U+2066–2069）。
- 上限：範本內容 512 KiB、名稱 80 字、每個 vendor 100 個。範本內容上限刻意與草稿相同（共用 `LANDING_PAGE_MAX_CONTENT_BYTES`，#499 起為 512 KiB），讓編輯器能儲存的頁面一定能存成範本；代價是單一 vendor 最多約 50 MB 範本內容，列表因此只回縮圖（見下）。常數在 `src/lib/landing-page-limits.ts`（`landingPageAction` 也改用它）；套用範本與用範本建立網站在呼叫 `saveLandingPageDraft`／`createLandingPage` 前，以同一個常數檢查伺服器組好的整份網站內容，超過回 `content_too_large`（「內容超過 512 KiB 上限…這次沒有任何變更」，數字由常數產生），不寫入、revision 不變。數量檢查在 ReadCommitted 交易內先取 `pg_advisory_xact_lock(hashtextextended('landing-page-template:<vendorId>', 0))` 再計數，同一 vendor 的並發儲存無法超過上限；互動式交易逾時（P2028）回「系統忙碌中…請稍後再試」。
- 列表：只回 metadata 與縮圖用的前 2 個 root 區段（不含彈窗），完整內容在預覽時以 `getLandingPageTemplateDocument`（`findFirst where { id, vendorId }`）按需讀取。內容已無法解析的列仍列出（`readable: false`、無縮圖），只能刪除，避免看不見卻佔用 100 個名額；這種列不能預覽或套用。
- 權限：所有讀寫都走 `requireVendorManagerContext`（owner／admin），partner 導向夥伴入口、support 回 `insufficient_role`。改名／刪除的最後 DB 操作是 `updateMany`／`deleteMany where { id, vendorId }` 並檢查 count；使用他人範本一律以 `findFirst where { id, vendorId }` 查詢，查無即「找不到範本」，不洩漏存在性。
- **Vendor 層級例外（總覽唯讀）**：範本屬於商家而非銷售專案，所以列表、預覽、改名與刪除只要求 manager 角色、不要求選定專案，在「全部專案總覽（唯讀）」也可操作；這是相對於「總覽模式拒絕所有 mutation」的明確例外。存成範本、讀取套用目標、套用與建立網站會讀寫專案範圍的頁面，仍需目前選定的銷售專案（總覽時拒絕）。`landing-page-template-actions.db.test.ts` 的 aggregate overview 測試鎖住這個行為。
- 套用到現有步驟（`applyLandingPageTemplateToStep`）沿用「更換模板」的路徑：`replaceFunnelStepPage`（保留該步驟的 commerce、記錄 `step.template.templateId`，我的範本記為 `mine_<id>`）＋`saveLandingPageDraft`（重新驗證綁定，`updateMany where { id, vendorId, projectId, revision }` CAS；版本不符回衝突、不覆蓋）。平台範本只能套用到 `listFunnelTemplateGallery(goal, stepType)` 允許的步驟；系統停用頁不能套用。每次使用都以隨機前綴重新產生節點與 popup id，同一範本可套用到同一網站的多個步驟。
- 用範本建立新網站（`createLandingPageFromTemplate`）沿用 `createGoalFunnelStepPages` 與 `createLandingPage`：內容由伺服器組成，client 只送名稱、網址、目標、幣別與範本參照；平台範本的目標必須與範本一致；預設流程沒有適用步驟時（例如自訂目標）先新增一個 `info_page`。
- 範本庫標籤（`src/lib/funnel-template-catalog.ts`）：以 template id 對應用途／風格，不改 `funnel-template-gallery.ts`；未登記的平台範本依 goal 與相容步驟類型推導用途、風格預設「簡約」，仍會出現在範本庫。
- 測試：`src/lib/landing-page-template-document.test.ts`（逐一覆蓋清除欄位、`props.action`／overrides 的深層動作、`submit_form` 對應、rekey、大小、名稱與 bidi 字元）、`src/app/actions/landing-page-template-actions.test.ts`（P2028、P2002、512 KiB 訊息、未知錯誤重新拋出）、`src/lib/funnel-template-gallery-custom-code.test.ts`（每個平台範本都沒有自訂 JS 與頁面自訂 CSS）、`src/lib/funnel-template-catalog.test.ts`、`src/app/actions/landing-page-template-actions.db.test.ts`（PostgreSQL、真實 session／角色／專案範圍：存成範本清除綁定且不採用 client 內容、名稱／步驟／100 個上限與 DB CHECK、跨租戶讀取／改名／刪除／套用／建立皆拒絕且資料不變、版本衝突、步驟類型不符、建立新網站、套用或建立後超過 512 KiB 被拒且 revision 與內容不變、自訂程式碼閘門（未驗證 Email 套用／建立／存含 JS 的範本被拒且不寫入、已驗證可以並寫稽核、緊急開關拒絕新 JS、只有 HTML 時不需驗證但仍稽核）、總覽模式可改名／刪除但不能存／套用、縮圖與按需預覽、無法解析的列可刪除、5 個並發儲存不超過 100 個、support 與 partner 全部被拒且無寫入）、`src/components/landing-pages/landing-page-template-library.test.tsx`（篩選、分頁、預覽與桌機／手機切換、套用前覆蓋確認、改名、刪除、存成範本對話框）。
- 自訂程式碼（#499）：範本會保留 `raw_html` 的 html／css／js 與頁面 `settings.customCss`（不視為綁定）。三條寫入路徑都經過 `assertFunnelCustomCodeWrite`，actor 一律取自 session（`auth.user.id`、目前 membership 的 role、`User.emailVerifiedAt`），不接受 request 提供：
  - 套用範本到步驟走 `saveLandingPageDraft`（比對該頁舊草稿與新草稿）、用範本建立網站走 `createLandingPage`（比對空內容），稽核 `funnel_custom_code_saved`（`targetType: LandingPage`）的 `after.operation` 分別為 `apply_template`、`create_from_template`（兩個函式新增可選的 `auditOperation`，預設仍是 `save`／`create`）。
  - 存成範本視為「把這些自訂程式碼新增到範本」：同一個閘門比對空內容與範本內容（owner／admin；含非空 JS 時 Email 必須已驗證；緊急開關 `FUNNEL_CUSTOM_CODE_DISABLED` 時拒絕含 JS 的範本），範本內容通過 `parsePageDocument` 的自訂程式碼 schema（HTML 50 KB、CSS 20 KB、JS 50 KB、CSS 語法）。有變動時在建立範本的同一交易寫 `funnel_custom_code_saved`（`targetType: LandingPageTemplate`、`targetId` 為範本 id、`after: { operation: "save_template", sourcePageId, changes }`，只有位置、欄位與位元組數，不含程式碼）。
  - 拒絕訊息與編輯器相同（共用 `src/lib/funnel-custom-code-messages.ts`，`landingPageAction` 也改用它，文字不變）。
  - 平台範本不得含自訂 JS 或頁面自訂 CSS（任何商家都能套用，包含 Email 未驗證者）；`funnel-template-gallery-custom-code.test.ts` 逐一檢查 `FUNNEL_TEMPLATE_GALLERY`。
  - 範本庫的顯示（不影響套用與公開頁）：頁面自訂 CSS 以全頁共用的 `[data-funnel-content]` 為範圍，所以縮圖（伺服器列表與 `FunnelTemplateThumbnail`）一律以 `templateDisplayDocument` 拿掉頁面自訂 CSS 與自訂程式碼的 JS；預覽只保留被預覽那一份的頁面 CSS，同樣拿掉 JS（範本庫從不執行商家 JS，含 JS 時預覽備註會說明）。#499 的公開頁與編輯器渲染行為不變。
- Migration 改名：原 `20261027120000_landing_page_templates` 改為 `20261028090000_landing_page_templates`（內容與 checksum 不變），排在 master 已套用到 staging 的 `20261027150000_tracking_setting_browser_tags` 之後。舊名稱從未套用到 staging／Production；本機 disposable DB 若記錄了舊名稱，更新 `_prisma_migrations.migration_name` 或重建即可。

## 2026-10-28 Webinar 範本共用基礎（平板斷點、活動時間、C-01～C-18；無 migration）

- 沒有新增 model、欄位或 migration（模型與 forward migration 數不變）。變更只在 `LandingPage.draftContent`／`LandingPageVersion.content` 的 `PageDocument` JSON 契約；新增的都是選填欄位，舊文件解析結果不變。
- 節點覆寫新增 `overrides.tablet`（與 `desktop`／`mobile` 同形）。渲染 640–1079px（平板）時依序套用 `desktop` 再 `tablet`，因為 `desktop` 在平板斷點之前就代表「≥ 640px」；`funnelNodeVisibleOn` 用同一順序。存成「我的範本」的 `stripTemplateBindings` 也會清除 `tablet` 覆寫內的資源 id 與動作（`src/lib/landing-page-template-document.ts`）。
- `FUNNEL_NODE_TYPES` 新增 14 種：沒有子節點的 `event_facts`、`speaker_profiles`、`agenda_timeline`、`callout`、`fit_compare`、`add_to_calendar`、`value_stack`、`session_schedule`、`deadline_notice`、`media_frame`、`image_gallery`、`code_snippet`（row、各欄、content_box）、`announcement_bar`（root、section、row），以及有子節點的 `webinar_state`（row、各欄；子節點為 `content_box`，以 `props.webinarState` 指定狀態）。讀取端 `src/lib/funnel-webinar-elements.ts` 每次渲染重新驗證（文字截斷、`safeContentHref`／`safeContentAssetUrl`、列舉值、項目上限）。
- 放寬的父節點：`form`、`countdown`、`faq` 可放在 `content_box`；`headline` 可放在 `form`（表單標題）；`countdown` 可放在 root 與 section（頁首倒數條）；`content_box` 可放在 `webinar_state`。只放寬、不收緊，舊文件不受影響。
- 新增的選填 props：`columns_2/3/4` 的 `ratio`（只限兩欄）、`stackOn`（mobile／tablet）、`mobileOrder`（default／reverse，堆疊時同時反轉 DOM 與鍵盤順序）；`countdown` 的 `variant`、`source`（fixed／webinar_start／registration_close）與文案欄位，沒有 `source` 的舊倒數維持固定截止時間；`testimonial_wall` 的 `layout`（marquee／carousel／grid）；`form_input` 的 `helpText`、`width`；`content_box` 的 `webinarState`。
- `settings` 新增選填 `eventTitle`、`scrollReveal`（none／fade／rise）、`stickyCta`（`FunnelStickyCtaSchema`：enabled、label ≤ 40、target 為 HTML id、showDate、devices、三個顏色）。固定報名列由平台在內容外框（`FUNNEL_CONTENT_SHELL_STYLE`）之外渲染、只接受結構化欄位，商家自訂 CSS 選不到；#499 的沙箱與緊急開關未變動。
- `FUNNEL_BLOCK_CATEGORIES` 新增 `webinar_sections`（只影響版型區塊分類，不寫入文件）。
- 活動時間單一資料來源（`src/lib/funnel-event-time.ts`）：時間只讀漏斗 `flow.webinar`（UTC＋時區）與伺服器的報名截止（`FunnelOperations.deadline`，只在 enabled 時，由公開頁伺服器端傳入，`src/lib/funnel-public-render-hints.ts`）。截止的強制仍由 `resolveFunnelDeadline` 在寫入前判斷，顯示端不改變任何可用性。文字動態欄位 `{{webinar.title|date|time|startAt|weekday|timezone|duration}}` 只在渲染時替換，存檔保留原字串。
- `value_stack` 的金額是商家輸入的展示文字：不解析、不加總，不進入訂單、checkout 或任何金額計算。
- 公開報名表（C-19 最小集合）：欄位 key、標籤、類型、必填、送出文字與送出目標一律來自伺服器報名表與既有 submission context，同意文字沿用平台用語；頁面上的 `form_input`／`button` 只提供提示文字、說明、半寬與按鈕樣式。Webinar 報名步驟的頁面若有自己的名單表單，公開頁改由該表單以原生 POST 送出（同一組 hidden 欄位：formId、liveId、landingPageId、funnelStepId、推廣碼、redirectTo；伺服器照舊回傳 `?submitted=` 回饋；欄位送出前不停用；預覽模式不送出），並隱藏原本頁面下方的備用表單。
- 範本登記：`src/lib/funnel-templates/webinar/index.ts` 預留 20 個位置；`FunnelTemplateGalleryItem` 新增選填 `pageSettings`、`tags`、`retired`、`hidden`。`retired`／`hidden` 的範本仍可由 id 解析（`getFunnelTemplateGalleryItem`、`instantiateFunnelTemplate`），但不出現在 `listFunnelTemplateGallery` 與範本庫。
- 測試：`src/lib/funnel-event-time.test.ts`、`src/lib/funnel-webinar-elements.test.ts`、`src/components/landing-pages/funnel-webinar-elements.test.tsx`、`src/components/landing-pages/funnel-responsive-renderer.test.tsx`、`src/lib/funnel-element-inspector-webinar.test.ts`、`src/lib/landing-page-template-document.test.ts`（tablet 覆寫清除）、`src/lib/funnel-templates/webinar/*.test.ts`、`src/components/landing-pages/funnel-webinar-experience.test.tsx`。

## 2026-10-29 Webinar 範本整合：共用元件修正（無 migration）

- 沒有新增 model、欄位或 migration。`PageDocument` 契約只放寬：`webinar_state` 可放在 `content_box`（原本只能在 row 與各欄），讓兩欄的某一欄可以同時放 H1、活動資訊列與依狀態切換的 CTA，不必在每個狀態重複整段標題。`webinar_state` 的子節點仍只能是 `content_box`，`content_box` 仍不能直接放在 `content_box` 之下。舊文件解析結果不變。
- 文字動態欄位新增 `{{webinar.replayEndsAt}}`（回放開放至「11 月 12 日 23:59」，沒有設定時為「時間公布中」）；`section_title`（眉標、標題、副標）與 `announcement_bar` 的文字也在渲染時替換動態欄位。存檔仍保留原字串。
- `FunnelRenderEvent` 新增選填 `webinar`：文件沒有漏斗排程時的備用排程，只有開發用 harness（`/browser-qa/funnel-design?schedule=…`，production 回 404）會傳入；公開頁仍只讀 `flow.webinar`。
- 新增 `explainPageDocumentIssue`（只供範本測試診斷，回傳第一個不通過的 schema 路徑或樹狀規則），不影響 `parsePageDocument` 的 fail-closed 行為。

## 2026-10-30 使用者自行變更登入 Email（含「不是我操作，還原 Email」）

- `20261030120000_user_email_change_request`：forward-only、純新增，不改既有 table、欄位或資料（PR #516 審查後仍在同一個尚未套用到任何共用環境的 migration 內補欄位）。新增 `UserEmailChangeRequest`（`id`、`userId`、`previousEmail`、`newEmail`、`tokenHash`、`expiresAt`、`consumedAt`、`revokedAt`、`revertTokenHash`、`revertExpiresAt`、`revertedAt`、`revertRevokedAt`、`syncedVendorId`、`createdAt`）。`userId` FK → `User` ON DELETE CASCADE；`syncedVendorId` **刻意不建 FK**（只記錄哪個商家的 `Vendor.email` 跟著變更，使用時以 `id + email` 條件約束）。`tokenHash`、`revertTokenHash` 唯一；索引 `(userId, createdAt)`、`(expiresAt)`、`(previousEmail)`（保留查詢）、`(userId, revertedAt)`（7 天鎖定）。Partial unique index `UserEmailChangeRequest_one_open_per_user`（`userId`，`WHERE "consumedAt" IS NULL AND "revokedAt" IS NULL`）保證每位使用者最多一筆未完成請求；Prisma 6 不比對 partial index，已加入 `scripts/prisma-drift-allowlist.json` 的 `notComparedByPrismaDiff.partialUniqueIndexes`，並由 `src/lib/prisma-unmanaged-indexes.db.test.ts` 鎖住完整定義。CHECK：兩個 Email 都必須已 trim＋小寫且 3–320 字（與註冊規則一致）、兩者不同、兩個 hash 都是 64 字元小寫 hex、`expiresAt > createdAt`、`consumedAt`／`revokedAt` 不得同時有值、`revertedAt`／`revertRevokedAt` 不得同時有值。啟用 RLS（不新增 policy）。交易層級 `lock_timeout = 5s`。Prisma 6 不比對 CHECK，drift 檢查只多 partial index 一項（不在 diff 輸出中）。目前 156 models、129 forward migrations（排在 `20261028090000_landing_page_templates` 之後）；既有 SQL／checksum 不變。
- **部署順序**：既有 table 沒有新欄位，`auth` 的讀取不受影響；但設定頁、註冊、成員邀請接受與密碼重設都會讀寫新表，所以 migration 必須先於程式。
- 請求（`src/app/actions/account-email-change-actions.ts`、`src/lib/account-email-change.ts`）：登入後在「安全性」輸入新 Email 與目前密碼。`platformRole !== "none"` 一律 `requireRecentMfa`（沒有 factor 會先導去啟用）；一般帳號有 MFA 時需 15 分鐘內驗證過，沒有 MFA 不強迫啟用。限流：IP 層 10 次／15 分鐘；每帳號 5 次／小時（`account_email_change_request`，在密碼檢查前計數）；每個（帳號, 新 Email）3 封／小時（`account_email_change_pair`，別的帳號用不掉你的額度）；每個新 Email 跨所有帳號 20 封／小時（`account_email_change_recipient`，只防止用多個帳號轟炸同一信箱；要擋住別人需要多個帳號且只影響一小時，不影響資料）。用過還原連結後 7 天內不能再自行變更（`email_change_locked`）。新 Email 的正規化與註冊相同；等於目前 Email 時拒絕。
- 連結（`src/lib/account-email-change-token.ts`）：變更連結 `aec1`、還原連結 `aer1`，格式同商家驗證連結 `<version>.<base64url JSON {purpose, userId, exp, jti}>.<MAC>`，MAC = `HMAC-SHA256(衍生金鑰, "<version>-mac:" + body + "\0" + 寄送的 Email)`；token 不含 Email。衍生金鑰 `account-email-change:r2:a8a788e3ba38de72`、`account-email-revert:r2:f58ffa8c7c2f1eeb`，都登記在 `DERIVED_KEY_ROTATIONS`（無 legacy）並有 golden 值。資料表只存兩個 token 的 SHA-256。變更連結 60 分鐘、單次；還原連結在變更完成前的有效期間等於請求期限，完成後為完成時間起 7 天，單次。
- 寄信：變更連結只寄到新 Email，信中只以遮罩後的目前 Email 指出是哪個帳號，並寫明「若不認得此帳號請勿確認」；確認頁也一樣顯示遮罩 Email 與警語。目前 Email 收到遮罩的安全通知，唯一的連結是「不是我操作，還原 Email」（只能取消或還原，不能完成變更），並說明：完成前重設密碼也會取消，完成後請用還原連結。
- 防止列舉：新 Email 已屬於其他帳號（或被保留）時，請求畫面同樣顯示「已寄出驗證信」，不寄任何信到該地址，但**照樣建立請求列**（變更連結不寄出）、撤銷舊的未完成請求、寄同樣附有可用還原連結的通知到目前 Email；查詢、寫入與寄信都在回應之後（`after()`）執行，設定頁也不顯示待驗證的請求。不寄「有人嘗試」通知給既有帳號：那會讓任何人透過平台寄信給任意已註冊使用者，對對方的帳號也沒有保護作用。
- 確認（`POST /api/auth/email-change/confirm`）：信中連結開 `/verify-email-change?token=`，頁面只有確認按鈕（GET 只讀）；POST 不讀也不建立 session。單一交易內：以 hash 找請求、token 的 `userId` 必須等於請求的 `userId`、以請求的 `newEmail` 驗 MAC、`SELECT … FOR UPDATE` 鎖 `User` 列、帳號 active 且目前 Email 等於請求的 `previousEmail`、對兩個 Email 取 transaction-scoped advisory lock（排序後依序取）、重讀請求（未過期、未使用、未撤銷）、檢查新 Email 沒有被其他帳號使用或保留（否則撤銷請求回 `email_taken`；P2002 競態整筆回滾回 `email_taken`），然後設定 `email` 與 `emailVerifiedAt`、標記 `consumedAt` 並把 `revertExpiresAt` 設為 7 天後、撤銷所有 session、把所有未使用的密碼重設 token 標記為已用、撤銷其他未完成請求、寫入 `account_email_changed` 稽核（只含 requestId、jti 與計數）。`Vendor.email` 只在該使用者仍是該商家 **active owner**、且沒有其他商家使用新 Email 時同步，並記在 `syncedVendorId`。死結、序列化失敗與交易逾時（P2034、P2028、40P01、40001）回 `retry`（「請重試」，連結仍有效），不再當成 invalid。
- 還原（`POST /api/auth/email-change/revert`，頁面 `/revert-email-change`）：不需登入、不建立 session。同樣先鎖 `User` 列、再對目前 Email 與 `previousEmail` 取 advisory lock、重讀還原連結（未使用、未被取代、未過期）。不論結果都撤銷所有 session、作廢所有未使用的密碼重設 token、取消所有未完成請求。帳號目前 Email 仍是 `previousEmail` 時為「取消」；否則「還原」：`previousEmail` 若已被其他帳號持有（正常流程不會發生）就寫 `account_email_revert_conflict` 稽核並回 `conflict`（請聯絡客服，連結保留可再用），否則設回 `previousEmail` 與 `emailVerifiedAt = now`，並把此次及之後變更所同步、且仍跟著帳號目前 Email 的 `Vendor.email` 改回（沒有其他商家使用該地址時）。最後標記 `revertedAt`（開始 7 天變更鎖定）、撤銷**之後**建立的請求的還原連結（較早的保留，所以接手者用自己的還原連結也擋不掉原持有人）、寫 `account_email_change_reverted`／`account_email_change_cancelled_by_owner` 稽核。
- 保留（`src/lib/login-email-reservation.ts`）：變更完成後、還原連結仍可用期間，`previousEmail` 保留給原帳號。註冊（`registerAction` 回與重複 Email 相同的 `exists`）、以新帳號接受成員邀請（回 `account_exists`，同 P2002）與其他帳號的 Email 變更（同「已被使用」路徑）都視為已被使用；原帳號自己改回不受影響。寫入者都先取同一個 advisory lock 再檢查。
- 密碼重設（`src/lib/password-reset.ts`）：`createPasswordResetToken` 改為互動式交易，`SELECT … FOR UPDATE` 鎖 `User` 列後重讀，Email 仍等於申請的地址且 active 才建立 token，並寄到鎖內讀到的地址；`consumePasswordResetToken` 先鎖 `User` 列再重讀 token（與確認、還原同一鎖序）。變更完成後對舊地址申請重設會找不到帳號。更新密碼（`updatePasswordAction`）與完成密碼重設都在原交易內取消未完成的變更請求。
- `emailVerifiedAt` 的來源因此新增：完成登入 Email 變更（連結只寄到新地址）與還原（連結只寄到原地址），都與 `email` 同時寫入。

## 2026-10-30 登入 Email 變更強化（#518：還原與取消都逐出提出變更的人）

- `20261030200000_user_email_change_initiating_session`：forward-only、純新增，排在 `20261030120000_user_email_change_request` 之後（後者已套用到 staging，不再修改）。`UserEmailChangeRequest` 新增兩個 nullable 欄位 `initiatingSessionId`（只作參照，**刻意不建 FK**：session 會被撤銷或清理）與 `initiatingSessionCreatedAt`，以及 CHECK `UserEmailChangeRequest_initiating_session_check`（兩者同為 NULL 或同時有值）。不和 `createdAt` 比先後：session 時間來自 DB default、請求時間來自應用程式時鐘，可能有些微時差，程式取兩者較早者。既有列兩欄皆為 NULL，不回填。交易層級 `lock_timeout = 5s`。沒有新 table、index 或 RLS 變更（RLS／Data API catalog 測試照常涵蓋本表）。目前 156 models、130 forward migrations；既有 SQL／checksum 不變。
- **部署順序**：migration 必須先於程式（請求會寫入新欄位、還原會讀取）。舊程式碼不讀這兩欄，先套 migration 不影響舊版本。
- 請求：`processAccountEmailChangeRequest` 在鎖住 `User` 的交易內，以 `id + userId + revokedAt IS NULL + 未過期` 讀取發起的 session（id 來自 `requireAuth`，不來自表單），把 id 與該 session 的 `createdAt` 存入請求；session 已結束或不屬於此使用者時不建立任何列。
- 還原與取消共同的逐出（`revertAccountEmailChange`，同一交易、先鎖 `User`）：撤銷所有 session、作廢未使用的密碼重設 token、取消所有未完成請求、把該使用者所有 `LineUserIdentity`（`subjectType = "user"`、`subjectId = userId`，跨所有商家）設 `revokedAt`、刪除**全部** recovery codes，並把 `passwordHash` 設為 `unusable:account_email_revert`（`src/lib/password.ts`，任何密碼都不相符，驗證時仍跑 scrypt 以免時間差）。擁有者用寄到帳號 Email 的密碼重設取回帳號。所有寫入都以還原連結所屬的 `userId` 綁定。
- 取消（變更未完成且帳號仍是舊信箱）：另外只把本連結標記 `revertRevokedAt`，**不設 7 天鎖定**，也**保留 MFA factor**（點擊者本來就持有登入信箱，刪除 factor 等於讓該信箱繞過 MFA）。稽核 `account_email_change_cancelled_by_owner`。
- 鎖定式還原（其他所有情況）：另外還原 Email 與同步過的 `Vendor.email`、標記 `revertedAt`（7 天變更鎖定，`accountEmailChangeLockedUntil` 不變），並刪除 `enabledAt` 或 `createdAt` 不早於 cutoff 的 `UserMfaFactor`（重新啟用會刷新 `enabledAt`）。cutoff = `min(initiatingSessionCreatedAt, createdAt)`，所以「登入 → 啟用 MFA → 再申請變更」的 factor 也會被刪；`initiatingSessionCreatedAt` 為 NULL 的舊列改用 `createdAt − 24 小時`（`ACCOUNT_EMAIL_REVERT_LEGACY_FACTOR_WINDOW_MS`）。選 24 小時的理由：涵蓋同一天內登入、啟用、申請的接手流程，又不會刪掉擁有者長期使用的 factor；代價是擁有者若在申請前 24 小時內才啟用 MFA，還原後需重新啟用。刪除 factor 另寫 `account_email_revert_mfa_removed`（targetType `UserMfaFactor`，含 cutoff 與來源，不含密鑰）。`conflict`（原 Email 被他人持有）維持原行為，另撤銷 LINE identity，不停用密碼也不動 MFA。
- 已知限制：cutoff 之前就存在的 factor 無法與擁有者自己的區分，會保留（例如接手者另開一個新 session 才申請變更）；這種情況需聯絡客服。
- 不鎖 `User` 的寫入者改為同一鎖序（`src/lib/credential-write-lock.ts`）：`completeMfaEnrollment` 與 recovery code 重新產生改成互動式交易，先 `SELECT … FOR UPDATE` 鎖 `User`（須 active），再確認目前 session 未撤銷、未過期（重新產生另要求同一個 factor 仍存在），否則不寫入。`updatePasswordAction` 以 `updateMany({ id, passwordHash: 驗證時的舊 hash })` compare-and-swap，count ≠ 1 回 `current_password`，不會蓋掉還原寫入的不可用密碼。
- LINE Login：`completeLineLogin` 對 `subjectType = "user"` 的 identity（登入與綁定兩條路徑）在交易內確認 `User.status = active`，否則 state 照樣 consume 但不回傳 identity；callback route 建立 session 前再確認一次 active。
- 先前規劃的「在設定頁作廢舊信箱還原連結」已撤回（沒有 MFA 的帳號被接手後，接手者可當場啟用 TOTP 再作廢，舊信箱也不會收到通知）。設定卡與確認頁只顯示「舊信箱 7 天內仍可還原；若舊信箱已外洩，請聯絡客服」。