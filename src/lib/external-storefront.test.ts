import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { POST as checkout } from "@/app/api/payments/checkout/route";
import { getDb } from "@/lib/db";
import {
  ExternalStorefrontError,
  normalizeExternalStorefrontUrl,
  resolveExternalStorefrontRedirect,
  reviewExternalOrderEvidence,
  submitExternalOrderEvidence,
  upsertAffiliateProductLink,
} from "@/lib/external-storefront";

const vendorIds: string[] = [];
const userIds: string[] = [];

async function createFixture(label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await getDb().user.create({
    data: { email: `owner-${suffix}@example.test`, name: `Owner ${label}`, passwordHash: "test" },
  });
  const vendor = await getDb().vendor.create({
    data: {
      name: `External ${label}`,
      slug: `external-${suffix}`,
      email: `vendor-${suffix}@example.test`,
      passwordHash: "test",
      members: { create: { userId: owner.id, role: "owner", status: "active" } },
    },
  });
  const [affiliate, product] = await Promise.all([
    getDb().affiliate.create({
      data: {
        vendorId: vendor.id,
        name: `Affiliate ${label}`,
        code: `EXT${suffix}`.toUpperCase(),
        commissionRateBps: 850,
      },
    }),
    getDb().product.create({
      data: {
        vendorId: vendor.id,
        name: `External Product ${label}`,
        slug: `external-product-${suffix}`,
        priceCents: 125000,
        inventory: 0,
        checkoutMode: "external",
        checkoutUrl: `https://shop.example.test/products/${suffix}`,
      },
    }),
  ]);
  vendorIds.push(vendor.id);
  userIds.push(owner.id);
  return { vendor, owner, affiliate, product };
}

function checkoutRequest(vendorId: string, productId: string) {
  return new Request("https://app.example.test/api/payments/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
    },
    body: JSON.stringify({ vendorId, productId }),
  });
}

afterEach(async () => {
  const vendors = vendorIds.splice(0);
  const users = userIds.splice(0);
  await getDb().auditLog.deleteMany({ where: { vendorId: { in: vendors } } });
  await getDb().vendor.deleteMany({ where: { id: { in: vendors } } });
  await getDb().user.deleteMany({ where: { id: { in: users } } });
});

