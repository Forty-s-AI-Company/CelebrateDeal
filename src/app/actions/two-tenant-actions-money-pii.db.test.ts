import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTwoTenantFixture,
  formData,
  type TenantActor,
  type TenantData,
  type TwoTenantFixture,
} from "@/test/two-tenant-fixture";
import { addTenantExtras, withAllFeatures, type TenantExtras } from "@/test/two-tenant-fixture-extras";

// R-05 / F-134 second batch: the second-tenant matrix for every money, refund,
// commission and PII Server Action (and the native POST/GET routes in front of
// them) that had no real-PostgreSQL cross-tenant test. As in
// two-tenant-actions.db.test.ts, only the session, CSRF, MFA step-up,
// rate-limit, navigation and payment-provider boundaries are synthetic. Each
// "foreign" row hands tenant B's identifiers to a tenant-A actor: it must be
// refused the same way a missing record is, and neither tenant may change. Each
// "own" row is the same action with tenant A's identifiers and must go through,
// so a refusal above is the tenant boundary and not a broken form.
const runtime = vi.hoisted(() => ({
  actor: null as unknown,
  cookies: [] as Array<{ name: string; value: string }>,
}));
const mocks = vi.hoisted(() => ({
  getPaymentProvider: vi.fn((): never => {
    throw new Error("synthetic: no payment provider in this test");
  }),
  scheduleImmediateEmailDispatch: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({
    getAll: () => runtime.cookies,
    get: (name: string) => runtime.cookies.find((cookie) => cookie.name === name),
  })),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
  notFound: (): never => {
    throw new Error("not_found");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/recent-mfa", () => ({ requireRecentMfa: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => null),
  getRateLimitProviderStatus: () => ({ durable: true, configured: true }),
}));
vi.mock("@/lib/app-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-url")>()),
  getCanonicalAppUrl: () => "http://localhost:3000",
}));
vi.mock("@/lib/payment-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payment-providers")>()),
  getPaymentProvider: mocks.getPaymentProvider,
}));
vi.mock("@/lib/email-delivery-immediate", () => ({ scheduleImmediateEmailDispatch: mocks.scheduleImmediateEmailDispatch }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  const current = () => runtime.actor as TenantActor;
  const session = { id: "synthetic-session" };
  const auth = () => ({ user: current().user, member: current().member, vendor: current().vendor, session });
  const memberContext = async () => ({ auth: auth(), user: current().user, vendor: current().vendor, member: current().member });
  return {
    ...original,
    getCurrentAuth: async () => ({ ...auth(), isPlatformAdmin: false, isMfaVerified: true }),
    requireVendorManager: async () => current().vendor,
    requireVendorManagerContext: async () => ({ auth: auth(), vendor: current().vendor }),
    requireVendorManagerMember: memberContext,
    requireVendorSupportMember: memberContext,
    requireVendorFinance: async () => ({ user: current().user, session, vendor: current().vendor, member: current().member }),
    // Platform finance (refund handoff review) acts across tenants by design.
    requireFinanceAdmin: async () => ({ user: current().user, session, vendor: null, member: { id: current().user.id, role: "platform_admin" }, isPlatformAdmin: true }),
  };
});

import { upsertAffiliateAction } from "@/app/actions";
import { unblockBlacklistAction } from "@/app/actions/interaction-actions";
import { GET as funnelReportsRoute } from "@/app/api/funnel/operations/reports/route";
import { POST as shippingRoute } from "@/app/api/orders/shipping/route";
import { POST as productUpsertRoute } from "@/app/api/products/upsert/route";
import { initialProductActionState } from "@/lib/product-action-state";
import { requestSupportRefundHandoff } from "@/lib/support-case-domain";
import { setAffiliatePortalAccessAction } from "./affiliate-portal-actions";
import { addBuyerSupportReplyAction, createBuyerSupportCaseAction } from "./buyer-support-actions";
import {
  grantCommerceEntitlementAction,
  transitionServiceFulfillmentAction,
  transitionShippingFulfillmentAction,
} from "./commerce-order-actions";
import { cancelConsultationBookingAction, updateConsultationBookingStatusAction } from "./consultation-actions";
import { removeCustomerTagAction, updateCustomerStatusAction } from "./customer-crm-actions";
import { manageEmailDeliveriesAction } from "./email-delivery-operations-actions";
import { readFunnelOperations } from "./funnel-operations-actions";
import {
  drawLiveInteractionWinnerAction,
  moderateLiveQuestionAction,
  startLiveInteractionAction,
  verifyLuckyDrawWinnerClaimAction,
} from "./interaction-actions";
import { payInvoiceAction } from "./invoice-actions";
import { revokePaymentMethodReferenceAction, startPaymentMethodSetupAction } from "./payment-method-actions";
import { upsertProductAction } from "./product-server-actions";
import { enterStudentPortalFromCheckoutAction } from "./student-portal-actions";
import {
  addSupportCaseCustomerReplyAction,
  addSupportCaseNoteAction,
  assignSupportCaseAction,
  createSupportCaseAction,
  requestSupportRefundHandoffAction,
  reviewSupportRefundHandoffAction,
  transitionSupportCaseAction,
} from "./support-case-actions";

