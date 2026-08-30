import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredClick = {
  id: string;
  vendorId: string;
  affiliateId: string | null;
  referralCode: string | null;
  visitorId: string;
  createdAt: Date;
};

type StoredSubmission = {
  id: string;
  formId: string;
  liveId: string | null;
  email: string;
};

type StoredTransaction = Record<string, unknown> & {
  id: string;
  metadata: Record<string, unknown>;
};

const testRuntime = vi.hoisted(() => {
  const state: {
    click: StoredClick | null;
    clickAttribution: Record<string, unknown> | null;
    submission: StoredSubmission | null;
    leadAttribution: Record<string, unknown> | null;
    transaction: StoredTransaction | null;
  } = {
    click: null,
    clickAttribution: null,
    submission: null,
    leadAttribution: null,
    transaction: null,
  };

  const db = {
    vendor: { findUnique: vi.fn() },
    live: { findFirst: vi.fn() },
    affiliate: { findFirst: vi.fn() },
    affiliateClick: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    partnerLiveShare: { findFirst: vi.fn() },
    teamMembership: { findMany: vi.fn() },
    teamMembershipRelationship: { findMany: vi.fn() },
    teamClickAttribution: { upsert: vi.fn() },
    registrationForm: { findUnique: vi.fn() },
    blacklist: { findFirst: vi.fn() },
    formSubmission: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    analyticsEvent: { create: vi.fn() },
    teamLeadAttribution: { upsert: vi.fn() },
    product: { findFirst: vi.fn() },
    paymentTransaction: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  };

  const inventoryMocks = {
    createReservedPaymentTransaction: vi.fn(),
    failPendingCheckoutAndReleaseInventory: vi.fn(),
  };
  const admissionMocks = {
    checkoutSessionTokenFromRequest: vi.fn(),
    verifyCheckoutAdmission: vi.fn(),
  };
  const commerceOrderMocks = { createCommerceOrderForCheckout: vi.fn() };
  const buyerSupportMocks = { issueBuyerSupportGrant: vi.fn() };

  const createCheckoutSession = vi.fn();
  return {
    state,
    db,
    inventoryMocks,
    admissionMocks,
    commerceOrderMocks,
    buyerSupportMocks,
    createCheckoutSession,
  };
});

vi.mock("@/lib/db", () => ({ getDb: () => testRuntime.db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/payment-providers", () => ({
  getPaymentProvider: () => ({
    id: "demo",
    checkoutReadiness: () => "local_only",
    createCheckoutSession: testRuntime.createCheckoutSession,
  }),
}));
vi.mock("@/lib/inventory-reservations", () => testRuntime.inventoryMocks);
vi.mock("@/lib/email-delivery", () => ({
  ensureFormSubmissionVerificationDelivery: vi.fn(async () => ({ status: "queued", deliveryId: "email-1" })),
}));
vi.mock("@/lib/checkout-admission", () => testRuntime.admissionMocks);
vi.mock("@/lib/commerce-orders", () => testRuntime.commerceOrderMocks);
vi.mock("@/lib/buyer-support-access", () => ({
  issueBuyerSupportGrant: testRuntime.buyerSupportMocks.issueBuyerSupportGrant,
  buyerSupportCookieOptions: () => ({
    httpOnly: true, sameSite: "lax", secure: true, path: "/",
  }),
}));

import { POST as recordAffiliateClick } from "@/app/api/affiliate-clicks/route";
import { POST as submitLead } from "@/app/api/form-submissions/route";
import { POST as startCheckout } from "@/app/api/payments/checkout/route";

const shareCode = `tls1.${"a".repeat(43)}`;
const vendorId = "vendor-1";
const liveId = "live-a";
const formId = "form-1";
const productId = "product-1";
const idempotencyKey = "123e4567-e89b-12d3-a456-426614174000";
const admissionToken = `ca1.${"a".repeat(64)}.${"b".repeat(43)}`;

