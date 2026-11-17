import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { hashBuyerSupportToken } from "@/lib/buyer-support-access";
import { createLuckyDrawClaimCode, hashLuckyDrawClaimCode } from "@/lib/live-interaction";
import { createSupportCase } from "@/lib/support-case-domain";
import { BETA_GATED_FEATURES, VENDOR_FEATURE_MODULES } from "@/lib/vendor-feature-toggles";
import type { TenantActor, TenantData } from "@/test/two-tenant-fixture";

/**
 * R-05 / F-134 (second batch): money and PII rows on top of
 * `createTwoTenantFixture`. Every row is synthetic and belongs to exactly one
 * tenant, so a second-tenant test can hand tenant B's identifiers to a tenant-A
 * actor and prove the action refuses them while the same call with tenant A's
 * identifiers goes through.
 */
export type TenantExtras = {
  invoiceId: string;
  paymentTransactionId: string;
  paymentMethodReferenceId: string;
  entitlementId: string;
  serviceFulfillmentId: string;
  shippingFulfillmentId: string;
  supportCaseId: string;
  blacklistId: string;
  consultationEventId: string;
  bookingId: string;
  customerKeyHash: string;
  emailDeliveryId: string;
  questionId: string;
  drawRunId: string;
  claimRunId: string;
  claimCode: string;
  portalAccessAffiliateId: string;
  buyerGrantId: string;
  buyerCookie: { name: string; value: string };
};

/** The actor's vendor with every module and beta feature on, as gated actions read it. */
export function withAllFeatures(actor: TenantActor) {
  return {
    ...actor,
    vendor: {
      ...actor.vendor,
      enabledFeatureModules: [...VENDOR_FEATURE_MODULES],
      betaFeatureGrants: [...BETA_GATED_FEATURES],
    },
  };
}

