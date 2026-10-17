-- Preserve the former single account as the default. No credentials are decrypted.
ALTER TABLE "LineOfficialAccount" ADD COLUMN "displayName" TEXT NOT NULL DEFAULT 'LINE 官方帳號', ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
UPDATE "LineOfficialAccount" SET "isDefault" = true;
DROP INDEX "LineOfficialAccount_vendorId_key";
CREATE UNIQUE INDEX "LineOfficialAccount_one_default_per_vendor" ON "LineOfficialAccount" ("vendorId") WHERE "isDefault";

ALTER TABLE "SalesProject" ADD COLUMN "lineOfficialAccountId" TEXT;
ALTER TABLE "LineUserIdentity" ADD COLUMN "lineOfficialAccountId" TEXT;
ALTER TABLE "LineLoginState" ADD COLUMN "lineOfficialAccountId" TEXT, ADD COLUMN "accountVersion" TEXT;
ALTER TABLE "LineRichMenuDraft" ADD COLUMN "lineOfficialAccountId" TEXT;
UPDATE "SalesProject" p SET "lineOfficialAccountId" = a.id FROM "LineOfficialAccount" a WHERE p."vendorId" = a."vendorId";
UPDATE "LineUserIdentity" i SET "lineOfficialAccountId" = a.id FROM "LineOfficialAccount" a WHERE i."vendorId" = a."vendorId";
UPDATE "LineRichMenuDraft" d SET "lineOfficialAccountId" = a.id FROM "LineOfficialAccount" a WHERE d."vendorId" = a."vendorId";
-- Pending states predate account pinning: require a fresh, verified consent flow.
UPDATE "LineLoginState" SET "consumedAt" = CURRENT_TIMESTAMP WHERE "consumedAt" IS NULL;
UPDATE "LineUserIdentity" SET "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP) WHERE "lineOfficialAccountId" IS NULL;
ALTER TABLE "LineUserIdentity" ADD CONSTRAINT "LineUserIdentity_unbound_revoked_check" CHECK ("lineOfficialAccountId" IS NOT NULL OR "revokedAt" IS NOT NULL);
CREATE UNIQUE INDEX "LineUserIdentity_unbound_subject_key" ON "LineUserIdentity" ("vendorId", "subjectType", "subjectId") WHERE "lineOfficialAccountId" IS NULL;
DROP INDEX "LineDelivery_vendorId_idempotencyKey_key";
CREATE UNIQUE INDEX "LineDelivery_vendorId_lineOfficialAccountId_idempotencyKey_key" ON "LineDelivery" ("vendorId", "lineOfficialAccountId", "idempotencyKey");
DROP INDEX "LineUserIdentity_vendorId_lineUserIdHash_key";
DROP INDEX "LineUserIdentity_vendorId_subjectType_subjectId_key";
CREATE UNIQUE INDEX "LineUserIdentity_vendorId_lineOfficialAccountId_subjectType_s_key" ON "LineUserIdentity" ("vendorId", "lineOfficialAccountId", "subjectType", "subjectId");
CREATE INDEX "LineUserIdentity_vendorId_lineOfficialAccountId_lineUserIdHash_idx" ON "LineUserIdentity" ("vendorId", "lineOfficialAccountId", "lineUserIdHash");
CREATE UNIQUE INDEX "LineUserIdentity_vendorId_lineOfficialAccountId_id_key" ON "LineUserIdentity" ("vendorId", "lineOfficialAccountId", id);
DROP INDEX "LineRichMenuDraft_vendorId_key";
CREATE UNIQUE INDEX "LineRichMenuDraft_vendorId_lineOfficialAccountId_key" ON "LineRichMenuDraft" ("vendorId", "lineOfficialAccountId");
CREATE UNIQUE INDEX "LineRichMenuDraft_unbound_per_vendor" ON "LineRichMenuDraft" ("vendorId") WHERE "lineOfficialAccountId" IS NULL;

ALTER TABLE "SalesProject" ADD CONSTRAINT "SalesProject_vendorId_lineOfficialAccountId_fkey" FOREIGN KEY ("vendorId", "lineOfficialAccountId") REFERENCES "LineOfficialAccount" ("vendorId", id) ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "LineUserIdentity" ADD CONSTRAINT "LineUserIdentity_vendorId_lineOfficialAccountId_fkey" FOREIGN KEY ("vendorId", "lineOfficialAccountId") REFERENCES "LineOfficialAccount" ("vendorId", id) ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "LineLoginState" ADD CONSTRAINT "LineLoginState_vendorId_lineOfficialAccountId_fkey" FOREIGN KEY ("vendorId", "lineOfficialAccountId") REFERENCES "LineOfficialAccount" ("vendorId", id) ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "LineRichMenuDraft" ADD CONSTRAINT "LineRichMenuDraft_vendorId_lineOfficialAccountId_fkey" FOREIGN KEY ("vendorId", "lineOfficialAccountId") REFERENCES "LineOfficialAccount" ("vendorId", id) ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "LineDelivery" DROP CONSTRAINT "LineDelivery_vendorId_lineUserIdentityId_fkey";
ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_lineOfficialAccountId_lineUserIdentityId_fkey" FOREIGN KEY ("vendorId", "lineOfficialAccountId", "lineUserIdentityId") REFERENCES "LineUserIdentity" ("vendorId", "lineOfficialAccountId", id) ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "LineDelivery" DROP CONSTRAINT "LineDelivery_vendorId_lineOfficialAccountId_fkey";
ALTER TABLE "LineDelivery" ADD CONSTRAINT "LineDelivery_vendorId_lineOfficialAccountId_fkey" FOREIGN KEY ("vendorId", "lineOfficialAccountId") REFERENCES "LineOfficialAccount" ("vendorId", id) ON DELETE NO ACTION ON UPDATE CASCADE;
