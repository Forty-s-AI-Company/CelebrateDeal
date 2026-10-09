CREATE UNIQUE INDEX "AffiliateRemunerationSnapshot_vendorId_affiliateId_id_key" ON "AffiliateRemunerationSnapshot"("vendorId", "affiliateId", "id");
CREATE TABLE "AffiliateRemunerationExport" (
  "snapshotId" TEXT NOT NULL, "vendorId" TEXT NOT NULL, "affiliateId" TEXT NOT NULL,
  "exportedByUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateRemunerationExport_pkey" PRIMARY KEY ("snapshotId"),
  CONSTRAINT "AffiliateRemunerationExport_snapshot_fkey" FOREIGN KEY ("vendorId", "affiliateId", "snapshotId") REFERENCES "AffiliateRemunerationSnapshot"("vendorId", "affiliateId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AffiliateRemunerationExport_vendorId_createdAt_idx" ON "AffiliateRemunerationExport"("vendorId", "createdAt");
CREATE UNIQUE INDEX "AffiliateRemunerationExport_vendorId_affiliateId_snapshotId_key" ON "AffiliateRemunerationExport"("vendorId", "affiliateId", "snapshotId");
ALTER TABLE "AffiliateRemunerationExport" ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION affiliate_remuneration_export_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'remuneration export receipt is immutable';
END;
$$;
CREATE TRIGGER affiliate_remuneration_export_guard BEFORE UPDATE OR DELETE ON "AffiliateRemunerationExport" FOR EACH ROW EXECUTE FUNCTION affiliate_remuneration_export_guard();
