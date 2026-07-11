ALTER TABLE "BillingPlan"
ADD COLUMN "includedNotificationEmails" INTEGER NOT NULL DEFAULT 1000;

ALTER TABLE "VendorUsageLimit"
ADD COLUMN "notificationEmailsLimit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "notificationEmailsUsed" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "VendorUsageLimit_notification_email_usage_valid"
  CHECK ("notificationEmailsLimit" >= 0 AND "notificationEmailsUsed" >= 0 AND "notificationEmailsUsed" <= "notificationEmailsLimit");

UPDATE "VendorUsageLimit" AS usage
SET "notificationEmailsLimit" = plan."includedNotificationEmails"
FROM "BillingPlan" AS plan
WHERE usage."billingPlanId" = plan."id";

-- Rollback: remove VendorUsageLimit_notification_email_usage_valid, both usage columns,
-- and BillingPlan.includedNotificationEmails after exporting current usage for reconciliation.