const db = new PrismaClient();
let fixture: TwoTenantFixture;
let extras: { a: TenantExtras; b: TenantExtras };

type Tenant = TenantData & { x: TenantExtras };
type Fix = { a: Tenant; b: Tenant };

/** Every row the actions below could write, per tenant, as comparable JSON. */
async function snapshot(vendorId: string) {
  const byVendor = { where: { vendorId }, orderBy: { id: "asc" as const } };
  return JSON.stringify([
    await db.invoice.findMany(byVendor),
    await db.paymentTransaction.findMany(byVendor),
    await db.paymentMethodReference.findMany(byVendor),
    await db.paymentMethodSetupIntent.findMany(byVendor),
    await db.commerceOrder.findMany(byVendor),
    await db.commerceOrderItem.findMany(byVendor),
    await db.commerceEntitlement.findMany(byVendor),
    await db.serviceFulfillment.findMany(byVendor),
    await db.shippingFulfillment.findMany(byVendor),
    await db.commerceOrderEvent.findMany(byVendor),
    await db.supportCase.findMany(byVendor),
    await db.supportCaseEvent.findMany(byVendor),
    await db.supportRefundHandoff.findMany(byVendor),
    await db.buyerSupportOrderGrant.findMany(byVendor),
    await db.blacklist.findMany(byVendor),
    await db.consultationEvent.findMany(byVendor),
    await db.consultationBooking.findMany(byVendor),
    await db.customerCrmRecord.findMany(byVendor),
    await db.customerTagAssignment.findMany(byVendor),
    await db.salesProjectCustomer.findMany(byVendor),
    await db.emailDelivery.findMany(byVendor),
    await db.live.findMany(byVendor),
    await db.liveQuestion.findMany(byVendor),
    await db.liveInteractionRun.findMany(byVendor),
    await db.liveInteractionResponse.findMany(byVendor),
    await db.affiliate.findMany(byVendor),
    await db.affiliatePortalAccess.findMany({ where: { vendorId }, orderBy: { affiliateId: "asc" } }),
    await db.product.findMany(byVendor),
    await db.landingPage.findMany(byVendor),
    await db.auditLog.count({ where: { vendorId } }),
  ]);
}

/**
 * A Server Action ends in `redirect()` (thrown), returns a state object, or
 * throws. A route answers a Response. Everything becomes one comparable string.
 */
async function outcome(run: () => Promise<unknown>) {
  try {
    const value = await run();
    if (value instanceof Response) {
      const location = value.headers.get("location");
      return location ? `response:${value.status}:${new URL(location).pathname}${new URL(location).search}` : `response:${value.status}:${await value.text()}`;
    }
    if (value && typeof value === "object" && "status" in value && "message" in value) {
      const state = value as { status: string; message: string };
      return `state:${state.status}:${state.message}`;
    }
    if (value && typeof value === "object" && "error" in value) return `state-error:${String((value as { error: unknown }).error)}`;
    return `value:${JSON.stringify(value) ?? "undefined"}`;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) return error.message;
    if (error instanceof Error && error.message === "not_found") return "not_found";
    if (error instanceof Prisma.PrismaClientKnownRequestError) return `prisma:${error.code}`;
    if (error instanceof Error) return `error:${error.message}`;
    throw error;
  }
}

type Row = {
  name: string;
  actor: (f: Fix) => TenantActor;
  /** Tenant whose buyer-support cookie the browser carries (buyer rows only). */
  buyer?: (f: Fix) => Tenant;
  run: (f: Fix) => Promise<unknown>;
  /** Substring the redirect URL, state message, response or error must contain. */
  expected: string;
  /** Own-tenant rows only: extra assertions on tenant A. */
  verify?: (f: Fix) => Promise<void>;
};

const owner = (f: Fix) => f.a.actors.owner;
const accountant = (f: Fix) => f.a.actors.accountant;
const support = (f: Fix) => f.a.actors.support;
const idle = { status: "idle" as const, message: "" };

function post(path: string, form: FormData) {
  return new Request(`http://localhost:3000${path}`, { method: "POST", body: form });
}

const caseForm = (supportCaseId: string, fields: Record<string, string>) => formData({ supportCaseId, revision: "1", dedupKey: randomUUID(), ...fields });
const shippingForm = (t: Tenant, orderId = t.orderId) => formData({ orderId, fulfillmentId: t.x.shippingFulfillmentId, revision: "1", nextStatus: "packing" });
const productForm = (productId: string) => formData({
  id: productId,
  revision: "1",
  inventoryBaseline: "5",
  name: "改價商品",
  slug: `edit-${randomUUID()}`,
  price: "1",
  inventory: "5",
  currency: "TWD",
  fulfillmentType: "physical",
  isActive: "on",
});
const pollForm = (liveId: string) => formData({
  liveId,
  eventType: "poll",
  title: "合成投票",
  durationSec: "60",
  question: "要加購嗎？",
  options: "要\n不要",
  selectionMode: "single",
});
const portalForm = (affiliateId: string, vendorMemberId: string, expectedRevision: string, active: boolean) => formData({
  affiliateId,
  vendorMemberId,
  expectedRevision,
  ...(active ? { active: "on" } : {}),
});
const affiliateForm = (id: string) => formData({ id, name: "改名推廣者", code: `CODE${randomUUID().slice(0, 8)}`, commissionRateBps: "9000", contactEmail: "attacker@example.test", isActive: "on" });
const reportsRequest = (pageId: string) => new Request(`http://localhost:3000/api/funnel/operations/reports?pageId=${encodeURIComponent(pageId)}`);