function jsonRequest(
  path: string,
  payload: Record<string, unknown>,
  cookie?: string,
) {
  return new Request(`https://app.example.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      referer: "https://app.example.test/live/a?share=${shareCode}",
      "x-celebratedeal-client": "web",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function cookieHeader(...responses: Response[]) {
  return responses
    .flatMap((response) => response.headers.getSetCookie())
    .map((cookie) => cookie.split(";", 1)[0])
    .join("; ");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "commercial-flow-test-secret-that-is-at-least-32-bytes");
  Object.assign(testRuntime.state, {
    click: null,
    clickAttribution: null,
    submission: null,
    leadAttribution: null,
    transaction: null,
  });

  testRuntime.db.vendor.findUnique.mockResolvedValue({ id: vendorId });
  testRuntime.db.live.findFirst.mockResolvedValue({
    id: liveId,
    title: "Commercial flow live",
    formId,
    quotaPolicy: { affiliateMode: "enabled" },
    vendor: { name: "Commercial flow vendor" },
    messageTemplate: null,
  });
  testRuntime.db.affiliate.findFirst.mockResolvedValue({ id: "affiliate-b" });
  testRuntime.db.partnerLiveShare.findFirst.mockResolvedValue({
    vendorId,
    teamId: "team-1",
    liveId,
    sourcePageId: "page-a",
    promoterMembershipId: "member-b",
    expiresAt: null,
    isEnabled: true,
    sourcePage: {
      teamId: "team-1",
      liveId,
      templateVersionId: "version-a",
      promoterMembershipId: "member-a",
      contentOwnerMembershipId: "member-a",
    },
    live: {
      teamId: "team-1",
      seminarOwnerMembershipId: "member-a",
      status: "live",
      replayEnabled: true,
    },
  });
  testRuntime.db.teamMembership.findMany.mockResolvedValue([
    {
      id: "member-a",
      vendorId,
      teamId: "team-1",
      vendorMemberId: "vendor-member-a",
      status: "ACTIVE",
      leftAt: null,
      vendorMember: { userId: "user-a", status: "active", deactivatedAt: null },
      affiliate: { code: "A-CODE", isActive: true },
    },
    {
      id: "member-b",
      vendorId,
      teamId: "team-1",
      vendorMemberId: "vendor-member-b",
      status: "ACTIVE",
      leftAt: null,
      vendorMember: { userId: "user-b", status: "active", deactivatedAt: null },
      affiliate: { code: "B-CODE", isActive: true },
    },
  ]);
  testRuntime.db.teamMembershipRelationship.findMany.mockResolvedValue([{
    teamId: "team-1",
    uplineMembershipId: "member-a",
    downlineMembershipId: "member-b",
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    endedAt: null,
  }]);
  testRuntime.db.teamClickAttribution.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => {
    testRuntime.state.clickAttribution = create;
    return { id: "team-click-1" };
  });
  testRuntime.db.affiliateClick.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const click: StoredClick = {
      id: "click-1",
      vendorId: String(data.vendorId),
      affiliateId: typeof data.affiliateId === "string" ? data.affiliateId : null,
      referralCode: typeof data.referralCode === "string" ? data.referralCode : null,
      visitorId: String(data.visitorId),
      createdAt: new Date(),
    };
    testRuntime.state.click = click;
    return click;
  });
  testRuntime.db.affiliateClick.findFirst.mockImplementation(async () => {
    const click = testRuntime.state.click;
    return click
      ? {
          id: click.id,
          referralCode: click.referralCode,
          affiliateId: click.affiliateId,
          affiliate: { code: "B-CODE", vendorId, isActive: true },
          live: { quotaPolicy: { affiliateMode: "enabled" } },
          teamAttribution: testRuntime.state.clickAttribution ? { id: "team-click-1" } : null,
        }
      : null;
  });
  testRuntime.db.affiliateClick.updateMany.mockResolvedValue({ count: 1 });

  testRuntime.db.registrationForm.findUnique.mockResolvedValue({
    id: formId,
    vendorId,
    isActive: true,
    vendor: { name: "Commercial flow vendor" },
    fields: [
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ],
  });
  testRuntime.db.blacklist.findFirst.mockResolvedValue(null);
  testRuntime.db.formSubmission.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    const submission = testRuntime.state.submission;
    if (submission && where.id === submission.id) return { id: submission.id };
    return null;
  });
  testRuntime.db.formSubmission.findUnique.mockResolvedValue(null);
  testRuntime.db.formSubmission.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const submission: StoredSubmission = {
      id: "submission-1",
      formId: String(data.formId),
      liveId: typeof data.liveId === "string" ? data.liveId : null,
      email: String(data.email),
    };
    testRuntime.state.submission = submission;
    return {
      id: submission.id,
      name: String(data.name),
      email: submission.email,
      liveId: submission.liveId,
      verificationStatus: "UNVERIFIED",
      verificationVersion: 1,
      verificationExpiresAt: data.verificationExpiresAt,
    };
  });
  testRuntime.db.analyticsEvent.create.mockResolvedValue({ id: "event-1" });
  testRuntime.db.teamLeadAttribution.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => {
    testRuntime.state.leadAttribution = create;
    return { id: "team-lead-1" };
  });

  testRuntime.db.product.findFirst.mockResolvedValue({
    id: productId,
    name: "Synthetic Live product",
    vendorId,
    inventory: 3,
    priceCents: 1200,
    currency: "TWD",
    fulfillmentType: "digital",
    fulfillmentTypeConfirmed: true,
    isActive: true,
    revision: 1,
    checkoutUrl: null,
    deliveryConfig: { id: "delivery-config-1", status: "active", fulfillmentType: "digital" },
    vendor: { id: vendorId },
  });
  testRuntime.db.paymentTransaction.findUnique.mockResolvedValue(null);
  testRuntime.db.paymentTransaction.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    if (!testRuntime.state.transaction) throw new Error("transaction missing");
    testRuntime.state.transaction = { ...testRuntime.state.transaction, ...data } as StoredTransaction;
    return testRuntime.state.transaction;
  });
  testRuntime.db.paymentTransaction.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "transaction-1",
    ...data,
  }));
  testRuntime.commerceOrderMocks.createCommerceOrderForCheckout.mockResolvedValue({ id: "order-1" });
  testRuntime.buyerSupportMocks.issueBuyerSupportGrant.mockResolvedValue({
    name: `celebrate_support_${"a".repeat(32)}`,
    value: "b".repeat(43),
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  });
  testRuntime.admissionMocks.checkoutSessionTokenFromRequest.mockReturnValue("s".repeat(43));
  testRuntime.admissionMocks.verifyCheckoutAdmission.mockReturnValue({
    vendorId,
    productId,
    productRevision: 1,
    idempotencyKey,
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  });
  testRuntime.inventoryMocks.createReservedPaymentTransaction.mockImplementation(async ({
    transactionData,
    createCommerceOrder,
  }: {
    transactionData: Record<string, unknown>;
    createCommerceOrder?: (tx: unknown, transaction: StoredTransaction) => Promise<void>;
  }) => {
    testRuntime.state.transaction = {
      id: "transaction-1",
      ...transactionData,
      metadata: (transactionData.metadata ?? {}) as Record<string, unknown>,
    };
    if (createCommerceOrder) await createCommerceOrder({ transaction: true }, testRuntime.state.transaction);
    return testRuntime.state.transaction;
  });
  testRuntime.inventoryMocks.failPendingCheckoutAndReleaseInventory.mockResolvedValue(true);
  testRuntime.createCheckoutSession.mockResolvedValue({
    provider: "demo",
    mode: "manual",
    checkoutUrl: null,
    nextAction: "demo_checkout_transaction_created",
    externalRequired: false,
  });
});

describe("Live share commercial attribution flow", () => {
  it("carries one verified promoter from share click through lead and checkout metadata", async () => {
    const clickResponse = await recordAffiliateClick(jsonRequest(
      "/api/affiliate-clicks",
      {
        vendorId,
        liveId,
        shareCode,
        visitorId: "client-supplied-value",
        landingPath: `/live/a?share=${shareCode}`,
      },
    ));

    expect(clickResponse.status).toBe(200);
    expect(testRuntime.state.click).toMatchObject({
      affiliateId: "affiliate-b",
      referralCode: "B-CODE",
    });
    expect(testRuntime.state.clickAttribution).toMatchObject({
      promoterMembershipId: "member-b",
      contentOwnerMembershipId: "member-a",
      referralCode: "B-CODE",
    });
    expect(cookieHeader(clickResponse)).toContain("celebratedeal_attribution=");

    const clickCookies = cookieHeader(clickResponse);
    const leadResponse = await submitLead(jsonRequest(
      "/api/form-submissions",
      {
        formId,
        liveId,
        shareCode,
        payload: { name: "B lead", email: "b-lead@example.test" },
      },
      clickCookies,
    ));

    expect(leadResponse.status).toBe(200);
    expect(testRuntime.state.submission).toMatchObject({
      id: "submission-1",
      formId,
      liveId,
      email: "b-lead@example.test",
    });
    expect(testRuntime.state.leadAttribution).toMatchObject({
      formSubmissionId: "submission-1",
      promoterMembershipId: "member-b",
      contentOwnerMembershipId: "member-a",
      referralCode: "B-CODE",
    });

    const checkoutResponse = await startCheckout(jsonRequest(
      "/api/payments/checkout",
      {
        vendorId,
        productId,
        idempotencyKey,
        admissionToken,
        buyer: { name: "B lead", email: "b-lead@example.test" },
      },
      cookieHeader(clickResponse, leadResponse),
    ));

    expect(checkoutResponse.status).toBe(200);
    await expect(checkoutResponse.json()).resolves.toMatchObject({
      ok: true,
      transactionId: "transaction-1",
      provider: "demo",
    });
    expect(testRuntime.state.transaction?.metadata).toMatchObject({
      productId,
      affiliateClickId: "click-1",
      referralCode: "B-CODE",
      formSubmissionId: "submission-1",
    });
  });
});
