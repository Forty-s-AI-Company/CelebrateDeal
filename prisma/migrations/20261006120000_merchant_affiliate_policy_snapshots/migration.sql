-- Forward-only prospective merchant affiliate snapshots. Historical rows and keys are untouched.
-- AlterTable
ALTER TABLE "AffiliateCommission" ADD COLUMN     "merchantCalculationId" TEXT,
ADD COLUMN     "merchantCheckoutId" TEXT,
ADD COLUMN     "merchantLevel" INTEGER,
ADD COLUMN     "merchantRecipientId" TEXT;

-- CreateTable
CREATE TABLE "MerchantAffiliatePolicy" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "terms" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantAffiliatePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantAffiliatePolicyState" (
    "vendorId" TEXT NOT NULL,
    "activePolicyId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantAffiliatePolicyState_pkey" PRIMARY KEY ("vendorId")
);

-- CreateTable
CREATE TABLE "MerchantAffiliateProductRate" (
    "vendorId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL,

    CONSTRAINT "MerchantAffiliateProductRate_pkey" PRIMARY KEY ("policyId","productId")
);

-- CreateTable
CREATE TABLE "MerchantAffiliateCheckoutSnapshot" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "policyId" TEXT,
    "fixedRateBps" INTEGER,
    "promoterAffiliateId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "grossAmountCents" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "recipientTerms" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantAffiliateCheckoutSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantAffiliateCheckoutRecipient" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "teamId" TEXT,
    "teamMembershipId" TEXT,
    "level" INTEGER NOT NULL,

    CONSTRAINT "MerchantAffiliateCheckoutRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantAffiliateSalesCounter" (
    "vendorId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantAffiliateSalesCounter_pkey" PRIMARY KEY ("vendorId","affiliateId")
);

-- CreateTable
CREATE TABLE "MerchantAffiliateCalculation" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "qualifiedQuantityBefore" BIGINT NOT NULL,
    "qualifiedQuantityAfter" BIGINT NOT NULL,
    "plan" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantAffiliateCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliatePolicy_vendorId_id_key" ON "MerchantAffiliatePolicy"("vendorId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliatePolicy_vendorId_version_key" ON "MerchantAffiliatePolicy"("vendorId", "version");

