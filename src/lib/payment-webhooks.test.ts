import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { calculateSettlement } from "@/lib/billing";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";
import { createPlatformReferralPayoutBatch, syncPlatformReferralPayoutsForMonth } from "@/lib/platform-referral-payout";
import { reconcileWebhookEvent } from "@/lib/reconciliation";
import { processDueWebhookRetries } from "@/lib/webhook-retry";
import { protectProductDeliveryConfig, validateProductDeliveryDraft } from "@/lib/product-delivery";

const createdVendorIds: string[] = [];
const createdBillingPlanIds: string[] = [];
const createdWebhookEventIds: string[] = [];
const createdUserIds: string[] = [];
const createdPlatformReferralPayoutIds: string[] = [];
const createdPlatformReferralPayoutBatchIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "payment-webhook-test-encryption-secret-longer-than-thirty-two-bytes");
});

function webhookPayloadJson(payload: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({ normalized: payload })) as Prisma.InputJsonValue;
}

async function createFixture(suffix: string) {
  const db = getDb();
  const plan = await db.billingPlan.create({
    data: {
      name: `Test Plan ${suffix}`,
      code: `test-plan-${suffix}`,
      monthlyPriceCents: 100000,
      transactionFeeRateBps: 100,
    },
  });
  createdBillingPlanIds.push(plan.id);
  const vendor = await db.vendor.create({
    data: {
      name: `Webhook Vendor ${suffix}`,
      slug: `webhook-vendor-${suffix}`,
      email: `webhook-${suffix}@example.com`,
      passwordHash: "test",
      subscriptions: {
        create: {
          planId: plan.id,
          paymentMode: "platform",
          status: "active",
        },
      },
    },
  });
  const affiliate = await db.affiliate.create({
    data: {
      vendorId: vendor.id,
      name: `Partner ${suffix}`,
      code: `REF${suffix}`.toUpperCase(),
      commissionRateBps: 800,
    },
  });
  createdVendorIds.push(vendor.id);
  return { db, vendor, affiliate };
}

async function createTeamLeadAttributionFixture(vendorId: string, suffix: string) {
  const db = getDb();
  const user = await db.user.create({
    data: {
      name: `Webhook Attribution User ${suffix}`,
      email: `webhook-attribution-${suffix}@example.com`,
      passwordHash: "test",
    },
  });
  createdUserIds.push(user.id);

  const [vendorMember, team] = await Promise.all([
    db.vendorMember.create({ data: { vendorId, userId: user.id } }),
    db.salesTeam.create({ data: { vendorId, name: `Webhook Attribution Team ${suffix}`, slug: `webhook-attribution-team-${suffix}` } }),
  ]);
  const membership = await db.teamMembership.create({
    data: { vendorId, teamId: team.id, vendorMemberId: vendorMember.id },
  });
  const template = await db.teamFunnelTemplate.create({
    data: { vendorId, teamId: team.id, name: `Webhook Attribution Template ${suffix}` },
  });
  const templateVersion = await db.teamFunnelTemplateVersion.create({
    data: {
      vendorId,
      teamId: team.id,
      templateId: template.id,
      version: 1,
      contentOwnerMembershipId: membership.id,
      createdByMemberId: vendorMember.id,
      headline: "Headline",
      ctaLabel: "Register",
    },
  });
  const page = await db.partnerFunnelPage.create({
    data: {
      vendorId,
      teamId: team.id,
      templateVersionId: templateVersion.id,
      promoterMembershipId: membership.id,
      contentOwnerMembershipId: membership.id,
      slug: `webhook-attribution-page-${suffix}`,
      headline: "Headline",
      ctaLabel: "Register",
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId,
      name: `Webhook Attribution Form ${suffix}`,
      slug: `webhook-attribution-form-${suffix}`,
      headline: "Register",
      fields: [],
    },
  });
  const formSubmission = await db.formSubmission.create({
    data: {
      formId: form.id,
      name: "Webhook Attribution Lead",
      email: `webhook-attribution-lead-${suffix}@example.com`,
    },
  });
  const leadAttribution = await db.teamLeadAttribution.create({
    data: {
      vendorId,
      teamId: team.id,
      formSubmissionId: formSubmission.id,
      pageId: page.id,
      leaderMembershipId: membership.id,
      promoterMembershipId: membership.id,
      contentOwnerMembershipId: membership.id,
      seminarOwnerMembershipId: membership.id,
      source: "REFERRAL",
      referralCode: `TEAM${suffix}`.toUpperCase(),
    },
  });

  return { formSubmission, leadAttribution };
}

