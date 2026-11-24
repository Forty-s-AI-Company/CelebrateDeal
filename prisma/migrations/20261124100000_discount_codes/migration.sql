-- A4-01 (owner 2026-11-23, U-10/U-11): merchant-wide discount codes that a
-- buyer types at checkout.
--
--   * "DiscountCode": one row per code, unique per vendor ignoring case
--     ("normalizedCode" is the upper-case form). The discount is read only
--     from this row; "redemptionCount" (reserved + redeemed uses) is changed
--     only by conditional updates inside the Serializable checkout and payment
--     transactions, and "revision" moves on every merchant edit so a checkout
--     quote that no longer matches the row is refused.
--   * "DiscountCodeProduct": products a non-global code applies to. Composite
--     foreign keys keep the code and the product in the same vendor.
--   * "DiscountCodeRedemption": one use per canonical order with the immutable
--     price snapshot (original subtotal, discount, total, code text and terms).
--     Composite foreign keys bind the code, order and payment to one vendor.
--
-- Forward-only and additive: three new tables, no existing row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "normalizedCode" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "appliesToAllProducts" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "maxRedemptionsPerBuyer" INTEGER,
    "minSubtotalCents" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiscountCode_normalizedCode_check" CHECK ("normalizedCode" ~ '^[A-Z0-9_-]{3,32}$' AND "normalizedCode" = upper("code")),
    CONSTRAINT "DiscountCode_discount_check" CHECK (
      ("discountType" = 'fixed_amount' AND "discountValue" BETWEEN 1 AND 100000000)
      OR ("discountType" = 'percentage' AND "discountValue" BETWEEN 1 AND 100)
    ),
    CONSTRAINT "DiscountCode_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "DiscountCode_window_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"),
    CONSTRAINT "DiscountCode_limits_check" CHECK (
      ("maxRedemptions" IS NULL OR "maxRedemptions" >= 1)
      AND ("maxRedemptionsPerBuyer" IS NULL OR "maxRedemptionsPerBuyer" >= 1)
      AND ("minSubtotalCents" IS NULL OR "minSubtotalCents" >= 0)
    ),
    -- A late paid callback after a released reservation may push the count
    -- past "maxRedemptions" (the money was already collected), so only the
    -- floor is enforced here; the cap is enforced by the checkout's
    -- conditional update.
    CONSTRAINT "DiscountCode_counters_check" CHECK ("redemptionCount" >= 0 AND "revision" >= 1)
);

-- CreateTable
CREATE TABLE "DiscountCodeProduct" (
    "vendorId" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCodeProduct_pkey" PRIMARY KEY ("vendorId","discountCodeId","productId")
);

-- CreateTable
CREATE TABLE "DiscountCodeRedemption" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "buyerKeyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "codeSnapshot" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotalAmountCents" INTEGER NOT NULL,
    "discountAmountCents" INTEGER NOT NULL,
    "totalAmountCents" INTEGER NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "DiscountCodeRedemption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiscountCodeRedemption_status_check" CHECK (
      ("status" = 'reserved' AND "redeemedAt" IS NULL AND "releasedAt" IS NULL)
      OR ("status" = 'redeemed' AND "redeemedAt" IS NOT NULL)
      OR ("status" = 'released' AND "releasedAt" IS NOT NULL AND "redeemedAt" IS NULL AND "releaseReason" IS NOT NULL)
    ),
    CONSTRAINT "DiscountCodeRedemption_discountType_check" CHECK ("discountType" IN ('fixed_amount', 'percentage')),
    -- The buyer always pays at least one whole currency unit (PayUni's minimum).
    CONSTRAINT "DiscountCodeRedemption_amounts_check" CHECK (
      "discountAmountCents" > 0
      AND "totalAmountCents" >= 100
      AND "subtotalAmountCents" = "discountAmountCents" + "totalAmountCents"
    ),
    CONSTRAINT "DiscountCodeRedemption_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

-- CreateIndex
CREATE INDEX "DiscountCode_vendorId_createdAt_idx" ON "DiscountCode"("vendorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_vendorId_id_key" ON "DiscountCode"("vendorId", "id");

-- CreateIndex
-- Case-insensitive uniqueness within a vendor; also the checkout lookup.
CREATE UNIQUE INDEX "DiscountCode_vendorId_normalizedCode_key" ON "DiscountCode"("vendorId", "normalizedCode");

-- CreateIndex
CREATE INDEX "DiscountCodeProduct_vendorId_productId_idx" ON "DiscountCodeProduct"("vendorId", "productId");

-- CreateIndex
-- The per-buyer limit count inside the checkout transaction.
CREATE INDEX "DiscountCodeRedemption_vendorId_discountCodeId_buyerKeyHash_idx" ON "DiscountCodeRedemption"("vendorId", "discountCodeId", "buyerKeyHash", "status");

-- CreateIndex
CREATE INDEX "DiscountCodeRedemption_vendorId_discountCodeId_status_idx" ON "DiscountCodeRedemption"("vendorId", "discountCodeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCodeRedemption_vendorId_id_key" ON "DiscountCodeRedemption"("vendorId", "id");

-- CreateIndex
-- At most one discount code per order (and per payment).
CREATE UNIQUE INDEX "DiscountCodeRedemption_vendorId_orderId_key" ON "DiscountCodeRedemption"("vendorId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCodeRedemption_vendorId_paymentTransactionId_key" ON "DiscountCodeRedemption"("vendorId", "paymentTransactionId");

-- AddForeignKey
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeProduct" ADD CONSTRAINT "DiscountCodeProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeProduct" ADD CONSTRAINT "DiscountCodeProduct_vendorId_discountCodeId_fkey" FOREIGN KEY ("vendorId", "discountCodeId") REFERENCES "DiscountCode"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeProduct" ADD CONSTRAINT "DiscountCodeProduct_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeRedemption" ADD CONSTRAINT "DiscountCodeRedemption_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeRedemption" ADD CONSTRAINT "DiscountCodeRedemption_vendorId_discountCodeId_fkey" FOREIGN KEY ("vendorId", "discountCodeId") REFERENCES "DiscountCode"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeRedemption" ADD CONSTRAINT "DiscountCodeRedemption_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountCodeRedemption" ADD CONSTRAINT "DiscountCodeRedemption_vendorId_paymentTransactionId_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "DiscountCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscountCodeProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscountCodeRedemption" ENABLE ROW LEVEL SECURITY;