describe("external storefront vertical slice", () => {
  it("allows only absolute HTTPS storefront URLs", () => {
    expect(normalizeExternalStorefrontUrl("https://shop.example.test/p/1")).toBe("https://shop.example.test/p/1");
    for (const unsafe of ["http://shop.example.test/p/1", "javascript:alert(1)", "data:text/html,hi", "//shop.example.test/p/1"]) {
      expect(() => normalizeExternalStorefrontUrl(unsafe)).toThrow(ExternalStorefrontError);
    }
  });

  it("prefers an active affiliate link and falls back to the product URL", async () => {
    const fixture = await createFixture("redirect");
    const fallback = await resolveExternalStorefrontRedirect({
      vendorId: fixture.vendor.id,
      productId: fixture.product.id,
      affiliateId: fixture.affiliate.id,
    });
    expect(fallback).toMatchObject({ source: "product", redirectUrl: fixture.product.checkoutUrl });

    const link = await upsertAffiliateProductLink({
      vendorId: fixture.vendor.id,
      actorUserId: fixture.owner.id,
      affiliateId: fixture.affiliate.id,
      productId: fixture.product.id,
      url: "https://partner.example.test/personal-product",
      isActive: true,
    });
    const personalized = await resolveExternalStorefrontRedirect({
      vendorId: fixture.vendor.id,
      productId: fixture.product.id,
      affiliateId: fixture.affiliate.id,
    });
    expect(personalized).toMatchObject({ source: "affiliate", affiliateProductLinkId: link.id });
  });

  it("does not create a platform payment transaction for an external checkout click", async () => {
    const fixture = await createFixture("checkout");
    const before = await getDb().paymentTransaction.count({ where: { vendorId: fixture.vendor.id } });
    const response = await checkout(checkoutRequest(fixture.vendor.id, fixture.product.id));
    const body = await response.json() as { checkoutMode: string; redirectUrl: string };
    const after = await getDb().paymentTransaction.count({ where: { vendorId: fixture.vendor.id } });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ checkoutMode: "external", redirectUrl: fixture.product.checkoutUrl });
    expect(after).toBe(before);
  });

  it("rejects cross-tenant link and evidence relations without leaking the foreign record", async () => {
    const current = await createFixture("current");
    const foreign = await createFixture("foreign");

    await expect(upsertAffiliateProductLink({
      vendorId: current.vendor.id,
      actorUserId: current.owner.id,
      affiliateId: foreign.affiliate.id,
      productId: current.product.id,
      url: "https://partner.example.test/foreign",
      isActive: true,
    })).rejects.toMatchObject({ code: "ownership_mismatch" });

    await expect(submitExternalOrderEvidence({
      vendorId: current.vendor.id,
      affiliateId: foreign.affiliate.id,
      productId: current.product.id,
      externalOrderReference: "FOREIGN-ORDER-1",
      amountCents: 10000,
      currency: "TWD",
      submittedByUserId: current.owner.id,
    })).rejects.toMatchObject({ code: "ownership_mismatch" });
  });

  it("rejects cross-tenant external relations at the PostgreSQL constraint boundary", async () => {
    const current = await createFixture("constraint-current");
    const foreign = await createFixture("constraint-foreign");
    const now = new Date();

    await expect(getDb().$executeRaw`
      INSERT INTO "AffiliateProductLink" ("id", "vendorId", "affiliateId", "productId", "url", "updatedAt")
      VALUES (${randomUUID()}, ${current.vendor.id}, ${foreign.affiliate.id}, ${current.product.id}, ${"https://partner.example.test/cross-tenant"}, ${now})
    `).rejects.toThrow();

    await expect(getDb().$executeRaw`
      INSERT INTO "ExternalOrderEvidence" (
        "id", "vendorId", "affiliateId", "productId", "externalOrderReference", "amountCents", "currency",
        "referralCode", "commissionRateBps", "submittedByUserId", "updatedAt"
      ) VALUES (
        ${randomUUID()}, ${current.vendor.id}, ${foreign.affiliate.id}, ${current.product.id}, ${`CROSS-${randomUUID()}`},
        ${10000}, ${"TWD"}, ${foreign.affiliate.code}, ${foreign.affiliate.commissionRateBps}, ${current.owner.id}, ${now}
      )
    `).rejects.toThrow();
  });

  it("freezes attribution terms and creates only one commission after platform review", async () => {
    const fixture = await createFixture("review");
    const platformAdmin = await getDb().user.create({
      data: {
        email: `platform-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
        name: "Platform Admin",
        passwordHash: "test",
        platformRole: "platform_admin",
      },
    });
    userIds.push(platformAdmin.id);

    const evidence = await submitExternalOrderEvidence({
      vendorId: fixture.vendor.id,
      affiliateId: fixture.affiliate.id,
      productId: fixture.product.id,
      externalOrderReference: `EXTERNAL-${Date.now()}`,
      amountCents: 100000,
      currency: "TWD",
      submittedByUserId: fixture.owner.id,
    });
    expect(evidence).toMatchObject({ referralCode: fixture.affiliate.code, commissionRateBps: 850 });

    await getDb().affiliate.update({
      where: { id: fixture.affiliate.id },
      data: { code: `CHANGED${Date.now()}`, commissionRateBps: 2500 },
    });

    await expect(reviewExternalOrderEvidence({
      evidenceId: evidence.id,
      decision: "confirmed",
      reviewedByUserId: fixture.owner.id,
    })).rejects.toMatchObject({ code: "platform_admin_required" });

    const first = await reviewExternalOrderEvidence({
      evidenceId: evidence.id,
      decision: "confirmed",
      reviewedByUserId: platformAdmin.id,
    });
    const replay = await reviewExternalOrderEvidence({
      evidenceId: evidence.id,
      decision: "confirmed",
      reviewedByUserId: platformAdmin.id,
    });
    const commissions = await getDb().affiliateCommission.findMany({
      where: { vendorId: fixture.vendor.id, sourceType: "external_order_evidence", sourceId: evidence.id },
    });

    expect(first.commission).toMatchObject({
      referralCode: evidence.referralCode,
      commissionRateBps: 850,
      commissionAmountCents: 8500,
      status: "approved",
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(commissions).toHaveLength(1);
  });
});