afterEach(async () => {
  const db = getDb();
  const vendorIds = createdVendorIds.splice(0);
  const billingPlanIds = createdBillingPlanIds.splice(0);
  const userIds = createdUserIds.splice(0);
  vi.unstubAllEnvs();
  await db.platformReferralPayout.deleteMany({ where: { id: { in: createdPlatformReferralPayoutIds.splice(0) } } });
  await db.platformReferralPayoutBatch.deleteMany({ where: { id: { in: createdPlatformReferralPayoutBatchIds.splice(0) } } });
  await db.webhookEvent.deleteMany({ where: { id: { in: createdWebhookEventIds.splice(0) } } });
  await db.teamConversionAttribution.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamLeadAttribution.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.partnerFunnelPage.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamFunnelTemplateVersion.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamFunnelTemplate.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamMembership.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.salesTeam.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.registrationForm.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendorMember.deleteMany({ where: { vendorId: { in: vendorIds } } });
  // Accounting ledger rows intentionally block parent deletion. The disposable
  // schema runner removes this fixture data by dropping its marker schema.
  let retainedAccountingFixture = false;
  try {
    await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  } catch (error) {
    if (!(error instanceof Error) || !/append-only|foreign key constraint|RESTRICT setting/i.test(error.message)) throw error;
    retainedAccountingFixture = true;
  }
  if (retainedAccountingFixture) {
    // append-only accounting 保留 vendor 時，至少停用本測試建立的合成方案，避免污染方案頁。
    await db.billingPlan.updateMany({
      where: { id: { in: billingPlanIds } },
      data: { isActive: false },
    });
    return;
  }
  // Platform referral fixtures are owned by synthetic users rather than a
  // vendor. Remove the non-accounting rows before deleting those users so a
  // failed-payment test cannot leak a referral code into the next test.
  await db.platformReferralAttribution.deleteMany({ where: { ownerUserId: { in: userIds } } });
  await db.platformReferralClick.deleteMany({ where: { referralCode: { ownerUserId: { in: userIds } } } });
  await db.platformReferralCode.deleteMany({ where: { ownerUserId: { in: userIds } } });
  await db.billingPlan.deleteMany({ where: { id: { in: billingPlanIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("payment webhook processing", () => {
  it("rejects a payload without vendorId or vendorSlug before creating a transaction", async () => {
    const suffix = `${Date.now()}-unscoped`;
    const db = getDb();
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-unscoped-${suffix}`,
      eventType: "paid",
      orderNumber: `ORDER-UNSCOPED-${suffix}`,
      grossAmountCents: 100000,
    });

    await expect(processPaymentWebhook(payload)).rejects.toThrow("付款 webhook 缺少商家識別");

    const transactions = await db.paymentTransaction.findMany({ where: { orderNumber: payload.orderNumber } });
    expect(transactions).toHaveLength(0);
  });

  it("recovers the vendor from an existing provider order when PayUni omits vendor identifiers", async () => {
    const suffix = `${Date.now()}-payuni-order-scope`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-PAYUNI-SCOPE-${suffix}`;
    const checkoutTransaction = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "payuni",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 100000,
        netAmountCents: 100000,
        currency: "TWD",
        status: "pending",
      },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "payuni",
      eventId: `evt-payuni-order-scope-${suffix}`,
      eventType: "paid",
      orderNumber,
      grossAmountCents: 100000,
      currency: "TWD",
    }));

    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: checkoutTransaction.id } })).toMatchObject({
      vendorId: vendor.id,
      providerName: "payuni",
      status: "paid",
    });
  });

  it("does not bind a scoped webhook to another provider's transaction with the same order number", async () => {
    const suffix = `${Date.now()}-provider-order-scope`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-PROVIDER-SCOPE-${suffix}`;
    const foreignProviderTransaction = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "ecpay-like",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 100000,
        netAmountCents: 100000,
        currency: "TWD",
        status: "pending",
      },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-provider-order-scope-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 100000,
      currency: "TWD",
    }));

    expect(await db.paymentTransaction.findUniqueOrThrow({
      where: { id: foreignProviderTransaction.id },
    })).toMatchObject({ providerName: "ecpay-like", status: "pending" });
    expect(await db.paymentTransaction.count({
      where: { vendorId: vendor.id, providerName: "demo", orderNumber },
    })).toBe(1);
  });

  it("does not create duplicate transactions for the same order", async () => {
    const suffix = `${Date.now()}a`;
    const { db, vendor } = await createFixture(suffix);
    const payload = {
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid" as const,
      vendorSlug: vendor.slug,
      orderNumber: `ORDER-${suffix}`,
      grossAmountCents: 100000,
      gatewayFeeCents: 2000,
      platformFeeCents: 1000,
      referralCode: `REF${suffix}`.toUpperCase(),
    };

    await processPaymentWebhook(PaymentWebhookPayload.parse(payload));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: `evt-paid-${suffix}-retry` }));

    const transactions = await db.paymentTransaction.findMany({ where: { vendorId: vendor.id, orderNumber: payload.orderNumber } });
    expect(transactions).toHaveLength(1);
  });

  it("serializes concurrent callbacks for one logical order and commission", async () => {
    const suffix = `${Date.now()}-concurrent-order`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-CONCURRENT-${suffix}`;
    const payload = {
      provider: "demo",
      eventType: "paid" as const,
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      referralCode: affiliate.code,
    };

    const results = await Promise.allSettled([
      processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: `evt-a-${suffix}` })),
      processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: `evt-b-${suffix}` })),
    ]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id, orderNumber } })).toBe(1);
    expect(await db.affiliateCommission.count({
      where: { vendorId: vendor.id, orderNumber, referralCode: affiliate.code },
    })).toBe(1);
  });

  it("snapshots gross commission base separately from the provider-net reference", async () => {
    const suffix = `${Date.now()}-gross-net-reference`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-GROSS-NET-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-gross-net-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      gatewayFeeCents: 2000,
      platformFeeCents: 1000,
      referralCode: affiliate.code,
    }));

    await expect(db.affiliateCommission.findFirstOrThrow({
      where: { vendorId: vendor.id, orderNumber, sourceType: "webhook" },
    })).resolves.toMatchObject({
      orderAmountCents: 100000,
      commissionBaseAmountCents: 100000,
      netReferenceAmountCents: 97000,
      commissionAmountCents: 8000,
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-gross-net-refund-${suffix}`,
      eventType: "partially_refunded",
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 20000,
      gatewayFeeRefundCents: 400,
      platformFeeRefundCents: 200,
    }));

    await expect(db.affiliateCommission.findFirstOrThrow({
      where: { vendorId: vendor.id, orderNumber, sourceType: "webhook" },
    })).resolves.toMatchObject({
      commissionBaseAmountCents: 100000,
      netReferenceAmountCents: 77600,
      commissionAmountCents: 8000,
    });
  });

  it("reconciles an invoice payment through paid, partial-refund, and full-refund webhooks", async () => {
    const suffix = `${Date.now()}-invoice-payment-lifecycle`;
    const { db, vendor } = await createFixture(suffix);
    const invoice = await db.invoice.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2026-07",
        invoiceNumber: `INV-${suffix}`,
        monthlyFeeCents: 100000,
        subtotalCents: 100000,
        totalCents: 100000,
        status: "issued",
      },
    });
    const orderNumber = `ORDER-INVOICE-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: invoice.totalCents,
        netAmountCents: invoice.totalCents,
        currency: "TWD",
        status: "pending",
        metadata: {
          billingPurpose: "invoice_payment",
          invoiceId: invoice.id,
          invoiceTotalCents: invoice.totalCents,
        },
      },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-invoice-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: invoice.totalCents,
      currency: "TWD",
    }));
    await expect(db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({
      status: "paid",
      paidAt: expect.any(Date),
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-invoice-partial-${suffix}`,
      eventType: "partially_refunded",
      vendorId: vendor.id,
      orderNumber,
      refundAmountCents: 20000,
      currency: "TWD",
    }));
    await expect(db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({ status: "partially_refunded" });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-invoice-refunded-${suffix}`,
      eventType: "refunded",
      vendorId: vendor.id,
      orderNumber,
      refundAmountCents: 80000,
      currency: "TWD",
    }));
    await expect(db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({ status: "refunded" });
  });

  it("rejects an invoice webhook when the trusted transaction amount differs from the invoice", async () => {
    const suffix = `${Date.now()}-invoice-amount-mismatch`;
    const { db, vendor } = await createFixture(suffix);
    const invoice = await db.invoice.create({
      data: {
        vendorId: vendor.id,
        monthKey: "2026-07",
        invoiceNumber: `INV-${suffix}`,
        monthlyFeeCents: 100000,
        subtotalCents: 100000,
        totalCents: 100000,
        status: "issued",
      },
    });
    const orderNumber = `ORDER-INVOICE-MISMATCH-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 99999,
        netAmountCents: 99999,
        currency: "TWD",
        status: "pending",
        metadata: { billingPurpose: "invoice_payment", invoiceId: invoice.id },
      },
    });

    await expect(processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-invoice-mismatch-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 99999,
      currency: "TWD",
    }))).rejects.toThrow("帳單付款金額與帳單總額不一致");

    await expect(db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({ status: "issued", paidAt: null });
  });

  it("commits reserved inventory once and restocks only after a full refund", async () => {
    const suffix = `${Date.now()}-inventory-lifecycle`;
    const { db, vendor } = await createFixture(suffix);
    const product = await db.product.create({
      data: {
        vendorId: vendor.id,
        name: `Webhook Inventory Product ${suffix}`,
        slug: `webhook-inventory-product-${suffix}`,
        priceCents: 100000,
        inventory: 2,
      },
    });
    const orderNumber = `ORDER-INVENTORY-${suffix}`;
    const checkoutTransaction = await createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      transactionData: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        grossAmountCents: 100000,
        netAmountCents: 100000,
        currency: "TWD",
        status: "pending",
        metadata: { productId: product.id },
      },
    });
    const paidPayload = {
      provider: "demo",
      eventType: "paid" as const,
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 100000,
      currency: "TWD",
    };

    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...paidPayload, eventId: `evt-paid-${suffix}` }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...paidPayload, eventId: `evt-paid-retry-${suffix}` }));

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 1 });
    expect(await db.inventoryReservation.findUniqueOrThrow({
      where: { paymentTransactionId: checkoutTransaction.id },
    })).toMatchObject({ status: "committed" });

    const partialRefund = PaymentWebhookPayload.parse({
      ...paidPayload,
      eventId: `evt-partial-refund-${suffix}`,
      eventType: "partially_refunded",
      refundAmountCents: 10000,
    });
    await processPaymentWebhook(partialRefund);
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 1 });

    const fullRefund = PaymentWebhookPayload.parse({
      ...paidPayload,
      eventId: `evt-full-refund-${suffix}`,
      eventType: "refunded",
      refundAmountCents: 90000,
    });
    await processPaymentWebhook(fullRefund);
    await processPaymentWebhook(fullRefund);

    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2 });
    expect(await db.inventoryReservation.findUniqueOrThrow({
      where: { paymentTransactionId: checkoutTransaction.id },
    })).toMatchObject({ status: "released", releaseReason: "full_refund" });
  });

  it("snapshots a same-vendor lead attribution for paid webhooks and deduplicates retries", async () => {
    const suffix = `${Date.now()}-team-conversion`;
    const { db, vendor } = await createFixture(suffix);
    const { formSubmission, leadAttribution } = await createTeamLeadAttributionFixture(vendor.id, suffix);
    const orderNumber = `ORDER-TEAM-CONVERSION-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 100000,
        netAmountCents: 100000,
        currency: "TWD",
        status: "pending",
        metadata: { formSubmissionId: formSubmission.id },
      },
    });
    const payload = {
      provider: "demo",
      eventId: `evt-team-conversion-${suffix}`,
      eventType: "paid" as const,
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 100000,
    };

    await processPaymentWebhook(PaymentWebhookPayload.parse(payload));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: `evt-team-conversion-retry-${suffix}` }));

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber: payload.orderNumber } });
    expect(transaction.metadata).toMatchObject({ formSubmissionId: formSubmission.id });
    const attributions = await db.teamConversionAttribution.findMany({ where: { vendorId: vendor.id, paymentTransactionId: transaction.id } });
    expect(attributions).toHaveLength(1);
    expect(attributions[0]).toMatchObject({
      vendorId: vendor.id,
      paymentTransactionId: transaction.id,
      teamId: leadAttribution.teamId,
      leadAttributionId: leadAttribution.id,
      pageId: leadAttribution.pageId,
      leaderMembershipId: leadAttribution.leaderMembershipId,
      promoterMembershipId: leadAttribution.promoterMembershipId,
      contentOwnerMembershipId: leadAttribution.contentOwnerMembershipId,
      seminarOwnerMembershipId: leadAttribution.seminarOwnerMembershipId,
      source: leadAttribution.source,
      referralCode: leadAttribution.referralCode,
    });
  });

  it("does not attribute cross-vendor or non-payment webhooks", async () => {
    const suffix = `${Date.now()}-team-rejected`;
    const { db, vendor: leadVendor } = await createFixture(`${suffix}-lead`);
    const { vendor: paymentVendor } = await createFixture(`${suffix}-payment`);
    const { formSubmission } = await createTeamLeadAttributionFixture(leadVendor.id, suffix);

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-cross-vendor-${suffix}`,
      eventType: "paid",
      vendorId: paymentVendor.id,
      orderNumber: `ORDER-CROSS-VENDOR-${suffix}`,
      grossAmountCents: 100000,
      metadata: { formSubmissionId: formSubmission.id },
    }));
    await expect(processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-no-attribution-${suffix}`,
      eventType: "refunded",
      vendorId: leadVendor.id,
      orderNumber: `ORDER-REFUND-NO-ATTRIBUTION-${suffix}`,
      metadata: { formSubmissionId: formSubmission.id },
    }))).rejects.toThrow("找不到既存付款交易");

    expect(await db.teamConversionAttribution.count({ where: { vendorId: { in: [leadVendor.id, paymentVendor.id] } } })).toBe(0);
    const paymentTransaction = await db.paymentTransaction.findFirstOrThrow({
      where: { vendorId: paymentVendor.id, orderNumber: `ORDER-CROSS-VENDOR-${suffix}` },
    });
    expect(paymentTransaction.metadata).toEqual({});
  });

  it("never persists provider callback metadata or lets it replace checkout-owned identity", async () => {
    const suffix = `${Date.now()}-provider-metadata-boundary`;
    const { db, vendor } = await createFixture(suffix);
    const product = await db.product.create({
      data: {
        vendorId: vendor.id,
        name: `Trusted Checkout Product ${suffix}`,
        slug: `trusted-checkout-product-${suffix}`,
        priceCents: 100000,
        inventory: 1,
      },
    });
    const orderNumber = `ORDER-PROVIDER-METADATA-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 100000,
        netAmountCents: 100000,
        currency: "TWD",
        status: "pending",
        metadata: { productId: product.id, checkoutIdentityHash: "trusted-hash" },
      },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-provider-metadata-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 100000,
      metadata: {
        productId: "forged-product",
        checkoutIdentityHash: "forged-hash",
        buyerEmail: "private-buyer@example.test",
        formSubmissionId: "forged-submission",
      },
    }));

    const transaction = await db.paymentTransaction.findFirstOrThrow({
      where: { vendorId: vendor.id, orderNumber },
    });
    expect(transaction.metadata).toEqual({
      productId: product.id,
      checkoutIdentityHash: "trusted-hash",
    });
    expect(JSON.stringify(transaction.metadata)).not.toContain("private-buyer@example.test");
  });

  it("retains a canonical commerce checkout key after payment for safe browser retries", async () => {
    const suffix = `${Date.now()}-commerce-idempotency-retention`;
    const { db, vendor } = await createFixture(suffix);
    const product = await db.product.create({
      data: {
        vendorId: vendor.id,
        name: `Commerce Retry Product ${suffix}`,
        slug: `commerce-retry-product-${suffix}`,
        priceCents: 100000,
        inventory: 1,
        fulfillmentType: "digital",
      },
    });
    const delivery = validateProductDeliveryDraft({
      fulfillmentType: "digital",
      isActive: true,
      title: "Webhook 測試交付",
      destinationUrl: "https://delivery.example.com/webhook/content",
      instructions: "付款後開放。",
      hostConfirmed: true,
    })!;
    const allowlist = await db.vendorDeliveryUrlAllowlist.create({
      data: {
        vendorId: vendor.id,
        hostname: delivery.destinationHostname!,
        pathPrefix: delivery.destinationPathPrefix!,
      },
    });
    const deliveryConfigId = `delivery-config-${suffix}`;
    await db.productDeliveryConfig.create({
      data: {
        id: deliveryConfigId,
        vendorId: vendor.id,
        productId: product.id,
        allowlistId: allowlist.id,
        status: "active",
        fulfillmentType: "digital",
        deliveryKind: delivery.deliveryKind,
        title: delivery.title,
        ...protectProductDeliveryConfig(delivery, {
          vendorId: vendor.id,
          productId: product.id,
          configId: deliveryConfigId,
          revision: 1,
        }),
        activatedAt: new Date(),
      },
    });
    const checkoutIdempotencyKey = `commerce-retry-${suffix}`;
    const orderNumber = `ORDER-COMMERCE-RETRY-${suffix}`;
    const transaction = await createReservedPaymentTransaction({
      vendorId: vendor.id,
      productId: product.id,
      checkoutIdempotencyKey,
      transactionData: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: product.priceCents,
        netAmountCents: product.priceCents,
        currency: "TWD",
        status: "pending",
        checkoutIdempotencyKey,
        metadata: { productId: product.id },
      },
      createCommerceOrder: (tx, payment) => createCommerceOrderForCheckout(tx, {
        vendorId: vendor.id,
        productId: product.id,
        orderNumber,
        checkoutIdempotencyKey,
        paymentTransactionId: payment.id,
        totalAmountCents: product.priceCents,
        currency: "TWD",
        buyer: { name: "合成買家", email: `commerce-retry-${suffix}@example.test` },
        shipping: null,
      }).then(() => undefined),
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-commerce-retry-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: product.priceCents,
    }));

    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } }))
      .resolves.toMatchObject({ status: "paid", checkoutIdempotencyKey });
    await expect(db.commerceOrder.findUniqueOrThrow({
      where: { vendorId_checkoutIdempotencyKey: { vendorId: vendor.id, checkoutIdempotencyKey } },
    })).resolves.toMatchObject({ status: "paid", primaryPaymentTransactionId: transaction.id });
  });

  it("processes a webhook identified by vendorId", async () => {
    const suffix = `${Date.now()}-vendor-id`;
    const { db, vendor } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-vendor-id-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber: `ORDER-VENDOR-ID-${suffix}`,
      grossAmountCents: 100000,
    });

    await processPaymentWebhook(payload);

    const transaction = await db.paymentTransaction.findFirst({ where: { vendorId: vendor.id, orderNumber: payload.orderNumber } });
    expect(transaction).not.toBeNull();
  });

  it("rejects inconsistent vendor identifiers before updating a transaction", async () => {
    const suffix = `${Date.now()}-vendor-mismatch`;
    const { db, vendor: vendorById } = await createFixture(`${suffix}-id`);
    const { vendor: vendorBySlug } = await createFixture(`${suffix}-slug`);
    const orderNumber = `ORDER-VENDOR-MISMATCH-${suffix}`;
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-vendor-mismatch-initial-${suffix}`,
      eventType: "paid",
      vendorId: vendorById.id,
      orderNumber,
      grossAmountCents: 100000,
    }));
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-vendor-mismatch-${suffix}`,
      eventType: "paid",
      vendorId: vendorById.id,
      vendorSlug: vendorBySlug.slug,
      orderNumber,
      grossAmountCents: 200000,
    });

    await expect(processPaymentWebhook(payload)).rejects.toThrow("付款 webhook 商家識別不一致");

    const transactions = await db.paymentTransaction.findMany({ where: { orderNumber: payload.orderNumber } });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.grossAmountCents).toBe(100000);
  });

  it.each([
    { label: "amount", grossAmountCents: 99000, currency: "TWD" },
    { label: "currency", grossAmountCents: 100000, currency: "USD" },
  ])("rejects a checkout transaction webhook with a mismatched $label", async ({ label, grossAmountCents, currency }) => {
    const suffix = `${Date.now()}-checkout-mismatch-${currency}`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-CHECKOUT-MISMATCH-${suffix}`;
    const checkoutTransaction = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 100000,
        netAmountCents: 100000,
        currency: "TWD",
        status: "pending",
      },
    });

    await expect(processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-checkout-mismatch-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents,
      currency,
    }))).rejects.toThrow(label === "amount" ? "付款 webhook 訂單金額" : "付款 webhook 訂單幣別");

    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: checkoutTransaction.id } })).toMatchObject({
      grossAmountCents: 100000,
      currency: "TWD",
      status: "pending",
    });
  });

  it("uses checkout referral metadata, ignores forged callback codes, and accepts matching retries", async () => {
    const suffix = `${Date.now()}-checkout-referral-authority`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const forgedAffiliate = await db.affiliate.create({
      data: {
        vendorId: vendor.id,
        name: `Forged Partner ${suffix}`,
        code: `FORGED${suffix}`.toUpperCase(),
        commissionRateBps: 2000,
      },
    });
    const orderNumber = `ORDER-CHECKOUT-REFERRAL-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 100000,
        netAmountCents: 100000,
        currency: "TWD",
        status: "pending",
        metadata: { referralCode: affiliate.code },
      },
    });
    const payload = {
      provider: "demo",
      eventId: `evt-checkout-referral-${suffix}`,
      eventType: "paid" as const,
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 100000,
      currency: "TWD",
      referralCode: forgedAffiliate.code,
      metadata: { referralCode: forgedAffiliate.code },
    };

    await processPaymentWebhook(PaymentWebhookPayload.parse(payload));
    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...payload, eventId: `evt-checkout-referral-retry-${suffix}` }));

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    const commissions = await db.affiliateCommission.findMany({ where: { vendorId: vendor.id, orderNumber } });
    expect(transaction.metadata).toMatchObject({ referralCode: affiliate.code });
    expect(commissions).toEqual([
      expect.objectContaining({ affiliateId: affiliate.id, referralCode: affiliate.code, commissionAmountCents: 8000 }),
    ]);
    expect(commissions.find((commission) => commission.affiliateId === forgedAffiliate.id)).toBeUndefined();
  });

  it("marks only the checkout's matching affiliate click on paid events and ignores retries, failures, refunds, and mismatches", async () => {
    const suffix = `${Date.now()}-affiliate-click-conversion`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const click = await db.affiliateClick.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        referralCode: affiliate.code,
        visitorId: `visitor-${suffix}`,
        landingPath: "/test",
      },
    });
    const orderNumber = `ORDER-AFFILIATE-CLICK-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 100000,
        netAmountCents: 100000,
        currency: "TWD",
        status: "pending",
        metadata: { affiliateClickId: click.id, referralCode: affiliate.code },
      },
    });
    const paidPayload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-affiliate-click-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 100000,
      referralCode: "FORGEDCODE",
    });

    await processPaymentWebhook(paidPayload);
    const convertedAt = (await db.affiliateClick.findUniqueOrThrow({ where: { id: click.id } })).convertedAt;
    expect(convertedAt).not.toBeNull();

    await processPaymentWebhook(PaymentWebhookPayload.parse({ ...paidPayload, eventId: `evt-affiliate-click-retry-${suffix}` }));
    expect((await db.affiliateClick.findUniqueOrThrow({ where: { id: click.id } })).convertedAt).toEqual(convertedAt);

    const rejectedClick = await db.affiliateClick.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        referralCode: affiliate.code,
        visitorId: `visitor-rejected-${suffix}`,
        landingPath: "/test",
      },
    });
    const rejectedCases = [
      { label: "failed", eventType: "failed" as const, metadata: { affiliateClickId: rejectedClick.id, referralCode: affiliate.code } },
      { label: "refunded", eventType: "refunded" as const, metadata: { affiliateClickId: rejectedClick.id, referralCode: affiliate.code } },
      { label: "mismatch", eventType: "paid" as const, metadata: { affiliateClickId: rejectedClick.id, referralCode: "MISMATCH" } },
    ];
    for (const rejected of rejectedCases) {
      await db.paymentTransaction.create({
        data: {
          vendorId: vendor.id,
          providerName: "demo",
          orderNumber: `ORDER-AFFILIATE-CLICK-${rejected.label}-${suffix}`,
          paymentMode: "platform",
          grossAmountCents: 100000,
          netAmountCents: 100000,
          currency: "TWD",
          status: rejected.eventType === "refunded" ? "paid" : "pending",
          metadata: rejected.metadata,
        },
      });
      await processPaymentWebhook(PaymentWebhookPayload.parse({
        provider: "demo",
        eventId: `evt-affiliate-click-${rejected.label}-${suffix}`,
        eventType: rejected.eventType,
        vendorId: vendor.id,
        orderNumber: `ORDER-AFFILIATE-CLICK-${rejected.label}-${suffix}`,
        grossAmountCents: 100000,
        refundAmountCents: rejected.eventType === "refunded" ? 100000 : 0,
      }));
    }
    expect((await db.affiliateClick.findUniqueOrThrow({ where: { id: rejectedClick.id } })).convertedAt).toBeNull();
  });

  it("rejects dual vendor identifiers when either identifier cannot be resolved", async () => {
    const suffix = `${Date.now()}-vendor-missing`;
    const { db, vendor } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-vendor-missing-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      vendorSlug: `missing-vendor-${suffix}`,
      orderNumber: `ORDER-VENDOR-MISSING-${suffix}`,
      grossAmountCents: 100000,
    });

    await expect(processPaymentWebhook(payload)).rejects.toThrow("付款 webhook 商家識別無效");

    const transactions = await db.paymentTransaction.findMany({ where: { orderNumber: payload.orderNumber } });
    expect(transactions).toHaveLength(0);
  });

  it("does not create duplicate refund records for the same refund event", async () => {
    const suffix = `${Date.now()}b`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      gatewayFeeCents: 2000,
      platformFeeCents: 1000,
    }));

    const refundPayload = {
      provider: "demo",
      eventId: `evt-refund-${suffix}`,
      eventType: "partially_refunded" as const,
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 20000,
      refundReason: "test refund",
    };

    await processPaymentWebhook(PaymentWebhookPayload.parse(refundPayload));
    await processPaymentWebhook(PaymentWebhookPayload.parse(refundPayload));

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    const refunds = await db.refundRecord.findMany({ where: { paymentTransactionId: transaction.id, providerEventId: refundPayload.eventId } });
    expect(refunds).toHaveLength(1);
    expect(transaction.refundedAmountCents).toBe(20000);
  });

  it("deduplicates resent partial-refund ledger entries while accumulating distinct refunds", async () => {
    const suffix = `${Date.now()}-affiliate-refund-retry`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      referralCode: affiliate.code,
    }));

    const firstPartialRefund = {
      provider: "demo",
      eventId: `evt-refund-first-${suffix}`,
      eventType: "partially_refunded" as const,
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 20000,
    };
    await processPaymentWebhook(PaymentWebhookPayload.parse(firstPartialRefund));
    await processPaymentWebhook(PaymentWebhookPayload.parse(firstPartialRefund));
    const original = await db.affiliateCommission.findFirstOrThrow({
      where: { vendorId: vendor.id, orderNumber, sourceType: { not: "refund_adjustment" } },
    });
    expect(await db.affiliateCommissionLedgerEntry.count({
      where: { vendorId: vendor.id, affiliateCommissionId: original.id, entryType: "refund" },
    })).toBe(1);
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      ...firstPartialRefund,
      eventId: `evt-refund-second-${suffix}`,
      refundAmountCents: 30000,
    }));

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    const commissionAfterRefunds = await db.affiliateCommission.findUniqueOrThrow({ where: { id: original.id } });
    const refunds = await db.affiliateCommissionLedgerEntry.findMany({
      where: { vendorId: vendor.id, affiliateCommissionId: original.id, entryType: "refund" },
      orderBy: { createdAt: "asc" },
    });
    const ledgerNet = (await db.affiliateCommissionLedgerEntry.findMany({
      where: { vendorId: vendor.id, affiliateCommissionId: original.id },
    })).reduce((total, entry) => total + entry.amountCents, 0);

    expect(refunds).toHaveLength(2);
    expect(refunds.map((entry) => entry.eventIdentity).sort()).toEqual([
      firstPartialRefund.eventId,
      `evt-refund-second-${suffix}`,
    ]);
    expect(refunds.map((entry) => entry.amountCents).sort((a, b) => a - b)).toEqual([-2400, -1600]);
    expect(transaction.refundedAmountCents).toBe(50000);
    expect(ledgerNet).toBe(4000);
    expect(commissionAfterRefunds.netReferenceAmountCents).toBe(50000);
  });

  it("keeps a partially refunded commission eligible and charges the settlement from its ledger balance", async () => {
    const suffix = `${Date.now()}-partial-refund-settlement`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;
    const occurredAt = new Date();
    const monthKey = occurredAt.toISOString().slice(0, 7);

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      referralCode: affiliate.code,
      occurredAt: occurredAt.toISOString(),
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-partial-${suffix}`,
      eventType: "partially_refunded",
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 20000,
      occurredAt: occurredAt.toISOString(),
    }));

    const commission = await db.affiliateCommission.findFirstOrThrow({
      where: { vendorId: vendor.id, orderNumber, sourceType: { not: "refund_adjustment" } },
    });
    const settlement = await calculateSettlement(vendor.id, monthKey);

    expect(commission.status).toBe("pending");
    expect(await db.affiliateCommissionLedgerEntry.aggregate({
      where: { vendorId: vendor.id, affiliateCommissionId: commission.id },
      _sum: { amountCents: true },
    })).toEqual({ _sum: { amountCents: 6400 } });
    expect(settlement.payoutableAmountCents).toBe(73600);
  });

  it("reduces an unpaid locked affiliate payout when a later partial refund lowers the ledger balance", async () => {
    const suffix = `${Date.now()}-locked-partial-refund`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      referralCode: affiliate.code,
    }));
    const commission = await db.affiliateCommission.findFirstOrThrow({
      where: { vendorId: vendor.id, orderNumber, sourceType: { not: "refund_adjustment" } },
    });
    await db.affiliateCommission.update({ where: { id: commission.id }, data: { status: "locked" } });
    const payout = await db.affiliatePayout.create({
      data: {
        vendorId: vendor.id,
        affiliateId: affiliate.id,
        monthKey: commission.monthKey,
        commissionAmountCents: 8000,
        finalAmountCents: 8000,
        status: "pending",
      },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-partial-${suffix}`,
      eventType: "partially_refunded",
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 20000,
    }));

    await expect(db.affiliatePayout.findUniqueOrThrow({ where: { id: payout.id } })).resolves.toMatchObject({
      commissionAmountCents: 6400,
      adjustmentAmountCents: 0,
      finalAmountCents: 6400,
      status: "pending",
      payoutItemId: null,
    });
    await expect(db.affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } })).resolves.toMatchObject({ status: "locked" });
  });

  it("keeps source commission immutable and brings ledger net to zero after a full refund", async () => {
    const suffix = `${Date.now()}-affiliate-full-refund`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      referralCode: affiliate.code,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-partial-refund-${suffix}`,
      eventType: "partially_refunded",
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 20000,
    }));

    const fullRefund = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-full-refund-${suffix}`,
      eventType: "refunded",
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 80000,
    });
    await processPaymentWebhook(fullRefund);

    const commissionsAfterFullRefund = await db.affiliateCommission.findMany({
      where: { vendorId: vendor.id, orderNumber },
      orderBy: { createdAt: "asc" },
    });
    const transactionAfterFullRefund = await db.paymentTransaction.findFirstOrThrow({
      where: { vendorId: vendor.id, orderNumber },
    });
    const originalCommission = commissionsAfterFullRefund.find((commission) => commission.sourceType !== "refund_adjustment");
    const ledgerEntries = await db.affiliateCommissionLedgerEntry.findMany({
      where: { vendorId: vendor.id, affiliateCommissionId: originalCommission?.id },
      orderBy: { createdAt: "asc" },
    });
    const commissionStateAfterFullRefund = commissionsAfterFullRefund.map((commission) => ({
      id: commission.id,
      status: commission.status,
      commissionAmountCents: commission.commissionAmountCents,
    }));

    expect(commissionsAfterFullRefund).toHaveLength(1);
    expect(originalCommission).toMatchObject({
      status: "void",
      commissionAmountCents: 8000,
    });
    expect(ledgerEntries.map((entry) => entry.entryType)).toEqual(["accrual", "refund", "refund"]);
    expect(ledgerEntries.reduce((total, entry) => total + entry.amountCents, 0)).toBe(0);
    expect(transactionAfterFullRefund.refundedAmountCents).toBe(100000);

    await processPaymentWebhook(fullRefund);

    const commissionsAfterRetry = await db.affiliateCommission.findMany({
      where: { vendorId: vendor.id, orderNumber },
      orderBy: { createdAt: "asc" },
    });
    expect(commissionsAfterRetry.map((commission) => ({
      id: commission.id,
      status: commission.status,
      commissionAmountCents: commission.commissionAmountCents,
    }))).toEqual(commissionStateAfterFullRefund);
    expect(await db.refundRecord.count({
      where: { paymentTransactionId: transactionAfterFullRefund.id, providerEventId: fullRefund.eventId },
    })).toBe(1);
  });

  it("keeps a paid commission and payment state immutable through a synthetic dispute lifecycle", async () => {
    const suffix = `${Date.now()}-affiliate-dispute`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;
    const paidPayload = {
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid" as const,
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100_000,
      referralCode: affiliate.code,
    };
    await processPaymentWebhook(PaymentWebhookPayload.parse(paidPayload));
    const commission = await db.affiliateCommission.findFirstOrThrow({
      where: { vendorId: vendor.id, orderNumber, sourceType: { not: "refund_adjustment" } },
    });
    await db.affiliateCommission.update({ where: { id: commission.id }, data: { status: "paid" } });
    const caseId = `case-${suffix}`;

    await expect(processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo", eventId: `evt-lost-before-open-${suffix}`, eventType: "dispute_lost",
      vendorSlug: vendor.slug, orderNumber, disputeCaseId: caseId,
    }))).rejects.toThrow("必須先有 opened");

    const opened = {
      provider: "demo", eventId: `evt-opened-${suffix}`, eventType: "dispute_opened" as const,
      vendorSlug: vendor.slug, orderNumber, disputeCaseId: caseId,
    };
    await processPaymentWebhook(PaymentWebhookPayload.parse(opened));
    await processPaymentWebhook(PaymentWebhookPayload.parse(opened));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo", eventId: `evt-lost-${suffix}`, eventType: "dispute_lost",
      vendorSlug: vendor.slug, orderNumber, disputeCaseId: caseId,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo", eventId: `evt-late-failed-${suffix}`, eventType: "failed",
      vendorSlug: vendor.slug, orderNumber,
    }));

    const currentCommission = await db.affiliateCommission.findUniqueOrThrow({ where: { id: commission.id } });
    const payment = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    const entries = await db.affiliateCommissionLedgerEntry.findMany({
      where: { vendorId: vendor.id, affiliateCommissionId: commission.id }, orderBy: { createdAt: "asc" },
    });

    expect(currentCommission).toMatchObject({ status: "paid", commissionAmountCents: 8_000 });
    expect(payment.status).toBe("paid");
    expect(entries.map((entry) => entry.entryType)).toEqual(["accrual", "dispute_opened", "dispute_lost"]);
    expect(entries.filter((entry) => entry.entryType === "dispute_opened")).toHaveLength(1);
    expect(entries.reduce((total, entry) => total + entry.amountCents, 0)).toBe(0);
  });

  it("binds a dispute to the provider transaction instead of a colliding order number", async () => {
    const suffix = `${Date.now()}-affiliate-dispute-provider-scope`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;
    const paidPayload = (provider: string) => PaymentWebhookPayload.parse({
      provider,
      eventId: `evt-paid-${provider}-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100_000,
      referralCode: affiliate.code,
    });

    await processPaymentWebhook(paidPayload("provider-a"));
    await processPaymentWebhook(paidPayload("provider-b"));

    const transactions = await db.paymentTransaction.findMany({
      where: { vendorId: vendor.id, orderNumber },
      orderBy: { providerName: "asc" },
    });
    const commissions = await db.affiliateCommission.findMany({
      where: { vendorId: vendor.id, orderNumber, sourceType: "webhook" },
    });
    expect(transactions).toHaveLength(2);
    expect(commissions).toHaveLength(2);

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "provider-b",
      eventId: `evt-dispute-opened-provider-b-${suffix}`,
      eventType: "dispute_opened",
      vendorSlug: vendor.slug,
      orderNumber,
      disputeCaseId: `case-${suffix}`,
    }));

    const entries = await db.affiliateCommissionLedgerEntry.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "asc" },
    });
    const targetedCommission = commissions.find((commission) => commission.sourceId === transactions.find((transaction) => transaction.providerName === "provider-b")?.id);
    const untouchedCommission = commissions.find((commission) => commission.sourceId === transactions.find((transaction) => transaction.providerName === "provider-a")?.id);
    expect(targetedCommission).toBeDefined();
    expect(untouchedCommission).toBeDefined();
    expect(entries.filter((entry) => entry.affiliateCommissionId === targetedCommission!.id).map((entry) => entry.entryType)).toEqual([
      "accrual",
      "dispute_opened",
    ]);
    expect(entries.filter((entry) => entry.affiliateCommissionId === untouchedCommission!.id).map((entry) => entry.entryType)).toEqual([
      "accrual",
    ]);
  });

  it("binds a partial refund to the provider transaction instead of a colliding order number", async () => {
    const suffix = `${Date.now()}-affiliate-refund-provider-scope`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;
    const paidPayload = (provider: string) => PaymentWebhookPayload.parse({
      provider,
      eventId: `evt-paid-${provider}-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100_000,
      referralCode: affiliate.code,
    });

    await processPaymentWebhook(paidPayload("provider-a"));
    await processPaymentWebhook(paidPayload("provider-b"));

    const transactions = await db.paymentTransaction.findMany({
      where: { vendorId: vendor.id, orderNumber },
      orderBy: { providerName: "asc" },
    });
    const commissions = await db.affiliateCommission.findMany({
      where: { vendorId: vendor.id, orderNumber, sourceType: "webhook" },
    });
    const targetTransaction = transactions.find((transaction) => transaction.providerName === "provider-b");
    const targetedCommission = commissions.find((commission) => commission.sourceId === targetTransaction?.id);
    const untouchedCommission = commissions.find((commission) => commission.sourceId !== targetTransaction?.id);
    expect(targetTransaction).toBeDefined();
    expect(targetedCommission).toBeDefined();
    expect(untouchedCommission).toBeDefined();

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "provider-b",
      eventId: `evt-refund-provider-b-${suffix}`,
      eventType: "partially_refunded",
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 50_000,
    }));

    const entries = await db.affiliateCommissionLedgerEntry.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.filter((entry) => entry.affiliateCommissionId === targetedCommission!.id).map((entry) => ({
      type: entry.entryType,
      amountCents: entry.amountCents,
    }))).toEqual([
      { type: "accrual", amountCents: 8_000 },
      { type: "refund", amountCents: -4_000 },
    ]);
    expect(entries.filter((entry) => entry.affiliateCommissionId === untouchedCommission!.id).map((entry) => entry.entryType)).toEqual([
      "accrual",
    ]);
  });

  it("does not restore commission or transaction state when a paid webhook arrives after a full refund", async () => {
    const suffix = `${Date.now()}-delayed-paid-after-refund`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-initial-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      referralCode: affiliate.code,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-full-refund-${suffix}`,
      eventType: "refunded",
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 100000,
    }));

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-delayed-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      referralCode: affiliate.code,
    }));

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    const commission = await db.affiliateCommission.findFirstOrThrow({
      where: { vendorId: vendor.id, orderNumber, sourceType: { not: "refund_adjustment" } },
    });

    expect(commission).toMatchObject({ status: "void", commissionAmountCents: 8000 });
    expect((await db.affiliateCommissionLedgerEntry.aggregate({
      where: { vendorId: vendor.id, affiliateCommissionId: commission.id }, _sum: { amountCents: true },
    }))._sum.amountCents).toBe(0);
    expect(transaction).toMatchObject({ status: "refunded", refundedAmountCents: 100000 });
    expect(await db.refundRecord.count({ where: { paymentTransactionId: transaction.id } })).toBe(1);
  });

  it.each([
    ["paid", "paid"],
    ["partially_refunded", "partially_refunded"],
    ["refunded", "refunded"],
  ] as const)("does not regress a %s transaction when a late failed callback arrives", async (initialStatus, expectedStatus) => {
    const suffix = `${Date.now()}-late-failed-${initialStatus}`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-LATE-FAILED-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 100000,
    }));
    if (initialStatus === "partially_refunded") {
      await processPaymentWebhook(PaymentWebhookPayload.parse({
        provider: "demo",
        eventId: `evt-partial-${suffix}`,
        eventType: "partially_refunded",
        vendorId: vendor.id,
        orderNumber,
        refundAmountCents: 20_000,
      }));
    }
    if (initialStatus === "refunded") {
      await processPaymentWebhook(PaymentWebhookPayload.parse({
        provider: "demo",
        eventId: `evt-refund-${suffix}`,
        eventType: "refunded",
        vendorId: vendor.id,
        orderNumber,
        refundAmountCents: 100_000,
      }));
    }

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-failed-late-${suffix}`,
      eventType: "failed",
      vendorId: vendor.id,
      orderNumber,
    }));

    expect(await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } }))
      .toMatchObject({ status: expectedStatus });
  });

  it("rejects a refund that exceeds the remaining amount without creating ledger rows", async () => {
    const suffix = `${Date.now()}-over-refund`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-OVER-REFUND-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 100_000,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-partial-${suffix}`,
      eventType: "partially_refunded",
      vendorId: vendor.id,
      orderNumber,
      refundAmountCents: 40_000,
    }));

    await expect(processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-over-${suffix}`,
      eventType: "partially_refunded",
      vendorId: vendor.id,
      orderNumber,
      refundAmountCents: 70_000,
    }))).rejects.toThrow("剩餘可退款額度");

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    expect(transaction.refundedAmountCents).toBe(40_000);
    expect(await db.refundRecord.count({ where: { paymentTransactionId: transaction.id } })).toBe(1);
  });

  it.each(["refunded", "partially_refunded"] as const)("preserves the payment occurrence date while accumulating cross-month %s events", async (eventType) => {
    const suffix = `${Date.now()}-cross-month-refund`;
    const { db, vendor } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;
    const paidAt = "2026-01-31T15:30:00.000Z";
    const firstRefundAt = "2026-02-02T08:00:00.000Z";
    const secondRefundAt = "2026-02-15T09:45:00.000Z";

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      occurredAt: paidAt,
    }));

    const firstEventType = "partially_refunded" as const;
    const secondEventType = eventType;
    const secondRefundAmount = eventType === "refunded" ? 80_000 : 30_000;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-first-${suffix}`,
      eventType: firstEventType,
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: 20000,
      occurredAt: firstRefundAt,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-refund-second-${suffix}`,
      eventType: secondEventType,
      vendorSlug: vendor.slug,
      orderNumber,
      refundAmountCents: secondRefundAmount,
      occurredAt: secondRefundAt,
    }));

    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    expect(transaction.status).toBe(eventType);
    expect(transaction.occurredAt.toISOString()).toBe(paidAt);
    expect(transaction.refundedAt?.toISOString()).toBe(secondRefundAt);
    expect(transaction.refundedAmountCents).toBe(eventType === "refunded" ? 100000 : 50000);
  });

  it("creates affiliate commission when referralCode is present", async () => {
    const suffix = `${Date.now()}c`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-${suffix}`;

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-paid-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents: 100000,
      gatewayFeeCents: 2000,
      platformFeeCents: 1000,
      referralCode: affiliate.code,
    }));

    const commission = await db.affiliateCommission.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber } });
    expect(commission.affiliateId).toBe(affiliate.id);
    expect(commission.commissionAmountCents).toBe(8000);
  });

  it("retry worker only processes due webhook events", async () => {
    const suffix = `${Date.now()}d`;
    const { db, vendor } = await createFixture(suffix);
    const duePayload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-due-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber: `ORDER-DUE-${suffix}`,
      grossAmountCents: 100000,
    });
    const futurePayload = PaymentWebhookPayload.parse({
      ...duePayload,
      eventId: `evt-future-${suffix}`,
      orderNumber: `ORDER-FUTURE-${suffix}`,
    });
    const due = await db.webhookEvent.create({
      data: {
        provider: "demo",
        eventId: duePayload.eventId,
        eventType: duePayload.eventType,
        status: "failed",
        nextRetryAt: new Date(Date.now() - 1000),
        payload: webhookPayloadJson(duePayload),
      },
    });
    const future = await db.webhookEvent.create({
      data: {
        provider: "demo",
        eventId: futurePayload.eventId,
        eventType: futurePayload.eventType,
        status: "failed",
        nextRetryAt: new Date(Date.now() + 1000 * 60 * 60),
        payload: webhookPayloadJson(futurePayload),
      },
    });
    createdWebhookEventIds.push(due.id, future.id);

    const results = await processDueWebhookRetries();

    expect(results.some((result) => result.eventId === due.id && result.status === "processed")).toBe(true);
    expect(results.some((result) => result.eventId === future.id)).toBe(false);
  });

  it("recovers a stale retrying webhook claim while leaving a fresh claim untouched", async () => {
    const suffix = `${Date.now()}stale`;
    const { db, vendor } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-stale-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber: `ORDER-STALE-${suffix}`,
      grossAmountCents: 100000,
    });
    const [stale, fresh] = await Promise.all([
      db.webhookEvent.create({
        data: { provider: "demo", eventId: payload.eventId, eventType: payload.eventType, status: "retrying", retryCount: 0, payload: webhookPayloadJson(payload) },
      }),
      db.webhookEvent.create({
        data: { provider: "demo", eventId: `evt-fresh-${suffix}`, eventType: payload.eventType, status: "retrying", retryCount: 0, payload: webhookPayloadJson({ ...payload, eventId: `evt-fresh-${suffix}` }) },
      }),
    ]);
    createdWebhookEventIds.push(stale.id, fresh.id);
    await db.webhookEvent.update({ where: { id: stale.id }, data: { updatedAt: new Date(Date.now() - 1000 * 60 * 11) } });

    const results = await processDueWebhookRetries();
    const [recovered, unchanged] = await Promise.all([
      db.webhookEvent.findUniqueOrThrow({ where: { id: stale.id } }),
      db.webhookEvent.findUniqueOrThrow({ where: { id: fresh.id } }),
    ]);

    expect(results.some((result) => result.eventId === stale.id && result.status === "processed")).toBe(true);
    expect(recovered.status).toBe("processed");
    expect(recovered.retryCount).toBe(1);
    expect(unchanged.status).toBe("retrying");
    expect(unchanged.retryCount).toBe(0);
  });

  it("exhausts a stale maxed retry claim without creating a payment transaction", async () => {
    const suffix = `${Date.now()}maxed`;
    const { db } = await createFixture(suffix);
    const event = await db.webhookEvent.create({
      data: {
        provider: "demo",
        eventId: `evt-maxed-${suffix}`,
        eventType: "paid",
        status: "retrying",
        retryCount: 1,
        maxRetries: 1,
        payload: webhookPayloadJson({ provider: "demo", eventId: `evt-maxed-${suffix}` }),
      },
    });
    createdWebhookEventIds.push(event.id);
    await db.webhookEvent.update({ where: { id: event.id }, data: { updatedAt: new Date(Date.now() - 1000 * 60 * 11) } });

    const transactionCountBefore = await db.paymentTransaction.count();
    const results = await processDueWebhookRetries();
    const [updated, transactionCountAfter] = await Promise.all([
      db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } }),
      db.paymentTransaction.count(),
    ]);

    expect(results).toContainEqual({ eventId: event.id, status: "exhausted" });
    expect(updated.status).toBe("exhausted");
    expect(updated.nextRetryAt).toBeNull();
    expect(transactionCountAfter).toBe(transactionCountBefore);
  });

  it("marks webhook exhausted after max retries", async () => {
    const suffix = `${Date.now()}e`;
    const { db } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-exhaust-${suffix}`,
      eventType: "paid",
      vendorSlug: `missing-${suffix}`,
      orderNumber: `ORDER-EXHAUST-${suffix}`,
      grossAmountCents: 100000,
    });
    const event = await db.webhookEvent.create({
      data: {
        provider: "demo",
        eventId: payload.eventId,
        eventType: payload.eventType,
        status: "failed",
        retryCount: 0,
        maxRetries: 1,
        nextRetryAt: new Date(Date.now() - 1000),
        payload: webhookPayloadJson(payload),
      },
    });
    createdWebhookEventIds.push(event.id);

    await processDueWebhookRetries();

    const updated = await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("exhausted");
    expect(updated.retryCount).toBe(1);
  });

  it("accrues and reconciles platform referral commission only from a server-created subscription transaction", async () => {
    const suffix = `${Date.now()}-platform-referral`;
    const { db, vendor } = await createFixture(suffix);
    const subscription = await db.vendorSubscription.findFirstOrThrow({ where: { vendorId: vendor.id } });
    const owner = await db.user.create({
      data: {
        name: `Platform Referral Owner ${suffix}`,
        email: `platform-referral-owner-${suffix}@example.com`,
        passwordHash: "test",
      },
    });
    createdUserIds.push(owner.id);
    const referralCode = await db.platformReferralCode.create({
      data: { ownerUserId: owner.id, code: `PLAT${suffix}`.toUpperCase(), commissionRateBps: 1000 },
    });
    const click = await db.platformReferralClick.create({
      data: {
        referralCodeId: referralCode.id,
        visitorId: `visitor-${suffix}`,
        landingPath: "/billing/plans",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await db.platformReferralAttribution.create({
      data: {
        referralCodeId: referralCode.id,
        clickId: click.id,
        subscriptionId: subscription.id,
        ownerUserId: owner.id,
        codeSnapshot: referralCode.code,
        commissionRateBpsSnapshot: referralCode.commissionRateBps,
      },
    });
    const orderNumber = `PLATFORM-SUB-${suffix}`;
    const transaction = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 10_000,
        currency: "TWD",
        status: "pending",
        metadata: { platformSubscriptionId: subscription.id },
      },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 10_000,
      currency: "TWD",
    }));

    const accrued = await db.platformReferralCommission.findUniqueOrThrow({
      where: { paymentTransactionId: transaction.id },
      include: { ledgerEntries: true },
    });
    expect(accrued).toMatchObject({
      ownerUserId: owner.id,
      subscriptionId: subscription.id,
      grossAmountCents: 10_000,
      commissionAmountCents: 1_000,
      status: "pending",
    });
    expect(accrued.ledgerEntries).toHaveLength(1);
    expect(accrued.ledgerEntries[0]).toMatchObject({ entryType: "accrual", amountCents: 1_000 });

    const renewalOrderNumber = `PLATFORM-SUB-RENEWAL-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber: renewalOrderNumber,
        paymentMode: "platform",
        grossAmountCents: 10_000,
        currency: "TWD",
        status: "pending",
        metadata: { platformSubscriptionId: subscription.id },
      },
    });
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-renewal-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber: renewalOrderNumber,
      grossAmountCents: 10_000,
      currency: "TWD",
    }));
    expect(await db.platformReferralCommission.count({ where: { subscriptionId: subscription.id } })).toBe(1);

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-refund-${suffix}`,
      eventType: "partially_refunded",
      vendorId: vendor.id,
      orderNumber,
      refundAmountCents: 5_000,
      currency: "TWD",
    }));
    const partial = await db.platformReferralCommission.findUniqueOrThrow({
      where: { paymentTransactionId: transaction.id },
      include: { ledgerEntries: true },
    });
    expect(partial.ledgerEntries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(500);

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-refund-full-${suffix}`,
      eventType: "refunded",
      vendorId: vendor.id,
      orderNumber,
      refundAmountCents: 5_000,
      currency: "TWD",
    }));
    const refunded = await db.platformReferralCommission.findUniqueOrThrow({
      where: { paymentTransactionId: transaction.id },
      include: { ledgerEntries: true },
    });
    expect(refunded.status).toBe("void");
    expect(refunded.ledgerEntries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
  });

  it("closes the platform referral commission to owner payout batch with PostgreSQL-backed idempotency", async () => {
    const suffix = `${Date.now()}-platform-referral-payout-batch`;
    const payoutSeed = Date.now();
    const payoutMonthKey = `${String(8000 + (payoutSeed % 1000)).padStart(4, "0")}-${String((Math.floor(payoutSeed / 1000) % 12) + 1).padStart(2, "0")}`;
    const { db, vendor } = await createFixture(suffix);
    const subscription = await db.vendorSubscription.findFirstOrThrow({ where: { vendorId: vendor.id } });
    const owner = await db.user.create({
      data: {
        name: `Platform Payout Owner ${suffix}`,
        email: `platform-payout-owner-${suffix}@example.com`,
        passwordHash: "test",
      },
    });
    createdUserIds.push(owner.id);
    const referralCode = await db.platformReferralCode.create({
      data: { ownerUserId: owner.id, code: `PAYOUT${suffix}`.toUpperCase(), commissionRateBps: 1000 },
    });
    const click = await db.platformReferralClick.create({
      data: {
        referralCodeId: referralCode.id,
        visitorId: `visitor-${suffix}`,
        landingPath: "/billing/plans",
        expiresAt: new Date("2099-07-31T23:59:59.000Z"),
      },
    });
    await db.platformReferralAttribution.create({
      data: {
        referralCodeId: referralCode.id,
        clickId: click.id,
        subscriptionId: subscription.id,
        ownerUserId: owner.id,
        codeSnapshot: referralCode.code,
        commissionRateBpsSnapshot: referralCode.commissionRateBps,
      },
    });

    const orderNumber = `PLATFORM-PAYOUT-${suffix}`;
    const transaction = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 10_000,
        currency: "TWD",
        status: "pending",
        metadata: { platformSubscriptionId: subscription.id },
      },
    });
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-payout-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 10_000,
      currency: "TWD",
      occurredAt: `${payoutMonthKey}-20T12:00:00.000Z`,
    }));

    const batchNumber = `PRP-${payoutMonthKey.replace("-", "")}-${suffix}`;
    const result = await db.$transaction(async (tx) => {
      const synced = await syncPlatformReferralPayoutsForMonth(tx, { monthKey: payoutMonthKey });
      const batch = await createPlatformReferralPayoutBatch(tx, {
        monthKey: payoutMonthKey,
        batchNumber,
        batchDate: new Date("2099-08-01T00:00:00.000Z"),
      });
      return { synced, batch };
    });

    if (result.batch) createdPlatformReferralPayoutBatchIds.push(result.batch.id);
    const payout = await db.platformReferralPayout.findUnique({
      where: { ownerUserId_monthKey: { ownerUserId: owner.id, monthKey: payoutMonthKey } },
    });
    if (payout) createdPlatformReferralPayoutIds.push(payout.id);

    expect(result.synced).toHaveLength(1);
    expect(result.batch).toMatchObject({
      batchNumber,
      monthKey: payoutMonthKey,
      totalAmountCents: 1_000,
      totalCount: 1,
      status: "draft",
    });
    expect(result.batch).not.toBeNull();

    expect(payout).not.toBeNull();
    expect(payout).toMatchObject({
      ownerUserId: owner.id,
      commissionAmountCents: 1_000,
      finalAmountCents: 1_000,
      payoutBatchId: result.batch!.id,
      status: "batched",
    });

    const replayed = await createPlatformReferralPayoutBatch(db, {
      monthKey: payoutMonthKey,
      batchNumber,
      batchDate: new Date("2099-08-02T00:00:00.000Z"),
    });
    expect(replayed).toMatchObject({ id: result.batch!.id, batchNumber, totalCount: 1 });
    expect(await db.platformReferralPayoutBatch.count({ where: { batchNumber } })).toBe(1);
    expect(await db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } })).toMatchObject({ status: "paid" });
  });

  it("reverses a platform referral commission on a lost chargeback and ignores a retry", async () => {
    const suffix = `${Date.now()}-platform-referral-dispute`;
    const { db, vendor } = await createFixture(suffix);
    const subscription = await db.vendorSubscription.findFirstOrThrow({ where: { vendorId: vendor.id } });
    const owner = await db.user.create({
      data: {
        name: `Platform Referral Dispute Owner ${suffix}`,
        email: `platform-referral-dispute-owner-${suffix}@example.com`,
        passwordHash: "test",
      },
    });
    createdUserIds.push(owner.id);
    const referralCode = await db.platformReferralCode.create({
      data: { ownerUserId: owner.id, code: `DISPUTE${suffix}`.toUpperCase(), commissionRateBps: 1000 },
    });
    const click = await db.platformReferralClick.create({
      data: {
        referralCodeId: referralCode.id,
        visitorId: `visitor-${suffix}`,
        landingPath: "/billing/plans",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await db.platformReferralAttribution.create({
      data: {
        referralCodeId: referralCode.id,
        clickId: click.id,
        subscriptionId: subscription.id,
        ownerUserId: owner.id,
        codeSnapshot: referralCode.code,
        commissionRateBpsSnapshot: referralCode.commissionRateBps,
      },
    });
    const orderNumber = `PLATFORM-DISPUTE-${suffix}`;
    const transaction = await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: 10_000,
        currency: "TWD",
        status: "pending",
        metadata: { platformSubscriptionId: subscription.id },
      },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-dispute-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 10_000,
      currency: "TWD",
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-dispute-opened-${suffix}`,
      eventType: "dispute_opened",
      vendorId: vendor.id,
      orderNumber,
      disputeCaseId: `case-${suffix}`,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-dispute-lost-${suffix}`,
      eventType: "dispute_lost",
      vendorId: vendor.id,
      orderNumber,
      disputeCaseId: `case-${suffix}`,
    }));
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-dispute-lost-retry-${suffix}`,
      eventType: "dispute_lost",
      vendorId: vendor.id,
      orderNumber,
      disputeCaseId: `case-${suffix}`,
    }));

    const disputed = await db.platformReferralCommission.findUniqueOrThrow({
      where: { paymentTransactionId: transaction.id },
      include: { ledgerEntries: true },
    });
    expect(disputed.status).toBe("void");
    expect(disputed.ledgerEntries).toHaveLength(3);
    expect(disputed.ledgerEntries.map((entry) => entry.entryType)).toEqual(expect.arrayContaining([
      "accrual",
      "dispute_opened",
      "dispute_lost",
    ]));
    expect(disputed.ledgerEntries.find((entry) => entry.entryType === "accrual")).toMatchObject({ amountCents: 1_000 });
    expect(disputed.ledgerEntries.find((entry) => entry.entryType === "dispute_lost")).toMatchObject({ amountCents: -1_000 });
    expect(disputed.ledgerEntries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
  });

  it("activates a pending platform plan only from its trusted checkout transaction", async () => {
    const suffix = `${Date.now()}-platform-plan-checkout`;
    const { db, vendor } = await createFixture(suffix);
    const previous = await db.vendorSubscription.findFirstOrThrow({ where: { vendorId: vendor.id, status: "active" } });
    const pending = await db.vendorSubscription.create({
      data: {
        vendorId: vendor.id,
        planId: previous.planId,
        paymentMode: "platform",
        status: "pending_payment",
      },
      include: { plan: true },
    });
    const orderNumber = `PLATFORM-PLAN-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: pending.plan.monthlyPriceCents,
        netAmountCents: pending.plan.monthlyPriceCents,
        currency: "TWD",
        status: "pending",
        metadata: {
          billingPurpose: "platform_subscription_checkout",
          platformSubscriptionId: pending.id,
          billingPlanId: pending.planId,
          billingPlanCode: pending.plan.code,
        },
      },
    });

    const paid = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-plan-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: pending.plan.monthlyPriceCents,
      currency: "TWD",
    });
    await processPaymentWebhook(paid);
    await processPaymentWebhook(PaymentWebhookPayload.parse({
      ...paid,
      eventId: `evt-platform-plan-paid-retry-${suffix}`,
    }));

    const activated = await db.vendorSubscription.findUniqueOrThrow({ where: { id: pending.id } });
    const endedPrevious = await db.vendorSubscription.findUniqueOrThrow({ where: { id: previous.id } });
    const usageLimit = await db.vendorUsageLimit.findUniqueOrThrow({ where: { vendorId: vendor.id } });
    expect(activated.status).toBe("active");
    expect(endedPrevious.status).toBe("ended");
    expect(usageLimit).toMatchObject({
      billingPlanId: pending.planId,
      streamMinutesLimit: pending.plan.includedStreamMinutes,
      storageMinutesLimit: pending.plan.includedStorageMinutes,
      creditsLimit: pending.plan.includedCredits,
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-plan-refund-${suffix}`,
      eventType: "refunded",
      vendorId: vendor.id,
      orderNumber,
      refundAmountCents: pending.plan.monthlyPriceCents,
      currency: "TWD",
    }));
    await expect(db.vendorSubscription.findUniqueOrThrow({ where: { id: pending.id } })).resolves.toMatchObject({
      status: "payment_refunded",
    });
  });

  it("marks a pending platform plan payment failed without enabling it", async () => {
    const suffix = `${Date.now()}-platform-plan-failed`;
    const { db, vendor } = await createFixture(suffix);
    const plan = await db.billingPlan.findFirstOrThrow({ where: { subscriptions: { some: { vendorId: vendor.id, status: "active" } } } });
    const referralOwner = await db.user.create({
      data: {
        name: `Platform Failure Referral Owner ${suffix}`,
        email: `platform-failure-referral-${suffix}@example.com`,
        passwordHash: "test",
      },
    });
    createdUserIds.push(referralOwner.id);
    const referralCode = await db.platformReferralCode.create({
      data: {
        ownerUserId: referralOwner.id,
        code: `FAIL${suffix}`.toUpperCase(),
        commissionRateBps: 1_000,
      },
    });
    const pending = await db.vendorSubscription.create({
      data: { vendorId: vendor.id, planId: plan.id, paymentMode: "platform", status: "pending_payment" },
    });
    const click = await db.platformReferralClick.create({
      data: {
        referralCodeId: referralCode.id,
        visitorId: `visitor-${suffix}`,
        landingPath: "/billing/plans",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await db.platformReferralAttribution.create({
      data: {
        referralCodeId: referralCode.id,
        clickId: click.id,
        subscriptionId: pending.id,
        ownerUserId: referralOwner.id,
        codeSnapshot: referralCode.code,
        commissionRateBpsSnapshot: referralCode.commissionRateBps,
      },
    });
    const orderNumber = `PLATFORM-FAIL-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber,
        paymentMode: "platform",
        grossAmountCents: plan.monthlyPriceCents,
        currency: "TWD",
        status: "pending",
        metadata: {
          billingPurpose: "platform_subscription_checkout",
          platformSubscriptionId: pending.id,
          billingPlanId: plan.id,
        },
      },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-plan-failed-${suffix}`,
      eventType: "failed",
      vendorId: vendor.id,
      orderNumber,
      currency: "TWD",
    }));

    await expect(db.vendorSubscription.findUniqueOrThrow({ where: { id: pending.id } })).resolves.toMatchObject({
      status: "payment_failed",
    });
    await expect(db.platformReferralAttribution.findUnique({ where: { subscriptionId: pending.id } })).resolves.toBeNull();
  });

  it("supersedes an older pending plan so a late paid callback cannot replace the newer checkout", async () => {
    const suffix = `${Date.now()}-platform-plan-stale-paid`;
    const { db, vendor } = await createFixture(suffix);
    const previous = await db.vendorSubscription.findFirstOrThrow({ where: { vendorId: vendor.id, status: "active" } });
    const olderCreatedAt = new Date("2026-08-07T00:00:00.000Z");
    const newerCreatedAt = new Date("2026-08-07T00:05:00.000Z");
    const [older, newer] = await Promise.all([
      db.vendorSubscription.create({
        data: { vendorId: vendor.id, planId: previous.planId, paymentMode: "platform", status: "pending_payment", createdAt: olderCreatedAt },
        include: { plan: true },
      }),
      db.vendorSubscription.create({
        data: { vendorId: vendor.id, planId: previous.planId, paymentMode: "platform", status: "pending_payment", createdAt: newerCreatedAt },
        include: { plan: true },
      }),
    ]);
    const staleOrder = `PLATFORM-STALE-${suffix}`;
    await db.paymentTransaction.create({
      data: {
        vendorId: vendor.id,
        providerName: "demo",
        orderNumber: staleOrder,
        paymentMode: "platform",
        grossAmountCents: older.plan.monthlyPriceCents,
        netAmountCents: older.plan.monthlyPriceCents,
        currency: "TWD",
        status: "pending",
        checkoutIdempotencyKey: `platform-plan:v1:${vendor.id}:stale`,
        metadata: {
          billingPurpose: "platform_subscription_checkout",
          platformSubscriptionId: older.id,
          billingPlanId: older.planId,
          billingPlanCode: older.plan.code,
        },
      },
    });

    await processPaymentWebhook(PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-platform-stale-paid-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber: staleOrder,
      grossAmountCents: older.plan.monthlyPriceCents,
      currency: "TWD",
    }));

    await expect(db.vendorSubscription.findUniqueOrThrow({ where: { id: older.id } })).resolves.toMatchObject({ status: "payment_superseded" });
    await expect(db.vendorSubscription.findUniqueOrThrow({ where: { id: newer.id } })).resolves.toMatchObject({ status: "pending_payment" });
    await expect(db.vendorSubscription.findUniqueOrThrow({ where: { id: previous.id } })).resolves.toMatchObject({ status: "active" });
    await expect(db.vendorUsageLimit.findUnique({ where: { vendorId: vendor.id } })).resolves.toBeNull();
    await expect(db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber: staleOrder } })).resolves.toMatchObject({
      status: "paid",
      checkoutIdempotencyKey: null,
    });
  });

  it("reconciliation detects refund amount mismatch", async () => {
    const suffix = `${Date.now()}f`;
    const { db, vendor } = await createFixture(suffix);
    const payload = PaymentWebhookPayload.parse({
      provider: "demo",
      eventId: `evt-reconcile-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber: `ORDER-RECON-${suffix}`,
      grossAmountCents: 100000,
    });
    await processPaymentWebhook(payload);
    const transaction = await db.paymentTransaction.findFirstOrThrow({ where: { vendorId: vendor.id, orderNumber: payload.orderNumber } });
    await db.paymentTransaction.update({ where: { id: transaction.id }, data: { refundedAmountCents: 12345 } });
    const event = await db.webhookEvent.create({
      data: {
        vendorId: vendor.id,
        provider: "demo",
        eventId: payload.eventId,
        eventType: payload.eventType,
        status: "processed",
        payload: webhookPayloadJson(payload),
      },
    });
    createdWebhookEventIds.push(event.id);

    const checks = await reconcileWebhookEvent(event);
    expect(checks.find((check) => check.key === "refund_total")?.status).toBe("fail");
  });

  it("reconciliation binds the transaction and commission to the webhook provider", async () => {
    const suffix = `${Date.now()}f-provider-scope`;
    const { db, vendor, affiliate } = await createFixture(suffix);
    const orderNumber = `ORDER-RECON-PROVIDER-${suffix}`;
    const paidPayload = (provider: string, grossAmountCents: number) => PaymentWebhookPayload.parse({
      provider,
      eventId: `evt-reconcile-paid-${provider}-${suffix}`,
      eventType: "paid",
      vendorSlug: vendor.slug,
      orderNumber,
      grossAmountCents,
      referralCode: affiliate.code,
    });

    await processPaymentWebhook(paidPayload("provider-a", 100_000));
    await processPaymentWebhook(paidPayload("provider-b", 120_000));

    const payload = PaymentWebhookPayload.parse({
      provider: "provider-b",
      eventId: `evt-reconcile-${suffix}`,
      eventType: "paid",
      vendorId: vendor.id,
      orderNumber,
      grossAmountCents: 120_000,
      referralCode: affiliate.code,
    });
    const event = await db.webhookEvent.create({
      data: {
        vendorId: vendor.id,
        provider: payload.provider,
        eventId: payload.eventId,
        eventType: payload.eventType,
        status: "processed",
        payload: webhookPayloadJson(payload),
      },
    });
    createdWebhookEventIds.push(event.id);

    const checks = await reconcileWebhookEvent(event);
    expect(checks.find((check) => check.key === "transaction_exists")?.status).toBe("pass");
    expect(checks.find((check) => check.key === "transaction_amount")?.status).toBe("pass");
    expect(checks.find((check) => check.key === "affiliate_commission")?.status).toBe("pass");
  });
});