export async function addTenantExtras(db: PrismaClient, tenant: TenantData, label: string): Promise<TenantExtras> {
  const key = randomUUID();
  const vendorId = tenant.vendor.id;
  await db.vendor.update({
    where: { id: vendorId },
    data: { enabledFeatureModules: [...VENDOR_FEATURE_MODULES], betaFeatureGrants: [...BETA_GATED_FEATURES] },
  });

  const invoice = await db.invoice.create({
    data: { vendorId, monthKey: "2099-12", invoiceNumber: `INV-${key}`, subtotalCents: 5000, totalCents: 5000, status: "issued" },
  });

  // The fixture order becomes a paid order with three fulfilment lines.
  const payment = await db.paymentTransaction.create({
    data: {
      vendorId,
      providerName: "demo",
      orderNumber: `TT-${key}`,
      grossAmountCents: 1000,
      netAmountCents: 1000,
      currency: "TWD",
      status: "paid",
    },
  });
  await db.commerceOrder.update({
    where: { id: tenant.orderId },
    data: { status: "paid", paidAmountCents: 1000, primaryPaymentTransactionId: payment.id, paidAt: new Date() },
  });
  const line = (lineIndex: number, fulfillmentType: "digital" | "service" | "physical") => db.commerceOrderItem.create({
    data: {
      vendorId,
      orderId: tenant.orderId,
      productId: tenant.productId,
      lineIndex,
      productName: `Product ${label}`,
      productSlug: `line-${lineIndex}-${key}`,
      commerceDomain: "merchant",
      fulfillmentType,
      unitPriceCents: 1000,
      quantity: 1,
      lineTotalCents: 1000,
      nonSensitiveSnapshot: {},
    },
  });
  const digital = await line(0, "digital");
  const service = await line(1, "service");
  const physical = await line(2, "physical");
  const entitlement = await db.commerceEntitlement.create({ data: { vendorId, orderItemId: digital.id } });
  const serviceFulfillment = await db.serviceFulfillment.create({ data: { vendorId, orderItemId: service.id } });
  const shippingFulfillment = await db.shippingFulfillment.create({ data: { vendorId, orderItemId: physical.id } });

  const paymentMethodReference = await db.paymentMethodReference.create({
    data: {
      vendorId,
      scopeType: "VENDOR",
      providerName: "demo",
      providerPaymentMethodRef: `pm-${key}`,
      status: "verified",
      verifiedAt: new Date(),
    },
  });

  const supportCase = await db.$transaction((tx) => createSupportCase(tx, {
    vendorId,
    orderId: tenant.orderId,
    intakeKey: randomUUID(),
    category: "general",
    priority: "p2",
    summary: `${label} 合成客服案件`,
    actorMemberId: tenant.actors.support.member.id,
  }));

  const blacklist = await db.blacklist.create({
    data: { vendorId, identifier: `blocked-${key}@example.test`, identifierType: "email", reason: "synthetic" },
  });

  const consultationEvent = await db.consultationEvent.create({
    data: { vendorId, projectId: tenant.projectId, title: `Consultation ${label}`, weeklySchedule: [], intakeFormFields: [] },
  });
  const booking = await db.consultationBooking.create({
    data: {
      vendorId,
      eventId: consultationEvent.id,
      startTime: new Date("2099-02-01T02:00:00.000Z"),
      endTime: new Date("2099-02-01T03:00:00.000Z"),
      clientName: `${label} 諮詢者`,
      clientEmail: `client-${key}@example.test`,
      clientPhone: "0912345678",
    },
  });

  // A CRM customer that belongs to the tenant's selected project.
  const customerKeyHash = automationCustomerKeyHash(vendorId, `lead-${label.toLowerCase()}@example.test`);
  await db.customerCrmRecord.create({ data: { vendorId, customerKeyHash, consultationStatus: "following_up" } });
  await db.salesProjectCustomer.create({ data: { vendorId, projectId: tenant.projectId, customerKeyHash } });
  await db.customerTagAssignment.create({ data: { vendorId, customerKeyHash, tag: "vip" } });

  const emailDelivery = await db.emailDelivery.create({
    data: {
      id: randomUUID(),
      vendorId,
      sourceTemplateId: "synthetic-template",
      trigger: "synthetic",
      payloadEncryptedEnvelope: "synthetic-envelope",
      recipientHash: createHash("sha256").update(key).digest("hex"),
      recipientMaskedEmail: "l***@example.test",
      idempotencyKey: `email-${key}`,
      status: "failed",
      lastErrorCode: "provider_timeout",
      failedAt: new Date(),
    },
  });

  // The Live is on air with the product on its sales list.
  await db.live.update({ where: { id: tenant.liveId }, data: { status: "live" } });
  await db.liveProduct.create({ data: { vendorId, liveId: tenant.liveId, productId: tenant.productId } });
  const question = await db.liveQuestion.create({
    data: { vendorId, liveId: tenant.liveId, participantHash: `question-${key}`, displayName: `${label} 觀眾`, body: "合成提問" },
  });
  const luckyDraw = { kind: "lucky_draw", durationSec: 60, slogan: "抽", eligibility: "slogan", excludePreviousWinners: false };
  const drawRun = await db.liveInteractionRun.create({
    data: {
      vendorId,
      liveId: tenant.liveId,
      source: "manual",
      eventType: "lucky_draw",
      title: "抽獎",
      configuration: luckyDraw,
      endsAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });
  await db.liveInteractionResponse.create({
    data: { vendorId, liveId: tenant.liveId, runId: drawRun.id, participantHash: `draw-${key}`, eventType: "lucky_draw", value: "抽" },
  });
  const claimCode = createLuckyDrawClaimCode();
  const claimRun = await db.liveInteractionRun.create({
    data: {
      vendorId,
      liveId: tenant.liveId,
      source: "manual",
      eventType: "lucky_draw",
      title: "已開獎",
      configuration: luckyDraw,
      status: "closed",
      endsAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });
  const winner = await db.liveInteractionResponse.create({
    data: {
      vendorId,
      liveId: tenant.liveId,
      runId: claimRun.id,
      participantHash: `winner-${key}`,
      eventType: "lucky_draw",
      value: "抽",
      claimTokenHash: hashLuckyDrawClaimCode(claimCode),
    },
  });
  await db.liveInteractionRun.update({ where: { id: claimRun.id }, data: { winnerResponseId: winner.id } });

  // A second affiliate with an active partner-portal grant (revision 1).
  const portalAffiliate = await db.affiliate.create({
    data: { vendorId, name: `Portal affiliate ${label}`, code: `PORTAL-${key}`, commissionRateBps: 1000 },
  });
  await db.affiliatePortalAccess.create({
    data: { vendorId, affiliateId: portalAffiliate.id, vendorMemberId: tenant.actors.support.member.id, active: true, revision: 1 },
  });

  // The buyer's HttpOnly support capability for the paid order.
  const cookieKey = randomBytes(16).toString("hex");
  const token = randomBytes(32).toString("base64url");
  const grant = await db.buyerSupportOrderGrant.create({
    data: {
      vendorId,
      orderId: tenant.orderId,
      cookieKey,
      tokenHash: hashBuyerSupportToken(token),
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });

  return {
    invoiceId: invoice.id,
    paymentTransactionId: payment.id,
    paymentMethodReferenceId: paymentMethodReference.id,
    entitlementId: entitlement.id,
    serviceFulfillmentId: serviceFulfillment.id,
    shippingFulfillmentId: shippingFulfillment.id,
    supportCaseId: supportCase.id,
    blacklistId: blacklist.id,
    consultationEventId: consultationEvent.id,
    bookingId: booking.id,
    customerKeyHash,
    emailDeliveryId: emailDelivery.id,
    questionId: question.id,
    drawRunId: drawRun.id,
    claimRunId: claimRun.id,
    claimCode,
    portalAccessAffiliateId: portalAffiliate.id,
    buyerGrantId: grant.id,
    buyerCookie: { name: `celebrate_support_${cookieKey}`, value: token },
  };
}