const foreignRows: Row[] = [
  // Money: platform invoices and payment methods.
  {
    name: "invoice: pay tenant B's issued invoice",
    actor: accountant,
    run: (f) => payInvoiceAction(formData({ invoiceId: f.b.x.invoiceId })),
    expected: "redirect:/billing/invoices?error=invalid_invoice",
  },
  {
    name: "payment method: revoke tenant B's verified card reference",
    actor: accountant,
    run: (f) => revokePaymentMethodReferenceAction(formData({ referenceId: f.b.x.paymentMethodReferenceId })),
    expected: "redirect:/billing/payment-methods?error=invalid_reference",
  },
  {
    name: "payment method: start a membership card setup inside tenant B's team",
    actor: accountant,
    run: (f) => startPaymentMethodSetupAction(formData({ scopeType: "MEMBERSHIP", teamId: f.b.teamId, membershipId: f.b.ownerTeamMembershipId, setupConsent: "yes" })),
    expected: "redirect:/billing/payment-methods?error=invalid_scope",
  },
  {
    name: "payment method: start a card setup for tenant B's membership through tenant A's team",
    actor: accountant,
    run: (f) => startPaymentMethodSetupAction(formData({ scopeType: "MEMBERSHIP", teamId: f.a.teamId, membershipId: f.b.ownerTeamMembershipId, setupConsent: "yes" })),
    expected: "redirect:/billing/payment-methods?error=invalid_scope",
  },
  // Money: paid-order fulfilment.
  {
    name: "order: grant tenant B's paid digital entitlement",
    actor: owner,
    run: (f) => grantCommerceEntitlementAction(formData({ orderId: f.b.orderId, entitlementId: f.b.x.entitlementId, revision: "1" })),
    expected: "error=fulfillment_conflict",
  },
  {
    name: "order: grant tenant B's entitlement under tenant A's order id",
    actor: owner,
    run: (f) => grantCommerceEntitlementAction(formData({ orderId: f.a.orderId, entitlementId: f.b.x.entitlementId, revision: "1" })),
    expected: "error=fulfillment_conflict",
  },
  {
    name: "order: schedule tenant B's service fulfilment",
    actor: owner,
    run: (f) => transitionServiceFulfillmentAction(formData({ orderId: f.b.orderId, fulfillmentId: f.b.x.serviceFulfillmentId, revision: "1", nextStatus: "scheduled", scheduledAt: "2099-03-01T10:00" })),
    expected: "error=fulfillment_conflict",
  },
  {
    name: "order: move tenant B's shipment to packing (Server Action)",
    actor: owner,
    run: (f) => transitionShippingFulfillmentAction(shippingForm(f.b)),
    expected: "error=fulfillment_conflict",
  },
  {
    name: "order: move tenant B's shipment to packing (POST /api/orders/shipping)",
    actor: owner,
    run: (f) => shippingRoute(post("/api/orders/shipping", shippingForm(f.b))),
    expected: "?error=fulfillment_conflict",
  },
  // Money: refunds and commissions.
  {
    name: "support: request a refund handoff on tenant B's paid order",
    actor: owner,
    run: (f) => requestSupportRefundHandoffAction(caseForm(f.b.x.supportCaseId, { requestedAmount: "5.00", reason: "合成退款" })),
    expected: "error=refund_unavailable",
  },
  {
    name: "affiliate: rewrite tenant B's affiliate commission rate and contact",
    actor: owner,
    run: (f) => upsertAffiliateAction(affiliateForm(f.b.affiliateId)),
    expected: "prisma:P2025",
  },
  {
    name: "affiliate portal: grant tenant B's affiliate to tenant A's member",
    actor: owner,
    run: (f) => setAffiliatePortalAccessAction(portalForm(f.b.affiliateId, f.a.actors.support.member.id, "0", true)),
    expected: "?error=conflict",
  },
  {
    name: "affiliate portal: grant tenant A's affiliate to tenant B's member",
    actor: owner,
    run: (f) => setAffiliatePortalAccessAction(portalForm(f.a.affiliateId, f.b.actors.support.member.id, "0", true)),
    expected: "?error=conflict",
  },
  {
    name: "affiliate portal: revoke tenant B's active partner grant",
    actor: owner,
    run: (f) => setAffiliatePortalAccessAction(portalForm(f.b.x.portalAccessAffiliateId, f.b.actors.support.member.id, "1", false)),
    expected: "?error=conflict",
  },
  // Money: product price.
  {
    name: "product: reprice tenant B's product (Server Action)",
    actor: owner,
    run: (f) => upsertProductAction(initialProductActionState, productForm(f.b.productId)),
    expected: "state-error:not_found",
  },
  {
    name: "product: reprice tenant B's product (POST /api/products/upsert)",
    actor: owner,
    run: (f) => productUpsertRoute(post("/api/products/upsert", productForm(f.b.productId))),
    expected: "response:404:{\"error\":\"not_found\"}",
  },
  // Live sales interactions (flash sale / prize redemption).
  {
    name: "live interaction: start a poll on tenant B's on-air Live",
    actor: owner,
    run: (f) => startLiveInteractionAction(idle, pollForm(f.b.liveId)),
    expected: "state:error:只有正在直播中的直播間可以手動發起互動。",
  },
  {
    name: "live interaction: draw tenant B's lucky-draw winner",
    actor: owner,
    run: (f) => drawLiveInteractionWinnerAction(idle, formData({ runId: f.b.x.drawRunId })),
    expected: "state:error:抽獎場次不存在或已經抽過獎。",
  },
  {
    name: "live interaction: redeem tenant B's prize with B's real claim code",
    actor: owner,
    run: (f) => verifyLuckyDrawWinnerClaimAction(idle, formData({ runId: f.b.x.claimRunId, claimCode: f.b.x.claimCode })),
    expected: "state:error:抽獎場次或得獎資料不存在。",
  },
  // PII: support cases (merchant side).
  {
    name: "support: open a case on tenant B's order",
    actor: owner,
    run: (f) => createSupportCaseAction(formData({ orderId: f.b.orderId, intakeKey: randomUUID(), category: "general", priority: "p2", summary: "外部案件" })),
    expected: "error=support_create",
  },
  {
    name: "support: add an internal note to tenant B's case",
    actor: support,
    run: (f) => addSupportCaseNoteAction(caseForm(f.b.x.supportCaseId, { note: "外部備註" })),
    expected: "error=case_conflict",
  },
  {
    name: "support: assign tenant B's case to tenant A's member",
    actor: owner,
    run: (f) => assignSupportCaseAction(caseForm(f.b.x.supportCaseId, { assignedMemberId: f.a.actors.support.member.id })),
    expected: "error=case_conflict",
  },
  {
    name: "support: assign tenant A's case to tenant B's member",
    actor: owner,
    run: (f) => assignSupportCaseAction(caseForm(f.a.x.supportCaseId, { assignedMemberId: f.b.actors.support.member.id })),
    expected: "error=case_conflict",
  },
  {
    name: "support: change the status of tenant B's case",
    actor: owner,
    run: (f) => transitionSupportCaseAction(caseForm(f.b.x.supportCaseId, { nextStatus: "in_progress" })),
    expected: "error=invalid_transition",
  },
  {
    name: "support: send a customer reply on tenant B's case",
    actor: support,
    run: (f) => addSupportCaseCustomerReplyAction(caseForm(f.b.x.supportCaseId, { message: "外部回覆" })),
    expected: "error=case_conflict",
  },
  // PII: support cases (buyer side, HttpOnly grant cookie of tenant A's buyer).
  {
    name: "buyer support: open a case with tenant B's grant id while holding tenant A's cookie",
    actor: owner,
    buyer: (f) => f.a,
    run: (f) => createBuyerSupportCaseAction(formData({ grantId: f.b.x.buyerGrantId, intakeKey: randomUUID(), category: "general", summary: "外部買家" })),
    expected: "redirect:/support/requests?error=unavailable",
  },
  {
    name: "buyer portal: enter the learner portal with tenant B's grant id while holding tenant A's cookie",
    actor: owner,
    buyer: (f) => f.a,
    run: (f) => enterStudentPortalFromCheckoutAction(formData({ grantId: f.b.x.buyerGrantId })),
    expected: "redirect:/checkout/result",
  },
  {
    name: "buyer support: reply on tenant B's case with tenant A's grant",
    actor: owner,
    buyer: (f) => f.a,
    run: (f) => addBuyerSupportReplyAction(formData({ grantId: f.a.x.buyerGrantId, supportCaseId: f.b.x.supportCaseId, revision: "1", dedupKey: randomUUID(), message: "外部買家回覆" })),
    expected: "redirect:/support/requests?error=unavailable",
  },
  // PII: consultations, CRM, blacklist, email deliveries, Live questions.
  {
    name: "consultation: cancel tenant B's booking",
    actor: owner,
    run: (f) => cancelConsultationBookingAction(formData({ bookingId: f.b.x.bookingId })),
    expected: "redirect:/consultations?error=not_found_or_closed",
  },
  {
    name: "consultation: mark tenant B's booking completed",
    actor: owner,
    run: (f) => updateConsultationBookingStatusAction(formData({ bookingId: f.b.x.bookingId, status: "completed" })),
    expected: "redirect:/consultations?error=not_found_or_closed",
  },
  {
    name: "CRM: change the status of tenant B's customer",
    actor: owner,
    run: (f) => updateCustomerStatusAction(formData({ customerKeyHash: f.b.x.customerKeyHash, status: "closed_lost" })),
    expected: "error:customer_not_in_selected_project",
  },
  {
    name: "CRM: remove a tag from tenant B's customer",
    actor: owner,
    run: (f) => removeCustomerTagAction(formData({ customerKeyHash: f.b.x.customerKeyHash, tag: "vip" })),
    expected: "error:customer_not_in_selected_project",
  },
  {
    name: "blacklist: lift tenant B's active block",
    actor: owner,
    run: (f) => unblockBlacklistAction(formData({ id: f.b.x.blacklistId })),
    expected: "prisma:P2025",
  },
  {
    name: "email deliveries: requeue tenant B's failed email",
    actor: owner,
    run: (f) => manageEmailDeliveriesAction({ ...idle, result: null }, formData({ operation: `retry:${f.b.x.emailDeliveryId}`, currentPage: "1" })),
    expected: "state:error:找不到這筆寄送紀錄，或目前帳號沒有操作權限。",
  },
  {
    name: "email deliveries: search for tenant B's delivery id",
    actor: owner,
    run: (f) => manageEmailDeliveriesAction({ ...idle, result: null }, formData({ query: f.b.x.emailDeliveryId, page: "1" })),
    expected: "state:success:沒有符合目前條件的寄送紀錄。",
  },
  {
    name: "live question: spotlight tenant B's audience question",
    actor: owner,
    run: (f) => moderateLiveQuestionAction(idle, formData({ questionId: f.b.x.questionId, status: "spotlight" })),
    expected: "state:error:問題不存在，或不允許這個狀態轉換。",
  },
  // PII + money: Funnel leads and sales report.
  {
    name: "funnel: read tenant B's lead and sales report (GET /api/funnel/operations/reports)",
    actor: owner,
    run: (f) => funnelReportsRoute(reportsRequest(f.b.pageId)),
    expected: "response:404:{\"error\":\"UNAVAILABLE\"}",
  },
  {
    name: "funnel: read tenant B's Funnel settings",
    actor: owner,
    run: (f) => readFunnelOperations(f.b.pageId),
    expected: "error:找不到一頁式網站或沒有存取權限。",
  },
];