-- CreateIndex
CREATE INDEX "MerchantAffiliateProductRate_vendorId_productId_idx" ON "MerchantAffiliateProductRate"("vendorId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliateCheckoutSnapshot_vendorId_id_key" ON "MerchantAffiliateCheckoutSnapshot"("vendorId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliateCheckout_payment_key" ON "MerchantAffiliateCheckoutSnapshot"("vendorId", "paymentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliateCheckoutSnapshot_vendorId_orderId_key" ON "MerchantAffiliateCheckoutSnapshot"("vendorId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliateCheckout_payment_order_key" ON "MerchantAffiliateCheckoutSnapshot"("vendorId", "paymentTransactionId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliateCheckoutRecipient_vendorId_checkoutId_leve_key" ON "MerchantAffiliateCheckoutRecipient"("vendorId", "checkoutId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliateCheckoutRecipient_vendorId_checkoutId_affi_key" ON "MerchantAffiliateCheckoutRecipient"("vendorId", "checkoutId", "affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliateCheckoutRecipient_vendorId_checkoutId_id_a_key" ON "MerchantAffiliateCheckoutRecipient"("vendorId", "checkoutId", "id", "affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliateCalculation_vendorId_checkoutId_key" ON "MerchantAffiliateCalculation"("vendorId", "checkoutId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliateCalculation_vendorId_checkoutId_id_key" ON "MerchantAffiliateCalculation"("vendorId", "checkoutId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceOrder_vendorId_primaryPaymentTransactionId_id_key" ON "CommerceOrder"("vendorId", "primaryPaymentTransactionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateCommission_vendorId_merchantCalculationId_affiliat_key" ON "AffiliateCommission"("vendorId", "merchantCalculationId", "affiliateId");

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_vendorId_merchantCheckoutId_merchantCa_fkey" FOREIGN KEY ("vendorId", "merchantCheckoutId", "merchantCalculationId") REFERENCES "MerchantAffiliateCalculation"("vendorId", "checkoutId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_vendorId_merchantCheckoutId_merchantRe_fkey" FOREIGN KEY ("vendorId", "merchantCheckoutId", "merchantRecipientId", "affiliateId") REFERENCES "MerchantAffiliateCheckoutRecipient"("vendorId", "checkoutId", "id", "affiliateId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliatePolicy" ADD CONSTRAINT "MerchantAffiliatePolicy_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliatePolicyState" ADD CONSTRAINT "MerchantAffiliatePolicyState_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliatePolicyState" ADD CONSTRAINT "MerchantAffiliatePolicyState_vendorId_activePolicyId_fkey" FOREIGN KEY ("vendorId", "activePolicyId") REFERENCES "MerchantAffiliatePolicy"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateProductRate" ADD CONSTRAINT "MerchantAffiliateProductRate_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateProductRate" ADD CONSTRAINT "MerchantAffiliateProductRate_vendorId_policyId_fkey" FOREIGN KEY ("vendorId", "policyId") REFERENCES "MerchantAffiliatePolicy"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateProductRate" ADD CONSTRAINT "MerchantAffiliateProductRate_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCheckoutSnapshot" ADD CONSTRAINT "MerchantAffiliateCheckoutSnapshot_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCheckoutSnapshot" ADD CONSTRAINT "MerchantAffiliateCheckout_payment_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCheckoutSnapshot" ADD CONSTRAINT "MerchantAffiliateCheckout_order_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId", "orderId") REFERENCES "CommerceOrder"("vendorId", "primaryPaymentTransactionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCheckoutSnapshot" ADD CONSTRAINT "MerchantAffiliateCheckoutSnapshot_vendorId_policyId_fkey" FOREIGN KEY ("vendorId", "policyId") REFERENCES "MerchantAffiliatePolicy"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCheckoutSnapshot" ADD CONSTRAINT "MerchantAffiliateCheckoutSnapshot_vendorId_promoterAffilia_fkey" FOREIGN KEY ("vendorId", "promoterAffiliateId") REFERENCES "Affiliate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCheckoutRecipient" ADD CONSTRAINT "MerchantAffiliateCheckoutRecipient_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCheckoutRecipient" ADD CONSTRAINT "MerchantAffiliateCheckoutRecipient_vendorId_checkoutId_fkey" FOREIGN KEY ("vendorId", "checkoutId") REFERENCES "MerchantAffiliateCheckoutSnapshot"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCheckoutRecipient" ADD CONSTRAINT "MerchantAffiliateCheckoutRecipient_vendorId_affiliateId_fkey" FOREIGN KEY ("vendorId", "affiliateId") REFERENCES "Affiliate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCheckoutRecipient" ADD CONSTRAINT "MerchantAffiliateCheckoutRecipient_vendorId_teamId_teamMem_fkey" FOREIGN KEY ("vendorId", "teamId", "teamMembershipId") REFERENCES "TeamMembership"("vendorId", "teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateSalesCounter" ADD CONSTRAINT "MerchantAffiliateSalesCounter_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateSalesCounter" ADD CONSTRAINT "MerchantAffiliateSalesCounter_vendorId_affiliateId_fkey" FOREIGN KEY ("vendorId", "affiliateId") REFERENCES "Affiliate"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCalculation" ADD CONSTRAINT "MerchantAffiliateCalculation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliateCalculation" ADD CONSTRAINT "MerchantAffiliateCalculation_vendorId_checkoutId_fkey" FOREIGN KEY ("vendorId", "checkoutId") REFERENCES "MerchantAffiliateCheckoutSnapshot"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Root server validators are paired with bounded database checks; no API role
-- receives a permissive RLS policy for these financial tables.
CREATE FUNCTION merchant_affiliate_terms_valid(t JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE item JSONB; previous_max INTEGER := 0; position INTEGER := 0;
  min_q INTEGER; max_q INTEGER; rate INTEGER; maximum_direct INTEGER := 0;
  upline_total INTEGER := 0; cap INTEGER; seen_products TEXT[] := ARRAY[]::TEXT[]; product_id TEXT;
BEGIN
  IF jsonb_typeof(t) IS DISTINCT FROM 'object' OR octet_length(t::TEXT) > 65536
    OR t->>'schemaVersion' IS DISTINCT FROM '1' OR t->>'currency' IS DISTINCT FROM 'TWD'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(t) k WHERE k NOT IN ('schemaVersion','currency','maxTotalBps','tiers','uplines','productOverrides'))
    OR jsonb_typeof(t->'maxTotalBps') IS DISTINCT FROM 'number'
    OR jsonb_typeof(t->'tiers') IS DISTINCT FROM 'array'
    OR jsonb_typeof(t->'uplines') IS DISTINCT FROM 'array'
    OR jsonb_typeof(t->'productOverrides') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
  cap := (t->>'maxTotalBps')::INTEGER;
  IF cap < 0 OR cap > 10000 OR jsonb_array_length(t->'tiers') NOT BETWEEN 1 AND 32
    OR jsonb_array_length(t->'uplines') > 8 OR jsonb_array_length(t->'productOverrides') > 200 THEN RETURN FALSE; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(t->'tiers') LOOP
    position := position + 1;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('minQuantity','maxQuantity','rateBps'))
      OR jsonb_typeof(item->'minQuantity') IS DISTINCT FROM 'number'
      OR jsonb_typeof(item->'rateBps') IS DISTINCT FROM 'number'
      OR item->'maxQuantity' IS NULL THEN RETURN FALSE; END IF;
    min_q := (item->>'minQuantity')::INTEGER; max_q := (item->>'maxQuantity')::INTEGER; rate := (item->>'rateBps')::INTEGER;
    IF min_q < 1 OR min_q <> previous_max + 1 OR rate NOT BETWEEN 0 AND 10000
      OR (max_q IS NOT NULL AND max_q < min_q)
      OR (position < jsonb_array_length(t->'tiers') AND max_q IS NULL)
      OR (position = jsonb_array_length(t->'tiers') AND max_q IS NOT NULL) THEN RETURN FALSE; END IF;
    previous_max := max_q; maximum_direct := greatest(maximum_direct, rate);
  END LOOP;
  position := 0;
  FOR item IN SELECT value FROM jsonb_array_elements(t->'uplines') LOOP
    position := position + 1;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('level','rateBps'))
      OR jsonb_typeof(item->'level') IS DISTINCT FROM 'number'
      OR jsonb_typeof(item->'rateBps') IS DISTINCT FROM 'number'
      OR (item->>'level')::INTEGER <> position THEN RETURN FALSE; END IF;
    rate := (item->>'rateBps')::INTEGER;
    IF rate NOT BETWEEN 0 AND 10000 THEN RETURN FALSE; END IF;
    upline_total := upline_total + rate;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(t->'productOverrides') LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('productId','rateBps'))
      OR jsonb_typeof(item->'productId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'rateBps') IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
    product_id := item->>'productId'; rate := (item->>'rateBps')::INTEGER;
    IF btrim(product_id) = '' OR length(product_id) > 191 OR product_id = ANY(seen_products)
      OR rate NOT BETWEEN 0 AND 10000 THEN RETURN FALSE; END IF;
    seen_products := array_append(seen_products, product_id); maximum_direct := greatest(maximum_direct, rate);
  END LOOP;
  RETURN maximum_direct + upline_total <= cap;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
ALTER TABLE "MerchantAffiliatePolicy" ADD CONSTRAINT "MerchantAffiliatePolicy_terms_valid" CHECK ("version" > 0 AND merchant_affiliate_terms_valid("terms"));
ALTER TABLE "MerchantAffiliatePolicyState" ADD CONSTRAINT "MerchantAffiliatePolicyState_revision_valid" CHECK ("revision" >= 0);
ALTER TABLE "MerchantAffiliateProductRate" ADD CONSTRAINT "MerchantAffiliateProductRate_rate_valid" CHECK ("rateBps" BETWEEN 0 AND 10000);
ALTER TABLE "MerchantAffiliateCheckoutSnapshot" ADD CONSTRAINT "MerchantAffiliateCheckout_scope_valid" CHECK ("currency" = 'TWD' AND "grossAmountCents" > 0 AND jsonb_typeof("lines") = 'array' AND jsonb_array_length("lines") BETWEEN 1 AND 20);
ALTER TABLE "MerchantAffiliateCheckoutRecipient" ADD CONSTRAINT "MerchantAffiliateRecipient_scope_valid" CHECK ("level" BETWEEN 0 AND 8 AND (("teamId" IS NULL AND "teamMembershipId" IS NULL) OR ("teamId" IS NOT NULL AND "teamMembershipId" IS NOT NULL)));
ALTER TABLE "MerchantAffiliateSalesCounter" ADD CONSTRAINT "MerchantAffiliateCounter_quantity_valid" CHECK ("quantity" >= 0);
ALTER TABLE "MerchantAffiliateCalculation" ADD CONSTRAINT "MerchantAffiliateCalculation_quantity_valid" CHECK ("qualifiedQuantityBefore" >= 0 AND "qualifiedQuantityAfter" > "qualifiedQuantityBefore" AND jsonb_typeof("plan") = 'object');
ALTER TABLE "AffiliateCommission" ADD CONSTRAINT "AffiliateCommission_merchant_plan_shape" CHECK (
  ("merchantCheckoutId" IS NULL AND "merchantCalculationId" IS NULL AND "merchantRecipientId" IS NULL AND "merchantLevel" IS NULL)
  OR ("merchantCheckoutId" IS NOT NULL AND "merchantCalculationId" IS NOT NULL AND "merchantRecipientId" IS NOT NULL AND "merchantLevel" IS NOT NULL AND "merchantLevel" BETWEEN 0 AND 8 AND "affiliateId" IS NOT NULL AND "sourceType" = 'webhook')
);
CREATE FUNCTION merchant_affiliate_append_only() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'merchant affiliate financial snapshots are append-only' USING ERRCODE = '23514'; END $$;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['MerchantAffiliatePolicy','MerchantAffiliateProductRate','MerchantAffiliateCheckoutSnapshot','MerchantAffiliateCheckoutRecipient','MerchantAffiliateCalculation'] LOOP
    EXECUTE format('CREATE TRIGGER merchant_affiliate_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_append_only()',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['MerchantAffiliatePolicy','MerchantAffiliatePolicyState','MerchantAffiliateProductRate','MerchantAffiliateCheckoutSnapshot','MerchantAffiliateCheckoutRecipient','MerchantAffiliateSalesCounter','MerchantAffiliateCalculation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
  END LOOP;
END $$;
CREATE FUNCTION merchant_affiliate_counter_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'qualified paid counters cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF NEW."vendorId" <> OLD."vendorId" OR NEW."affiliateId" <> OLD."affiliateId" OR NEW."quantity" < OLD."quantity" THEN
    RAISE EXCEPTION 'qualified paid counters are monotonic and identity-bound' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_affiliate_counter_guard BEFORE UPDATE OR DELETE ON "MerchantAffiliateSalesCounter" FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_counter_guard();
CREATE FUNCTION merchant_affiliate_policy_pointer_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE terms JSONB; override_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'policy pointer identity cannot be deleted' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'INSERT' AND NEW."revision" NOT IN (0,1) THEN RAISE EXCEPTION 'invalid initial policy revision' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."vendorId" <> OLD."vendorId" OR NEW."revision" <> OLD."revision" + 1) THEN
    RAISE EXCEPTION 'policy pointer requires the next CAS revision' USING ERRCODE = '23514';
  END IF;
  IF NEW."activePolicyId" IS NOT NULL THEN
    SELECT p."terms" INTO terms FROM "MerchantAffiliatePolicy" p WHERE p."id"=NEW."activePolicyId" AND p."vendorId"=NEW."vendorId";
    SELECT count(*) INTO override_count FROM "MerchantAffiliateProductRate" r WHERE r."policyId"=NEW."activePolicyId" AND r."vendorId"=NEW."vendorId";
    IF terms IS NULL OR override_count <> jsonb_array_length(terms->'productOverrides') THEN
      RAISE EXCEPTION 'published policy product overrides are incomplete' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_affiliate_policy_pointer_guard BEFORE INSERT OR UPDATE OR DELETE ON "MerchantAffiliatePolicyState" FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_policy_pointer_guard();
CREATE FUNCTION merchant_affiliate_product_rate_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "MerchantAffiliatePolicy" p, jsonb_array_elements(p."terms"->'productOverrides') item
    WHERE p."vendorId"=NEW."vendorId" AND p."id"=NEW."policyId" AND item->>'productId'=NEW."productId" AND (item->>'rateBps')::INTEGER=NEW."rateBps") THEN
    RAISE EXCEPTION 'product override differs from its immutable policy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_affiliate_product_rate_guard BEFORE INSERT ON "MerchantAffiliateProductRate" FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_product_rate_guard();
CREATE FUNCTION merchant_affiliate_commission_identity_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."merchantCheckoutId",NEW."merchantCalculationId",NEW."merchantRecipientId",NEW."merchantLevel") IS DISTINCT FROM
    (OLD."merchantCheckoutId",OLD."merchantCalculationId",OLD."merchantRecipientId",OLD."merchantLevel") THEN
    RAISE EXCEPTION 'merchant commission snapshot identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_affiliate_commission_identity_guard BEFORE UPDATE ON "AffiliateCommission" FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_commission_identity_guard();

-- Frozen recipient terms make the set immutable too: unlisted beneficiaries
-- cannot be appended later, while composite FKs validate each real identity.
ALTER TABLE "MerchantAffiliateCheckoutSnapshot" ADD CONSTRAINT "MerchantAffiliateCheckout_recipient_terms_valid" CHECK (jsonb_typeof("recipientTerms")='array' AND jsonb_array_length("recipientTerms") BETWEEN 1 AND 9);
CREATE FUNCTION merchant_affiliate_recipient_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "MerchantAffiliateCheckoutSnapshot" s, jsonb_array_elements(s."recipientTerms") item
    WHERE s."vendorId"=NEW."vendorId" AND s."id"=NEW."checkoutId" AND item->>'id'=NEW."id"
      AND item->>'affiliateId'=NEW."affiliateId" AND (item->>'level')::INTEGER=NEW."level"
      AND (item->>'teamId') IS NOT DISTINCT FROM NEW."teamId"
      AND (item->>'teamMembershipId') IS NOT DISTINCT FROM NEW."teamMembershipId"
      AND (NEW."level"<>0 OR s."promoterAffiliateId"=NEW."affiliateId")) THEN
    RAISE EXCEPTION 'recipient differs from frozen checkout terms' USING ERRCODE='23514';
  END IF;
  IF NEW."teamMembershipId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "TeamMembership" m
    WHERE m."vendorId"=NEW."vendorId" AND m."teamId"=NEW."teamId" AND m."id"=NEW."teamMembershipId" AND m."affiliateId"=NEW."affiliateId") THEN
    RAISE EXCEPTION 'recipient affiliate differs from its team membership' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_affiliate_recipient_guard BEFORE INSERT ON "MerchantAffiliateCheckoutRecipient" FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_recipient_guard();

CREATE FUNCTION merchant_affiliate_checkout_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE frozen_order "CommerceOrder"%ROWTYPE; payment "PaymentTransaction"%ROWTYPE; item JSONB; ordinal INTEGER := 0; checkout_quantity INTEGER; amount INTEGER; total BIGINT := 0; units INTEGER := 0;
BEGIN
  SELECT * INTO frozen_order FROM "CommerceOrder" WHERE "vendorId"=NEW."vendorId" AND "id"=NEW."orderId" AND "primaryPaymentTransactionId"=NEW."paymentTransactionId";
  SELECT * INTO payment FROM "PaymentTransaction" WHERE "vendorId"=NEW."vendorId" AND "id"=NEW."paymentTransactionId";
  IF frozen_order."id" IS NULL OR payment."id" IS NULL OR NEW."currency" IS DISTINCT FROM frozen_order."currency"
    OR NEW."grossAmountCents" IS DISTINCT FROM frozen_order."totalAmountCents"
    OR NEW."grossAmountCents" IS DISTINCT FROM payment."grossAmountCents"
    OR (NEW."policyId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "MerchantAffiliatePolicyState" WHERE "vendorId"=NEW."vendorId" AND "activePolicyId"=NEW."policyId"))
    OR (NEW."policyId" IS NULL AND (EXISTS(SELECT 1 FROM "MerchantAffiliatePolicyState" WHERE "vendorId"=NEW."vendorId" AND "activePolicyId" IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM "Affiliate" WHERE "vendorId"=NEW."vendorId" AND "id"=NEW."promoterAffiliateId" AND "isActive" AND "commissionRateBps"=NEW."fixedRateBps")))
    OR EXISTS(SELECT 1 FROM "CommerceOrderItem" i WHERE i."vendorId"=NEW."vendorId" AND i."orderId"=NEW."orderId" AND i."commerceDomain"<>'merchant') THEN
    RAISE EXCEPTION 'merchant affiliate snapshot differs from its canonical buyer order' USING ERRCODE='23514';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW."lines") LOOP
    checkout_quantity := (item->>'quantity')::INTEGER; amount := (item->>'amountCents')::INTEGER;
    IF checkout_quantity IS NULL OR checkout_quantity NOT BETWEEN 1 AND 1000 OR amount IS NULL OR amount<0
      OR NOT EXISTS(SELECT 1 FROM "CommerceOrderItem" i WHERE i."vendorId"=NEW."vendorId" AND i."orderId"=NEW."orderId"
        AND i."lineIndex"=ordinal AND i."productId"=item->>'productId' AND i."quantity"=checkout_quantity
        AND i."lineTotalCents"-CASE WHEN ordinal=0 THEN (frozen_order."subtotalAmountCents"-frozen_order."totalAmountCents") ELSE 0 END=amount) THEN
      RAISE EXCEPTION 'merchant affiliate item differs from the discounted order line' USING ERRCODE='23514';
    END IF;
    ordinal := ordinal+1; total := total+amount; units := units+checkout_quantity;
  END LOOP;
  IF total <> NEW."grossAmountCents" OR units>1000 OR ordinal<>(SELECT count(*) FROM "CommerceOrderItem" WHERE "vendorId"=NEW."vendorId" AND "orderId"=NEW."orderId") THEN
    RAISE EXCEPTION 'merchant affiliate checkout lines are incomplete' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(NEW."recipientTerms")<>(SELECT count(DISTINCT value->>'affiliateId') FROM jsonb_array_elements(NEW."recipientTerms"))
    OR jsonb_array_length(NEW."recipientTerms")<>(SELECT count(DISTINCT value->>'level') FROM jsonb_array_elements(NEW."recipientTerms"))
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."recipientTerms") recipient_item WHERE recipient_item->>'level'='0' AND recipient_item->>'affiliateId'=NEW."promoterAffiliateId") THEN
    RAISE EXCEPTION 'merchant affiliate recipient chain is ambiguous' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_affiliate_checkout_guard BEFORE INSERT ON "MerchantAffiliateCheckoutSnapshot" FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_checkout_guard();
CREATE FUNCTION merchant_affiliate_calculation_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE checkout "MerchantAffiliateCheckoutSnapshot"%ROWTYPE; payment "PaymentTransaction"%ROWTYPE; item JSONB; total BIGINT:=0; units BIGINT; recipient_count INTEGER; amount INTEGER; available INTEGER;
BEGIN
  SELECT * INTO checkout FROM "MerchantAffiliateCheckoutSnapshot" WHERE "vendorId"=NEW."vendorId" AND "id"=NEW."checkoutId";
  SELECT * INTO payment FROM "PaymentTransaction" WHERE "vendorId"=NEW."vendorId" AND "id"=checkout."paymentTransactionId";
  SELECT sum((value->>'quantity')::BIGINT) INTO units FROM jsonb_array_elements(checkout."lines");
  SELECT count(*) INTO recipient_count FROM "MerchantAffiliateCheckoutRecipient" WHERE "vendorId"=NEW."vendorId" AND "checkoutId"=NEW."checkoutId";
  available:=(NEW."plan"->>'netReferenceAmountCents')::INTEGER;
  IF checkout."id" IS NULL OR payment."status"::TEXT IS DISTINCT FROM 'paid'
    OR NEW."qualifiedQuantityAfter"-NEW."qualifiedQuantityBefore" IS DISTINCT FROM units
    OR NEW."plan"->>'schemaVersion' IS DISTINCT FROM '1' OR NEW."plan"->>'currency' IS DISTINCT FROM 'TWD'
    OR (NEW."plan"->>'grossAmountCents')::INTEGER IS DISTINCT FROM checkout."grossAmountCents"
    OR (NEW."plan"->>'qualifiedQuantityBefore')::BIGINT IS DISTINCT FROM NEW."qualifiedQuantityBefore"
    OR (NEW."plan"->>'qualifiedQuantityAfter')::BIGINT IS DISTINCT FROM NEW."qualifiedQuantityAfter"
    OR available IS DISTINCT FROM payment."netAmountCents" OR available<0
    OR jsonb_typeof(NEW."plan"->'recipients') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW."plan"->'selectedTiers') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."plan"->'selectedTiers') IS DISTINCT FROM units
    OR recipient_count IS DISTINCT FROM jsonb_array_length(checkout."recipientTerms")
    OR recipient_count IS DISTINCT FROM jsonb_array_length(NEW."plan"->'recipients')
    OR NOT EXISTS(SELECT 1 FROM "MerchantAffiliateSalesCounter" WHERE "vendorId"=NEW."vendorId" AND "affiliateId"=checkout."promoterAffiliateId" AND "quantity"=NEW."qualifiedQuantityAfter") THEN
    RAISE EXCEPTION 'merchant affiliate calculation does not match its paid snapshot/counter' USING ERRCODE='23514';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW."plan"->'recipients') LOOP
    amount:=(item->>'amountCents')::INTEGER;
    IF amount IS NULL OR amount<0 OR (item->>'effectiveRateBps')::INTEGER NOT BETWEEN 0 AND 10000
      OR NOT EXISTS(SELECT 1 FROM "MerchantAffiliateCheckoutRecipient" r WHERE r."vendorId"=NEW."vendorId" AND r."checkoutId"=NEW."checkoutId" AND r."id"=item->>'checkoutRecipientId' AND r."affiliateId"=item->>'affiliateId' AND r."level"=(item->>'level')::INTEGER) THEN
      RAISE EXCEPTION 'calculated beneficiary is not frozen on this checkout' USING ERRCODE='23514';
    END IF;
    total:=total+amount;
  END LOOP;
  IF total IS DISTINCT FROM (NEW."plan"->>'commissionAmountCents')::BIGINT OR total>checkout."grossAmountCents"
    OR recipient_count<>(SELECT count(DISTINCT value->>'checkoutRecipientId') FROM jsonb_array_elements(NEW."plan"->'recipients')) THEN
    RAISE EXCEPTION 'merchant affiliate calculation exceeds its immutable budget' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_affiliate_calculation_guard BEFORE INSERT ON "MerchantAffiliateCalculation" FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_calculation_guard();
CREATE FUNCTION merchant_affiliate_commission_plan_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."merchantCalculationId" IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM "MerchantAffiliateCalculation" c JOIN "MerchantAffiliateCheckoutSnapshot" s ON s."vendorId"=c."vendorId" AND s."id"=c."checkoutId",
      jsonb_array_elements(c."plan"->'recipients') item
    WHERE c."vendorId"=NEW."vendorId" AND c."id"=NEW."merchantCalculationId" AND c."checkoutId"=NEW."merchantCheckoutId"
      AND s."paymentTransactionId"=NEW."sourceId" AND s."grossAmountCents"=NEW."orderAmountCents" AND s."grossAmountCents"=NEW."commissionBaseAmountCents"
      AND item->>'checkoutRecipientId'=NEW."merchantRecipientId" AND item->>'affiliateId'=NEW."affiliateId"
      AND (item->>'level')::INTEGER=NEW."merchantLevel" AND (item->>'amountCents')::INTEGER=NEW."commissionAmountCents"
      AND (item->>'effectiveRateBps')::INTEGER=NEW."commissionRateBps" AND NEW."commissionAmountCents">0
  ) THEN RAISE EXCEPTION 'commission differs from its immutable paid calculation' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_affiliate_commission_plan_guard BEFORE INSERT ON "AffiliateCommission" FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_commission_plan_guard();

