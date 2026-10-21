# Serializable 交易呼叫點清單（F-055）

F-055（B03-22、B04-14）新增共用的 `src/lib/serializable-retry.ts`：`withSerializableRetry(op, { attempts, baseDelayMs, maxDelayMs, retryOn })` 對整段操作重試，`runSerializable(db, op, options)` 包一個 Serializable 互動交易，兩者都用指數退避加 full jitter，預設只重試 P2034。

已套用：

- `src/lib/inventory-reservations.ts`：庫存保留、釋放、過期清理共用的 `runSerializable`，5 次、25–400 ms。
- `src/lib/payment-webhooks.ts`：`processPaymentWebhook` 對 P2034／P2002 重跑整個 webhook 處理，3 次、50–500 ms。

其餘呼叫點這次不改，只列出位置（`TransactionIsolationLevel.Serializable`，不含測試；行號為本次 commit 當下）。日後各自改用共用 helper 時，需確認該路徑可安全重跑（沒有交易外的副作用）。

- `src/app/actions.ts:1752`
- `src/app/actions.ts:1898`
- `src/app/actions.ts:2102`
- `src/app/actions.ts:2321`
- `src/app/actions/affiliate-actions.ts:56`
- `src/app/actions/buyer-support-actions.ts:100`
- `src/app/actions/buyer-support-actions.ts:139`
- `src/app/actions/commerce-order-actions.ts:43`
- `src/app/actions/consultation-actions.ts:530`
- `src/app/actions/course-payout-actions.ts:108`
- `src/app/actions/interaction-actions.ts:219`
- `src/app/actions/interaction-actions.ts:312`
- `src/app/actions/interaction-actions.ts:364`
- `src/app/actions/interaction-actions.ts:862`
- `src/app/actions/interaction-actions.ts:1052`
- `src/app/actions/invoice-actions.ts:184`
- `src/app/actions/platform-referral-payout-actions.ts:77`
- `src/app/actions/platform-referral-payout-actions.ts:119`
- `src/app/actions/support-case-actions.ts:63`
- `src/app/actions/team-membership-actions.ts:40`
- `src/app/actions/vendor-member-actions.ts:98`
- `src/app/actions/vendor-member-actions.ts:221`
- `src/app/actions/webinar-resource-actions.ts:401`
- `src/app/api/checkout/upsell/route.ts:63`
- `src/app/api/live-interactions/route.ts:417`
- `src/app/api/live-interactions/route.ts:476`
- `src/app/api/webhooks/payment-methods/route.ts:340`
- `src/lib/affiliate-payee-profile.ts:35`
- `src/lib/affiliate-payee-profile.ts:56`
- `src/lib/affiliate-portal.ts:37`
- `src/lib/affiliate-remuneration-quotes.ts:59`
- `src/lib/affiliate-remuneration-quotes.ts:81`
- `src/lib/affiliate-remuneration-quotes.ts:110`
- `src/lib/billing-cycle.ts:259`
- `src/lib/buyer-support-access.ts:207`
- `src/lib/commerce-shipping-action.ts:34`
- `src/lib/course-community.ts:28`
- `src/lib/course-curriculum.ts:48`
- `src/lib/email-delivery-operations.ts:334`
- `src/lib/email-delivery.ts:382`
- `src/lib/email-delivery.ts:433`
- `src/lib/email-delivery.ts:578`
- `src/lib/form-submission-verification-domain.ts:240`
- `src/lib/learner-consultation-reminders.ts:58`
- `src/lib/learner-notification-outbox.ts:29`
- `src/lib/learner-notification-preferences.ts:46`
- `src/lib/learner-notification-source-events.ts:84`
- `src/lib/learner-notification-verification.ts:21`
- `src/lib/line-login.ts:232`
- `src/lib/live-chat.ts:573`
- `src/lib/live-notification-delivery.ts:322`
- `src/lib/live-notification-delivery.ts:356`
- `src/lib/live-notification-delivery.ts:730`
- `src/lib/live-private-chat.ts:98`
- `src/lib/live-private-chat.ts:201`
- `src/lib/live-quota-admission.ts:287`
- `src/lib/merchant-affiliate-payout-policy.ts:24`
- `src/lib/merchant-affiliate-policy-service.ts:20`
- `src/lib/payuni-pending-refund-proof.ts:58`
- `src/lib/payuni-pending-refund-proof.ts:76`
- `src/lib/payuni-refund-execution.ts:119`
- `src/lib/payuni-refund-execution.ts:241`
- `src/lib/payuni-refund-hold-release.ts:244`
- `src/lib/payuni-refund-reconciliation.ts:277`
- `src/lib/platform-plan-checkout.ts:462`
- `src/lib/post-purchase-checkout-recovery.ts:140`
- `src/lib/post-purchase-checkout-recovery.ts:182`
- `src/lib/settlement-adjustment.ts:81`
- `src/lib/stream-usage-reconciliation.ts:287`
- `src/lib/stream-usage-reconciliation.ts:356`
- `src/lib/stream-usage.ts:389`
- `src/lib/student-course-learning.ts:115`
- `src/lib/team-funnel-pages.ts:241`
- `src/lib/team-funnel-sharing.ts:193`
- `src/lib/wp4-buyer-callback-retry.ts:82`
- `src/lib/wp4-payuni-sandbox-payment-attempt.ts:73`