const ownRows: Row[] = [
  {
    name: "invoice: own issued invoice reaches the payment provider step",
    actor: accountant,
    run: (f) => payInvoiceAction(formData({ invoiceId: f.a.x.invoiceId })),
    expected: "redirect:/billing/invoices?error=provider_not_configured",
    verify: async () => {
      expect(mocks.getPaymentProvider).toHaveBeenCalledTimes(1);
    },
  },
  {
    name: "payment method: revoke own reference",
    actor: accountant,
    run: (f) => revokePaymentMethodReferenceAction(formData({ referenceId: f.a.x.paymentMethodReferenceId })),
    expected: "redirect:/billing/payment-methods?error=provider_revoke_failed",
    verify: async (f) => {
      expect((await db.paymentMethodReference.findUniqueOrThrow({ where: { id: f.a.x.paymentMethodReferenceId } })).status).toBe("revoked");
    },
  },
  {
    name: "payment method: own membership passes the scope check",
    actor: accountant,
    run: (f) => startPaymentMethodSetupAction(formData({ scopeType: "MEMBERSHIP", teamId: f.a.teamId, membershipId: f.a.ownerTeamMembershipId, setupConsent: "yes" })),
    expected: "redirect:/billing/payment-methods?error=provider_not_configured",
  },
  {
    name: "order: grant own entitlement",
    actor: owner,
    run: (f) => grantCommerceEntitlementAction(formData({ orderId: f.a.orderId, entitlementId: f.a.x.entitlementId, revision: "1" })),
    expected: "updated=entitlement",
    verify: async (f) => {
      expect((await db.commerceEntitlement.findUniqueOrThrow({ where: { id: f.a.x.entitlementId } })).status).toBe("granted");
    },
  },
  {
    name: "order: schedule own service",
    actor: owner,
    run: (f) => transitionServiceFulfillmentAction(formData({ orderId: f.a.orderId, fulfillmentId: f.a.x.serviceFulfillmentId, revision: "1", nextStatus: "scheduled", scheduledAt: "2099-03-01T10:00" })),
    expected: "updated=service",
    verify: async (f) => {
      expect((await db.serviceFulfillment.findUniqueOrThrow({ where: { id: f.a.x.serviceFulfillmentId } })).status).toBe("scheduled");
    },
  },
  {
    name: "order: pack own shipment (Server Action)",
    actor: owner,
    run: (f) => transitionShippingFulfillmentAction(shippingForm(f.a)),
    expected: "updated=shipping",
    verify: async (f) => {
      expect((await db.shippingFulfillment.findUniqueOrThrow({ where: { id: f.a.x.shippingFulfillmentId } })).status).toBe("packing");
    },
  },
  {
    name: "order: pack own shipment (POST /api/orders/shipping)",
    actor: owner,
    run: (f) => shippingRoute(post("/api/orders/shipping", shippingForm(f.a))),
    expected: "updated=shipping",
    verify: async (f) => {
      expect((await db.shippingFulfillment.findUniqueOrThrow({ where: { id: f.a.x.shippingFulfillmentId } })).status).toBe("packing");
    },
  },
  {
    name: "support: request a refund handoff on own paid order",
    actor: owner,
    run: (f) => requestSupportRefundHandoffAction(caseForm(f.a.x.supportCaseId, { requestedAmount: "5.00", reason: "合成退款" })),
    expected: "updated=refund_requested",
    verify: async (f) => {
      expect(await db.supportRefundHandoff.findFirstOrThrow({ where: { vendorId: f.a.vendor.id } })).toMatchObject({
        supportCaseId: f.a.x.supportCaseId,
        paymentTransactionId: f.a.x.paymentTransactionId,
        requestedAmountCents: 500,
      });
    },
  },
  {
    name: "affiliate: edit own affiliate",
    actor: owner,
    run: (f) => upsertAffiliateAction(affiliateForm(f.a.affiliateId)),
    expected: "redirect:/affiliates",
    verify: async (f) => {
      expect((await db.affiliate.findUniqueOrThrow({ where: { id: f.a.affiliateId } })).commissionRateBps).toBe(9000);
    },
  },
  {
    name: "affiliate portal: grant own affiliate to own member",
    actor: owner,
    run: (f) => setAffiliatePortalAccessAction(portalForm(f.a.affiliateId, f.a.actors.support.member.id, "0", true)),
    expected: "?saved=1",
    verify: async (f) => {
      expect(await db.affiliatePortalAccess.count({ where: { vendorId: f.a.vendor.id, affiliateId: f.a.affiliateId, active: true } })).toBe(1);
    },
  },
  {
    name: "affiliate portal: revoke own partner grant",
    actor: owner,
    run: (f) => setAffiliatePortalAccessAction(portalForm(f.a.x.portalAccessAffiliateId, f.a.actors.support.member.id, "1", false)),
    expected: "?saved=1",
  },
  {
    name: "product: edit own product (Server Action)",
    actor: owner,
    run: (f) => upsertProductAction(initialProductActionState, productForm(f.a.productId)),
    expected: "redirect:/products",
    verify: async (f) => {
      expect((await db.product.findUniqueOrThrow({ where: { id: f.a.productId } })).priceCents).toBe(100);
    },
  },
  {
    name: "product: edit own product (POST /api/products/upsert)",
    actor: owner,
    run: (f) => productUpsertRoute(post("/api/products/upsert", productForm(f.a.productId))),
    expected: "response:303:/products",
  },
  {
    name: "live interaction: start a poll on own on-air Live",
    actor: owner,
    run: (f) => startLiveInteractionAction(idle, pollForm(f.a.liveId)),
    expected: "state:success:",
  },
  {
    name: "live interaction: draw own winner",
    actor: owner,
    run: (f) => drawLiveInteractionWinnerAction(idle, formData({ runId: f.a.x.drawRunId })),
    expected: "state:success:",
  },
  {
    name: "live interaction: redeem own prize",
    actor: owner,
    run: (f) => verifyLuckyDrawWinnerClaimAction(idle, formData({ runId: f.a.x.claimRunId, claimCode: f.a.x.claimCode })),
    expected: "state:success:核銷完成。",
  },
  {
    name: "support: open, note, assign, reply and move own cases",
    actor: owner,
    run: async (f) => {
      expect(await outcome(() => createSupportCaseAction(formData({ orderId: f.a.orderId, intakeKey: randomUUID(), category: "general", priority: "p2", summary: "本商家案件" })))).toContain("updated=created");
      expect(await outcome(() => addSupportCaseNoteAction(caseForm(f.a.x.supportCaseId, { note: "本商家備註" })))).toContain("updated=note");
      expect(await outcome(() => assignSupportCaseAction(caseForm(f.a.x.supportCaseId, { revision: "2", assignedMemberId: f.a.actors.admin.member.id })))).toContain("updated=assignment");
      expect(await outcome(() => addSupportCaseCustomerReplyAction(caseForm(f.a.x.supportCaseId, { revision: "3", message: "本商家回覆" })))).toContain("updated=customer_reply");
      return transitionSupportCaseAction(caseForm(f.a.x.supportCaseId, { revision: "4", nextStatus: "resolved" }));
    },
    expected: "updated=status",
    verify: async (f) => {
      expect(await db.supportCase.count({ where: { vendorId: f.a.vendor.id } })).toBe(2);
      expect(await db.supportCase.findUniqueOrThrow({ where: { id: f.a.x.supportCaseId } })).toMatchObject({
        status: "resolved",
        assignedMemberId: f.a.actors.admin.member.id,
      });
    },
  },
  {
    name: "buyer support: open a case and reply with own grant",
    actor: owner,
    buyer: (f) => f.a,
    run: async (f) => {
      const created = await outcome(() => createBuyerSupportCaseAction(formData({ grantId: f.a.x.buyerGrantId, intakeKey: randomUUID(), category: "general", summary: "本商家買家" })));
      expect(created).toContain("updated=created");
      const caseId = created.split("/support/requests/")[1]!.split("?")[0]!;
      return addBuyerSupportReplyAction(formData({ grantId: f.a.x.buyerGrantId, supportCaseId: caseId, revision: "1", dedupKey: randomUUID(), message: "買家補充" }));
    },
    expected: "updated=reply",
  },
  {
    name: "buyer portal: own grant reaches own learner portal login",
    actor: owner,
    buyer: (f) => f.a,
    run: (f) => enterStudentPortalFromCheckoutAction(formData({ grantId: f.a.x.buyerGrantId })),
    expected: "redirect:/portal/two-tenant-",
  },
  {
    name: "consultation: cancel own booking",
    actor: owner,
    run: (f) => cancelConsultationBookingAction(formData({ bookingId: f.a.x.bookingId })),
    expected: "redirect:/consultations?updated=booking_cancelled",
  },
  {
    name: "consultation: mark own booking completed",
    actor: owner,
    run: (f) => updateConsultationBookingStatusAction(formData({ bookingId: f.a.x.bookingId, status: "completed" })),
    expected: "redirect:/consultations?updated=booking_status",
  },
  {
    name: "CRM: update own customer's status and tags",
    actor: owner,
    run: async (f) => {
      await updateCustomerStatusAction(formData({ customerKeyHash: f.a.x.customerKeyHash, status: "closed_won" }));
      return removeCustomerTagAction(formData({ customerKeyHash: f.a.x.customerKeyHash, tag: "vip" }));
    },
    expected: "value:undefined",
    verify: async (f) => {
      expect((await db.customerCrmRecord.findFirstOrThrow({ where: { vendorId: f.a.vendor.id, customerKeyHash: f.a.x.customerKeyHash } })).consultationStatus).toBe("closed_won");
      expect(await db.customerTagAssignment.count({ where: { vendorId: f.a.vendor.id } })).toBe(0);
    },
  },
  {
    name: "blacklist: lift own block",
    actor: owner,
    run: (f) => unblockBlacklistAction(formData({ id: f.a.x.blacklistId })),
    expected: "value:undefined",
    verify: async (f) => {
      expect((await db.blacklist.findUniqueOrThrow({ where: { id: f.a.x.blacklistId } })).isActive).toBe(false);
    },
  },
  {
    name: "email deliveries: own failed email is found and handled",
    actor: owner,
    run: (f) => manageEmailDeliveriesAction({ ...idle, result: null }, formData({ operation: `retry:${f.a.x.emailDeliveryId}`, currentPage: "1" })),
    expected: "state:success:",
    verify: async (f) => {
      expect((await db.emailDelivery.findUniqueOrThrow({ where: { id: f.a.x.emailDeliveryId } })).status).not.toBe("failed");
    },
  },
  {
    name: "email deliveries: search for own delivery id",
    actor: owner,
    run: (f) => manageEmailDeliveriesAction({ ...idle, result: null }, formData({ query: f.a.x.emailDeliveryId, page: "1" })),
    expected: "state:success:找到 1 筆寄送紀錄。",
  },
  {
    name: "live question: spotlight own audience question",
    actor: owner,
    run: (f) => moderateLiveQuestionAction(idle, formData({ questionId: f.a.x.questionId, status: "spotlight" })),
    expected: "state:success:問題已精選上牆。",
  },
  {
    name: "funnel: own page passes the tenant lookup (its synthetic content is then rejected)",
    actor: owner,
    run: (f) => readFunnelOperations(f.a.pageId),
    expected: "error:一頁式網站資料格式無效，原始資料已保留。",
  },
];