ALTER TABLE "MerchantAffiliateCheckoutSnapshot" ADD CONSTRAINT "MerchantAffiliateCheckout_fixed_or_policy" CHECK (("policyId" IS NOT NULL AND "fixedRateBps" IS NULL) OR ("policyId" IS NULL AND "fixedRateBps" IS NOT NULL AND "fixedRateBps" BETWEEN 0 AND 10000));

-- A zero balance still needs an immutable, idempotent terminal dispute record.
ALTER TABLE "AffiliateCommissionLedgerEntry" DROP CONSTRAINT "AffiliateCommissionLedgerEntry_amount_direction";
ALTER TABLE "AffiliateCommissionLedgerEntry" ADD CONSTRAINT "AffiliateCommissionLedgerEntry_amount_direction" CHECK (
 "entryType"='opening_balance' OR ("entryType"='accrual' AND "amountCents">0)
 OR ("entryType" IN ('refund','reversal') AND "amountCents"<0)
 OR ("entryType"='dispute_lost' AND "amountCents"<=0)
 OR ("entryType" IN ('dispute_opened','dispute_released') AND "amountCents"=0));
ALTER TABLE "AffiliatePayout" ADD COLUMN "heldAmountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AffiliatePayout" ADD CONSTRAINT "AffiliatePayout_hold_bounds" CHECK ("heldAmountCents">=0 AND "heldAmountCents"<="commissionAmountCents");
CREATE FUNCTION merchant_affiliate_zero_dispute_outcome_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."entryType"='dispute_lost' AND NEW."amountCents"=0 THEN
   IF NOT EXISTS(SELECT 1 FROM "AffiliateCommissionLedgerEntry" e WHERE e."vendorId"=NEW."vendorId" AND e."affiliateCommissionId"=NEW."affiliateCommissionId" AND e."providerName"=NEW."providerName" AND e."disputeCaseId"=NEW."disputeCaseId" AND e."entryType"='dispute_opened')
     OR EXISTS(SELECT 1 FROM "AffiliateCommissionLedgerEntry" e WHERE e."vendorId"=NEW."vendorId" AND e."affiliateCommissionId"=NEW."affiliateCommissionId" AND e."providerName"=NEW."providerName" AND e."disputeCaseId"=NEW."disputeCaseId" AND e."entryType" IN ('dispute_lost','dispute_released'))
     OR (SELECT coalesce(sum(e."amountCents"),0) FROM "AffiliateCommissionLedgerEntry" e WHERE e."vendorId"=NEW."vendorId" AND e."affiliateCommissionId"=NEW."affiliateCommissionId")<>0 THEN
     RAISE EXCEPTION 'zero lost requires an open case and zero accounting balance' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER merchant_affiliate_zero_dispute_outcome_guard BEFORE INSERT ON "AffiliateCommissionLedgerEntry" FOR EACH ROW EXECUTE FUNCTION merchant_affiliate_zero_dispute_outcome_guard();
