import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as recordAffiliateClick } from "@/app/api/affiliate-clicks/route";
import { POST as submitForm } from "@/app/api/form-submissions/route";
import { POST as checkout } from "@/app/api/payments/checkout/route";
import { getDb } from "@/lib/db";

const vendorIds: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

function clientRequest(url: string, body: unknown, cookie?: string) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("server-side checkout attribution", () => {
  it("ignores forged client referral and accepts only the signed click cookie", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "demo");
    vi.stubEnv("ATTRIBUTION_SECRET", "integration-attribution-secret-123456");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const vendor = await getDb().vendor.create({
      data: { name: "Attribution Vendor", slug: `attr-vendor-${suffix}`, email: `attr-${suffix}@example.test`, passwordHash: "test" },
    });
    vendorIds.push(vendor.id);
    const [affiliate, product, live, form] = await Promise.all([
      getDb().affiliate.create({ data: { vendorId: vendor.id, name: "Partner", code: `ATTR${suffix}`.toUpperCase(), commissionRateBps: 800 } }),
      getDb().product.create({ data: { vendorId: vendor.id, name: "Product", slug: `attr-product-${suffix}`, priceCents: 5000, inventory: 5 } }),
      getDb().live.create({ data: { vendorId: vendor.id, title: "Live", slug: `attr-live-${suffix}`, status: "live", scheduledAt: new Date() } }),
      getDb().registrationForm.create({ data: { vendorId: vendor.id, name: "Lead form", slug: `attr-form-${suffix}`, headline: "Lead", fields: [] } }),
    ]);

    const forgedCheckout = await checkout(clientRequest("https://app.example.test/api/payments/checkout", {
      vendorId: vendor.id,
      productId: product.id,
      referralCode: affiliate.code,
    }));
    const forgedBody = await forgedCheckout.json() as { transactionId: string };
    const forgedTransaction = await getDb().paymentTransaction.findUniqueOrThrow({ where: { id: forgedBody.transactionId } });
    expect(forgedTransaction.metadata).not.toMatchObject({ referralCode: affiliate.code });

    const clickResponse = await recordAffiliateClick(clientRequest("https://app.example.test/api/affiliate-clicks", {
      vendorId: vendor.id,
      liveId: live.id,
      referralCode: affiliate.code,
      visitorId: "visitor-a",
      landingPath: `/live/${live.slug}?ref=${affiliate.code}`,
    }));
    expect(clickResponse.status).toBe(200);
    const setCookie = clickResponse.headers.get("set-cookie");
    expect(setCookie).toContain(`celebrate_attr_${vendor.id}=`);
    const cookie = setCookie?.split(";", 1)[0];

    const leadResponse = await submitForm(clientRequest("https://app.example.test/api/form-submissions", {
      formId: form.id,
      payload: { name: "Lead", email: `lead-${suffix}@example.test` },
    }, cookie));
    expect(leadResponse.status).toBe(200);
    const leadClick = await getDb().affiliateClick.findFirstOrThrow({ where: { vendorId: vendor.id, visitorId: "visitor-a" } });
    expect(leadClick.leadAt).not.toBeNull();
    expect(leadClick.convertedAt).toBeNull();

    const attributedCheckout = await checkout(clientRequest("https://app.example.test/api/payments/checkout", {
      vendorId: vendor.id,
      productId: product.id,
      referralCode: "FORGED-OTHER-CODE",
    }, cookie));
    const attributedBody = await attributedCheckout.json() as { transactionId: string };
    const attributedTransaction = await getDb().paymentTransaction.findUniqueOrThrow({ where: { id: attributedBody.transactionId } });
    expect(attributedTransaction.metadata).toMatchObject({
      referralCode: affiliate.code,
      affiliateId: affiliate.id,
      commissionRateBps: affiliate.commissionRateBps,
      attributionPolicyVersion: "last-touch-30d-v1",
      attributionClickId: leadClick.id,
    });
  });

  it("records later clicks but preserves the first valid attribution when configured", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "demo");
    vi.stubEnv("ATTRIBUTION_SECRET", "integration-attribution-secret-123456");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const vendor = await getDb().vendor.create({
      data: {
        name: "First Touch Vendor",
        slug: `first-touch-vendor-${suffix}`,
        email: `first-touch-${suffix}@example.test`,
        passwordHash: "test",
        tracking: { create: { attributionPolicy: "first_touch", attributionWindowDays: 14 } },
      },
    });
    vendorIds.push(vendor.id);
    const [firstAffiliate, laterAffiliate, product] = await Promise.all([
      getDb().affiliate.create({ data: { vendorId: vendor.id, name: "First Partner", code: `FIRST${suffix}`.toUpperCase(), commissionRateBps: 500 } }),
      getDb().affiliate.create({ data: { vendorId: vendor.id, name: "Later Partner", code: `LATER${suffix}`.toUpperCase(), commissionRateBps: 900 } }),
      getDb().product.create({ data: { vendorId: vendor.id, name: "First Touch Product", slug: `first-touch-product-${suffix}`, priceCents: 8000, inventory: 5 } }),
    ]);

    const firstResponse = await recordAffiliateClick(clientRequest("https://app.example.test/api/affiliate-clicks", {
      vendorId: vendor.id,
      referralCode: firstAffiliate.code,
      visitorId: "first-touch-visitor",
      landingPath: `/offer?ref=${firstAffiliate.code}`,
    }));
    const firstCookie = firstResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(firstCookie).toContain(`celebrate_attr_${vendor.id}=`);
    expect(firstResponse.headers.get("set-cookie")).toContain("Max-Age=1209600");

    const laterResponse = await recordAffiliateClick(clientRequest("https://app.example.test/api/affiliate-clicks", {
      vendorId: vendor.id,
      referralCode: laterAffiliate.code,
      visitorId: "first-touch-visitor",
      landingPath: `/offer?ref=${laterAffiliate.code}`,
    }, firstCookie));
    await expect(laterResponse.json()).resolves.toMatchObject({ attribution: "first_touch_preserved" });
    expect(laterResponse.headers.get("set-cookie")).toBeNull();
    await expect(getDb().affiliateClick.count({ where: { vendorId: vendor.id } })).resolves.toBe(2);

    const checkoutResponse = await checkout(clientRequest("https://app.example.test/api/payments/checkout", {
      vendorId: vendor.id,
      productId: product.id,
    }, firstCookie));
    const checkoutBody = await checkoutResponse.json() as { transactionId: string };
    const transaction = await getDb().paymentTransaction.findUniqueOrThrow({ where: { id: checkoutBody.transactionId } });
    expect(transaction.metadata).toMatchObject({
      affiliateId: firstAffiliate.id,
      referralCode: firstAffiliate.code,
      attributionPolicyVersion: "first-touch-14d-v1",
    });
  });

  it("rejects unsupported attribution policy values at the database boundary", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const vendor = await getDb().vendor.create({
      data: { name: "Policy Constraint", slug: `policy-constraint-${suffix}`, email: `policy-${suffix}@example.test`, passwordHash: "test" },
    });
    vendorIds.push(vendor.id);
    await expect(getDb().trackingSetting.create({
      data: { vendorId: vendor.id, attributionPolicy: "typo_policy" },
    })).rejects.toThrow("TrackingSetting_attributionPolicy_check");
  });
});