beforeEach(async () => {
  vi.clearAllMocks();
  runtime.cookies = [];
  fixture = await createTwoTenantFixture(db);
  extras = { a: await addTenantExtras(db, fixture.a, "A"), b: await addTenantExtras(db, fixture.b, "B") };
});
afterEach(async () => {
  await fixture?.cleanup();
});
afterAll(async () => {
  await db.$disconnect();
});

function view(): Fix {
  return { a: { ...fixture.a, x: extras.a }, b: { ...fixture.b, x: extras.b } };
}

function prepare(row: Row, f: Fix) {
  runtime.actor = withAllFeatures(row.actor(f));
  runtime.cookies = row.buyer ? [row.buyer(f).x.buyerCookie] : [];
}

describe("second-tenant matrix (money and PII): foreign identifiers are refused and nothing is written", () => {
  it.each(foreignRows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const f = view();
    prepare(row, f);
    const [beforeA, beforeB] = [await snapshot(f.a.vendor.id), await snapshot(f.b.vendor.id)];

    const result = await outcome(() => row.run(f));
    expect(result).toContain(row.expected);
    // A refusal never echoes tenant B's data back to tenant A.
    for (const secret of [f.b.x.claimCode, "lead-b@example.test", f.b.x.customerKeyHash]) expect(result).not.toContain(secret);

    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
    expect(await snapshot(f.a.vendor.id)).toBe(beforeA);
    expect(mocks.getPaymentProvider).not.toHaveBeenCalled();
    expect(mocks.scheduleImmediateEmailDispatch).not.toHaveBeenCalled();
  });

  it("the shipping route redirects a foreign shipment to the same conflict page as a missing one", async () => {
    const f = view();
    prepare({ name: "", actor: owner, run: async () => undefined, expected: "" }, f);
    const foreign = await outcome(() => shippingRoute(post("/api/orders/shipping", shippingForm(f.b))));
    const missing = await outcome(() => shippingRoute(post("/api/orders/shipping", formData({ orderId: f.b.orderId, fulfillmentId: "missing-fulfillment", revision: "1", nextStatus: "packing" }))));
    expect(foreign).toBe(`response:303:/orders/${f.b.orderId}?error=fulfillment_conflict`);
    expect(foreign).toBe(missing);
  });

  it("foreign and missing ids are indistinguishable where the action has no not-found page", async () => {
    const f = view();
    prepare({ name: "", actor: owner, run: async () => undefined, expected: "" }, f);
    const missing = "missing-synthetic-id";
    expect(await outcome(() => upsertAffiliateAction(affiliateForm(f.b.affiliateId))))
      .toBe(await outcome(() => upsertAffiliateAction(affiliateForm(missing))));
    expect(await outcome(() => unblockBlacklistAction(formData({ id: f.b.x.blacklistId }))))
      .toBe(await outcome(() => unblockBlacklistAction(formData({ id: missing }))));
    expect(await outcome(() => payInvoiceAction(formData({ invoiceId: f.b.x.invoiceId }))))
      .toBe(await outcome(() => payInvoiceAction(formData({ invoiceId: missing }))));
    expect(await outcome(() => revokePaymentMethodReferenceAction(formData({ referenceId: f.b.x.paymentMethodReferenceId }))))
      .toBe(await outcome(() => revokePaymentMethodReferenceAction(formData({ referenceId: missing }))));
  });
});

describe("platform refund handoff review never completes one tenant's handoff with another tenant's refund", () => {
  async function reviewingHandoff(t: Tenant) {
    const handoff = await db.$transaction((tx) => requestSupportRefundHandoff(tx, {
      vendorId: t.vendor.id,
      supportCaseId: t.x.supportCaseId,
      expectedRevision: 1,
      requestedAmountCents: 500,
      reason: "合成退款",
      actorMemberId: t.actors.owner.member.id,
      dedupKey: randomUUID(),
    }));
    // Platform finance picks the request up through the real review path.
    expect(await outcome(() => reviewSupportRefundHandoffAction(formData({ handoffId: handoff.id, revision: "1", nextStatus: "reviewing", dedupKey: randomUUID() }))))
      .toBe(`redirect:/admin/support-cases/${handoff.id}?updated=reviewing`);
    return handoff;
  }
  function processedRefund(t: Tenant) {
    return db.commerceOrderRefund.create({
      data: {
        vendorId: t.vendor.id,
        orderId: t.orderId,
        paymentTransactionId: t.x.paymentTransactionId,
        providerName: "demo",
        eventIdentity: `refund-${randomUUID()}`,
        amountCents: 500,
        cumulativeAmountCents: 500,
        status: "processed",
        occurredAt: new Date(),
      },
    });
  }
  const completeForm = (handoffId: string, refundId: string) => formData({ handoffId, revision: "2", nextStatus: "completed", dedupKey: randomUUID(), completedRefundIds: refundId });

  it("refuses tenant B's processed refund as evidence for tenant A's handoff, and accepts tenant A's own", async () => {
    const f = view();
    const platform = await db.user.create({
      data: { email: `platform-${randomUUID()}@example.test`, name: "Synthetic platform finance", passwordHash: "synthetic-only", platformRole: "platform_admin" },
    });
    runtime.actor = { ...f.a.actors.owner, user: { ...f.a.actors.owner.user, id: platform.id } };
    const handoff = await reviewingHandoff(f.a);
    const foreignRefund = await processedRefund(f.b);
    const ownRefund = await processedRefund(f.a);
    const [beforeA, beforeB] = [await snapshot(f.a.vendor.id), await snapshot(f.b.vendor.id)];

    expect(await outcome(() => reviewSupportRefundHandoffAction(completeForm(handoff.id, foreignRefund.id))))
      .toBe(`redirect:/admin/support-cases/${handoff.id}?error=refund_unavailable`);
    expect(await snapshot(f.a.vendor.id)).toBe(beforeA);
    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
    expect(await db.supportRefundHandoffRefund.count({ where: { refundId: foreignRefund.id } })).toBe(0);

    expect(await outcome(() => reviewSupportRefundHandoffAction(completeForm(handoff.id, ownRefund.id))))
      .toBe(`redirect:/admin/support-cases/${handoff.id}?updated=completed`);
    expect(await db.supportRefundHandoff.findUniqueOrThrow({ where: { id: handoff.id } })).toMatchObject({ status: "completed", completedRefundId: ownRefund.id });
    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
  });
});

describe("second-tenant matrix (money and PII): the same actions with own identifiers go through", () => {
  it.each(ownRows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const f = view();
    prepare(row, f);
    const beforeB = await snapshot(f.b.vendor.id);

    const result = await outcome(() => row.run(f));
    expect(result).toContain(row.expected);
    await row.verify?.(f);

    // An own-tenant success never leaks into the other tenant.
    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
  });
});
