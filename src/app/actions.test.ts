import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  affiliateCreate: vi.fn(),
  affiliateFindFirst: vi.fn(),
  affiliateUpdate: vi.fn(),
  affiliateCommissionFindFirst: vi.fn(),
  affiliateCommissionFindMany: vi.fn(),
  affiliateCommissionFindUnique: vi.fn(),
  affiliateCommissionUpdateMany: vi.fn(),
  affiliateCommissionLedgerEntryAggregate: vi.fn(),
  affiliateCommissionLedgerEntryFindUnique: vi.fn(),
  affiliateCommissionLedgerEntryCreate: vi.fn(),
  affiliatePayoutFindFirst: vi.fn(),
  affiliatePayoutFindUnique: vi.fn(),
  affiliatePayoutCreate: vi.fn(),
  affiliatePayoutUpdateMany: vi.fn(),
  courseCommissionAllocationFindMany: vi.fn(),
  courseCommissionAllocationFindUnique: vi.fn(),
  courseCommissionLedgerEntryAggregate: vi.fn(),
  courseCommissionLedgerEntryFindUnique: vi.fn(),
  courseCommissionLedgerEntryCreate: vi.fn(),
  coursePayoutFindUnique: vi.fn(),
  coursePayoutFindUniqueOrThrow: vi.fn(),
  coursePayoutCreate: vi.fn(),
  coursePayoutUpdateMany: vi.fn(),
  reconcileCommerceOrderRefundForPayment: vi.fn(async () => null),
  authenticateUser: vi.fn(),
  calculateSettlement: vi.fn(),
  upsertUsageSnapshot: vi.fn(),
  cookies: vi.fn(),
  createUserSession: vi.fn(),
  findUnique: vi.fn(),
  generateSettlementForVendor: vi.fn(),
  generateRecoveryCodes: vi.fn(),
  headers: vi.fn(),
  invoiceFindUnique: vi.fn(),
  invoiceUpsert: vi.fn(),
  invoiceUpdate: vi.fn(),
  isAllowedSmokeTestRecipient: vi.fn(),
  interactionEventCreate: vi.fn(),
  interactionEventDeleteMany: vi.fn(),
  interactionRoleCreate: vi.fn(),
  interactionRoleCreateMany: vi.fn(),
  interactionRoleDelete: vi.fn(),
  interactionRoleFindMany: vi.fn(),
  interactionRoleUpdate: vi.fn(),
  interactionScriptCreate: vi.fn(),
  interactionScriptDelete: vi.fn(),
  interactionScriptUpdate: vi.fn(),
  imageAssetFindFirst: vi.fn(),
  liveFindFirst: vi.fn(),
  liveFindMany: vi.fn(),
  liveUpdateMany: vi.fn(),
  liveUpdate: vi.fn(),
  liveCreate: vi.fn(),
  liveStudioDraftUpdateMany: vi.fn(),
  liveProductDeleteMany: vi.fn(),
  liveProductCreate: vi.fn(),
  createLiveReminderReconciliationSnapshot: vi.fn(),
  queueLiveReminderReconciliation: vi.fn(),
  productFindMany: vi.fn(),
  videoFindFirst: vi.fn(),
  videoCreate: vi.fn(),
  videoUpdate: vi.fn(),
  registrationFormFindFirst: vi.fn(),
  messageTemplateFindFirst: vi.fn(),
  messageTemplateCreate: vi.fn(),
  messageTemplateUpdate: vi.fn(),
  interactionScriptFindFirst: vi.fn(),
  markCurrentSessionMfaVerified: vi.fn(),
  paymentTransactionUpdate: vi.fn(),
  paymentMethodReferenceFindFirst: vi.fn(),
  paymentMethodReferenceFindMany: vi.fn(),
  payoutItemFindUnique: vi.fn(),
  payoutItemFindMany: vi.fn(),
  payoutItemCreate: vi.fn(),
  payoutItemUpdate: vi.fn(),
  payoutBatchCreate: vi.fn(),
  payoutBatchFindUnique: vi.fn(),
  payoutBatchUpdateMany: vi.fn(),
  payoutBatchUpdate: vi.fn(),
  redirect: vi.fn(),
  refundRecordAggregate: vi.fn(),
  refundRecordCreate: vi.fn(),
  refundRecordUpdate: vi.fn(),
  getPaymentProvider: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  requireAuth: vi.fn(),
  requireVendor: vi.fn(),
  requireVendorManagerContext: vi.fn(),
  requireVendorFinance: vi.fn(),
  requireVendorOwner: vi.fn(),
  revalidatePath: vi.fn(),
  checkRateLimit: vi.fn(),
  sendPasswordResetLink: vi.fn(),
  schedulePasswordResetLink: vi.fn(),
  settlementFindUnique: vi.fn(),
  settlementFindMany: vi.fn(),
  settlementUpdateMany: vi.fn(),
  settlementCreate: vi.fn(),
  settlementUpsert: vi.fn(),
  partnerFunnelPageFindFirst: vi.fn(),
  partnerFunnelPageUpdateMany: vi.fn(),
  blacklistCreate: vi.fn(),
  registrationFormCreate: vi.fn(),
  registrationFormUpdate: vi.fn(),
  teamMembershipFindFirst: vi.fn(),
  teamMembershipFindMany: vi.fn(),
  teamMembershipRelationshipFindMany: vi.fn(),
  transaction: vi.fn(),
  userCreate: vi.fn(),
  userFindUnique: vi.fn(),
  userMfaFactorUpdate: vi.fn(),
  userRecoveryCodeCreateMany: vi.fn(),
  userRecoveryCodeDeleteMany: vi.fn(),
  userRecoveryCodeFindMany: vi.fn(),
  userRecoveryCodeUpdate: vi.fn(),
  userRecoveryCodeUpdateMany: vi.fn(),
  userUpdate: vi.fn(),
  verifyRecoveryCode: vi.fn(),
  verifyTotpCode: vi.fn(),
  decryptMfaSecret: vi.fn(),
  vendorFindUnique: vi.fn(),
  vendorUpdate: vi.fn(),
  vendorMemberFindFirst: vi.fn(),
  vendorMemberFindMany: vi.fn(),
  vendorMemberFindUnique: vi.fn(),
  vendorMemberCount: vi.fn(),
  vendorMemberUpdate: vi.fn(),
  vendorMemberUpsert: vi.fn(),
  userSessionFindMany: vi.fn(),
  userSessionUpdateMany: vi.fn(),
  writeAuditLog: vi.fn(),
  requestAuditMeta: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  writeAuditLog: mocks.writeAuditLog,
  requestAuditMeta: mocks.requestAuditMeta,
}));
vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE: "celebrate_session",
  LEGACY_VENDOR_COOKIE: "celebrate_vendor_id",
  authenticateUser: mocks.authenticateUser,
  createUserSession: mocks.createUserSession,
  markCurrentSessionMfaVerified: mocks.markCurrentSessionMfaVerified,
  requireAuth: mocks.requireAuth,
  requireFinanceAdmin: mocks.requireFinanceAdmin,
  requireVendor: mocks.requireVendor,
  requireVendorFinance: mocks.requireVendorFinance,
  requireVendorManager: mocks.requireVendor,
  requireVendorManagerContext: mocks.requireVendorManagerContext,
  requireVendorOwner: mocks.requireVendorOwner,
  sessionCookieOptions: vi.fn(),
}));
vi.mock("@/lib/billing", () => ({
  calculateSettlement: mocks.calculateSettlement,
  invoiceDueAt: (monthKey: string) => new Date(`${monthKey}-01T00:00:00.000Z`),
  invoiceNumber: (vendorSlug: string, monthKey: string, vendorId: string) => `${vendorSlug}-${monthKey}-${vendorId}`,
  monthRange: () => ({ start: new Date("2026-07-01T00:00:00.000Z"), end: new Date("2026-08-01T00:00:00.000Z") }),
  payoutBatchNumber: () => "PB-20260725-00001",
}));
vi.mock("@/lib/billing-cycle", () => {
  class BillingCycleError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return {
    BillingCycleError,
    generateSettlementForVendor: mocks.generateSettlementForVendor,
  };
});
vi.mock("@/lib/usage-estimation", () => ({ upsertUsageSnapshot: mocks.upsertUsageSnapshot }));
vi.mock("@/lib/live-reminder-reconciliation", () => ({
  createLiveReminderReconciliationSnapshot: mocks.createLiveReminderReconciliationSnapshot,
  queueLiveReminderReconciliation: mocks.queueLiveReminderReconciliation,
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/password-reset", () => ({
  schedulePasswordResetLink: mocks.schedulePasswordResetLink,
  sendPasswordResetLink: mocks.sendPasswordResetLink,
}));
vi.mock("@/lib/email", () => ({ isAllowedSmokeTestRecipient: mocks.isAllowedSmokeTestRecipient }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/mfa", () => ({
  decryptMfaSecret: mocks.decryptMfaSecret,
  generateRecoveryCodes: mocks.generateRecoveryCodes,
  generateTotpUri: vi.fn(),
  hashRecoveryCodeAsync: async (code: string) => `test-hash:${code}`,
  MFA_RECOVERY_COOKIE: "mfa_recovery_codes",
  MFA_SETUP_COOKIE: "mfa_setup",
  parsePendingMfaSetup: vi.fn(),
  parseRecoveryCodes: vi.fn(),
  serializeRecoveryCodes: (codes: string[]) => JSON.stringify(codes),
  verifyRecoveryCodeAsync: mocks.verifyRecoveryCode,
  verifyTotpCode: mocks.verifyTotpCode,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    paymentTransaction: {
      findUnique: mocks.findUnique,
      update: mocks.paymentTransactionUpdate,
    },
    paymentMethodReference: {
      findFirst: mocks.paymentMethodReferenceFindFirst,
      findMany: mocks.paymentMethodReferenceFindMany,
    },
    payoutItem: {
      create: mocks.payoutItemCreate,
      findUnique: mocks.payoutItemFindUnique,
    },
    payoutBatch: {
      create: mocks.payoutBatchCreate,
      findUnique: mocks.payoutBatchFindUnique,
      updateMany: mocks.payoutBatchUpdateMany,
    },
    invoice: {
      findUnique: mocks.invoiceFindUnique,
      update: mocks.invoiceUpdate,
    },
    refundRecord: { aggregate: mocks.refundRecordAggregate, update: mocks.refundRecordUpdate },
    settlement: {
      findMany: mocks.settlementFindMany,
      findUnique: mocks.settlementFindUnique,
      updateMany: mocks.settlementUpdateMany,
    },
    interactionEvent: { create: mocks.interactionEventCreate, deleteMany: mocks.interactionEventDeleteMany },
    interactionRole: {
      create: mocks.interactionRoleCreate,
      createMany: mocks.interactionRoleCreateMany,
      delete: mocks.interactionRoleDelete,
      findMany: mocks.interactionRoleFindMany,
      update: mocks.interactionRoleUpdate,
    },
    interactionScript: {
      create: mocks.interactionScriptCreate,
      delete: mocks.interactionScriptDelete,
      findFirst: mocks.interactionScriptFindFirst,
      update: mocks.interactionScriptUpdate,
    },
    imageAsset: { findFirst: mocks.imageAssetFindFirst },
    live: { create: mocks.liveCreate, findFirst: mocks.liveFindFirst, findMany: mocks.liveFindMany, updateMany: mocks.liveUpdateMany },
    liveProduct: { create: mocks.liveProductCreate, deleteMany: mocks.liveProductDeleteMany },
    liveStudioDraft: { updateMany: mocks.liveStudioDraftUpdateMany },
    product: { findMany: mocks.productFindMany },
    video: {
      create: mocks.videoCreate,
      findFirst: mocks.videoFindFirst,
      update: mocks.videoUpdate,
    },
    messageTemplate: {
      create: mocks.messageTemplateCreate,
      findFirst: mocks.messageTemplateFindFirst,
      update: mocks.messageTemplateUpdate,
    },
    $transaction: mocks.transaction,
    user: { create: mocks.userCreate, findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    userMfaFactor: { update: mocks.userMfaFactorUpdate },
    userRecoveryCode: {
      createMany: mocks.userRecoveryCodeCreateMany,
      deleteMany: mocks.userRecoveryCodeDeleteMany,
      findMany: mocks.userRecoveryCodeFindMany,
      update: mocks.userRecoveryCodeUpdate,
      updateMany: mocks.userRecoveryCodeUpdateMany,
    },
    vendor: { findUnique: mocks.vendorFindUnique, update: mocks.vendorUpdate },
    vendorMember: {
      count: mocks.vendorMemberCount,
      findFirst: mocks.vendorMemberFindFirst,
      findMany: mocks.vendorMemberFindMany,
      findUnique: mocks.vendorMemberFindUnique,
      update: mocks.vendorMemberUpdate,
      upsert: mocks.vendorMemberUpsert,
    },
    teamMembership: { findFirst: mocks.teamMembershipFindFirst, findMany: mocks.teamMembershipFindMany },
    teamMembershipRelationship: { findMany: mocks.teamMembershipRelationshipFindMany },
    partnerFunnelPage: { findFirst: mocks.partnerFunnelPageFindFirst, updateMany: mocks.partnerFunnelPageUpdateMany },
    affiliate: { create: mocks.affiliateCreate, findFirst: mocks.affiliateFindFirst, update: mocks.affiliateUpdate },
    affiliateCommission: {
      findFirst: mocks.affiliateCommissionFindFirst,
      findMany: mocks.affiliateCommissionFindMany,
      findUnique: mocks.affiliateCommissionFindUnique,
      updateMany: mocks.affiliateCommissionUpdateMany,
    },
    affiliateCommissionLedgerEntry: {
      aggregate: mocks.affiliateCommissionLedgerEntryAggregate,
      findUnique: mocks.affiliateCommissionLedgerEntryFindUnique,
      create: mocks.affiliateCommissionLedgerEntryCreate,
    },
    affiliatePayout: {
      findFirst: mocks.affiliatePayoutFindFirst,
      findUnique: mocks.affiliatePayoutFindUnique,
      create: mocks.affiliatePayoutCreate,
      updateMany: mocks.affiliatePayoutUpdateMany,
    },
    courseCommissionAllocation: {
      findMany: mocks.courseCommissionAllocationFindMany,
      findUnique: mocks.courseCommissionAllocationFindUnique,
    },
    courseCommissionLedgerEntry: {
      aggregate: mocks.courseCommissionLedgerEntryAggregate,
      findUnique: mocks.courseCommissionLedgerEntryFindUnique,
      create: mocks.courseCommissionLedgerEntryCreate,
    },
    coursePayout: {
      findUnique: mocks.coursePayoutFindUnique,
      findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
      create: mocks.coursePayoutCreate,
      updateMany: mocks.coursePayoutUpdateMany,
    },
    auditLog: { create: mocks.auditLogCreate },
    blacklist: { create: mocks.blacklistCreate },
    registrationForm: {
      create: mocks.registrationFormCreate,
      findFirst: mocks.registrationFormFindFirst,
      update: mocks.registrationFormUpdate,
    },
    userSession: { findMany: mocks.userSessionFindMany, updateMany: mocks.userSessionUpdateMany },
  }),
}));
vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/commerce-orders", () => ({
  reconcileCommerceOrderRefundForPayment: mocks.reconcileCommerceOrderRefundForPayment,
}));

import {
  createVendorMemberAction,
  createPayoutBatchAction,
  deactivateVendorMemberAction,
  deleteInteractionRoleAction,
  deleteInteractionScriptAction,
  duplicateInteractionScriptAction,
  generateSettlementAction,
  importSystemRolesAction,
  loginAction,
  lockSettlementAction,
  markPayoutBatchExportedAction,
  refundPaymentTransactionAction,
  resendVendorMemberInvitationAction,
  requestPasswordResetAction,
  regenerateRecoveryCodesAction,
  sendPasswordResetSmokeAction,
  updatePasswordAction,
  updateSettlementAdjustmentAction,
  recordAffiliatePayoutOutcomeAction,
  updatePayoutItemStatusAction,
  unbindInteractionScriptFromLiveAction,
  upsertBlacklistAction,
  upsertAffiliateAction,
  upsertFormAction,
  upsertLiveAction,
  upsertTemplateAction,
  upsertVideoAction,
  upsertInteractionRoleAction,
  upsertInteractionRoleActionState,
  upsertInteractionScriptAction,
  verifyMfaAction,
  saveBrandSettingsAction,
  saveBrandSettingsActionState,
  type BrandSettingsActionState,
  type InteractionRoleActionState,
} from "./actions";
import { savePartnerPageAction } from "./actions/team-funnel-partner-actions";
import { RefundProviderError } from "@/lib/payment-providers/types";
import SecuritySettingsPage from "./(app)/settings/security/page";
import { FormSubmitButton } from "@/components/form-submit-button";
import { hashPassword } from "@/lib/password";
import { BillingCycleError } from "@/lib/billing-cycle";
import { initialMessageTemplateActionState } from "@/lib/message-template";

const transaction = {
  id: "payment-1",
  vendorId: "vendor-1",
  status: "paid",
  grossAmountCents: 10_000,
  refundedAmountCents: 6_000,
  gatewayFeeCents: 1_000,
  platformFeeCents: 400,
  occurredAt: new Date("2026-07-15T00:00:00.000Z"),
};

function refundFormData(
  refundAmount: string,
  gatewayFeeRefund = "0",
  platformFeeRefund = "0",
  monthKey = "2026-07",
) {
  const formData = new FormData();
  formData.set("id", transaction.id);
  formData.set("refundAmount", refundAmount);
  formData.set("gatewayFeeRefund", gatewayFeeRefund);
  formData.set("platformFeeRefund", platformFeeRefund);
  formData.set("monthKey", monthKey);
  return formData;
}

function settlementFormData(monthKey: string) {
  const formData = new FormData();
  formData.set("vendorId", "vendor-1");
  formData.set("monthKey", monthKey);
  return formData;
}

function vendorMemberFormData({
  name = "王小明",
  email = "member@example.com",
  role = "accountant",
}: {
  name?: string;
  email?: string;
  role?: string;
} = {}) {
  const formData = new FormData();
  formData.set("name", name);
  formData.set("email", email);
  formData.set("role", role);
  return formData;
}

function resendVendorMemberInvitationFormData(id = "member-2") {
  const formData = new FormData();
  formData.set("id", id);
  return formData;
}

function deactivateVendorMemberFormData(id = "member-2", confirmation = "member@example.com") {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("confirmation", confirmation);
  return formData;
}

function passwordResetFormData(email = "member@example.com") {
  const formData = new FormData();
  formData.set("email", email);
  return formData;
}

function updatePasswordFormData({
  currentPassword = "current-password-123",
  password = "replacement-password-456",
  confirmPassword = password,
}: {
  currentPassword?: string;
  password?: string;
  confirmPassword?: string;
} = {}) {
  const formData = new FormData();
  formData.set("currentPassword", currentPassword);
  formData.set("password", password);
  formData.set("confirmPassword", confirmPassword);
  return formData;
}

function registrationFormData(fields: string) {
  const formData = new FormData();
  formData.set("name", "測試表單");
  formData.set("slug", "test-form");
  formData.set("headline", "測試標題");
  formData.set("fields", fields);
  return formData;
}

function liveFormData() {
  const formData = new FormData();
  formData.set("title", "租戶限定直播");
  formData.set("slug", "tenant-live");
  formData.set("scheduledAt", "2026-08-08T20:00");
  formData.set("streamMode", "vod");
  formData.set("videoId", "video-1");
  formData.set("formId", "form-1");
  formData.set("messageTemplateId", "template-1");
  formData.set("liveReminderTemplateId", "reminder-template-1");
  formData.set("interactionScriptId", "script-1");
  formData.append("productIds", "product-1");
  formData.set("liveDraftId", "draft-1");
  formData.set("liveDraftRevision", "3");
  formData.set("affiliateMode", "enabled");
  formData.set("maxConcurrentViewers", "500");
  formData.set("stopWhenCreditsBelow", "300");
  formData.set("usageAttributionMode", "PROMOTER");
  formData.set("quotaPayerScope", "VENDOR");
  formData.set("splitOwnerBps", "3000");
  formData.set("splitPromoterBps", "7000");
  formData.set("replayEnabled", "on");
  return formData;
}

function videoFormData(id?: string) {
  const formData = new FormData();
  if (id) formData.set("id", id);
  formData.set("title", "受控影片");
  formData.set("videoUrl", "https://media.example.test/video.mp4");
  formData.set("sourceType", "cloudflare_live");
  formData.set("status", "processing");
  formData.set("cloudflareStreamUid", "forged-stream-uid");
  formData.set("cloudflareLiveInputUid", "forged-live-input-uid");
  formData.set("cloudflarePlaybackId", "forged-playback-id");
  formData.set("cloudflareReadyToStream", "on");
  formData.set("liveInputStatus", "connected");
  return formData;
}

function payoutStatusFormData(status: string, failReason?: string, outcomeReference?: string) {
  const formData = new FormData();
  formData.set("id", "payout-item-1");
  formData.set("status", status);
  if (failReason !== undefined) formData.set("failReason", failReason);
  if (outcomeReference !== undefined) formData.set("outcomeReference", outcomeReference);
  return formData;
}

function payoutBatchFormData(id = "batch-1") {
  const formData = new FormData();
  formData.set("id", id);
  return formData;
}

function loginFormData(email = " Member@Example.com ", password = "test-fixture-incorrect-password") {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

function mfaVerifyFormData(code = "123456", next = "/admin/billing/dashboard") {
  const formData = new FormData();
  formData.set("code", code);
  formData.set("next", next);
  return formData;
}

function recoveryRegenerationFormData(code = "123456") {
  const formData = new FormData();
  formData.set("code", code);
  return formData;
}

function interactionScriptFormData(triggerSec: string, ctaUrl?: string) {
  const formData = new FormData();
  formData.set("name", "測試留言組");
  formData.set("status", "draft");
  formData.set("eventType", ctaUrl === undefined ? "chat_message" : "cta_switch");
  formData.set("triggerSec", triggerSec);
  formData.set("eventTitle", "測試留言");
  formData.set("message", ctaUrl === undefined ? "測試留言內容" : "");
  formData.set("roleId", ctaUrl === undefined ? "role-1" : "");
  formData.set("productId", "");
  formData.set("ctaLabel", ctaUrl === undefined ? "" : "查看優惠");
  formData.set("ctaUrl", ctaUrl ?? "");
  return formData;
}

function scheduledInteractionRoleRecord(
  id = "role-1",
  overrides: Partial<{
    vendorId: string;
    name: string;
    avatarUrl: string | null;
    label: string;
    roleType: string;
    isActive: boolean;
    isScheduled: boolean;
  }> = {},
) {
  return {
    id,
    vendorId: "vendor-1",
    name: "直播小編",
    avatarUrl: null,
    label: "官方角色",
    roleType: "official",
    isActive: true,
    isScheduled: true,
    ...overrides,
  };
}

function unbindInteractionScriptFormData(liveId = "live-1", scriptId = "script-1") {
  const formData = new FormData();
  formData.set("id", scriptId);
  formData.set("liveId", liveId);
  return formData;
}

function formActions(node: unknown): unknown[] {
  if (Array.isArray(node)) return node.flatMap(formActions);
  if (!node || typeof node !== "object" || !("props" in node)) return [];

  const element = node as { type?: unknown; props?: { action?: unknown; children?: unknown } };
  return [
    ...(element.type === "form" ? [element.props?.action] : []),
    ...formActions(element.props?.children),
  ];
}

function elementsOfType(node: unknown, type: unknown): Array<{ props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap((child) => elementsOfType(child, type));
  if (!node || typeof node !== "object" || !("props" in node)) return [];

  const element = node as { type?: unknown; props?: Record<string, unknown> };
  return [
    ...(element.type === type && element.props ? [{ props: element.props }] : []),
    ...elementsOfType(element.props?.children, type),
  ];
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "test-actions-sensitive-data-secret-32-bytes");
  // Reset queued one-shot implementations too. Several action tests replace
  // transaction fixtures, so retaining an unconsumed mockResolvedValueOnce
  // would leak one case's database shape into the next case.
  vi.resetAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.authenticateUser.mockResolvedValue(null);
  mocks.cookies.mockResolvedValue({ delete: vi.fn(), set: vi.fn() });
  mocks.createUserSession.mockResolvedValue({ token: "test-fixture-session-token", expiresAt: new Date("2026-07-18T00:00:00.000Z") });
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-1", role: "finance_admin" } });
  mocks.requireVendorFinance.mockResolvedValue({
    vendor: { id: "vendor-1" },
    member: { id: "merchant-finance-1", role: "owner" },
  });
  mocks.requireAuth.mockResolvedValue({
    user: {
      id: "admin-1",
      platformRole: "platform_admin",
      mfaFactor: { secretEncrypted: "encrypted-totp-secret" },
    },
    vendor: { id: "vendor-1" },
    member: { role: "platform_admin" },
  });
  mocks.requireVendorOwner.mockResolvedValue({
    user: { id: "owner-1" },
    member: { role: "owner" },
    vendor: { id: "vendor-1" },
  });
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
  mocks.requireVendorManagerContext.mockResolvedValue({
    auth: {
      user: { id: "manager-user-1" },
      member: { role: "admin" },
    },
    vendor: { id: "vendor-1" },
  });
  mocks.headers.mockResolvedValue({
    get: (name: string) => ({
      "user-agent": "CelebrateDeal test",
      "x-forwarded-for": "203.0.113.10, 198.51.100.1",
    })[name] ?? null,
  });
  mocks.sendPasswordResetLink.mockResolvedValue({ token: "one-time-reset-token", resetUrl: "https://app.test/password-reset/confirm?token=one-time-reset-token" });
  mocks.decryptMfaSecret.mockReturnValue("totp-secret");
  mocks.generateRecoveryCodes.mockReturnValue(["recovery-code-1", "recovery-code-2"]);
  mocks.verifyTotpCode.mockReturnValue(true);
  mocks.verifyRecoveryCode.mockReturnValue(false);
  mocks.userRecoveryCodeFindMany.mockResolvedValue([]);
  mocks.userRecoveryCodeCreateMany.mockResolvedValue({ count: 2 });
  mocks.userRecoveryCodeDeleteMany.mockResolvedValue({ count: 0 });
  mocks.userMfaFactorUpdate.mockResolvedValue({ id: "factor-1" });
  mocks.userRecoveryCodeUpdate.mockResolvedValue({ id: "recovery-1" });
  mocks.userRecoveryCodeUpdateMany.mockResolvedValue({ count: 1 });
  mocks.markCurrentSessionMfaVerified.mockResolvedValue(undefined);
  mocks.findUnique.mockResolvedValue(transaction);
  mocks.refundRecordAggregate.mockResolvedValue({
    _sum: { gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 },
  });
  mocks.refundRecordCreate.mockResolvedValue({ id: "refund-1" });
  mocks.refundRecordUpdate.mockResolvedValue({ id: "refund-1", status: "processed" });
  mocks.vendorFindUnique.mockResolvedValue({ id: "vendor-1", slug: "vendor" });
  mocks.vendorMemberFindFirst.mockResolvedValue(null);
  mocks.vendorMemberFindMany.mockResolvedValue([]);
  mocks.settlementFindUnique.mockResolvedValue(null);
  mocks.settlementFindMany.mockResolvedValue([]);
  mocks.settlementUpdateMany.mockResolvedValue({ count: 1 });
  mocks.settlementCreate.mockResolvedValue({ id: "settlement-1" });
  mocks.invoiceFindUnique.mockResolvedValue(null);
  mocks.invoiceUpdate.mockResolvedValue({ id: "invoice-1" });
  mocks.affiliateCommissionFindMany.mockResolvedValue([]);
  mocks.affiliateCommissionFindFirst.mockResolvedValue(null);
  mocks.affiliateCommissionFindUnique.mockResolvedValue(null);
  mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
  mocks.affiliateCommissionLedgerEntryFindUnique.mockResolvedValue(null);
  mocks.affiliateCommissionLedgerEntryCreate.mockResolvedValue({ id: "ledger-entry-1" });
  mocks.affiliateCommissionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.affiliatePayoutFindFirst.mockResolvedValue(null);
  mocks.affiliatePayoutFindUnique.mockResolvedValue(null);
  mocks.affiliatePayoutCreate.mockResolvedValue({ id: "affiliate-payout-1" });
  mocks.affiliatePayoutUpdateMany.mockResolvedValue({ count: 1 });
  mocks.courseCommissionAllocationFindMany.mockResolvedValue([]);
  mocks.courseCommissionAllocationFindUnique.mockResolvedValue(null);
  mocks.courseCommissionLedgerEntryAggregate.mockResolvedValue({ _sum: { amountCents: 0 } });
  mocks.courseCommissionLedgerEntryFindUnique.mockResolvedValue(null);
  mocks.courseCommissionLedgerEntryCreate.mockResolvedValue({ id: "course-ledger-entry-1" });
  mocks.coursePayoutFindUnique.mockResolvedValue(null);
  mocks.coursePayoutFindUniqueOrThrow.mockResolvedValue({ id: "course-payout-1" });
  mocks.coursePayoutCreate.mockResolvedValue({ id: "course-payout-1" });
  mocks.coursePayoutUpdateMany.mockResolvedValue({ count: 1 });
  mocks.auditLogCreate.mockResolvedValue({ id: "audit-1" });
  mocks.requestAuditMeta.mockResolvedValue({ ipAddress: "203.0.113.10", userAgent: "CelebrateDeal test" });
  mocks.payoutBatchCreate.mockResolvedValue({ id: "payout-batch-1" });
  mocks.payoutItemCreate.mockResolvedValue({ id: "payout-item-1" });
  mocks.userSessionFindMany.mockResolvedValue([]);
  mocks.calculateSettlement.mockResolvedValue({
    monthlyFeeCents: 1_000,
    overflowFeeCents: 200,
    paymentServiceFeeCents: 300,
    transactionServiceFeeCents: 400,
    affiliateManagementFeeCents: 500,
    paymentGatewayFeeCents: 600,
    grossRevenueCents: 10_000,
    payoutableAmountCents: 8_000,
  });
  mocks.generateSettlementForVendor.mockResolvedValue({
    settlement: { id: "settlement-1" },
    existingSettlement: null,
    calculation: {
      monthlyFeeCents: 1_000,
      overflowFeeCents: 200,
      paymentServiceFeeCents: 300,
      transactionServiceFeeCents: 400,
      affiliateManagementFeeCents: 500,
      paymentGatewayFeeCents: 600,
      grossRevenueCents: 10_000,
      payoutableAmountCents: 8_000,
    },
    invoice: { id: "invoice-1" },
  });
  mocks.upsertUsageSnapshot.mockResolvedValue({ snapshot: {}, record: { id: "usage-snapshot-1" } });
  mocks.paymentTransactionUpdate.mockResolvedValue({ ...transaction, refundedAmountCents: 10_000, status: "refunded" });
  mocks.interactionRoleFindMany.mockResolvedValue([scheduledInteractionRoleRecord()]);
  mocks.interactionRoleCreate.mockResolvedValue({ id: "role-new" });
  mocks.interactionRoleCreateMany.mockResolvedValue({ count: 0 });
  mocks.interactionRoleDelete.mockResolvedValue({
    id: "role-1",
    name: "直播小編",
    label: "官方角色",
    roleType: "official",
    isActive: true,
  });
  mocks.interactionRoleUpdate.mockResolvedValue({ id: "role-1" });
  mocks.interactionScriptCreate.mockResolvedValue({ id: "script-new" });
  mocks.interactionScriptDelete.mockResolvedValue({ id: "script-1", name: "測試留言組", status: "draft" });
  mocks.interactionScriptUpdate.mockResolvedValue({ id: "script-1" });
  mocks.interactionEventDeleteMany.mockResolvedValue({ count: 1 });
  mocks.interactionEventCreate.mockResolvedValue({ id: "event-1" });
  mocks.messageTemplateCreate.mockResolvedValue({ id: "template-new" });
  mocks.messageTemplateUpdate.mockResolvedValue({ id: "template-1" });
  mocks.liveFindFirst.mockResolvedValue(null);
  mocks.liveFindMany.mockResolvedValue([]);
  mocks.liveStudioDraftUpdateMany.mockResolvedValue({ count: 1 });
  mocks.liveUpdate.mockResolvedValue({ id: "live-1" });
  mocks.liveProductDeleteMany.mockResolvedValue({ count: 1 });
  mocks.liveProductCreate.mockResolvedValue({ id: "live-product-1" });
  mocks.createLiveReminderReconciliationSnapshot.mockImplementation((input: Record<string, unknown>) => ({
    ...input,
    templateId: (input.template as { id?: string } | null)?.id ?? null,
    templateRevision: "test-revision",
    configDigest: "test-config-digest",
    isDeliverable: Boolean(
      input.template
      && ["scheduled", "live"].includes(String(input.liveStatus))
    ),
  }));
  mocks.queueLiveReminderReconciliation.mockImplementation(async (_tx, snapshot: { isDeliverable: boolean }) => ({
    status: snapshot.isDeliverable ? "queued" : "cancelled",
    jobId: "reminder-job-1",
  }));
  mocks.isAllowedSmokeTestRecipient.mockReturnValue(true);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    paymentTransaction: {
      findUnique: mocks.findUnique,
      update: mocks.paymentTransactionUpdate,
    },
    refundRecord: {
      aggregate: mocks.refundRecordAggregate,
      create: mocks.refundRecordCreate,
      update: mocks.refundRecordUpdate,
    },
    affiliateCommission: {
      findFirst: mocks.affiliateCommissionFindFirst,
      findMany: mocks.affiliateCommissionFindMany,
      findUnique: mocks.affiliateCommissionFindUnique,
      updateMany: mocks.affiliateCommissionUpdateMany,
    },
    affiliateCommissionLedgerEntry: {
      aggregate: mocks.affiliateCommissionLedgerEntryAggregate,
      findUnique: mocks.affiliateCommissionLedgerEntryFindUnique,
      create: mocks.affiliateCommissionLedgerEntryCreate,
    },
    affiliatePayout: {
      findFirst: mocks.affiliatePayoutFindFirst,
      findUnique: mocks.affiliatePayoutFindUnique,
      create: mocks.affiliatePayoutCreate,
      updateMany: mocks.affiliatePayoutUpdateMany,
    },
    courseCommissionAllocation: {
      findMany: mocks.courseCommissionAllocationFindMany,
      findUnique: mocks.courseCommissionAllocationFindUnique,
    },
    courseCommissionLedgerEntry: {
      aggregate: mocks.courseCommissionLedgerEntryAggregate,
      findUnique: mocks.courseCommissionLedgerEntryFindUnique,
      create: mocks.courseCommissionLedgerEntryCreate,
    },
    coursePayout: {
      findUnique: mocks.coursePayoutFindUnique,
      findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
      create: mocks.coursePayoutCreate,
      updateMany: mocks.coursePayoutUpdateMany,
    },
    interactionEvent: {
      create: mocks.interactionEventCreate,
      deleteMany: mocks.interactionEventDeleteMany,
    },
    interactionRole: {
      findMany: mocks.interactionRoleFindMany,
    },
    interactionScript: {
      create: mocks.interactionScriptCreate,
      findFirst: mocks.interactionScriptFindFirst,
      update: mocks.interactionScriptUpdate,
    },
    auditLog: { create: mocks.auditLogCreate },
    liveStudioDraft: { updateMany: mocks.liveStudioDraftUpdateMany },
    live: { create: mocks.liveCreate, findMany: mocks.liveFindMany, update: mocks.liveUpdate },
    messageTemplate: { create: mocks.messageTemplateCreate, update: mocks.messageTemplateUpdate },
    liveProduct: { create: mocks.liveProductCreate, deleteMany: mocks.liveProductDeleteMany },
    product: { findMany: mocks.productFindMany },
  }));
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loginAction", () => {
  it("blocks a source-wide limit before credential verification, session creation, or login-failure auditing", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const formData = loginFormData();

    await expect(loginAction(formData)).rejects.toThrow("redirect:/login?error=rate_limited");

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "login-source",
      20,
      15 * 60 * 1000,
    );
    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("forwards the trusted Cloudflare source to the limiter ahead of x-forwarded-for", async () => {
    mocks.headers.mockResolvedValueOnce({
      get: (name: string) => ({
        "cf-connecting-ip": "198.51.100.24",
        "x-forwarded-for": "203.0.113.10, 198.51.100.1",
        "user-agent": "CelebrateDeal test",
      })[name] ?? null,
    });
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));

    await expect(loginAction(loginFormData())).rejects.toThrow("redirect:/login?error=rate_limited");

    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("cf-connecting-ip")).toBe("198.51.100.24");
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
  });

  it("blocks a source and normalized-email limit before credential verification, session creation, or login-failure auditing", async () => {
    mocks.checkRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    const formData = loginFormData();

    await expect(loginAction(formData)).rejects.toThrow("redirect:/login?error=rate_limited");

    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      1,
      expect.any(Request),
      "login-source",
      20,
      15 * 60 * 1000,
    );
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.any(Request),
      "login-source-email:member@example.com",
      5,
      15 * 60 * 1000,
    );
    expect(mocks.authenticateUser).not.toHaveBeenCalled();
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails closed when the rate-limit service is unavailable without authenticating, creating a session, or auditing a failed login", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(loginAction(loginFormData())).rejects.toThrow(
      "redirect:/login?error=temporarily_unavailable",
    );

    expect(mocks.authenticateUser).not.toHaveBeenCalled();
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails closed when the source-and-email limiter is unavailable without authenticating, creating a session, or auditing", async () => {
    mocks.checkRateLimit
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(loginAction(loginFormData())).rejects.toThrow(
      "redirect:/login?error=temporarily_unavailable",
    );

    expect(mocks.authenticateUser).not.toHaveBeenCalled();
    expect(mocks.createUserSession).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("updatePasswordAction", () => {
  const currentPassword = "current-password-123";

  function authenticatedUser() {
    mocks.requireAuth.mockResolvedValue({
      user: {
        id: "user-1",
        email: "member@example.com",
        passwordHash: hashPassword(currentPassword, "current-password-test-salt"),
        platformRole: "user",
      },
      session: { id: "session-1" },
      vendor: { id: "vendor-1" },
      member: { role: "owner" },
    });
  }

  it("rejects an incorrect current password without changing credentials or sessions", async () => {
    authenticatedUser();
    const formData = updatePasswordFormData({ currentPassword: "incorrect-password" });

    await expect(updatePasswordAction(formData)).rejects.toThrow(
      "redirect:/settings/security?error=current_password",
    );

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.userSessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation before writing any credential data", async () => {
    authenticatedUser();

    await expect(updatePasswordAction(updatePasswordFormData({
      password: "replacement-password-456",
      confirmPassword: "different-password-789",
    }))).rejects.toThrow("redirect:/settings/security?error=password_mismatch");

    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.userSessionUpdateMany).not.toHaveBeenCalled();
  });

  it("updates the password atomically, revokes every active session, and clears auth cookies", async () => {
    authenticatedUser();
    const deleteCookie = vi.fn();
    mocks.cookies.mockResolvedValueOnce({ delete: deleteCookie, set: vi.fn() });
    mocks.transaction.mockResolvedValueOnce([]);

    await expect(updatePasswordAction(updatePasswordFormData())).rejects.toThrow(
      "redirect:/login?password_changed=1",
    );

    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { passwordHash: expect.stringMatching(/^scrypt:/) },
    });
    expect(mocks.userSessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "update_password",
      after: { email: "member@example.com" },
    }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("replacement-password-456");
    expect(deleteCookie).toHaveBeenCalledWith("celebrate_session");
    expect(deleteCookie).toHaveBeenCalledWith("celebrate_vendor_id");
  });
});

describe("savePartnerPageAction", () => {
  it("ignores forged partner contact fields and never updates the user account", async () => {
    const membership = {
      id: "membership-1",
      vendorId: "vendor-1",
      teamId: "team-1",
      vendorMemberId: "vendor-member-1",
      status: "ACTIVE",
      leftAt: null,
      vendorMember: { userId: "user-1", status: "active", deactivatedAt: null },
    };
    mocks.requireAuth.mockResolvedValue({
      user: { id: "user-1" },
      member: { id: "vendor-member-1", status: "active", deactivatedAt: null },
    });
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
  mocks.requireVendorManagerContext.mockImplementation(async () => ({
    auth: { user: { id: "manager-user-1" }, member: { role: "admin" } },
    vendor: await mocks.requireVendor(),
  }));
    mocks.teamMembershipFindFirst.mockResolvedValue(membership);
    mocks.teamMembershipFindMany.mockResolvedValue([membership]);
    mocks.teamMembershipRelationshipFindMany.mockResolvedValue([]);
    mocks.partnerFunnelPageFindFirst.mockResolvedValue({
      id: "page-1",
      vendorId: "vendor-1",
      teamId: "team-1",
      promoterMembershipId: "membership-1",
      contentOwnerMembershipId: "membership-1",
      slug: "partner-page",
      templateVersion: { fieldLocks: [], productSlots: [] },
    });
    mocks.partnerFunnelPageUpdateMany.mockResolvedValue({ count: 1 });
    const formData = new FormData();
    formData.set("_csrf", "test-fixture-csrf-token");
    formData.set("teamId", "team-1");
    formData.set("pageId", "page-1");
    formData.set("headline", "更新後的主標題");
    formData.set("ctaLabel", "立即報名");
    formData.set("partnerName", "偽造名稱");
    formData.set("partnerEmail", "forged@example.com");

    await expect(savePartnerPageAction({ status: "idle", message: "" }, formData)).resolves.toEqual({ status: "success", message: "夥伴頁已儲存。" });

    expect(mocks.partnerFunnelPageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { headline: "更新後的主標題", subheadline: null, body: null, ctaLabel: "立即報名", ctaUrl: null },
    }));
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});

describe("upsertFormAction", () => {
  it("stores only a validated field definition and scopes edits to the current vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    const formData = registrationFormData(JSON.stringify([
      { key: "name", label: " 姓名 ", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
    ]));
    formData.set("id", "form-1");

    await expect(upsertFormAction(formData)).rejects.toThrow("redirect:/forms");

    expect(mocks.registrationFormUpdate).toHaveBeenCalledWith({
      where: { id: "form-1", vendorId: "vendor-1" },
      data: expect.objectContaining({
        fields: [
          { key: "name", label: "姓名", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
      }),
    });
    expect(mocks.registrationFormCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{not-json}"],
    ["missing required email field", JSON.stringify([
      { key: "name", label: "姓名", type: "text", required: true },
    ])],
    ["unsupported sensitive field type", JSON.stringify([
      { key: "name", label: "姓名", type: "text", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "password", label: "密碼", type: "password", required: false },
    ])],
  ])("rejects %s before any form persistence", async (_name, fields) => {
    await expect(upsertFormAction(registrationFormData(fields))).rejects.toThrow(
      "redirect:/forms/new?error=invalid_fields",
    );

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledOnce();
    expect(mocks.requireVendor).toHaveBeenCalledOnce();
    expect(mocks.registrationFormCreate).not.toHaveBeenCalled();
    expect(mocks.registrationFormUpdate).not.toHaveBeenCalled();
  });
});

describe("upsertBlacklistAction", () => {
  function blacklistFormData(identifierType: string, identifier: string) {
    const formData = new FormData();
    formData.set("identifierType", identifierType);
    formData.set("identifier", identifier);
    formData.set("reason", "風險名單");
    return formData;
  }

  it("normalizes an email before storing it in the current vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });

    await upsertBlacklistAction(blacklistFormData("email", " Blocked@Example.Test "));

    expect(mocks.blacklistCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        identifierType: "email",
        identifier: "blocked@example.test",
      }),
    });
  });

  it.each([
    ["unknown identifier type", "token", "value"],
    ["malformed email", "email", "not-an-email"],
    ["malformed phone", "phone", "phone-number"],
  ])("rejects %s without persistence", async (_name, identifierType, identifier) => {
    await expect(upsertBlacklistAction(blacklistFormData(identifierType, identifier))).rejects.toThrow(
      "redirect:/blacklists?error=invalid_identifier",
    );
    expect(mocks.blacklistCreate).not.toHaveBeenCalled();
  });
});

describe("upsertAffiliateAction", () => {
  function affiliateFormData(rate: string) {
    const formData = new FormData();
    formData.set("name", "受控夥伴");
    formData.set("code", "partner");
    formData.set("commissionRateBps", rate);
    formData.set("isActive", "on");
    return formData;
  }

  it.each(["-1", "10001", "1.5", "not-a-number"])(
    "rejects the out-of-range commission rate %s before persistence",
    async (rate) => {
      mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });

      await expect(upsertAffiliateAction(affiliateFormData(rate))).rejects.toThrow(
        "redirect:/affiliates?error=invalid_commission_rate",
      );

      expect(mocks.affiliateCreate).not.toHaveBeenCalled();
      expect(mocks.affiliateUpdate).not.toHaveBeenCalled();
    },
  );

  it("persists the normalized upper-bound rate for the current vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });

    await expect(upsertAffiliateAction(affiliateFormData("10000"))).rejects.toThrow(
      "redirect:/affiliates",
    );

    expect(mocks.affiliateCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        code: "PARTNER",
        commissionRateBps: 10_000,
      }),
    });
  });
});

describe("saveBrandSettingsAction timezone validation", () => {
  function brandSettingsFormData(timezone: string) {
    const formData = new FormData();
    formData.set("name", "測試品牌");
    formData.set("slug", "test-brand");
    formData.set("primaryColor", "#2563eb");
    formData.set("ctaColor", "#f97316");
    formData.set("timezone", timezone);
    formData.set("supportEmail", "support@example.test");
    formData.set("logoUrl", "https://submitted.example.test/logo.png");
    formData.set("logoUploadPhase", "idle");
    return formData;
  }

  function initialBrandSettingsState(): BrandSettingsActionState {
    return {
      status: "idle",
      message: "",
      values: {
        name: "目前品牌",
        slug: "current-brand",
        primaryColor: "#000000",
        ctaColor: "#ffffff",
        timezone: "Asia/Taipei",
        supportEmail: "current@example.test",
        logoUrl: "https://current.example.test/logo.png",
        logoAssetId: "current-logo-asset",
      },
    };
  }

  it("rejects an invalid IANA timezone before updating the vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "Asia/Taipei" });

    await expect(saveBrandSettingsAction(brandSettingsFormData("Mars/Olympus_Mons"))).rejects.toThrow(
      "redirect:/settings/brand?error=invalid_timezone",
    );

    expect(mocks.vendorUpdate).not.toHaveBeenCalled();
  });

  it("persists a valid tenant timezone as submitted server-side brand configuration", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "Asia/Taipei" });

    await expect(saveBrandSettingsAction(brandSettingsFormData("America/New_York"))).resolves.toBeUndefined();

    expect(mocks.vendorUpdate).toHaveBeenCalledWith({
      where: { id: "vendor-1" },
      data: expect.objectContaining({ timezone: "America/New_York" }),
    });
  });

  it("returns every submitted public value for an invalid timezone without writing the vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "Asia/Taipei" });
    const formData = brandSettingsFormData("Mars/Olympus_Mons");
    formData.set("name", "尚未儲存品牌");
    formData.set("slug", "unsaved-brand");
    formData.set("primaryColor", "#102030");
    formData.set("ctaColor", "#405060");
    formData.set("supportEmail", "unsaved@example.test");
    formData.set("logoUrl", "https://unsaved.example.test/logo.png");
    formData.set("logoAssetId", "unsaved-logo-asset");

    const result = await saveBrandSettingsActionState(initialBrandSettingsState(), formData);

    expect(result).toEqual({
      status: "error",
      message: "時區格式無效，請輸入有效的 IANA 時區，例如 Asia/Taipei。",
      values: {
        name: "尚未儲存品牌",
        slug: "unsaved-brand",
        primaryColor: "#102030",
        ctaColor: "#405060",
        timezone: "Mars/Olympus_Mons",
        supportEmail: "unsaved@example.test",
        logoUrl: "https://unsaved.example.test/logo.png",
        logoAssetId: "unsaved-logo-asset",
      },
    });
    expect(result.values).not.toHaveProperty("id");
    expect(mocks.vendorUpdate).not.toHaveBeenCalled();
  });

  it("updates and redirects only after the state action accepts the timezone", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "Asia/Taipei" });

    await expect(saveBrandSettingsActionState(initialBrandSettingsState(), brandSettingsFormData("America/New_York"))).rejects.toThrow(
      "redirect:/settings/brand",
    );

    expect(mocks.vendorUpdate).toHaveBeenCalledWith({
      where: { id: "vendor-1" },
      data: expect.objectContaining({ timezone: "America/New_York" }),
    });
  });

  it("prefers a tenant-owned ready Logo asset over a submitted URL", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "Asia/Taipei" });
    mocks.imageAssetFindFirst.mockResolvedValue({
      id: "logo-asset-1",
      publicUrl: "https://media.example.test/vendors/logo-asset-1.webp",
    });
    const formData = brandSettingsFormData("America/New_York");
    formData.set("logoAssetId", "logo-asset-1");
    formData.set("logoUploadPhase", "success");
    formData.set("logoUrl", "https://attacker.example.test/forged-logo.webp");

    await expect(saveBrandSettingsAction(formData)).resolves.toBeUndefined();

    expect(mocks.imageAssetFindFirst).toHaveBeenCalledWith({
      where: { id: "logo-asset-1", vendorId: "vendor-1", status: "ready" },
      select: { id: true, publicUrl: true },
    });
    expect(mocks.vendorUpdate).toHaveBeenCalledWith({
      where: { id: "vendor-1" },
      data: expect.objectContaining({
        logoUrl: "https://media.example.test/vendors/logo-asset-1.webp",
      }),
    });
  });

  it("uses the safe external URL only when no Logo asset is submitted", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "Asia/Taipei" });

    await expect(saveBrandSettingsAction(brandSettingsFormData("America/New_York"))).resolves.toBeUndefined();

    expect(mocks.imageAssetFindFirst).not.toHaveBeenCalled();
    expect(mocks.vendorUpdate).toHaveBeenCalledWith({
      where: { id: "vendor-1" },
      data: expect.objectContaining({ logoUrl: "https://submitted.example.test/logo.png" }),
    });
  });

  it.each(["", "idle", "success"])('accepts a Logo upload phase of "%s"', async (phase) => {
    const formData = brandSettingsFormData("America/New_York");
    formData.set("logoUploadPhase", phase);

    await expect(saveBrandSettingsActionState(initialBrandSettingsState(), formData)).rejects.toThrow(
      "redirect:/settings/brand",
    );

    expect(mocks.vendorUpdate).toHaveBeenCalled();
  });

  it.each(["ready", "provisioning", "uploading", "finalizing", "error"])(
    "returns a fixable state error and does not update for blocking Logo phase %s",
    async (phase) => {
      const formData = brandSettingsFormData("America/New_York");
      formData.set("logoUploadPhase", phase);

      const result = await saveBrandSettingsActionState(initialBrandSettingsState(), formData);

      expect(result).toEqual({
        status: "error",
        message: "品牌 Logo 上傳尚未完成，請完成上傳或移除未完成的檔案。",
        values: expect.objectContaining({
          name: "測試品牌",
          logoUrl: "https://submitted.example.test/logo.png",
          logoAssetId: "",
        }),
      });
      expect(mocks.vendorUpdate).not.toHaveBeenCalled();
    },
  );

  it("returns a safe state error for an invalid Logo asset without updating", async () => {
    mocks.imageAssetFindFirst.mockResolvedValue(null);
    const formData = brandSettingsFormData("America/New_York");
    formData.set("logoAssetId", "foreign-or-missing-asset");
    formData.set("logoUploadPhase", "success");

    const result = await saveBrandSettingsActionState(initialBrandSettingsState(), formData);

    expect(result).toEqual({
      status: "error",
      message: "品牌 Logo 圖片資產無效，請重新上傳。",
      values: expect.objectContaining({ logoAssetId: "foreign-or-missing-asset" }),
    });
    expect(mocks.vendorUpdate).not.toHaveBeenCalled();
  });

  it("rethrows Logo asset infrastructure errors from the state action", async () => {
    const infrastructureError = new Error("image asset database unavailable");
    mocks.imageAssetFindFirst.mockRejectedValue(infrastructureError);
    const formData = brandSettingsFormData("America/New_York");
    formData.set("logoAssetId", "logo-asset-1");
    formData.set("logoUploadPhase", "success");

    await expect(saveBrandSettingsActionState(initialBrandSettingsState(), formData)).rejects.toBe(infrastructureError);

    expect(mocks.vendorUpdate).not.toHaveBeenCalled();
  });

  it("rethrows Logo asset infrastructure errors from the direct action", async () => {
    const infrastructureError = new Error("image asset service unavailable");
    mocks.imageAssetFindFirst.mockRejectedValue(infrastructureError);
    const formData = brandSettingsFormData("America/New_York");
    formData.set("logoAssetId", "logo-asset-1");
    formData.set("logoUploadPhase", "success");

    await expect(saveBrandSettingsAction(formData)).rejects.toBe(infrastructureError);

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.vendorUpdate).not.toHaveBeenCalled();
  });

  it("bounds every public state echo and fails closed before looking up an oversized asset", async () => {
    const formData = brandSettingsFormData("Asia/Taipei");
    formData.set("name", "n".repeat(161));
    formData.set("slug", "s".repeat(161));
    formData.set("primaryColor", "p".repeat(33));
    formData.set("ctaColor", "c".repeat(33));
    formData.set("supportEmail", "e".repeat(321));
    formData.set("logoUrl", "u".repeat(2049));
    formData.set("logoAssetId", "a".repeat(129));
    formData.set("logoUploadPhase", "success");

    const result = await saveBrandSettingsActionState(initialBrandSettingsState(), formData);

    expect(result).toEqual({
      status: "error",
      message: "品牌 Logo 圖片資產無效，請重新上傳。",
      values: {
        name: "n".repeat(160),
        slug: "s".repeat(160),
        primaryColor: "p".repeat(32),
        ctaColor: "c".repeat(32),
        timezone: "Asia/Taipei",
        supportEmail: "e".repeat(320),
        logoUrl: "u".repeat(2048),
        logoAssetId: "a".repeat(128),
      },
    });
    expect(mocks.imageAssetFindFirst).not.toHaveBeenCalled();
    expect(mocks.vendorUpdate).not.toHaveBeenCalled();
  });

  it("returns a safe state error for an invalid Logo URL instead of throwing", async () => {
    const formData = brandSettingsFormData("America/New_York");
    formData.set("logoUrl", "javascript:alert(1)");

    const result = await saveBrandSettingsActionState(initialBrandSettingsState(), formData);

    expect(result).toEqual({
      status: "error",
      message: "品牌 Logo 來源無效，請完成上傳、移除未完成的檔案，或改用有效的 HTTP/HTTPS 圖片網址。",
      values: expect.objectContaining({ logoUrl: "javascript:alert(1)", logoAssetId: "" }),
    });
    expect(mocks.vendorUpdate).not.toHaveBeenCalled();
  });

  it("rejects a Logo URL longer than 2048 characters before updating", async () => {
    const formData = brandSettingsFormData("America/New_York");
    formData.delete("logoAssetId");
    formData.set("logoUrl", `https://logo.example.test/${"a".repeat(2048)}`);

    const result = await saveBrandSettingsActionState(initialBrandSettingsState(), formData);

    expect(result).toEqual({
      status: "error",
      message: "品牌 Logo 來源無效，請完成上傳、移除未完成的檔案，或改用有效的 HTTP/HTTPS 圖片網址。",
      values: expect.objectContaining({ logoUrl: formData.get("logoUrl")?.toString().slice(0, 2048) }),
    });
    expect(mocks.imageAssetFindFirst).not.toHaveBeenCalled();
    expect(mocks.vendorUpdate).not.toHaveBeenCalled();
  });

  it("redirects a direct action with a safe error for an invalid Logo URL", async () => {
    const formData = brandSettingsFormData("America/New_York");
    formData.set("logoUrl", "data:text/html,<script>alert(1)</script>");

    await expect(saveBrandSettingsAction(formData)).rejects.toThrow("redirect:/settings/brand?error=invalid_logo");

    expect(mocks.vendorUpdate).not.toHaveBeenCalled();
  });

  it("clears both Logo sources when the submitted asset and URL are empty", async () => {
    const formData = brandSettingsFormData("America/New_York");
    formData.delete("logoAssetId");
    formData.set("logoUrl", "");
    formData.set("logoUploadPhase", "idle");

    await expect(saveBrandSettingsAction(formData)).resolves.toBeUndefined();

    expect(mocks.vendorUpdate).toHaveBeenCalledWith({
      where: { id: "vendor-1" },
      data: expect.objectContaining({ logoUrl: null }),
    });
    expect(mocks.vendorUpdate.mock.calls[0]?.[0]?.data).not.toHaveProperty("logoAssetId");
  });
});

describe("upsertLiveAction", () => {
  function allowCurrentVendorLiveReferences() {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "Asia/Taipei" });
    mocks.productFindMany.mockResolvedValue([{ id: "product-1" }]);
    mocks.videoFindFirst.mockResolvedValue({ id: "video-1" });
    mocks.registrationFormFindFirst.mockResolvedValue({
      id: "form-1",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
    });
    mocks.messageTemplateFindFirst.mockImplementation(async ({ where }: { where: { trigger?: string } }) => (
      where.trigger === "live_reminder"
        ? {
            id: "reminder-template-1",
            vendorId: "vendor-1",
            channel: "email",
            trigger: "live_reminder",
            subject: "{{live_title}} 即將開始",
            body: "{{name}} {{unsubscribe_url}}",
            isActive: true,
            updatedAt: new Date("2026-08-09T00:00:00.000Z"),
          }
        : {
            id: "template-1",
            subject: "{{name}}，你已報名 {{live_title}}",
            body: "由 {{vendor_name}} 寄送。取消通知：{{unsubscribe_url}}",
          }
    ));
    mocks.interactionScriptFindFirst.mockResolvedValue({ id: "script-1" });
    mocks.affiliateFindFirst.mockResolvedValue({ id: "affiliate-1" });
    mocks.liveFindFirst.mockResolvedValue({
      id: "live-1",
      title: "租戶限定直播",
      status: "draft",
      scheduledAt: new Date("2026-08-08T12:00:00.000Z"),
      liveReminderTemplateId: null,
      liveReminderOffsetMinutes: 60,
    });
    mocks.liveCreate.mockResolvedValue({ id: "live-1" });
  }

  it("creates a live only after every relation is verified against the current vendor", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("cloudflareLiveInputUid", "forged-live-input-uid");
    formData.set("affiliateMode", "disabled");
    formData.set("defaultAffiliateCode", "summer_partner");
    formData.set("maxConcurrentViewers", "1200");
    formData.set("stopWhenCreditsBelow", "450");

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/live-1/preview");

    expect(mocks.productFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", id: { in: ["product-1"] }, isActive: true, fulfillmentTypeConfirmed: true },
      select: { id: true },
    });
    for (const lookup of [
      mocks.videoFindFirst,
      mocks.registrationFormFindFirst,
      mocks.messageTemplateFindFirst,
      mocks.interactionScriptFindFirst,
    ]) {
      expect(lookup).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ vendorId: "vendor-1" }),
      }));
    }
    expect(mocks.interactionScriptFindFirst).toHaveBeenCalledWith({
      where: { id: "script-1", vendorId: "vendor-1", status: "published" },
      select: { id: true },
    });
    expect(mocks.messageTemplateFindFirst).toHaveBeenCalledWith({
      where: {
        id: "template-1",
        vendorId: "vendor-1",
        channel: "email",
        trigger: "registration_confirmed",
        isActive: true,
      },
      select: { id: true, subject: true, body: true },
    });
    expect(mocks.liveCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        status: "draft",
        videoId: "video-1",
        formId: "form-1",
        messageTemplateId: "template-1",
        interactionScriptId: "script-1",
        replayEnabled: true,
        products: { create: [{ vendorId: "vendor-1", productId: "product-1", sortOrder: 1, isPinned: true }] },
      }),
    });
    expect(mocks.liveCreate.mock.calls[0]?.[0]?.data).not.toHaveProperty("cloudflareLiveInputUid");
    expect(mocks.liveCreate.mock.calls[0]?.[0]?.data.quotaPolicy).toEqual({
      version: 2,
      affiliateMode: "disabled",
      defaultAffiliateCode: "SUMMER_PARTNER",
      maxConcurrentViewers: 1200,
      stopWhenCreditsBelow: 450,
      quotaPayerScope: "VENDOR",
      usageAttributionMode: "PROMOTER",
      splitOwnerBps: 3000,
      splitPromoterBps: 7000,
      customAllocations: [],
      memberQuotas: [],
      pageQuotas: [],
    });
    expect(mocks.liveStudioDraftUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "draft-1",
        vendorId: "vendor-1",
        liveId: null,
        revision: 3,
        payload: { equals: expect.objectContaining({
          title: "租戶限定直播",
          affiliateMode: "disabled",
          activeStep: 4,
        }) },
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("converts the tenant wall time to UTC and ignores a forged form timezone", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("timezone", "America/New_York");

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/live-1/preview");

    expect(mocks.liveCreate.mock.calls[0]?.[0]?.data).toEqual(expect.objectContaining({
      scheduledAt: new Date("2026-08-08T12:00:00.000Z"),
    }));
  });

  it("rejects an invalid tenant timezone before reading or consuming the live draft", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "Mars/Olympus_Mons" });

    await expect(upsertLiveAction(liveFormData())).rejects.toThrow(
      "redirect:/lives/new?error=invalid_draft&draft=draft-1",
    );

    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
    expect(mocks.liveUpdate).not.toHaveBeenCalled();
    expect(mocks.queueLiveReminderReconciliation).not.toHaveBeenCalled();
  });

  it("rejects a DST gap before creating or updating a live", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "America/New_York" });
    const formData = liveFormData();
    formData.set("scheduledAt", "2026-03-08T02:30");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=invalid_draft&draft=draft-1",
    );

    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
    expect(mocks.liveUpdate).not.toHaveBeenCalled();
  });

  it("rolls back creation when another tab already advanced the draft revision", async () => {
    allowCurrentVendorLiveReferences();
    mocks.liveStudioDraftUpdateMany.mockResolvedValue({ count: 0 });

    await expect(upsertLiveAction(liveFormData())).rejects.toThrow(
      "redirect:/lives/new?error=draft_conflict&draft=draft-1",
    );

    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("allows a new live to schedule only through the explicit scheduled submitter", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("status", "scheduled");

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/live-1/preview");

    expect(mocks.liveCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "scheduled",
        formId: "form-1",
        messageTemplateId: "template-1",
        liveReminderTemplateId: "reminder-template-1",
      }),
    });
  });

  it("keeps an incomplete content setup as a private draft", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    for (const field of ["productIds", "videoId", "formId", "messageTemplateId", "interactionScriptId"]) {
      formData.delete(field);
    }

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/live-1/preview");

    expect(mocks.liveCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "draft",
        videoId: null,
        formId: null,
        messageTemplateId: null,
        interactionScriptId: null,
        products: { create: [] },
      }),
    });
  });

  it("blocks a sales live from publishing when its conversion path is incomplete", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "scheduled");
    formData.delete("formId");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/live-1/edit?error=publish_not_ready",
    );

    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveUpdate).not.toHaveBeenCalled();
  });

  it("blocks a sales live from publishing with malformed registration fields", async () => {
    allowCurrentVendorLiveReferences();
    mocks.registrationFormFindFirst.mockResolvedValue({ id: "form-1", fields: [] });
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "scheduled");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/live-1/edit?error=publish_not_ready",
    );

    expect(mocks.liveUpdate).not.toHaveBeenCalled();
  });

  it("allows a content live to publish with ready media and no sales conversion resources", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "scheduled");
    for (const field of ["productIds", "interactionScriptId"]) {
      formData.delete(field);
    }

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/live-1/edit");

    expect(mocks.liveUpdate).toHaveBeenCalledWith({
      where: { id: "live-1", vendorId: "vendor-1" },
      data: expect.objectContaining({
        status: "scheduled",
        videoId: "video-1",
        formId: "form-1",
        messageTemplateId: "template-1",
        liveReminderTemplateId: "reminder-template-1",
        interactionScriptId: null,
      }),
    });
  });

  it("schedules a complete content setup and consumes its draft atomically", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("studioPreset", "CONTENT");
    formData.set("status", "scheduled");
    formData.delete("productIds");
    formData.delete("interactionScriptId");

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/live-1/preview");

    expect(mocks.liveCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "scheduled",
        formId: "form-1",
        messageTemplateId: "template-1",
        liveReminderTemplateId: "reminder-template-1",
        products: { create: [] },
      }),
    });
    expect(mocks.liveStudioDraftUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ liveId: null, consumedAt: null }),
      data: { consumedAt: expect.any(Date) },
    }));
  });

  it("requires a reminder email for a content schedule before claiming its draft", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("studioPreset", "CONTENT");
    formData.set("status", "scheduled");
    formData.delete("productIds");
    formData.delete("interactionScriptId");
    formData.delete("liveReminderTemplateId");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=publish_not_ready&draft=draft-1",
    );
    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("keeps an explicit commerce setup blocked when its product and script are absent", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("studioPreset", "COMMERCE");
    formData.set("status", "scheduled");
    formData.delete("productIds");
    formData.delete("interactionScriptId");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=publish_not_ready&draft=draft-1",
    );
    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("promotes a content preset with products to commerce readiness", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("studioPreset", "CONTENT");
    formData.set("status", "scheduled");
    formData.delete("interactionScriptId");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=publish_not_ready&draft=draft-1",
    );
    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("blocks a content live from publishing without playable media", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "scheduled");
    for (const field of ["productIds", "videoId", "interactionScriptId"]) {
      formData.delete(field);
    }

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/live-1/edit?error=publish_not_ready",
    );

    expect(mocks.liveUpdate).not.toHaveBeenCalled();
  });

  it.each(["live", "ended"])("rejects a new live status %s before creating a live", async (status) => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("status", status);

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      `redirect:/lives/new?error=invalid_status&draft=draft-1`,
    );
    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("allows a scheduled live to be taken down as a draft even when readiness is incomplete", async () => {
    allowCurrentVendorLiveReferences();
    mocks.liveFindFirst.mockResolvedValue({
      id: "live-1",
      title: "租戶限定直播",
      status: "scheduled",
      scheduledAt: new Date("2026-08-08T12:00:00.000Z"),
      liveReminderTemplateId: null,
      liveReminderOffsetMinutes: 60,
    });
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "draft");
    for (const field of ["productIds", "videoId", "formId", "messageTemplateId", "interactionScriptId"]) {
      formData.delete(field);
    }

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/live-1/edit");

    expect(mocks.liveUpdate).toHaveBeenCalledWith({
      where: { id: "live-1", vendorId: "vendor-1" },
      data: expect.objectContaining({ status: "draft" }),
    });
  });

  it("updates an existing live only after atomically advancing its edit-draft revision", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "scheduled");

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/live-1/edit");

    expect(mocks.liveStudioDraftUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "draft-1",
        vendorId: "vendor-1",
        liveId: "live-1",
        revision: 3,
        payload: { equals: expect.objectContaining({
          title: "租戶限定直播",
          activeStep: 4,
        }) },
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revision: { increment: 1 } },
    });
    expect(mocks.liveUpdate).toHaveBeenCalledWith({
      where: { id: "live-1", vendorId: "vendor-1" },
      data: expect.objectContaining({ status: "scheduled", replayEnabled: true }),
    });
    expect(mocks.liveProductDeleteMany).toHaveBeenCalledWith({ where: { liveId: "live-1" } });
    expect(mocks.liveProductCreate).toHaveBeenCalledWith({
      data: { vendorId: "vendor-1", liveId: "live-1", productId: "product-1", sortOrder: 1, isPinned: true },
    });
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("atomically queues reminder reconciliation when an existing live changes reminder configuration", async () => {
    allowCurrentVendorLiveReferences();
    mocks.liveFindFirst.mockResolvedValue({
      id: "live-1",
      title: "租戶限定直播",
      status: "scheduled",
      scheduledAt: new Date("2026-08-08T12:00:00.000Z"),
      liveReminderTemplateId: "reminder-template-1",
      liveReminderOffsetMinutes: 60,
    });
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "scheduled");
    formData.set("liveReminderTemplateId", "reminder-template-1");
    formData.set("liveReminderOffsetMinutes", "30");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/live-1/edit?notice=reminders_reconciling",
    );

    expect(mocks.createLiveReminderReconciliationSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-1",
      liveId: "live-1",
      liveTitle: "租戶限定直播",
      liveStatus: "scheduled",
      reminderOffsetMinutes: 30,
      template: expect.objectContaining({ id: "reminder-template-1", trigger: "live_reminder" }),
    }));
    expect(mocks.queueLiveReminderReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ live: expect.any(Object) }),
      expect.objectContaining({ configDigest: "test-config-digest", isDeliverable: true }),
      expect.any(Date),
    );
  });

  it("queues reminder reconciliation when the live title changes", async () => {
    allowCurrentVendorLiveReferences();
    mocks.liveFindFirst.mockResolvedValue({
      id: "live-1",
      title: "舊直播標題",
      status: "scheduled",
      scheduledAt: new Date("2026-08-08T12:00:00.000Z"),
      liveReminderTemplateId: "reminder-template-1",
      liveReminderOffsetMinutes: 60,
    });
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "scheduled");
    formData.set("liveReminderTemplateId", "reminder-template-1");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/live-1/edit?notice=reminders_reconciling",
    );
    expect(mocks.createLiveReminderReconciliationSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      liveId: "live-1",
      liveTitle: "租戶限定直播",
    }));
  });

  it("cancels old reminder work when a live ends", async () => {
    allowCurrentVendorLiveReferences();
    mocks.liveFindFirst.mockResolvedValue({
      id: "live-1",
      title: "租戶限定直播",
      status: "live",
      scheduledAt: new Date("2026-08-08T12:00:00.000Z"),
      liveReminderTemplateId: "reminder-template-1",
      liveReminderOffsetMinutes: 60,
    });
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "ended");
    formData.set("liveReminderTemplateId", "reminder-template-1");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/live-1/edit?notice=reminders_cancelled",
    );
    expect(mocks.queueLiveReminderReconciliation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ isDeliverable: false, liveStatus: "ended" }),
      expect.any(Date),
    );
  });

  it("rejects a direct status jump that is not allowed from the current live state", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("id", "live-1");
    formData.set("status", "ended");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/live-1/edit?error=invalid_status",
    );
    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveUpdate).not.toHaveBeenCalled();
  });

  it("requires a live notification template that can actually send registration email", async () => {
    allowCurrentVendorLiveReferences();
    mocks.messageTemplateFindFirst.mockResolvedValue(null);

    await expect(upsertLiveAction(liveFormData())).rejects.toThrow(
      "redirect:/lives/new?error=invalid_reference&draft=draft-1",
    );
    expect(mocks.messageTemplateFindFirst).toHaveBeenCalledWith({
      where: {
        id: "template-1",
        vendorId: "vendor-1",
        channel: "email",
        trigger: "registration_confirmed",
        isActive: true,
      },
      select: { id: true, subject: true, body: true },
    });
    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects incomplete final form data before claiming the saved draft", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("title", "");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=invalid_draft&draft=draft-1",
    );
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
  });

  it("rejects a product from another vendor before creating a live", async () => {
    allowCurrentVendorLiveReferences();
    mocks.productFindMany.mockResolvedValue([]);

    await expect(upsertLiveAction(liveFormData())).rejects.toThrow(
      "redirect:/lives/new?error=invalid_reference&draft=draft-1",
    );

    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("requires verified membership payment references before enabling member quotas", async () => {
    allowCurrentVendorLiveReferences();
    mocks.teamMembershipFindMany.mockResolvedValue([{ id: "member-1", teamId: "team-1" }]);
    mocks.paymentMethodReferenceFindMany.mockResolvedValue([]);
    const formData = liveFormData();
    formData.set("quotaPayerScope", "MEMBER");
    formData.set("memberQuotas", JSON.stringify([
      { teamId: "team-1", membershipId: "member-1", includedMinutes: 60 },
    ]));

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=payment_method_required&draft=draft-1",
    );
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("rejects a member quota whose team does not own the selected membership", async () => {
    allowCurrentVendorLiveReferences();
    mocks.teamMembershipFindMany.mockResolvedValue([{ id: "member-1", teamId: "team-1" }]);
    const formData = liveFormData();
    formData.set("quotaPayerScope", "MEMBER");
    formData.set("memberQuotas", JSON.stringify([
      { teamId: "wrong-team", membershipId: "member-1", includedMinutes: 60 },
    ]));

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=invalid_reference&draft=draft-1",
    );
    expect(mocks.paymentMethodReferenceFindMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("rejects a forged, inactive, or foreign default affiliate code before saving the live policy", async () => {
    allowCurrentVendorLiveReferences();
    mocks.affiliateFindFirst.mockResolvedValue(null);
    const formData = liveFormData();
    formData.set("defaultAffiliateCode", "foreign_code");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=invalid_reference&draft=draft-1",
    );

    expect(mocks.affiliateFindFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", code: "FOREIGN_CODE", isActive: true },
      select: { id: true },
    });
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("rejects an inactive or departed membership from Stream allocation settings", async () => {
    allowCurrentVendorLiveReferences();
    mocks.teamMembershipFindMany.mockResolvedValue([]);
    const formData = liveFormData();
    formData.set("quotaPayerScope", "MEMBER");
    formData.set("memberQuotas", JSON.stringify([
      { teamId: "team-1", membershipId: "member-inactive", includedMinutes: 60 },
    ]));

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=invalid_reference&draft=draft-1",
    );

    expect(mocks.teamMembershipFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        id: { in: ["member-inactive"] },
        status: "ACTIVE",
        leftAt: null,
      },
      select: { id: true, teamId: true },
    });
    expect(mocks.paymentMethodReferenceFindMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("requires verified membership payment references for custom member allocations", async () => {
    allowCurrentVendorLiveReferences();
    mocks.teamMembershipFindMany.mockResolvedValue([{ id: "member-1", teamId: "team-1" }]);
    mocks.paymentMethodReferenceFindMany.mockResolvedValue([]);
    const formData = liveFormData();
    formData.set("quotaPayerScope", "MEMBER");
    formData.set("usageAttributionMode", "CUSTOM");
    formData.set("customAllocations", JSON.stringify([
      { teamId: "team-1", membershipId: "member-1", bps: 10_000 },
    ]));

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=payment_method_required&draft=draft-1",
    );
    expect(mocks.paymentMethodReferenceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ membershipId: { in: ["member-1"] } }),
    }));
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("rejects a to-one relation from another vendor before creating a live", async () => {
    allowCurrentVendorLiveReferences();
    mocks.videoFindFirst.mockResolvedValue(null);

    await expect(upsertLiveAction(liveFormData())).rejects.toThrow(
      "redirect:/lives/new?error=invalid_reference&draft=draft-1",
    );

    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("does not bind a provisioned but unready Stream upload to a live", async () => {
    allowCurrentVendorLiveReferences();
    mocks.videoFindFirst.mockResolvedValue(null);

    await expect(upsertLiveAction(liveFormData())).rejects.toThrow(
      "redirect:/lives/new?error=invalid_reference&draft=draft-1",
    );

    expect(mocks.videoFindFirst).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        id: "video-1",
        OR: [
          { sourceType: "url", status: "ready" },
          { sourceType: "cloudflare_stream", status: "ready", cloudflareReadyToStream: true },
          {
            sourceType: "cloudflare_live",
            status: { not: "archived" },
            cloudflareLiveInputUid: { not: null },
            liveInputStatus: "created",
          },
        ],
      },
      select: { id: true },
    });
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("rejects a draft interaction script before a live can expose it", async () => {
    allowCurrentVendorLiveReferences();
    mocks.interactionScriptFindFirst.mockResolvedValue(null);

    await expect(upsertLiveAction(liveFormData())).rejects.toThrow(
      "redirect:/lives/new?error=invalid_reference&draft=draft-1",
    );

    expect(mocks.interactionScriptFindFirst).toHaveBeenCalledWith({
      where: { id: "script-1", vendorId: "vendor-1", status: "published" },
      select: { id: true },
    });
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("binds only a ready hero image owned by the current vendor", async () => {
    allowCurrentVendorLiveReferences();
    mocks.imageAssetFindFirst.mockResolvedValue({ id: "asset-1", publicUrl: "https://media.example.test/vendors/hero.webp" });
    const formData = liveFormData();
    formData.set("heroImageAssetId", "asset-1");
    formData.set("heroImageUrl", "https://attacker.example.test/forged.webp");

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/live-1/preview");

    expect(mocks.imageAssetFindFirst).toHaveBeenCalledWith({
      where: { id: "asset-1", vendorId: "vendor-1", status: "ready" },
      select: { id: true, publicUrl: true },
    });
    expect(mocks.liveCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        heroImageAssetId: "asset-1",
        heroImageUrl: "https://media.example.test/vendors/hero.webp",
      }),
    });
  });

  it("rejects a hero image from another vendor before creating a live", async () => {
    allowCurrentVendorLiveReferences();
    mocks.imageAssetFindFirst.mockResolvedValue(null);
    const formData = liveFormData();
    formData.set("heroImageAssetId", "cross-tenant-asset");

    await expect(upsertLiveAction(formData)).rejects.toThrow("redirect:/lives/new?error=invalid_reference&draft=draft-1");
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("returns to the same recoverable draft when a legacy hero URL is unsafe", async () => {
    allowCurrentVendorLiveReferences();
    const formData = liveFormData();
    formData.set("heroImageUrl", "javascript:alert(1)");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=invalid_draft&draft=draft-1",
    );
    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });

  it("rejects a final draft whose canonical slug would be empty", async () => {
    const formData = liveFormData();
    formData.set("slug", "!!!");

    await expect(upsertLiveAction(formData)).rejects.toThrow(
      "redirect:/lives/new?error=invalid_draft&draft=draft-1",
    );
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    expect(mocks.liveStudioDraftUpdateMany).not.toHaveBeenCalled();
    expect(mocks.liveCreate).not.toHaveBeenCalled();
  });
});

describe("upsertVideoAction", () => {
  beforeEach(() => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.videoCreate.mockResolvedValue({ id: "video-1" });
    mocks.videoUpdate.mockResolvedValue({ id: "video-1" });
  });

  it("creates only an external URL video and ignores forged provider-owned fields", async () => {
    await expect(upsertVideoAction(videoFormData())).rejects.toThrow("redirect:/videos");

    const data = mocks.videoCreate.mock.calls[0]?.[0]?.data;
    expect(data).toEqual(expect.objectContaining({
      vendorId: "vendor-1",
      sourceType: "url",
      status: "ready",
      videoUrl: "https://media.example.test/video.mp4",
    }));
    for (const providerOwnedField of [
      "cloudflareStreamUid",
      "cloudflareLiveInputUid",
      "cloudflarePlaybackId",
      "cloudflareReadyToStream",
      "liveInputStatus",
    ]) {
      expect(data).not.toHaveProperty(providerOwnedField);
    }
  });

  it("preserves provider-owned playback URL, mapping, and state when editing a Cloudflare video", async () => {
    mocks.videoFindFirst.mockResolvedValue({
      id: "video-1",
      sourceType: "cloudflare_stream",
      status: "ready",
      cloudflareReadyToStream: true,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    });

    await expect(upsertVideoAction(videoFormData("video-1"))).rejects.toThrow("redirect:/videos");

    expect(mocks.videoFindFirst).toHaveBeenCalledWith({
      where: { id: "video-1", vendorId: "vendor-1" },
      select: {
        id: true,
        sourceType: true,
        status: true,
        cloudflareReadyToStream: true,
        cloudflareLiveInputUid: true,
        liveInputStatus: true,
      },
    });
    const data = mocks.videoUpdate.mock.calls[0]?.[0]?.data;
    for (const providerOwnedField of [
      "sourceType",
      "videoUrl",
      "status",
      "cloudflareStreamUid",
      "cloudflareLiveInputUid",
      "cloudflarePlaybackId",
      "cloudflareReadyToStream",
      "liveInputStatus",
    ]) {
      expect(data).not.toHaveProperty(providerOwnedField);
    }
  });

  it("allows an external URL video to change its URL and archive state", async () => {
    mocks.videoFindFirst.mockResolvedValue({ id: "video-1", sourceType: "url" });
    const formData = videoFormData("video-1");
    formData.set("status", "archived");

    await expect(upsertVideoAction(formData)).rejects.toThrow("redirect:/videos");

    expect(mocks.videoUpdate).toHaveBeenCalledWith({
      where: { id: "video-1", vendorId: "vendor-1" },
      data: expect.objectContaining({
        videoUrl: "https://media.example.test/video.mp4",
        status: "archived",
      }),
    });
  });

  it("uses the current vendor ready image asset instead of a client supplied thumbnail URL", async () => {
    mocks.videoFindFirst.mockResolvedValue({
      id: "video-1",
      sourceType: "cloudflare_stream",
      status: "ready",
      cloudflareReadyToStream: true,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    });
    mocks.imageAssetFindFirst.mockResolvedValue({ id: "asset-1", publicUrl: "https://media.example.test/thumbnail.webp" });
    const formData = videoFormData("video-1");
    formData.set("thumbnailAssetId", "asset-1");
    formData.set("thumbnailUrl", "https://attacker.example.test/forged.webp");

    await expect(upsertVideoAction(formData)).rejects.toThrow("redirect:/videos");

    expect(mocks.videoUpdate).toHaveBeenCalledWith({
      where: { id: "video-1", vendorId: "vendor-1" },
      data: expect.objectContaining({
        thumbnailAssetId: "asset-1",
        thumbnailUrl: "https://media.example.test/thumbnail.webp",
      }),
    });
  });

  it("rejects an image asset outside the current vendor", async () => {
    mocks.videoFindFirst.mockResolvedValue({
      id: "video-1",
      sourceType: "cloudflare_stream",
      status: "ready",
      cloudflareReadyToStream: true,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    });
    mocks.imageAssetFindFirst.mockResolvedValue(null);
    const formData = videoFormData("video-1");
    formData.set("thumbnailAssetId", "cross-tenant-asset");

    await expect(upsertVideoAction(formData)).rejects.toThrow("redirect:/videos/video-1/edit?error=invalid_image_asset");
    expect(mocks.videoUpdate).not.toHaveBeenCalled();
  });

  it("does not treat a provisioned but unready Stream upload as a completed video", async () => {
    mocks.videoFindFirst.mockResolvedValue({
      id: "video-1",
      sourceType: "cloudflare_stream",
      status: "processing",
      cloudflareReadyToStream: false,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    });

    await expect(upsertVideoAction(videoFormData("video-1"))).rejects.toThrow(
      "redirect:/videos/video-1/edit?error=video_processing",
    );
    expect(mocks.videoUpdate).not.toHaveBeenCalled();
  });
});

describe("requestPasswordResetAction", () => {
  it("allows a request after CSRF validation without exposing the reset token", async () => {
    const formData = passwordResetFormData();

    await expect(requestPasswordResetAction(formData)).rejects.toThrow(
      "redirect:/password-reset/request?updated=sent",
    );

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "password-reset-request",
      5,
      60_000,
    );
    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.schedulePasswordResetLink).toHaveBeenCalledWith({
      email: "member@example.com",
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023",
      ipAddress: "203.0.113.10",
      userAgent: "CelebrateDeal test",
    });
  });

  it("does not create a token or send email when the IP is rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 429 }));

    await expect(requestPasswordResetAction(passwordResetFormData())).rejects.toThrow(
      "redirect:/password-reset/request?error=rate_limited",
    );

    expect(mocks.schedulePasswordResetLink).not.toHaveBeenCalled();
  });

  it("fails closed without sending email when the rate-limit service is unavailable", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(requestPasswordResetAction(passwordResetFormData())).rejects.toThrow(
      "redirect:/password-reset/request?error=temporarily_unavailable",
    );

    expect(mocks.schedulePasswordResetLink).not.toHaveBeenCalled();
  });
});

describe("sendPasswordResetSmokeAction", () => {
  function authenticatedSmokeRecipient() {
    mocks.requireAuth.mockResolvedValue({
      user: { id: "user-1", email: "smoke@example.test", platformRole: "user" },
      vendor: { id: "vendor-1" },
      member: { role: "owner" },
      isPlatformAdmin: false,
    });
  }

  it("does not create a reset token when the current account is not the configured test recipient", async () => {
    authenticatedSmokeRecipient();
    mocks.isAllowedSmokeTestRecipient.mockReturnValue(false);

    await expect(sendPasswordResetSmokeAction(new FormData())).rejects.toThrow(
      "redirect:/settings/security?error=password_reset_smoke_recipient",
    );

    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("does not create a reset token after the per-account smoke limit is reached", async () => {
    authenticatedSmokeRecipient();
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));

    await expect(sendPasswordResetSmokeAction(new FormData())).rejects.toThrow(
      "redirect:/settings/security?error=password_reset_smoke_rate_limited",
    );

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "password-reset-smoke:user-1",
      3,
      15 * 60 * 1000,
    );
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("sends only after allowlist and rate-limit checks and records a safe audit event", async () => {
    authenticatedSmokeRecipient();

    await expect(sendPasswordResetSmokeAction(new FormData())).rejects.toThrow(
      "redirect:/settings/security?updated=password_reset_smoke",
    );

    expect(mocks.isAllowedSmokeTestRecipient).toHaveBeenCalledWith("smoke@example.test");
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith(expect.objectContaining({
      email: "smoke@example.test",
    }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "password_reset_smoke_email_sent",
      targetId: "user-1",
    }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("one-time-reset-token");
  });
});

describe("verifyMfaAction", () => {
  it("limits a verified user's MFA attempts by both user ID and forwarded source IP before validating the code", async () => {
    const formData = mfaVerifyFormData();

    await expect(verifyMfaAction(formData)).rejects.toThrow("redirect:/admin/billing/dashboard");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.requireAuth).toHaveBeenCalledOnce();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "mfa-verification:admin-1",
      5,
      60_000,
    );
    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.verifyTotpCode).toHaveBeenCalledWith("totp-secret", "123456");
    expect(mocks.userMfaFactorUpdate).toHaveBeenCalledWith({
      where: { userId: "admin-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
    expect(mocks.markCurrentSessionMfaVerified).toHaveBeenCalledOnce();
  });

  it("falls back when MFA next uses a backslash-prefixed external path", async () => {
    const formData = mfaVerifyFormData("123456", "/\\evil.example.test");

    await expect(verifyMfaAction(formData)).rejects.toThrow("redirect:/admin/billing/dashboard");

    expect(mocks.markCurrentSessionMfaVerified).toHaveBeenCalledOnce();
  });

  it("claims a recovery code with a conditional update before marking the session verified", async () => {
    const formData = mfaVerifyFormData("recovery-code-1");
    mocks.verifyTotpCode.mockReturnValueOnce(false);
    mocks.verifyRecoveryCode.mockReturnValueOnce(true);
    mocks.userRecoveryCodeFindMany.mockResolvedValueOnce([
      { id: "recovery-1", userId: "admin-1", codeHash: "test-hash:recovery-code-1", usedAt: null },
    ]);

    await expect(verifyMfaAction(formData)).rejects.toThrow("redirect:/admin/billing/dashboard");

    expect(mocks.userRecoveryCodeUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "recovery-1",
        userId: "admin-1",
        usedAt: null,
      },
      data: { usedAt: expect.any(Date) },
    });
    expect(mocks.markCurrentSessionMfaVerified).toHaveBeenCalledOnce();
  });

  it("rejects a recovery code if the conditional claim has already been consumed", async () => {
    const formData = mfaVerifyFormData("recovery-code-1");
    mocks.verifyTotpCode.mockReturnValueOnce(false);
    mocks.verifyRecoveryCode.mockReturnValueOnce(true);
    mocks.userRecoveryCodeFindMany.mockResolvedValueOnce([
      { id: "recovery-1", userId: "admin-1", codeHash: "test-hash:recovery-code-1", usedAt: null },
    ]);
    mocks.userRecoveryCodeUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(verifyMfaAction(formData)).rejects.toThrow(
      "redirect:/mfa/verify?error=invalid&next=%2Fadmin%2Fbilling%2Fdashboard",
    );

    expect(mocks.markCurrentSessionMfaVerified).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "mfa_verify_failed",
    }));
  });

  it("does not validate or update MFA state when the attempt limit is exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 429 }));

    await expect(verifyMfaAction(mfaVerifyFormData())).rejects.toThrow(
      "redirect:/mfa/verify?error=rate_limited&next=%2Fadmin%2Fbilling%2Fdashboard",
    );

    expect(mocks.decryptMfaSecret).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeFindMany).not.toHaveBeenCalled();
    expect(mocks.verifyTotpCode).not.toHaveBeenCalled();
    expect(mocks.verifyRecoveryCode).not.toHaveBeenCalled();
    expect(mocks.userMfaFactorUpdate).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeUpdate).not.toHaveBeenCalled();
    expect(mocks.markCurrentSessionMfaVerified).not.toHaveBeenCalled();
  });

  it("fails closed without validating or updating MFA state when rate limiting is unavailable", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(verifyMfaAction(mfaVerifyFormData())).rejects.toThrow(
      "redirect:/mfa/verify?error=temporarily_unavailable&next=%2Fadmin%2Fbilling%2Fdashboard",
    );

    expect(mocks.decryptMfaSecret).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeFindMany).not.toHaveBeenCalled();
    expect(mocks.verifyTotpCode).not.toHaveBeenCalled();
    expect(mocks.verifyRecoveryCode).not.toHaveBeenCalled();
    expect(mocks.userMfaFactorUpdate).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeUpdate).not.toHaveBeenCalled();
    expect(mocks.markCurrentSessionMfaVerified).not.toHaveBeenCalled();
  });
});

describe("regenerateRecoveryCodesAction", () => {
  function authenticatedMfaUser() {
    mocks.requireAuth.mockResolvedValue({
      user: {
        id: "user-1",
        email: "member@example.test",
        platformRole: "user",
        mfaFactor: { secretEncrypted: "encrypted-totp-secret" },
      },
      vendor: { id: "vendor-1" },
      member: { role: "owner" },
      isPlatformAdmin: false,
    });
  }

  it("fails closed before TOTP verification when regeneration is rate limited", async () => {
    authenticatedMfaUser();
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));

    await expect(regenerateRecoveryCodesAction(recoveryRegenerationFormData())).rejects.toThrow(
      "redirect:/settings/security?error=recovery_rate_limited",
    );

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "mfa-recovery-regeneration:user-1",
      3,
      15 * 60 * 1000,
    );
    expect(mocks.decryptMfaSecret).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects an incorrect current TOTP without replacing any recovery code", async () => {
    authenticatedMfaUser();
    mocks.verifyTotpCode.mockReturnValueOnce(false);

    await expect(regenerateRecoveryCodesAction(recoveryRegenerationFormData("000000"))).rejects.toThrow(
      "redirect:/settings/security?error=mfa_code",
    );

    expect(mocks.verifyTotpCode).toHaveBeenCalledWith("totp-secret", "000000");
    expect(mocks.userRecoveryCodeDeleteMany).not.toHaveBeenCalled();
    expect(mocks.userRecoveryCodeCreateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "mfa_recovery_codes_regeneration_failed",
    }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("000000");
  });

  it("atomically replaces recovery codes only after a valid current TOTP", async () => {
    authenticatedMfaUser();
    const setCookie = vi.fn();
    mocks.cookies.mockResolvedValueOnce({ delete: vi.fn(), set: setCookie });
    mocks.transaction.mockResolvedValueOnce([]);

    await expect(regenerateRecoveryCodesAction(recoveryRegenerationFormData())).rejects.toThrow(
      "redirect:/settings/security?updated=recovery_regenerated",
    );

    expect(mocks.userRecoveryCodeDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(mocks.userRecoveryCodeCreateMany).toHaveBeenCalledWith({
      data: [
        { userId: "user-1", codeHash: "test-hash:recovery-code-1" },
        { userId: "user-1", codeHash: "test-hash:recovery-code-2" },
      ],
    });
    expect(mocks.userMfaFactorUpdate).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(setCookie).toHaveBeenCalledWith(
      "mfa_recovery_codes",
      JSON.stringify(["recovery-code-1", "recovery-code-2"]),
      expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    );
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("recovery-code-1");
  });
});

describe("createVendorMemberAction", () => {
  it("allows an owner to invite the least-privilege support role", async () => {
    const newUser = { id: "user-support", email: "support@example.com", name: "客服小美", status: "active", platformRole: "none" };
    const savedMember = { id: "member-support", userId: newUser.id, role: "support", status: "active", user: newUser };
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userCreate.mockResolvedValue(newUser);
    mocks.userUpdate.mockResolvedValue(newUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);

    await expect(createVendorMemberAction(vendorMemberFormData({ name: newUser.name, email: newUser.email, role: "support" }))).rejects.toThrow(
      "redirect:/settings/security?updated=member",
    );

    expect(mocks.vendorMemberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ role: "support", status: "active" }),
    }));
  });

  it("rejects roles outside the member-role allowlist", async () => {
    await expect(createVendorMemberAction(vendorMemberFormData({ role: "platform_admin" }))).rejects.toThrow(
      "redirect:/settings/security?error=member_invalid",
    );

    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("creates a member and sends a one-time password setup invitation without auditing the token or password", async () => {
    const newUser = { id: "user-2", email: "member@example.com", name: "王小明", status: "active", platformRole: "none" };
    const savedMember = { id: "member-2", userId: newUser.id, role: "accountant", status: "active", user: newUser };
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userCreate.mockResolvedValue(newUser);
    mocks.userUpdate.mockResolvedValue(newUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);

    const formData = vendorMemberFormData();
    const suppliedInitialPassword = "initial-password-must-not-be-sent";
    formData.set("password", suppliedInitialPassword);
    await expect(createVendorMemberAction(formData)).rejects.toThrow("redirect:/settings/security?updated=member");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.requireVendorOwner).toHaveBeenCalledOnce();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "vendor-member-invitation",
      5,
      60_000,
    );
    const [rateLimitRequest] = mocks.checkRateLimit.mock.calls[0] as [Request];
    expect(rateLimitRequest.headers.get("x-forwarded-for")).toBe("203.0.113.10, 198.51.100.1");
    expect(mocks.userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: newUser.email,
        name: newUser.name,
        passwordHash: expect.any(String),
      }),
    });
    expect(mocks.vendorMemberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        vendorId: "vendor-1",
        userId: newUser.id,
        role: "accountant",
        status: "active",
      }),
    }));
    // 與 Server Action 使用相同的環境網址，避免 CI 與本機設定不同時產生假失敗。
    const expectedAppUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023";
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith({
      email: newUser.email,
      appUrl: expectedAppUrl,
      ipAddress: "203.0.113.10",
      userAgent: "CelebrateDeal test",
    });

    const generatedPasswordHash = mocks.userCreate.mock.calls[0]?.[0].data.passwordHash;
    const auditEntries = JSON.stringify(mocks.writeAuditLog.mock.calls);
    expect(auditEntries).not.toContain("one-time-reset-token");
    expect(auditEntries).not.toContain(generatedPasswordHash);
    expect(auditEntries).not.toContain("passwordHash");
    expect(auditEntries).not.toContain(suppliedInitialPassword);
    expect(JSON.stringify(mocks.sendPasswordResetLink.mock.calls)).not.toContain(suppliedInitialPassword);
  });

  it("does not change members or create password reset tokens when the invitation rate limit is exceeded", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 429 }));

    await expect(createVendorMemberAction(vendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_rate_limited",
    );

    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpsert).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("fails closed without changing members or creating password reset tokens when rate limiting is unavailable", async () => {
    mocks.checkRateLimit.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(createVendorMemberAction(vendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_unavailable",
    );

    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpsert).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("re-enables an inactive membership for an active user and sends a new invitation", async () => {
    const existingUser = { id: "user-2", email: "member@example.com", name: "原本姓名", status: "active", platformRole: "none" };
    const inactiveMember = {
      id: "member-2",
      userId: existingUser.id,
      role: "accountant",
      status: "inactive",
      user: { ...existingUser, passwordHash: "existing-password-hash" },
    };
    const savedMember = { ...inactiveMember, role: "admin", status: "active", deactivatedAt: null };
    mocks.userFindUnique.mockResolvedValue(existingUser);
    mocks.vendorMemberFindUnique.mockResolvedValue(inactiveMember);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userUpdate.mockResolvedValue(existingUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);

    await expect(createVendorMemberAction(vendorMemberFormData({ role: "admin" }))).rejects.toThrow("redirect:/settings/security?updated=member");

    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ role: "admin", status: "active", deactivatedAt: null }),
    }));
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: existingUser.id },
      data: { name: existingUser.name },
    });
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith(expect.objectContaining({ email: existingUser.email }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "reactivate_vendor_member" }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("existing-password-hash");
  });

  it("checks the last-owner invariant inside a Serializable role-update transaction", async () => {
    const existingUser = {
      id: "user-2",
      email: "member@example.com",
      name: "Second Owner",
      status: "active",
      platformRole: "none",
    };
    const existingOwner = {
      id: "member-2",
      userId: existingUser.id,
      role: "owner",
      status: "active",
      user: { email: existingUser.email },
    };
    mocks.userFindUnique.mockResolvedValueOnce(existingUser);
    mocks.vendorMemberFindUnique.mockResolvedValueOnce(existingOwner);
    mocks.vendorMemberCount.mockResolvedValueOnce(0);
    mocks.transaction.mockImplementationOnce(async (
      callback: (tx: unknown) => Promise<unknown>,
      options: unknown,
    ) => {
      expect(options).toEqual({ isolationLevel: "Serializable" });
      return callback({
        user: { create: mocks.userCreate, update: mocks.userUpdate },
        vendorMember: {
          count: mocks.vendorMemberCount,
          upsert: mocks.vendorMemberUpsert,
        },
      });
    });
    mocks.userUpdate.mockResolvedValueOnce(existingUser);

    await expect(createVendorMemberAction(vendorMemberFormData({ role: "admin" }))).rejects.toThrow(
      "redirect:/settings/security?error=last_owner",
    );

    expect(mocks.vendorMemberCount).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        status: "active",
        role: "owner",
        id: { not: "member-2" },
      },
    });
    expect(mocks.vendorMemberUpsert).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("does not let a tenant owner reactivate a globally inactive user", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "user-suspended",
      email: "member@example.com",
      name: "停權帳號",
      status: "inactive",
      platformRole: "none",
    });

    await expect(createVendorMemberAction(vendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=inactive_user",
    );

    expect(mocks.vendorMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpsert).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("keeps the membership update but reports an invitation delivery failure without auditing secrets", async () => {
    const newUser = { id: "user-2", email: "member@example.com", name: "王小明", status: "active", platformRole: "none" };
    const savedMember = { id: "member-2", userId: newUser.id, role: "accountant", status: "active", user: newUser };
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      user: { create: mocks.userCreate, update: mocks.userUpdate },
      vendorMember: { upsert: mocks.vendorMemberUpsert },
    }));
    mocks.userCreate.mockResolvedValue(newUser);
    mocks.userUpdate.mockResolvedValue(newUser);
    mocks.vendorMemberUpsert.mockResolvedValue(savedMember);
    mocks.sendPasswordResetLink.mockRejectedValueOnce(new Error("email delivery failed"));

    await expect(createVendorMemberAction(vendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation",
    );

    expect(mocks.writeAuditLog).toHaveBeenLastCalledWith(expect.objectContaining({
      action: "vendor_member_invitation_email_failed",
      after: { email: newUser.email, role: "accountant", status: "active" },
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/security");
    const auditEntries = JSON.stringify(mocks.writeAuditLog.mock.calls);
    expect(auditEntries).not.toContain("one-time-reset-token");
    expect(auditEntries).not.toContain("passwordHash");
  });
});

describe("resendVendorMemberInvitationAction", () => {
  const activeMember = {
    id: "member-2",
    vendorId: "vendor-1",
    userId: "user-2",
    role: "accountant",
    status: "active",
    user: { id: "user-2", email: "member@example.com", platformRole: "none" },
  };

  it("requires an owner after validating CSRF before looking up or emailing a member", async () => {
    mocks.requireVendorOwner.mockRejectedValueOnce(new Error("owner_required"));
    const formData = resendVendorMemberInvitationFormData();

    await expect(resendVendorMemberInvitationAction(formData)).rejects.toThrow("owner_required");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.vendorMemberFindFirst).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it.each([
    ["a member belonging to another vendor", null],
    ["an inactive member", { ...activeMember, status: "inactive" }],
  ])("rejects %s without sending email", async (_description, member) => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(member);

    await expect(resendVendorMemberInvitationAction(resendVendorMemberInvitationFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_resend_invalid",
    );

    expect(mocks.vendorMemberFindFirst).toHaveBeenCalledWith({
      where: { id: "member-2", vendorId: "vendor-1", status: "active" },
      include: { user: true },
    });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("resends a one-time password setup email without changing the member or sessions", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(activeMember);

    await expect(resendVendorMemberInvitationAction(resendVendorMemberInvitationFormData())).rejects.toThrow(
      "redirect:/settings/security?updated=member_invitation_resent",
    );

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      "vendor-member-invitation",
      5,
      60_000,
    );
    expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith({
      email: activeMember.user.email,
      appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31023",
      ipAddress: "203.0.113.10",
      userAgent: "CelebrateDeal test",
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "vendor_member_invitation_resent",
      targetId: activeMember.id,
      after: { email: activeMember.user.email, role: activeMember.role, status: activeMember.status },
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/security");
    expect(mocks.redirect).toHaveBeenCalledWith("/settings/security?updated=member_invitation_resent");
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0],
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("does not email or modify data when the invitation limit is exceeded", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(activeMember);
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));

    await expect(resendVendorMemberInvitationAction(resendVendorMemberInvitationFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_rate_limited",
    );

    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it("audits a failed resend without changing the member or sessions", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(activeMember);
    mocks.sendPasswordResetLink.mockRejectedValueOnce(new Error("email delivery failed"));

    await expect(resendVendorMemberInvitationAction(resendVendorMemberInvitationFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_invitation_resend_failed",
    );

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "vendor_member_invitation_resend_email_failed",
      targetId: activeMember.id,
    }));
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });
});

describe("deactivateVendorMemberAction", () => {
  const activeMember = {
    id: "member-2",
    vendorId: "vendor-1",
    userId: "user-2",
    role: "accountant",
    status: "active",
    user: { id: "user-2", email: "member@example.com", platformRole: "none" },
  };

  it("deactivates another active member, revokes the vendor sessions, audits, revalidates, and redirects", async () => {
    const deactivatedMember = { ...activeMember, status: "inactive", deactivatedAt: new Date("2026-07-20T00:00:00.000Z") };
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(activeMember);
    mocks.vendorMemberUpdate.mockResolvedValueOnce(deactivatedMember);
    mocks.userSessionUpdateMany.mockResolvedValueOnce({ count: 2 });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      vendorMember: { update: mocks.vendorMemberUpdate },
      userSession: { updateMany: mocks.userSessionUpdateMany },
    }));
    const formData = deactivateVendorMemberFormData();

    await expect(deactivateVendorMemberAction(formData)).rejects.toThrow(
      "redirect:/settings/security?updated=member_deactivated",
    );

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.requireVendorOwner).toHaveBeenCalledOnce();
    expect(mocks.vendorMemberFindFirst).toHaveBeenCalledWith({
      where: { id: activeMember.id, vendorId: "vendor-1" },
      include: { user: true },
    });
    expect(mocks.vendorMemberUpdate).toHaveBeenCalledWith({
      where: {
        id: activeMember.id,
        vendorId: "vendor-1",
        status: "active",
        role: activeMember.role,
      },
      data: { status: "inactive", deactivatedAt: expect.any(Date) },
    });
    expect(mocks.userSessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: activeMember.userId, vendorId: "vendor-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      actorId: "owner-1",
      actorLabel: "owner",
      action: "deactivate_vendor_member",
      targetType: "VendorMember",
      targetId: activeMember.id,
      before: activeMember,
      after: deactivatedMember,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/security");
    expect(mocks.redirect).toHaveBeenCalledWith("/settings/security?updated=member_deactivated");
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0],
    );
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("does not write data when the member is not found", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(null);

    await expect(deactivateVendorMemberAction(deactivateVendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=member_not_found",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpdate).not.toHaveBeenCalled();
    expect(mocks.userSessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects an unconfirmed deactivation without changing the member, sessions, or audit log", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce(activeMember);

    await expect(deactivateVendorMemberAction(deactivateVendorMemberFormData(activeMember.id, ""))).rejects.toThrow(
      "redirect:/settings/security?error=member_confirmation",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpdate).not.toHaveBeenCalled();
    expect(mocks.userSessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not write data when the owner attempts to deactivate themself", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce({
      ...activeMember,
      id: "member-owner",
      userId: "owner-1",
      user: { id: "owner-1", email: "owner@example.com", platformRole: "none" },
    });

    await expect(deactivateVendorMemberAction(deactivateVendorMemberFormData("member-owner"))).rejects.toThrow(
      "redirect:/settings/security?error=self_deactivate",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.vendorMemberUpdate).not.toHaveBeenCalled();
    expect(mocks.userSessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("does not write data when deactivating the last active owner", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce({ ...activeMember, role: "owner" });
    mocks.vendorMemberCount.mockResolvedValueOnce(0);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      vendorMember: {
        count: mocks.vendorMemberCount,
        update: mocks.vendorMemberUpdate,
      },
      userSession: { updateMany: mocks.userSessionUpdateMany },
    }));

    await expect(deactivateVendorMemberAction(deactivateVendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=last_owner",
    );

    expect(mocks.vendorMemberCount).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        role: "owner",
        status: "active",
        id: { not: activeMember.id },
      },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(mocks.vendorMemberUpdate).not.toHaveBeenCalled();
    expect(mocks.userSessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails closed when concurrent owner changes cause a serializable transaction conflict", async () => {
    mocks.vendorMemberFindFirst.mockResolvedValueOnce({ ...activeMember, role: "owner" });
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("serialization conflict"), { code: "P2034" }));

    await expect(deactivateVendorMemberAction(deactivateVendorMemberFormData())).rejects.toThrow(
      "redirect:/settings/security?error=last_owner",
    );

    expect(mocks.vendorMemberUpdate).not.toHaveBeenCalled();
    expect(mocks.userSessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("/settings/security member invitation controls", () => {
  it("renders resend controls only for an owner's active, non-self members", async () => {
    const activeMember = {
      id: "member-2",
      vendorId: "vendor-1",
      userId: "user-2",
      role: "accountant",
      status: "active",
      user: { id: "user-2", email: "member@example.com", platformRole: "none" },
    };
    mocks.requireAuth.mockResolvedValueOnce({
      user: { id: "owner-1", email: "owner@example.com", mfaFactor: { lastUsedAt: null }, recoveryCodes: [] },
      vendor: { id: "vendor-1" },
      member: { role: "owner" },
      session: { id: "session-1" },
      isMfaVerified: false,
    });
    mocks.cookies.mockResolvedValueOnce({ get: vi.fn() });
    mocks.vendorMemberFindMany.mockResolvedValueOnce([
      { ...activeMember, user: { ...activeMember.user, name: "可重寄成員" } },
      { ...activeMember, id: "member-self", userId: "owner-1", user: { id: "owner-1", email: "owner@example.com", name: "Owner", platformRole: "none" } },
      { ...activeMember, id: "member-inactive", status: "inactive", user: { ...activeMember.user, name: "停用成員" } },
    ]);

    const page = await SecuritySettingsPage({ searchParams: Promise.resolve({ updated: "member", error: "member_invitation_resend_failed" }) });
    const resendActions = formActions(page).filter((action) => action === resendVendorMemberInvitationAction);
    const actionButtons = elementsOfType(page, FormSubmitButton);
    const pendingLabels = actionButtons.map((button) => button.props.pendingChildren);
    const recoveryButton = actionButtons.find((button) => button.props.pendingChildren === "重新產生中…");
    const paragraphs = elementsOfType(page, "p");

    expect(resendActions).toHaveLength(1);
    expect(pendingLabels).toEqual(expect.arrayContaining(["重新產生中…", "重寄中…", "寄送中…"]));
    expect(recoveryButton?.props.confirmMessage).toBe("重新產生後，舊 recovery codes 會立即失效。確定繼續？");
    expect(elementsOfType(page, "button")).toHaveLength(0);
    expect(paragraphs.some((paragraph) => paragraph.props.role === "status" && paragraph.props["aria-live"] === "polite")).toBe(true);
    expect(paragraphs.some((paragraph) => paragraph.props.role === "alert")).toBe(true);
  });
});

describe("message template actions", () => {
  function templateFormData() {
    const formData = new FormData();
    formData.set("name", " 開播提醒 ");
    formData.set("channel", "email");
    formData.set("trigger", "live_reminder");
    formData.set("subject", " {{live_title}} 即將開始 ");
    formData.set("body", "嗨 {{name}}，直播即將開始。\n{{unsubscribe_url}}");
    formData.set("isActive", "on");
    return formData;
  }

  it("creates a normalized current-vendor email template and audits only safe metadata", async () => {
    const formData = templateFormData();

    await expect(upsertTemplateAction(initialMessageTemplateActionState, formData)).rejects.toThrow("redirect:/messages/templates");

    expect(mocks.messageTemplateCreate).toHaveBeenCalledWith({
      data: {
        vendorId: "vendor-1",
        name: "開播提醒",
        channel: "email",
        trigger: "live_reminder",
        subject: "{{live_title}} 即將開始",
        body: "嗨 {{name}}，直播即將開始。\n{{unsubscribe_url}}",
        isActive: true,
      },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-1",
      actorId: "manager-user-1",
      actorLabel: "admin",
      action: "message_template_created",
      targetId: "template-new",
      after: {
        name: "開播提醒",
        channel: "email",
        trigger: "live_reminder",
        isActive: true,
        hasSubject: true,
        bodyLength: 38,
      },
    }));
    expect(JSON.stringify(mocks.writeAuditLog.mock.calls)).not.toContain("直播即將開始");
  });

  it.each([
    ["an unavailable SMS channel", "channel", "sms"],
    ["an unavailable LINE channel", "channel", "line"],
    ["an unknown variable", "body", "{{provider_secret}}"],
    ["a missing email subject", "subject", ""],
  ])("rejects %s before persistence", async (_label, field, value) => {
    const formData = templateFormData();
    formData.set(field, value);

    const result = await upsertTemplateAction(initialMessageTemplateActionState, formData);

    expect(result).toEqual({
      status: "error",
      error: "invalid_template",
      draft: expect.objectContaining({ [field]: value }),
      expectedUpdatedAt: null,
      version: 1,
    });

    expect(mocks.messageTemplateCreate).not.toHaveBeenCalled();
    expect(mocks.messageTemplateUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("tenant-scopes template updates and recovers from a stale identifier", async () => {
    mocks.messageTemplateUpdate.mockRejectedValueOnce(Object.assign(new Error("missing template"), { code: "P2025" }));
    mocks.messageTemplateFindFirst.mockResolvedValueOnce(null);
    const formData = templateFormData();
    formData.set("id", "stale-template");
    formData.set("expectedUpdatedAt", "2026-08-09T03:00:00.000Z");

    const result = await upsertTemplateAction(initialMessageTemplateActionState, formData);

    expect(result).toEqual({
      status: "error",
      error: "missing_template",
      draft: expect.objectContaining({
        name: " 開播提醒 ",
        body: "嗨 {{name}}，直播即將開始。\n{{unsubscribe_url}}",
      }),
      expectedUpdatedAt: null,
      version: 1,
    });

    expect(mocks.messageTemplateUpdate).toHaveBeenCalledWith({
      where: { id: "stale-template", vendorId: "vendor-1", updatedAt: new Date("2026-08-09T03:00:00.000Z") },
      data: expect.objectContaining({ channel: "email" }),
    });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("preserves a stale-tab draft and advances the explicit version claim before overwrite", async () => {
    const currentUpdatedAt = new Date("2026-08-09T04:00:00.000Z");
    mocks.messageTemplateUpdate.mockRejectedValueOnce(Object.assign(new Error("stale template"), { code: "P2025" }));
    mocks.messageTemplateFindFirst.mockResolvedValueOnce({ updatedAt: currentUpdatedAt });
    const formData = templateFormData();
    formData.set("id", "template-1");
    formData.set("expectedUpdatedAt", "2026-08-09T03:00:00.000Z");
    formData.set("body", "舊分頁但不可消失的內容 {{unsubscribe_url}}");

    const result = await upsertTemplateAction(initialMessageTemplateActionState, formData);

    expect(result).toEqual({
      status: "error",
      error: "conflict",
      draft: expect.objectContaining({ body: "舊分頁但不可消失的內容 {{unsubscribe_url}}" }),
      expectedUpdatedAt: currentUpdatedAt.toISOString(),
      version: 1,
    });
    expect(mocks.messageTemplateFindFirst).toHaveBeenCalledWith({
      where: { id: "template-1", vendorId: "vendor-1" },
      select: { updatedAt: true },
    });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("updates a reminder template and queues every linked live in the same transaction", async () => {
    const updatedAt = new Date("2026-08-09T03:00:00.000Z");
    mocks.messageTemplateUpdate.mockResolvedValue({
      id: "template-1",
      vendorId: "vendor-1",
      name: "開播提醒",
      channel: "email",
      trigger: "live_reminder",
      subject: "{{live_title}} 即將開始",
      body: "嗨 {{name}}，直播即將開始。\n{{unsubscribe_url}}",
      isActive: true,
      updatedAt,
    });
    mocks.liveFindMany.mockResolvedValue([{
      id: "live-1",
      title: "租戶限定直播",
      status: "scheduled",
      scheduledAt: new Date("2026-08-10T04:00:00.000Z"),
      liveReminderOffsetMinutes: 60,
    }]);
    const formData = templateFormData();
    formData.set("id", "template-1");
    formData.set("expectedUpdatedAt", "2026-08-09T02:00:00.000Z");

    await expect(upsertTemplateAction(initialMessageTemplateActionState, formData)).rejects.toThrow(
      "redirect:/messages/templates?notice=reminders_reconciling",
    );

    expect(mocks.liveFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", liveReminderTemplateId: "template-1" },
      select: { id: true, title: true, status: true, scheduledAt: true, liveReminderOffsetMinutes: true },
    });
    expect(mocks.queueLiveReminderReconciliation).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ liveId: "live-1", liveTitle: "租戶限定直播", template: expect.objectContaining({ updatedAt }) }),
    );
  });
});

describe("interaction role actions", () => {
  function interactionRoleFormData() {
    const formData = new FormData();
    formData.set("name", "  直播小編  ");
    formData.set("avatarUrl", "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=editor-purple");
    formData.set("label", "官方角色");
    formData.set("roleType", "official");
    formData.set("tone", "  親切、清楚  ");
    formData.set("isActive", "on");
    return formData;
  }

  it("normalizes, tenant-scopes, and audits a new interaction role", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    const formData = interactionRoleFormData();

    await expect(upsertInteractionRoleAction(formData)).rejects.toThrow("redirect:/interaction-roles");

    expect(mocks.interactionRoleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        name: "直播小編",
        label: "官方角色",
        roleType: "official",
        tone: "親切、清楚",
        isActive: true,
        isScheduled: false,
      }),
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-1",
      actorId: "manager-user-1",
      actorLabel: "admin",
      action: "interaction_role_created",
      targetId: "role-new",
      after: { roleType: "official", isActive: true, isScheduled: false, hasAvatar: true },
    }));
    const auditAfter = (mocks.writeAuditLog.mock.calls[0]?.[0] as { after?: Record<string, unknown> }).after;
    expect(auditAfter).not.toHaveProperty("name");
    expect(auditAfter).not.toHaveProperty("label");
    expect(auditAfter).not.toHaveProperty("tone");
    expect(auditAfter).not.toHaveProperty("avatarUrl");
    expect(auditAfter).not.toHaveProperty("avatarAssetId");
  });

  it("rejects a non-canonical preset without redirecting the state action", async () => {
    const formData = interactionRoleFormData();
    formData.set("avatarMode", "preset");
    formData.set("avatarUrl", "https://cdn.example.test/not-a-preset.svg");

    const result = await upsertInteractionRoleActionState({} as InteractionRoleActionState, formData);

    expect(result).toEqual(expect.objectContaining({
      status: "error",
      values: expect.objectContaining({ avatarUrl: "https://cdn.example.test/not-a-preset.svg", avatarMode: "preset" }),
    }));
    expect(mocks.interactionRoleCreate).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("rejects a legacy explicit preset with a non-canonical URL", async () => {
    const formData = interactionRoleFormData();
    formData.set("avatarMode", "preset");
    formData.set("avatarUrl", "https://cdn.example.test/not-a-preset.svg");

    await expect(upsertInteractionRoleAction(formData)).rejects.toThrow(
      "redirect:/interaction-roles/new?error=invalid_role",
    );

    expect(mocks.imageAssetFindFirst).not.toHaveBeenCalled();
    expect(mocks.interactionRoleCreate).not.toHaveBeenCalled();
    expect(mocks.interactionRoleUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects an unsupported custom upload phase before resolving an asset", async () => {
    const formData = interactionRoleFormData();
    formData.set("avatarMode", "custom");
    formData.set("avatarAssetId", "asset-1");
    formData.set("avatarUploadPhase", "uploading");

    const result = await upsertInteractionRoleActionState({} as InteractionRoleActionState, formData);

    expect(result.status).toBe("error");
    expect(mocks.imageAssetFindFirst).not.toHaveBeenCalled();
    expect(mocks.interactionRoleCreate).not.toHaveBeenCalled();
  });

  it("returns a state error for an uploading custom avatar without an asset", async () => {
    const formData = interactionRoleFormData();
    formData.set("avatarMode", "custom");
    formData.set("avatarUploadPhase", "uploading");
    formData.delete("avatarAssetId");
    formData.delete("avatarUrl");

    const result = await upsertInteractionRoleActionState({} as InteractionRoleActionState, formData);

    expect(result.status).toBe("error");
    expect(mocks.imageAssetFindFirst).not.toHaveBeenCalled();
    expect(mocks.interactionRoleCreate).not.toHaveBeenCalled();
    expect(mocks.interactionRoleUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns a state error for a successful custom upload without an asset or safe fallback", async () => {
    const formData = interactionRoleFormData();
    formData.set("avatarMode", "custom");
    formData.set("avatarUploadPhase", "success");
    formData.delete("avatarAssetId");
    formData.delete("avatarUrl");

    const result = await upsertInteractionRoleActionState({} as InteractionRoleActionState, formData);

    expect(result.status).toBe("error");
    expect(mocks.imageAssetFindFirst).not.toHaveBeenCalled();
    expect(mocks.interactionRoleCreate).not.toHaveBeenCalled();
    expect(mocks.interactionRoleUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("uses the tenant-ready asset publicUrl before the submitted URL", async () => {
    mocks.imageAssetFindFirst.mockResolvedValueOnce({ id: "asset-1", publicUrl: "https://cdn.example.test/ready-avatar.svg" });
    const formData = interactionRoleFormData();
    formData.set("avatarMode", "custom");
    formData.set("avatarAssetId", "asset-1");
    formData.set("avatarUploadPhase", "success");
    formData.set("avatarUrl", "javascript:alert(1)");

    await expect(upsertInteractionRoleActionState({} as InteractionRoleActionState, formData)).rejects.toThrow(
      "redirect:/interaction-roles",
    );

    expect(mocks.imageAssetFindFirst).toHaveBeenCalledWith({
      where: { id: "asset-1", vendorId: "vendor-1", status: "ready" },
      select: { id: true, publicUrl: true },
    });
    expect(mocks.interactionRoleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ avatarUrl: "https://cdn.example.test/ready-avatar.svg" }),
    });
  });

  it("returns a safe state error for a missing tenant asset and preserves no unsafe URL", async () => {
    mocks.imageAssetFindFirst.mockResolvedValueOnce(null);
    const formData = interactionRoleFormData();
    formData.set("avatarMode", "custom");
    formData.set("avatarAssetId", "asset-foreign");
    formData.set("avatarUploadPhase", "success");
    formData.set("avatarUrl", "javascript:alert(1)");

    const result = await upsertInteractionRoleActionState({} as InteractionRoleActionState, formData);

    expect(result).toEqual(expect.objectContaining({
      status: "error",
      values: expect.objectContaining({ avatarUrl: "", avatarAssetId: "asset-foreign" }),
    }));
    expect(mocks.interactionRoleCreate).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("rethrows infrastructure failures while resolving a custom asset", async () => {
    mocks.imageAssetFindFirst.mockRejectedValueOnce(new Error("image asset database unavailable"));
    const formData = interactionRoleFormData();
    formData.set("avatarMode", "custom");
    formData.set("avatarAssetId", "asset-1");
    formData.set("avatarUploadPhase", "success");

    await expect(upsertInteractionRoleActionState({} as InteractionRoleActionState, formData)).rejects.toThrow(
      "image asset database unavailable",
    );
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("allows a safe custom URL when no asset is submitted", async () => {
    const formData = interactionRoleFormData();
    formData.set("avatarMode", "custom");
    formData.set("avatarUrl", "https://cdn.example.test/custom-avatar.svg");

    await expect(upsertInteractionRoleActionState({} as InteractionRoleActionState, formData)).rejects.toThrow(
      "redirect:/interaction-roles",
    );

    expect(mocks.imageAssetFindFirst).not.toHaveBeenCalled();
    expect(mocks.interactionRoleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ avatarUrl: "https://cdn.example.test/custom-avatar.svg" }),
    });
  });

  it.each([
    ["unsupported role type", "roleType", "fake_viewer"],
    ["unsafe avatar", "avatarUrl", "javascript:alert(1)"],
    ["empty name", "name", ""],
  ])("rejects %s before persistence", async (_label, field, value) => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    const formData = interactionRoleFormData();
    formData.set(field, value);

    await expect(upsertInteractionRoleAction(formData)).rejects.toThrow(
      "redirect:/interaction-roles/new?error=invalid_role",
    );

    expect(mocks.interactionRoleCreate).not.toHaveBeenCalled();
    expect(mocks.interactionRoleUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("updates only a current-vendor role and records the resulting state", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    const formData = interactionRoleFormData();
    formData.set("id", "role-1");
    formData.delete("isActive");

    await expect(upsertInteractionRoleAction(formData)).rejects.toThrow("redirect:/interaction-roles");

    expect(mocks.interactionRoleUpdate).toHaveBeenCalledWith({
      where: { id: "role-1", vendorId: "vendor-1" },
      data: expect.objectContaining({ isActive: false }),
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "interaction_role_updated",
      targetId: "role-1",
    }));
  });

  it("round-trips an audience role with a scheduled marker on create", async () => {
    const formData = interactionRoleFormData();
    formData.set("roleType", "audience");
    formData.set("label", "一般觀眾");
    formData.set("isScheduled", "on");

    await expect(upsertInteractionRoleAction(formData)).rejects.toThrow("redirect:/interaction-roles");

    expect(mocks.interactionRoleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ roleType: "audience", isScheduled: true }),
    });
  });

  it("round-trips an audience role with a scheduled marker on update", async () => {
    const formData = interactionRoleFormData();
    formData.set("id", "role-1");
    formData.set("roleType", "audience");
    formData.set("isScheduled", "on");

    await expect(upsertInteractionRoleAction(formData)).rejects.toThrow("redirect:/interaction-roles");

    expect(mocks.interactionRoleUpdate).toHaveBeenCalledWith({
      where: { id: "role-1", vendorId: "vendor-1" },
      data: expect.objectContaining({ roleType: "audience", isScheduled: true }),
    });
  });

  it.each(["ai_host", "system_assistant", "support"])("rejects legacy role type %s on a new write", async (roleType) => {
    const formData = interactionRoleFormData();
    formData.set("roleType", roleType);

    await expect(upsertInteractionRoleAction(formData)).rejects.toThrow(
      "redirect:/interaction-roles/new?error=invalid_role",
    );

    expect(mocks.interactionRoleCreate).not.toHaveBeenCalled();
    expect(mocks.interactionRoleUpdate).not.toHaveBeenCalled();
  });

  it("retains the scheduled checkbox value when the state action rejects a role", async () => {
    const formData = interactionRoleFormData();
    formData.set("roleType", "legacy_role");
    formData.set("isScheduled", "on");

    const result = await upsertInteractionRoleActionState({} as InteractionRoleActionState, formData);

    expect(result).toEqual(expect.objectContaining({
      status: "error",
      values: expect.objectContaining({ roleType: "legacy_role", isScheduled: true }),
    }));
    expect(mocks.interactionRoleCreate).not.toHaveBeenCalled();
  });

  it("recovers when an edited role disappeared or belongs to another vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionRoleUpdate.mockRejectedValueOnce(Object.assign(new Error("missing role"), { code: "P2025" }));
    const formData = interactionRoleFormData();
    formData.set("id", "stale-role");

    await expect(upsertInteractionRoleAction(formData)).rejects.toThrow(
      "redirect:/interaction-roles/new?error=missing_role",
    );

    expect(mocks.interactionRoleUpdate).toHaveBeenCalledWith({
      where: { id: "stale-role", vendorId: "vendor-1" },
      data: expect.anything(),
    });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("tenant-scopes and audits deletion without exposing avatar data", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    const formData = new FormData();
    formData.set("id", "role-1");

    await expect(deleteInteractionRoleAction(formData)).rejects.toThrow("redirect:/interaction-roles/new");

    expect(mocks.interactionRoleDelete).toHaveBeenCalledWith({ where: { id: "role-1", vendorId: "vendor-1" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "interaction_role_deleted",
      targetId: "role-1",
      before: expect.not.objectContaining({ avatarUrl: expect.anything() }),
    }));
  });

  it("recovers when a role delete target disappeared or belongs to another vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionRoleDelete.mockRejectedValueOnce(Object.assign(new Error("missing role"), { code: "P2025" }));
    const formData = new FormData();
    formData.set("id", "stale-role");

    await expect(deleteInteractionRoleAction(formData)).rejects.toThrow(
      "redirect:/interaction-roles/new?error=missing_role",
    );

    expect(mocks.interactionRoleDelete).toHaveBeenCalledWith({ where: { id: "stale-role", vendorId: "vendor-1" } });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("importSystemRolesAction", () => {
  it("validates CSRF and the vendor, then imports only system roles that do not already exist", async () => {
    const formData = new FormData();
    const existingNames = ["開場 AI 主持人", "客服 Q&A 助手"];
    mocks.requireVendorManagerContext.mockResolvedValue({
      auth: { user: { id: "manager-9" }, member: { role: "admin" } },
      vendor: { id: "vendor-9" },
    });
    mocks.interactionRoleFindMany.mockResolvedValue(existingNames.map((name) => ({ name })));
    mocks.interactionRoleCreateMany.mockResolvedValueOnce({ count: 8 });

    await expect(importSystemRolesAction(formData)).rejects.toThrow("redirect:/interaction-roles");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(formData);
    expect(mocks.requireVendorManagerContext).toHaveBeenCalledOnce();
    expect(mocks.interactionRoleFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-9",
        name: { in: expect.arrayContaining(existingNames) },
      },
      select: { name: true },
    });
    expect(mocks.interactionRoleCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ name: "官方商品顧問", vendorId: "vendor-9", roleType: "official", isActive: true, isScheduled: true }),
        expect.objectContaining({ name: "優惠提醒助手", vendorId: "vendor-9", roleType: "official", isActive: true, isScheduled: true }),
        expect.objectContaining({ name: "保養知識顧問", vendorId: "vendor-9", roleType: "official", isActive: true, isScheduled: true }),
        expect.objectContaining({ name: "成交節奏助手", vendorId: "vendor-9", roleType: "official", isActive: true, isScheduled: true }),
        expect.objectContaining({ name: "直播小編", vendorId: "vendor-9", roleType: "official", isActive: true, isScheduled: true }),
        expect.objectContaining({ name: "提醒通知助手", vendorId: "vendor-9", roleType: "official", isActive: true, isScheduled: true }),
        expect.objectContaining({ name: "售後關懷助手", vendorId: "vendor-9", roleType: "official", isActive: true, isScheduled: true }),
        expect.objectContaining({ name: "限時活動主持", vendorId: "vendor-9", roleType: "official", isActive: true, isScheduled: true }),
      ]),
    });
    const [[{ data: createdRoles }]] = mocks.interactionRoleCreateMany.mock.calls;
    expect(createdRoles).toHaveLength(8);
    expect(createdRoles).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "開場 AI 主持人" }),
      expect.objectContaining({ name: "客服 Q&A 助手" }),
    ]));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/interaction-roles");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "interaction_role_library_imported",
      after: { requestedCount: 10, importedCount: 8 },
    }));
    const [[auditEntry]] = mocks.writeAuditLog.mock.calls;
    expect(auditEntry.after).toEqual({ requestedCount: 10, importedCount: 8 });
    expect(auditEntry.after).not.toHaveProperty("avatarUrl");
    expect(auditEntry.after).not.toHaveProperty("tone");
    expect(mocks.redirect).toHaveBeenCalledWith("/interaction-roles");
    expect(mocks.revalidatePath.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0],
    );
  });

  it("does not create duplicate roles when the entire system library already exists", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionRoleFindMany.mockResolvedValue([
      "開場 AI 主持人",
      "官方商品顧問",
      "優惠提醒助手",
      "客服 Q&A 助手",
      "保養知識顧問",
      "成交節奏助手",
      "直播小編",
      "提醒通知助手",
      "售後關懷助手",
      "限時活動主持",
    ].map((name) => ({ name })));

    await expect(importSystemRolesAction(new FormData())).rejects.toThrow("redirect:/interaction-roles");

    expect(mocks.interactionRoleCreateMany).toHaveBeenCalledWith({ data: [] });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/interaction-roles");
    expect(mocks.redirect).toHaveBeenCalledWith("/interaction-roles");
  });
});

describe("upsertInteractionScriptAction", () => {
  it("stores role and product references only after current-vendor verification", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionRoleFindMany.mockResolvedValue([scheduledInteractionRoleRecord()]);
    mocks.productFindMany.mockResolvedValue([{ id: "product-1" }]);
    const formData = interactionScriptFormData("10");
    formData.set("roleId", "role-1");
    formData.append("eventType", "product_spotlight");
    formData.append("triggerSec", "20");
    formData.append("eventTitle", "主打商品");
    formData.append("message", "");
    formData.append("roleId", "");
    formData.append("productId", "product-1");
    formData.append("ctaLabel", "");
    formData.append("ctaUrl", "");

    await expect(upsertInteractionScriptAction(formData)).rejects.toThrow("redirect:/interaction-scripts");

    expect(mocks.interactionRoleFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", id: { in: ["role-1"] }, isActive: true, isScheduled: true },
      select: {
        id: true,
        vendorId: true,
        name: true,
        avatarUrl: true,
        label: true,
        roleType: true,
        isActive: true,
        isScheduled: true,
      },
    });
    expect(mocks.productFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", id: { in: ["product-1"] }, isActive: true, fulfillmentTypeConfirmed: true },
      select: { id: true },
    });
    expect(mocks.interactionScriptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        events: {
          create: [
            expect.objectContaining({ eventType: "chat_message", roleId: "role-1", productId: null }),
            expect.objectContaining({ eventType: "product_spotlight", roleId: null, productId: "product-1" }),
          ],
        },
      }),
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "manager-user-1",
      actorLabel: "admin",
      action: "interaction_script_created",
      targetId: "script-new",
      after: { name: "測試留言組", status: "draft", eventCount: 2 },
    }));
  });

  it("rejects a role from another vendor before script persistence", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionRoleFindMany.mockResolvedValue([]);
    const formData = interactionScriptFormData("10");
    formData.set("roleId", "foreign-role");

    await expect(upsertInteractionScriptAction(formData)).rejects.toThrow(
      "redirect:/interaction-scripts/new?error=invalid_reference",
    );

    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("rejects a message without a role before any reference lookup", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    const formData = interactionScriptFormData("10");
    formData.set("roleId", "");

    await expect(upsertInteractionScriptAction(formData)).rejects.toThrow(
      "redirect:/interaction-scripts/new?error=invalid_event",
    );
    expect(mocks.interactionRoleFindMany).not.toHaveBeenCalled();
    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["non-scheduled", { isScheduled: false }],
    ["inactive", { isActive: false }],
    ["cross-tenant", { vendorId: "vendor-2" }],
    ["unknown legacy-invalid", { roleType: "legacy-invalid" }],
  ])("rejects a %s role before script persistence", async (_label, overrides) => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionRoleFindMany.mockResolvedValue([scheduledInteractionRoleRecord("role-1", overrides)]);
    const formData = interactionScriptFormData("10");

    await expect(upsertInteractionScriptAction(formData)).rejects.toThrow(
      "redirect:/interaction-scripts/new?error=invalid_reference",
    );
    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("rejects an unbounded event batch before database access", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    const formData = new FormData();
    for (let index = 0; index < 201; index += 1) {
      formData.append("eventType", "chat_message");
      formData.append("triggerSec", String(index));
    }

    await expect(upsertInteractionScriptAction(formData)).rejects.toThrow(
      "redirect:/interaction-scripts/new?error=invalid_event",
    );
    expect(mocks.interactionRoleFindMany).not.toHaveBeenCalled();
    expect(mocks.productFindMany).not.toHaveBeenCalled();
    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "//attacker.example.test/path"])(
    "rejects the unsafe CTA URL %s before saving the script",
    async (ctaUrl) => {
      mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });

      await expect(upsertInteractionScriptAction(interactionScriptFormData("10", ctaUrl))).rejects.toThrow(
        "redirect:/interaction-scripts/new?error=invalid_event",
      );

      expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["unsupported type", { eventType: "fake_viewer" }],
    ["missing product", { eventType: "product_spotlight", message: "", productId: "" }],
    ["missing CTA label", { eventType: "cta_switch", message: "", ctaLabel: "", ctaUrl: "https://example.test/deal" }],
    ["invalid status", { status: "published_without_review" }],
  ])("rejects %s before persistence", async (_label, overrides) => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    const formData = interactionScriptFormData("10");
    for (const [key, value] of Object.entries(overrides)) formData.set(key, value);

    await expect(upsertInteractionScriptAction(formData)).rejects.toThrow(
      "redirect:/interaction-scripts/new?error=invalid_event",
    );
    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["-1", "60:00", "00:60", "00:00:60", "not-a-time", "00:00:00:00"])(
    "rejects the invalid interaction timestamp %s before saving the script",
    async (triggerSec) => {
      mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });

      await expect(upsertInteractionScriptAction(interactionScriptFormData(triggerSec))).rejects.toThrow(
        "redirect:/interaction-scripts/new?error=invalid_event",
      );

      expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
      expect(mocks.interactionScriptUpdate).not.toHaveBeenCalled();
      expect(mocks.interactionEventCreate).not.toHaveBeenCalled();
      expect(mocks.interactionEventDeleteMany).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it("atomically replaces an existing script timeline and audits the published state", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    const formData = interactionScriptFormData("10");
    formData.set("id", "script-1");
    formData.set("status", "published");

    await expect(upsertInteractionScriptAction(formData)).rejects.toThrow("redirect:/interaction-scripts");

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.interactionScriptUpdate).toHaveBeenCalledWith({
      where: { id: "script-1", vendorId: "vendor-1" },
      data: { name: "測試留言組", description: null, status: "published" },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "interaction_script_updated",
      targetId: "script-1",
      after: { name: "測試留言組", status: "published", eventCount: 1 },
    }));
  });

  it("recovers when an edited script disappeared or belongs to another vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("missing script"), { code: "P2025" }));
    const formData = interactionScriptFormData("10");
    formData.set("id", "stale-script");

    await expect(upsertInteractionScriptAction(formData)).rejects.toThrow(
      "redirect:/interaction-scripts?error=missing_script",
    );

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.interactionScriptUpdate).not.toHaveBeenCalled();
    expect(mocks.interactionEventDeleteMany).not.toHaveBeenCalled();
    expect(mocks.interactionEventCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it.each(["P2002", "P2034"])("fails safely on a Prisma %s transaction conflict without auditing", async (code) => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("database conflict details"), { code }));

    await expect(upsertInteractionScriptAction(interactionScriptFormData("10"))).rejects.toThrow(
      "redirect:/interaction-scripts?error=conflict",
    );

    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
    expect(mocks.interactionScriptUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain("database conflict details");
  });
});

describe("interaction script lifecycle actions", () => {
  function scriptIdFormData(id = "script-1") {
    const formData = new FormData();
    formData.set("id", id);
    return formData;
  }

  const sourceScript = {
    id: "script-1",
    name: "測試留言組",
    description: "直播導購節奏",
    status: "published",
    events: [{
      id: "event-1",
      eventType: "chat_message",
      triggerSec: 10,
      title: "歡迎",
      message: "歡迎來到直播",
      productId: null,
      ctaLabel: null,
      ctaUrl: null,
      roleId: "role-1",
      metadata: null,
    }],
  };

  it("duplicates only a normalized current-vendor script as a draft and audits its lineage", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionScriptFindFirst.mockResolvedValue(sourceScript);
    mocks.interactionScriptCreate.mockResolvedValueOnce({ id: "script-copy" });

    await expect(duplicateInteractionScriptAction(scriptIdFormData())).rejects.toThrow("redirect:/interaction-scripts");

    expect(mocks.interactionScriptFindFirst).toHaveBeenCalledWith({
      where: { id: "script-1", vendorId: "vendor-1" },
      include: { events: { orderBy: { triggerSec: "asc" } } },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.interactionScriptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        name: "測試留言組 複本",
        status: "draft",
        events: { create: [expect.objectContaining({ eventType: "chat_message", message: "歡迎來到直播" })] },
      }),
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "interaction_script_duplicated",
      targetId: "script-copy",
      after: expect.objectContaining({ sourceScriptId: "script-1", status: "draft", eventCount: 1 }),
    }));
  });

  it.each([
    ["missing role", { roleId: null }, undefined, "invalid_event"],
    ["inactive role", { roleId: "role-1" }, { isActive: false }, "invalid_reference"],
    ["non-scheduled role", { roleId: "role-1" }, { isScheduled: false }, "invalid_reference"],
    ["unknown role type", { roleId: "role-1" }, { roleType: "unknown-role" }, "invalid_reference"],
    ["cross-tenant role", { roleId: "foreign-role" }, null, "invalid_reference"],
  ])("fails closed when a source script has a %s", async (_label, eventOverrides, roleOverrides, expectedError) => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionScriptFindFirst.mockResolvedValue({
      ...sourceScript,
      events: [{ ...sourceScript.events[0], ...eventOverrides }],
    });
    if (roleOverrides === null) {
      mocks.interactionRoleFindMany.mockResolvedValue([]);
    } else if (roleOverrides) {
      mocks.interactionRoleFindMany.mockResolvedValue([scheduledInteractionRoleRecord("role-1", roleOverrides)]);
    }

    await expect(duplicateInteractionScriptAction(scriptIdFormData())).rejects.toThrow(
      `redirect:/interaction-scripts?error=${expectedError}`,
    );

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails safely on a Prisma serialization conflict without auditing or exposing the raw error", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error("serialization detail"), { code: "P2034" }));

    await expect(duplicateInteractionScriptAction(scriptIdFormData())).rejects.toThrow(
      "redirect:/interaction-scripts?error=conflict",
    );

    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain("serialization detail");
  });

  it("does not duplicate a legacy script containing an unsafe CTA", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionScriptFindFirst.mockResolvedValue({
      ...sourceScript,
      events: [{
        ...sourceScript.events[0],
        eventType: "cta_switch",
        message: null,
        ctaLabel: "查看活動",
        ctaUrl: "javascript:alert(1)",
      }],
    });

    await expect(duplicateInteractionScriptAction(scriptIdFormData())).rejects.toThrow(
      "redirect:/interaction-scripts?error=invalid_event",
    );

    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails closed when a legacy script references another vendor's role", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionScriptFindFirst.mockResolvedValue({
      ...sourceScript,
      events: [{ ...sourceScript.events[0], roleId: "foreign-role" }],
    });
    mocks.interactionRoleFindMany.mockResolvedValue([]);

    await expect(duplicateInteractionScriptAction(scriptIdFormData())).rejects.toThrow(
      "redirect:/interaction-scripts?error=invalid_reference",
    );

    expect(mocks.interactionRoleFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", id: { in: ["foreign-role"] }, isActive: true, isScheduled: true },
      select: {
        id: true,
        vendorId: true,
        name: true,
        avatarUrl: true,
        label: true,
        roleType: true,
        isActive: true,
        isScheduled: true,
      },
    });
    expect(mocks.interactionScriptCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("tenant-scopes script deletion and records a sanitized audit snapshot", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });

    await expect(deleteInteractionScriptAction(scriptIdFormData())).rejects.toThrow("redirect:/interaction-scripts");

    expect(mocks.interactionScriptDelete).toHaveBeenCalledWith({ where: { id: "script-1", vendorId: "vendor-1" } });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "interaction_script_deleted",
      targetId: "script-1",
      before: { name: "測試留言組", status: "draft" },
    }));
  });

  it("recovers when a script delete target disappeared or belongs to another vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.interactionScriptDelete.mockRejectedValueOnce(Object.assign(new Error("missing script"), { code: "P2025" }));

    await expect(deleteInteractionScriptAction(scriptIdFormData("stale-script"))).rejects.toThrow(
      "redirect:/interaction-scripts?error=missing_script",
    );

    expect(mocks.interactionScriptDelete).toHaveBeenCalledWith({ where: { id: "stale-script", vendorId: "vendor-1" } });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("createPayoutBatchAction", () => {
  function payoutBatchFormData() {
    const formData = new FormData();
    formData.append("settlementIds", "settlement-1");
    return formData;
  }

  const eligibleSettlement = {
    id: "settlement-1",
    vendorId: "vendor-1",
    finalPayoutAmountCents: 8_000,
    vendor: {
      name: "Vendor One",
      paymentAccounts: [{
        mode: "platform",
        status: "active",
        bankAccountEncrypted: null,
        bankAccountLegacyName: "Vendor One",
        bankCodeLegacy: "001",
        bankAccountLegacyNumber: "test-fixture-account",
      }],
    },
  };

  it("atomically claims each eligible settlement before creating its payout item", async () => {
    mocks.settlementFindMany.mockResolvedValueOnce([eligibleSettlement]);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      payoutBatch: { create: mocks.payoutBatchCreate },
      settlement: { updateMany: mocks.settlementUpdateMany },
      payoutItem: { create: mocks.payoutItemCreate },
    }));

    await expect(createPayoutBatchAction(payoutBatchFormData())).rejects.toThrow(
      "redirect:/admin/billing/payouts",
    );

    expect(mocks.settlementUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "settlement-1",
        lockedAt: { not: null },
        payoutBatchId: null,
        finalPayoutAmountCents: { gt: 0 },
      },
      data: {
        payoutBatchId: "payout-batch-1",
        batchNumber: "PB-20260725-00001",
        status: "ready_for_payout",
        payoutDate: expect.any(Date),
      },
    });
    expect(mocks.payoutItemCreate).toHaveBeenCalledOnce();
    expect(mocks.payoutItemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bankAccountDisplayName: "V＊＊＊＊",
        bankCodeDisplay: "001",
        bankAccountDisplayNumber: "****ount",
        // WP-12 introduced versioned keyring envelopes; the isolated runner
        // uses the synthetic active key id rather than the retired v1 shape.
        bankAccountEncrypted: expect.stringMatching(/^v2\.synthetic\./),
      }),
    });
    expect(JSON.stringify(mocks.payoutItemCreate.mock.calls)).not.toContain(
      "test-fixture-account",
    );
    expect(mocks.settlementUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.payoutItemCreate.mock.invocationCallOrder[0]!,
    );
  });

  it("rolls back and reports a conflict when another batch wins the settlement claim", async () => {
    mocks.settlementFindMany.mockResolvedValueOnce([eligibleSettlement]);
    mocks.settlementUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      payoutBatch: { create: mocks.payoutBatchCreate },
      settlement: { updateMany: mocks.settlementUpdateMany },
      payoutItem: { create: mocks.payoutItemCreate },
    }));

    await expect(createPayoutBatchAction(payoutBatchFormData())).rejects.toThrow(
      "redirect:/admin/billing/payouts?error=conflict",
    );

    expect(mocks.payoutItemCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("updatePayoutItemStatusAction", () => {
  const payoutItem = {
    id: "payout-item-1",
    vendorId: "vendor-1",
    payoutBatchId: "batch-1",
    settlementId: "settlement-1",
    payoutAmountCents: 240000,
    status: "failed",
    payoutBatch: { id: "batch-1", status: "failed", executedAt: null },
  };

  it("rejects an unknown status before reading or writing payout data", async () => {
    await expect(updatePayoutItemStatusAction(payoutStatusFormData("arbitrary"))).rejects.toThrow(
      "redirect:/admin/billing/payouts?error=invalid_status",
    );
    expect(mocks.payoutItemFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a paid outcome without a human payout reference before reading or writing payout data", async () => {
    await expect(updatePayoutItemStatusAction(payoutStatusFormData("paid"))).rejects.toThrow(
      "redirect:/admin/billing/payouts?error=invalid_status",
    );
    expect(mocks.payoutItemFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("prevents a terminal paid item from moving backward", async () => {
    mocks.payoutItemFindUnique.mockResolvedValue({ ...payoutItem, status: "paid" });

    await expect(updatePayoutItemStatusAction(payoutStatusFormData("failed", "bank rejected"))).rejects.toThrow(
      "redirect:/admin/billing/payouts?error=invalid_transition",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("moves a failed item to retrying and updates its aggregate batch state", async () => {
    mocks.payoutItemFindUnique.mockResolvedValue(payoutItem);
    mocks.payoutItemUpdate.mockResolvedValue({ ...payoutItem, status: "retrying" });
    mocks.payoutItemFindMany.mockResolvedValue([
      { id: "payout-item-1", status: "failed" },
      { id: "payout-item-2", status: "paid" },
    ]);
    mocks.payoutBatchUpdate.mockResolvedValue({ id: "batch-1", status: "retrying" });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      payoutItem: { update: mocks.payoutItemUpdate, findMany: mocks.payoutItemFindMany },
      payoutBatch: { update: mocks.payoutBatchUpdate },
      settlement: { update: mocks.settlementUpsert },
    }));

    await expect(updatePayoutItemStatusAction(payoutStatusFormData("retrying"))).rejects.toThrow(
      "redirect:/admin/billing/payouts",
    );

    expect(mocks.payoutItemUpdate).toHaveBeenCalledWith({
      where: { id: "payout-item-1", status: "failed" },
      data: {
        status: "retrying",
        failReason: null,
        outcomeReference: null,
        retriedAt: expect.any(Date),
        retryCount: { increment: 1 },
      },
    });
    expect(mocks.payoutBatchUpdate).toHaveBeenCalledWith({
      where: { id: "batch-1" },
      data: { status: "retrying", executedAt: null },
    });
  });

  it("settles the vendor without completing merchant-owned affiliate payouts", async () => {
    const retryingItem = {
      ...payoutItem,
      status: "retrying",
      payoutBatch: { id: "batch-1", status: "retrying", executedAt: null },
    };
    mocks.payoutItemFindUnique.mockResolvedValue(retryingItem);
    mocks.payoutItemUpdate.mockResolvedValue({ ...retryingItem, status: "paid" });
    mocks.payoutItemFindMany.mockResolvedValue([{ id: "payout-item-1", status: "retrying" }]);
    mocks.payoutBatchUpdate.mockResolvedValue({ id: "batch-1", status: "completed" });
    mocks.settlementUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      payoutItem: { update: mocks.payoutItemUpdate, findMany: mocks.payoutItemFindMany },
      payoutBatch: { update: mocks.payoutBatchUpdate },
      settlement: { updateMany: mocks.settlementUpdateMany },
    }));

    await expect(updatePayoutItemStatusAction(payoutStatusFormData("paid", undefined, "manual-bank-ref-2026-07"))).rejects.toThrow(
      "redirect:/admin/billing/payouts",
    );

    expect(mocks.payoutItemUpdate).toHaveBeenCalledWith({
      where: { id: "payout-item-1", status: "retrying" },
      data: {
        status: "paid",
        failReason: null,
        outcomeReference: "manual-bank-ref-2026-07",
        paidAt: expect.any(Date),
      },
    });

    expect(mocks.settlementUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "settlement-1",
        vendorId: "vendor-1",
        payoutBatchId: "batch-1",
        finalPayoutAmountCents: 240000,
        status: "ready_for_payout",
      },
      data: { status: "paid", paidAt: expect.any(Date) },
    });
    expect(mocks.affiliateCommissionUpdateMany).not.toHaveBeenCalled();
  });

  it("rolls back and fails closed when the payout item no longer matches an eligible settlement", async () => {
    const retryingItem = {
      ...payoutItem,
      status: "retrying",
      payoutBatch: { id: "batch-1", status: "retrying", executedAt: null },
    };
    mocks.payoutItemFindUnique.mockResolvedValue(retryingItem);
    mocks.payoutItemUpdate.mockResolvedValue({ ...retryingItem, status: "paid" });
    mocks.payoutItemFindMany.mockResolvedValue([{ id: "payout-item-1", status: "retrying" }]);
    mocks.payoutBatchUpdate.mockResolvedValue({ id: "batch-1", status: "completed" });
    mocks.settlementUpdateMany.mockResolvedValue({ count: 0 });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      payoutItem: { update: mocks.payoutItemUpdate, findMany: mocks.payoutItemFindMany },
      payoutBatch: { update: mocks.payoutBatchUpdate },
      settlement: { updateMany: mocks.settlementUpdateMany },
    }));

    await expect(updatePayoutItemStatusAction(payoutStatusFormData("paid", undefined, "manual-bank-ref-2026-07"))).rejects.toThrow(
      "redirect:/admin/billing/payouts?error=invalid_transition",
    );
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails closed when another operator changes the item concurrently", async () => {
    mocks.payoutItemFindUnique.mockResolvedValue(payoutItem);
    mocks.transaction.mockRejectedValue({ code: "P2025" });

    await expect(updatePayoutItemStatusAction(payoutStatusFormData("retrying"))).rejects.toThrow(
      "redirect:/admin/billing/payouts?error=invalid_transition",
    );
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("markPayoutBatchExportedAction", () => {
  it("refuses to move a completed batch back to exported", async () => {
    mocks.payoutBatchFindUnique.mockResolvedValue({ id: "batch-1", status: "completed" });

    await expect(markPayoutBatchExportedAction(payoutBatchFormData())).rejects.toThrow(
      "redirect:/admin/billing/payouts?error=invalid_transition",
    );

    expect(mocks.payoutBatchUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("uses a conditional write so concurrent state changes fail closed", async () => {
    mocks.payoutBatchFindUnique.mockResolvedValue({ id: "batch-1", status: "draft", exportedAt: null });
    mocks.payoutBatchUpdateMany.mockResolvedValue({ count: 0 });

    await expect(markPayoutBatchExportedAction(payoutBatchFormData())).rejects.toThrow(
      "redirect:/admin/billing/payouts?error=invalid_transition",
    );

    expect(mocks.payoutBatchUpdateMany).toHaveBeenCalledWith({
      where: { id: "batch-1", status: "draft" },
      data: { status: "exported", exportedAt: expect.any(Date) },
    });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("marks a draft batch exported and records the transition", async () => {
    const before = { id: "batch-1", status: "draft", exportedAt: null };
    mocks.payoutBatchFindUnique.mockResolvedValue(before);
    mocks.payoutBatchUpdateMany.mockResolvedValue({ count: 1 });

    await expect(markPayoutBatchExportedAction(payoutBatchFormData())).rejects.toThrow(
      "redirect:/admin/billing/payouts",
    );

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "export_payout_batch",
      before,
      after: expect.objectContaining({ status: "exported", exportedAt: expect.any(Date) }),
    }));
  });
});

describe("unbindInteractionScriptFromLiveAction", () => {
  it("unbinds a currently associated live owned by the current vendor and revalidates affected pages", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.liveUpdateMany.mockResolvedValue({ count: 1 });

    await unbindInteractionScriptFromLiveAction(unbindInteractionScriptFormData());

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(expect.any(FormData));
    expect(mocks.liveUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "live-1",
        vendorId: "vendor-1",
        interactionScriptId: "script-1",
        interactionScript: { is: { id: "script-1", vendorId: "vendor-1" } },
      },
      data: { interactionScriptId: null },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/interaction-scripts");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/interaction-scripts/script-1/edit");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/lives");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/lives/live-1/edit");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "interaction_script_unbound_from_live",
      targetId: "live-1",
      before: { interactionScriptId: "script-1" },
      after: { interactionScriptId: null },
    }));
  });

  it("rejects a live that is not owned by the current vendor", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.liveUpdateMany.mockResolvedValue({ count: 0 });

    await expect(unbindInteractionScriptFromLiveAction(unbindInteractionScriptFormData("live-from-vendor-2"))).rejects.toThrow(
      "直播不存在或未綁定此互動腳本。",
    );

    expect(mocks.liveUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "live-from-vendor-2", vendorId: "vendor-1" }),
    }));
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a live that is not bound to the requested interaction script", async () => {
    mocks.requireVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.liveUpdateMany.mockResolvedValue({ count: 0 });

    await expect(unbindInteractionScriptFromLiveAction(unbindInteractionScriptFormData("live-1", "different-script"))).rejects.toThrow(
      "直播不存在或未綁定此互動腳本。",
    );

    expect(mocks.liveUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ interactionScriptId: "different-script" }),
    }));
  });
});

describe("generateSettlementAction", () => {
  it("rejects an invalid settlement month before database access or side effects", async () => {
    await expect(generateSettlementAction(settlementFormData("2026-13"))).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=missing",
    );

    expect(mocks.vendorFindUnique).not.toHaveBeenCalled();
    expect(mocks.settlementFindUnique).not.toHaveBeenCalled();
    expect(mocks.calculateSettlement).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.settlementUpsert).not.toHaveBeenCalled();
    expect(mocks.invoiceUpsert).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("generates a settlement and invoice for a valid settlement month", async () => {
    const settlement = { id: "settlement-1" };
    mocks.generateSettlementForVendor.mockResolvedValueOnce({
      settlement,
      existingSettlement: null,
      calculation: { payoutableAmountCents: 8_000 },
      invoice: { id: "invoice-1", monthKey: "2026-12" },
    });

    await expect(generateSettlementAction(settlementFormData("2026-12"))).rejects.toThrow(
      "redirect:/admin/billing/settlements",
    );

    expect(mocks.generateSettlementForVendor).toHaveBeenCalledWith("vendor-1", "2026-12");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "generate_settlement",
      targetId: settlement.id,
    }));
  });

  it("fails closed instead of overwriting a paid invoice when recalculation changes its amount", async () => {
    mocks.generateSettlementForVendor.mockRejectedValueOnce(
      new BillingCycleError("terminal_invoice_amount_conflict"),
    );

    await expect(generateSettlementAction(settlementFormData("2026-12"))).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=invoice_conflict",
    );

    expect(mocks.generateSettlementForVendor).toHaveBeenCalledWith("vendor-1", "2026-12");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("refundPaymentTransactionAction", () => {
  it("uses one recoverable PayUni path: reserve pending, refund provider, then mark processed", async () => {
    const payUniTransaction = { ...transaction, providerName: "payuni", providerTradeNo: "trade-123" };
    const providerRefund = vi.fn().mockResolvedValue({ providerEventId: "refund-456" });
    mocks.findUnique.mockResolvedValue(payUniTransaction);
    mocks.getPaymentProvider.mockReturnValue({ refundPayment: providerRefund });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "pending", paymentTransactionId: transaction.id }),
    });
    expect(providerRefund).toHaveBeenCalledWith(expect.objectContaining({
      transaction: payUniTransaction,
      refundAmountCents: 4_000,
      requestId: expect.stringMatching(/^[a-f0-9]{32}$/),
    }));
    expect(mocks.refundRecordUpdate).toHaveBeenCalledWith({
      where: {
        id: "refund-1",
        status: "pending",
        providerEventId: expect.stringMatching(/^request:[a-f0-9]{32}$/),
      },
      data: { status: "processed", providerEventId: "refund-456" },
    });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledWith({
      where: { id: transaction.id },
      data: expect.objectContaining({ status: "refunded", refundedAmountCents: 10_000 }),
    });
  });

  it("releases the reserved PayUni refund only for a pre-provider request contract failure", async () => {
    const payUniTransaction = { ...transaction, providerName: "payuni", providerTradeNo: "trade-123" };
    mocks.findUnique.mockResolvedValue(payUniTransaction);
    mocks.getPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockRejectedValue(new RefundProviderError("request_contract")) });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.refundRecordUpdate).toHaveBeenCalledWith({
      where: {
        id: "refund-1",
        status: "pending",
        providerEventId: expect.stringMatching(/^request:[a-f0-9]{32}$/),
      },
      data: { status: "failed" },
    });
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["network", new RefundProviderError("network")],
    ["unverified provider response", new RefundProviderError("provider_response")],
    ["unexpected adapter failure", new Error("synthetic provider failure")],
  ])("keeps an ambiguous PayUni %s outcome pending for query reconciliation", async (_label, providerError) => {
    const payUniTransaction = { ...transaction, providerName: "payuni", providerTradeNo: "trade-123" };
    mocks.findUnique.mockResolvedValue(payUniTransaction);
    mocks.getPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockRejectedValue(providerError) });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund_reconciliation_required",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "pending", paymentTransactionId: transaction.id }),
    });
    expect(mocks.refundRecordUpdate).toHaveBeenCalledWith({
      where: {
        id: "refund-1",
        status: "pending",
        providerEventId: expect.stringMatching(/^request:[a-f0-9]{32}$/),
      },
      data: { providerEventId: expect.stringMatching(/^ambiguous:[a-f0-9]{32}$/) },
    });
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
  });

  it("fails closed when a late provider completion no longer owns the pending reservation", async () => {
    const payUniTransaction = { ...transaction, providerName: "payuni", providerTradeNo: "trade-123" };
    mocks.findUnique.mockResolvedValue(payUniTransaction);
    mocks.getPaymentProvider.mockReturnValue({ refundPayment: vi.fn().mockResolvedValue({ providerEventId: "refund-456" }) });
    mocks.refundRecordUpdate.mockRejectedValueOnce(new Error("reservation state changed"));

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
  });

  it("retries only local PayUni refund completion after a serialization conflict", async () => {
    const payUniTransaction = { ...transaction, providerName: "payuni", providerTradeNo: "trade-123" };
    const providerRefund = vi.fn().mockResolvedValue({ providerEventId: "refund-456" });
    let transactionAttempts = 0;
    mocks.findUnique.mockResolvedValue(payUniTransaction);
    mocks.getPaymentProvider.mockReturnValue({ refundPayment: providerRefund });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionAttempts += 1;
      const result = await callback({
        paymentTransaction: {
          findUnique: mocks.findUnique,
          update: mocks.paymentTransactionUpdate,
        },
        refundRecord: {
          aggregate: mocks.refundRecordAggregate,
          create: mocks.refundRecordCreate,
          update: mocks.refundRecordUpdate,
        },
        affiliateCommission: {
          findFirst: mocks.affiliateCommissionFindFirst,
          findMany: mocks.affiliateCommissionFindMany,
          findUnique: mocks.affiliateCommissionFindUnique,
          updateMany: mocks.affiliateCommissionUpdateMany,
        },
        affiliateCommissionLedgerEntry: {
          aggregate: mocks.affiliateCommissionLedgerEntryAggregate,
          findUnique: mocks.affiliateCommissionLedgerEntryFindUnique,
          create: mocks.affiliateCommissionLedgerEntryCreate,
        },
        affiliatePayout: {
          findFirst: mocks.affiliatePayoutFindFirst,
          findUnique: mocks.affiliatePayoutFindUnique,
          create: mocks.affiliatePayoutCreate,
          updateMany: mocks.affiliatePayoutUpdateMany,
        },
        courseCommissionAllocation: {
          findMany: mocks.courseCommissionAllocationFindMany,
          findUnique: mocks.courseCommissionAllocationFindUnique,
        },
        courseCommissionLedgerEntry: {
          aggregate: mocks.courseCommissionLedgerEntryAggregate,
          findUnique: mocks.courseCommissionLedgerEntryFindUnique,
          create: mocks.courseCommissionLedgerEntryCreate,
        },
        coursePayout: {
          findUnique: mocks.coursePayoutFindUnique,
          findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
          create: mocks.coursePayoutCreate,
          updateMany: mocks.coursePayoutUpdateMany,
        },
      });
      if (transactionAttempts === 2) throw Object.assign(new Error("serialization failure"), { code: "P2034" });
      return result;
    });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(transactionAttempts).toBe(3);
    expect(providerRefund).toHaveBeenCalledTimes(1);
    expect(mocks.refundRecordUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-refundable PayUni transaction before validating blank refund fields, creating a reservation, or calling the provider", async () => {
    const nonRefundable = { ...transaction, status: "refunded", providerName: "payuni", providerTradeNo: "trade-123" };
    const providerRefund = vi.fn();
    mocks.findUnique.mockResolvedValue(nonRefundable);
    mocks.getPaymentProvider.mockReturnValue({ refundPayment: providerRefund });

    await expect(refundPaymentTransactionAction(refundFormData(""))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund_already_processed",
    );

    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(providerRefund).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid settlement month without creating a refund, updating the transaction, or writing an audit log", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("1", "0", "0", "2026-13"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("writes a valid settlement month to the RefundRecord", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("1", "0", "0", "2026-12"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ monthKey: "2026-12" }),
    });
  });

  it("rejects a refund that exceeds the remaining refundable amount without writing records or updating the transaction", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("40.01"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: transaction.id } });
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("records a refund equal to the remaining refundable amount and marks the transaction refunded", async () => {
    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: {
        vendorId: transaction.vendorId,
        paymentTransactionId: transaction.id,
        monthKey: "2026-07",
        refundAmountCents: 4_000,
        gatewayFeeRefundCents: 0,
        platformFeeRefundCents: 0,
        reason: null,
      },
    });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalledWith({
      where: { id: transaction.id },
      data: expect.objectContaining({
        status: "refunded",
        refundedAmountCents: transaction.grossAmountCents,
      }),
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it.each([
    ["gateway", "-0.01", "0"],
    ["platform", "0", "-0.01"],
  ])("rejects a refund with a negative %s fee without writing records or updating the transaction", async (_feeType, gatewayFeeRefund, platformFeeRefund) => {
    await expect(refundPaymentTransactionAction(refundFormData("1", gatewayFeeRefund, platformFeeRefund))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.refundRecordAggregate).not.toHaveBeenCalled();
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a fee refund that exceeds the remaining fee balance without writing records or updating the transaction", async () => {
    mocks.refundRecordAggregate.mockResolvedValue({
      _sum: { gatewayFeeRefundCents: 600, platformFeeRefundCents: 100 },
    });

    await expect(refundPaymentTransactionAction(refundFormData("1", "4.01", "0"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(mocks.refundRecordAggregate).toHaveBeenCalledWith({
      where: { paymentTransactionId: transaction.id, status: "processed" },
      _sum: { gatewayFeeRefundCents: true, platformFeeRefundCents: true },
    });
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
    expect(mocks.paymentTransactionUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("records fee refunds that exactly equal the remaining fee balances", async () => {
    mocks.refundRecordAggregate.mockResolvedValue({
      _sum: { gatewayFeeRefundCents: 600, platformFeeRefundCents: 100 },
    });

    await expect(refundPaymentTransactionAction(refundFormData("1", "4", "3"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.refundRecordCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        gatewayFeeRefundCents: 400,
        platformFeeRefundCents: 300,
      }),
    });
    expect(mocks.paymentTransactionUpdate).toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalled();
  });

  it("reverses affiliate and course payable ledgers inside the local refund transaction", async () => {
    const accountableTransaction = {
      ...transaction,
      providerName: "local",
      orderNumber: "ORDER-REFUND-1",
    };
    mocks.findUnique.mockResolvedValue(accountableTransaction);
    mocks.affiliateCommissionFindFirst.mockResolvedValue({
      id: "commission-1",
      vendorId: "vendor-1",
      affiliateId: null,
      monthKey: "2026-07",
      status: "pending",
      commissionRateBps: 1_000,
    });
    mocks.affiliateCommissionLedgerEntryAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 1_000 } })
      .mockResolvedValueOnce({ _sum: { amountCents: 1_000 } })
      .mockResolvedValueOnce({ _sum: { amountCents: 0 } });
    mocks.courseCommissionAllocationFindMany.mockResolvedValue([{
      id: "course-allocation-1",
      recipientRole: "content_owner",
      shareBps: 10_000,
    }]);
    mocks.courseCommissionAllocationFindUnique.mockResolvedValue({ recipientMembershipId: "membership-f" });
    mocks.courseCommissionLedgerEntryAggregate.mockResolvedValue({ _sum: { amountCents: 4_000 } });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.affiliateCommissionLedgerEntryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affiliateCommissionId: "commission-1",
        entryType: "refund",
        amountCents: -1_000,
        eventIdentity: "refund:refund-1",
      }),
    });
    expect(mocks.courseCommissionLedgerEntryCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        courseCommissionAllocationId: "course-allocation-1",
        entryType: "refund",
        amountCents: -4_000,
        eventIdentity: "refund:refund-1",
      }),
    });
  });

  it("rolls back all writes and returns the refund error when PostgreSQL rejects a stale serializable transaction", async () => {
    const attemptedRefundRecords: unknown[] = [];
    const attemptedPaymentTransactions: unknown[] = [];
    const committedRefundRecords: unknown[] = [];
    const committedPaymentTransactions: unknown[] = [];

    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const stagedRefundRecords: unknown[] = [];
      const stagedPaymentTransactions: unknown[] = [];
      await callback({
        paymentTransaction: {
          findUnique: mocks.findUnique,
          update: async (args: unknown) => {
            attemptedPaymentTransactions.push(args);
            stagedPaymentTransactions.push(args);
            return { ...transaction, refundedAmountCents: 10_000, status: "refunded" };
          },
        },
        refundRecord: {
          aggregate: mocks.refundRecordAggregate,
          create: async (args: unknown) => {
            attemptedRefundRecords.push(args);
            stagedRefundRecords.push(args);
            return { id: "refund-staged" };
          },
        },
        affiliateCommission: {
          findFirst: mocks.affiliateCommissionFindFirst,
          findMany: mocks.affiliateCommissionFindMany,
          findUnique: mocks.affiliateCommissionFindUnique,
          updateMany: mocks.affiliateCommissionUpdateMany,
        },
        affiliateCommissionLedgerEntry: {
          aggregate: mocks.affiliateCommissionLedgerEntryAggregate,
          findUnique: mocks.affiliateCommissionLedgerEntryFindUnique,
          create: mocks.affiliateCommissionLedgerEntryCreate,
        },
        affiliatePayout: {
          findFirst: mocks.affiliatePayoutFindFirst,
          findUnique: mocks.affiliatePayoutFindUnique,
          create: mocks.affiliatePayoutCreate,
          updateMany: mocks.affiliatePayoutUpdateMany,
        },
        courseCommissionAllocation: {
          findMany: mocks.courseCommissionAllocationFindMany,
          findUnique: mocks.courseCommissionAllocationFindUnique,
        },
        courseCommissionLedgerEntry: {
          aggregate: mocks.courseCommissionLedgerEntryAggregate,
          findUnique: mocks.courseCommissionLedgerEntryFindUnique,
          create: mocks.courseCommissionLedgerEntryCreate,
        },
        coursePayout: {
          findUnique: mocks.coursePayoutFindUnique,
          findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
          create: mocks.coursePayoutCreate,
          updateMany: mocks.coursePayoutUpdateMany,
        },
      });

      // PostgreSQL detects that the transaction read stale data at commit time.
      const shouldAbortAtCommit = () => true;
      if (shouldAbortAtCommit()) {
        throw Object.assign(new Error("serialization failure"), { code: "P2034" });
      }

      // A successful transaction would commit staged writes here.
      committedRefundRecords.push(...stagedRefundRecords);
      committedPaymentTransactions.push(...stagedPaymentTransactions);
    });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );

    expect(attemptedRefundRecords).toHaveLength(3);
    expect(attemptedPaymentTransactions).toHaveLength(3);
    expect(committedRefundRecords).toEqual([]);
    expect(committedPaymentTransactions).toEqual([]);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("retries a P2034 serialization conflict and writes an audit log only after the successful commit", async () => {
    const attemptedRefundRecords: unknown[] = [];
    const attemptedPaymentTransactions: unknown[] = [];
    const committedRefundRecords: unknown[] = [];
    const committedPaymentTransactions: unknown[] = [];
    const events: string[] = [];
    let transactionAttempts = 0;

    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionAttempts += 1;
      const stagedRefundRecords: unknown[] = [];
      const stagedPaymentTransactions: unknown[] = [];
      const result = await callback({
        paymentTransaction: {
          findUnique: mocks.findUnique,
          update: async (args: unknown) => {
            attemptedPaymentTransactions.push(args);
            stagedPaymentTransactions.push(args);
            return { ...transaction, refundedAmountCents: 10_000, status: "refunded" };
          },
        },
        refundRecord: {
          aggregate: mocks.refundRecordAggregate,
          create: async (args: unknown) => {
            attemptedRefundRecords.push(args);
            stagedRefundRecords.push(args);
            return { id: "refund-staged" };
          },
        },
        affiliateCommission: {
          findFirst: mocks.affiliateCommissionFindFirst,
          findMany: mocks.affiliateCommissionFindMany,
          findUnique: mocks.affiliateCommissionFindUnique,
          updateMany: mocks.affiliateCommissionUpdateMany,
        },
        affiliateCommissionLedgerEntry: {
          aggregate: mocks.affiliateCommissionLedgerEntryAggregate,
          findUnique: mocks.affiliateCommissionLedgerEntryFindUnique,
          create: mocks.affiliateCommissionLedgerEntryCreate,
        },
        affiliatePayout: {
          findFirst: mocks.affiliatePayoutFindFirst,
          findUnique: mocks.affiliatePayoutFindUnique,
          create: mocks.affiliatePayoutCreate,
          updateMany: mocks.affiliatePayoutUpdateMany,
        },
        courseCommissionAllocation: {
          findMany: mocks.courseCommissionAllocationFindMany,
          findUnique: mocks.courseCommissionAllocationFindUnique,
        },
        courseCommissionLedgerEntry: {
          aggregate: mocks.courseCommissionLedgerEntryAggregate,
          findUnique: mocks.courseCommissionLedgerEntryFindUnique,
          create: mocks.courseCommissionLedgerEntryCreate,
        },
        coursePayout: {
          findUnique: mocks.coursePayoutFindUnique,
          findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
          create: mocks.coursePayoutCreate,
          updateMany: mocks.coursePayoutUpdateMany,
        },
      });

      if (transactionAttempts === 1) {
        throw Object.assign(new Error("serialization failure"), { code: "P2034" });
      }

      committedRefundRecords.push(...stagedRefundRecords);
      committedPaymentTransactions.push(...stagedPaymentTransactions);
      events.push("committed");
      return result;
    });
    mocks.writeAuditLog.mockImplementation(async () => {
      events.push("audit");
    });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard",
    );

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(attemptedRefundRecords).toHaveLength(2);
    expect(attemptedPaymentTransactions).toHaveLength(2);
    expect(committedRefundRecords).toHaveLength(1);
    expect(committedPaymentTransactions).toHaveLength(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["committed", "audit"]);
  });
});

describe("COV-04 login success attribution", () => {
  it("creates a vendor session, clears the legacy cookie, audits success, and redirects to the dashboard", async () => {
    const cookieStore = { delete: vi.fn(), set: vi.fn() };
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.authenticateUser.mockResolvedValue({
      user: { id: "user-1", email: "member@example.com", platformRole: "user", mfaFactor: null },
      vendor: { id: "vendor-1" },
      member: { role: "owner" },
      isPlatformAdmin: false,
    });

    await expect(loginAction(loginFormData())).rejects.toThrow("redirect:/dashboard");

    expect(mocks.createUserSession).toHaveBeenCalledWith({
      userId: "user-1",
      vendorId: "vendor-1",
      ipAddress: "203.0.113.10",
      userAgent: "CelebrateDeal test",
    });
    expect(cookieStore.set.mock.calls[0]?.slice(0, 2)).toEqual([
      "celebrate_session",
      "test-fixture-session-token",
    ]);
    expect(cookieStore.delete).toHaveBeenCalledWith("celebrate_vendor_id");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "login_success",
      actorId: "user-1",
      vendorId: "vendor-1",
    }));
  });

  it("routes a platform administrator without MFA to setup and preserves the success audit", async () => {
    mocks.authenticateUser.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com", platformRole: "platform_admin", mfaFactor: null },
      vendor: null,
      member: null,
      isPlatformAdmin: true,
    });

    await expect(loginAction(loginFormData("admin@example.com"))).rejects.toThrow("redirect:/mfa/setup");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "login_success",
      actorLabel: "platform_admin",
      targetId: "admin-1",
    }));
  });

  it("routes a platform administrator with MFA to the verification challenge", async () => {
    mocks.authenticateUser.mockResolvedValue({
      user: {
        id: "admin-1",
        email: "admin@example.com",
        platformRole: "platform_admin",
        mfaFactor: { id: "factor-1" },
      },
      vendor: null,
      member: null,
      isPlatformAdmin: true,
    });

    await expect(loginAction(loginFormData("admin@example.com"))).rejects.toThrow(
      "redirect:/mfa/verify?next=%2Fadmin%2Fbilling%2Fdashboard",
    );
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "login_success",
      actorLabel: "platform_admin",
    }));
  });
});

describe("FIN-01 payout account selection boundary", () => {
  it("prefers a platform account over an earlier BYO account and persists only a masked display", async () => {
    mocks.settlementFindMany.mockResolvedValueOnce([{
      id: "settlement-fin-01",
      vendorId: "vendor-1",
      finalPayoutAmountCents: 12_000,
      vendor: {
        name: "Finance Vendor",
        paymentAccounts: [
          {
            mode: "byo",
            status: "active",
            bankAccountEncrypted: null,
            bankAccountLegacyName: "BYO Account",
            bankCodeLegacy: "999",
            bankAccountLegacyNumber: "byo-raw-account",
          },
          {
            mode: "platform",
            status: "active",
            bankAccountEncrypted: null,
            bankAccountLegacyName: "Platform Account",
            bankCodeLegacy: "700",
            bankAccountLegacyNumber: "platform-raw-account",
          },
        ],
      },
    }]);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      payoutBatch: { create: mocks.payoutBatchCreate },
      settlement: { updateMany: mocks.settlementUpdateMany },
      payoutItem: { create: mocks.payoutItemCreate },
    }));

    const formData = new FormData();
    formData.append("settlementIds", "settlement-fin-01");

    await expect(createPayoutBatchAction(formData)).rejects.toThrow(
      "redirect:/admin/billing/payouts",
    );

    expect(mocks.payoutItemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bankCodeDisplay: "700",
        bankAccountDisplayNumber: "****ount",
      }),
    });
    expect(JSON.stringify(mocks.payoutItemCreate.mock.calls)).not.toContain("platform-raw-account");
    expect(JSON.stringify(mocks.payoutItemCreate.mock.calls)).not.toContain("byo-raw-account");
  });
});

describe("FIN-02 settlement mutation invariants", () => {
  const updatedAt = new Date("2026-08-05T08:00:00.000Z");
  const settlement = {
    id: "settlement-fin-02",
    vendorId: "vendor-1",
    monthKey: "2026-08",
    payoutableAmountCents: 10_000,
    adjustmentAmountCents: 0,
    adjustmentReason: null,
    finalPayoutAmountCents: 10_000,
    status: "draft",
    lockedAt: null,
    updatedAt,
  };

  function adjustmentFormData(adjustmentAmount: string) {
    const formData = new FormData();
    formData.set("id", settlement.id);
    formData.set("adjustmentAmount", adjustmentAmount);
    formData.set("adjustmentReason", "synthetic finance review");
    return formData;
  }

  function lockFormData() {
    const formData = new FormData();
    formData.set("id", settlement.id);
    return formData;
  }

  it("rejects a negative generated payout before settlement or invoice writes", async () => {
    mocks.generateSettlementForVendor.mockRejectedValueOnce(new BillingCycleError("negative_payout"));

    await expect(generateSettlementAction(settlementFormData("2026-08"))).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=negative_payout",
    );

    expect(mocks.generateSettlementForVendor).toHaveBeenCalledWith("vendor-1", "2026-08");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails a settlement regeneration when its optimistic conditional write loses", async () => {
    mocks.generateSettlementForVendor.mockRejectedValueOnce(new BillingCycleError("conflict"));

    await expect(generateSettlementAction(settlementFormData("2026-08"))).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=conflict",
    );

    expect(mocks.generateSettlementForVendor).toHaveBeenCalledWith("vendor-1", "2026-08");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("classifies a concurrent first-generation unique conflict without auditing success", async () => {
    mocks.generateSettlementForVendor.mockRejectedValueOnce({ code: "P2002" });

    await expect(generateSettlementAction(settlementFormData("2026-08"))).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=conflict",
    );

    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a negative manual adjustment before starting a transaction", async () => {
    mocks.settlementFindUnique.mockResolvedValueOnce(settlement);

    await expect(updateSettlementAdjustmentAction(adjustmentFormData("-101"))).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=negative_payout",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails a manual adjustment when the settlement version changes concurrently", async () => {
    mocks.settlementFindUnique.mockResolvedValueOnce(settlement);
    mocks.settlementUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      settlement: {
        findUnique: mocks.settlementFindUnique,
        updateMany: mocks.settlementUpdateMany,
      },
      courseCommissionAllocation: {
        findMany: mocks.courseCommissionAllocationFindMany,
        findUnique: mocks.courseCommissionAllocationFindUnique,
      },
      courseCommissionLedgerEntry: {
        aggregate: mocks.courseCommissionLedgerEntryAggregate,
        findUnique: mocks.courseCommissionLedgerEntryFindUnique,
        create: mocks.courseCommissionLedgerEntryCreate,
      },
      coursePayout: {
        findUnique: mocks.coursePayoutFindUnique,
        findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
        create: mocks.coursePayoutCreate,
        updateMany: mocks.coursePayoutUpdateMany,
      },
    }));

    await expect(updateSettlementAdjustmentAction(adjustmentFormData("5"))).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=conflict",
    );

    expect(mocks.settlementUpdateMany).toHaveBeenCalledWith({
      where: { id: settlement.id, lockedAt: null, updatedAt },
      data: {
        adjustmentAmountCents: 500,
        adjustmentReason: "synthetic finance review",
        reviewedBy: "finance-1",
        finalPayoutAmountCents: 10_500,
      },
    });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("persists and audits a non-negative adjustment after a successful conditional write", async () => {
    const saved = { ...settlement, adjustmentAmountCents: -10_000, finalPayoutAmountCents: 0 };
    mocks.settlementFindUnique
      .mockResolvedValueOnce(settlement)
      .mockResolvedValueOnce(saved);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      settlement: {
        findUnique: mocks.settlementFindUnique,
        updateMany: mocks.settlementUpdateMany,
      },
      courseCommissionAllocation: {
        findMany: mocks.courseCommissionAllocationFindMany,
        findUnique: mocks.courseCommissionAllocationFindUnique,
      },
      courseCommissionLedgerEntry: {
        aggregate: mocks.courseCommissionLedgerEntryAggregate,
        findUnique: mocks.courseCommissionLedgerEntryFindUnique,
        create: mocks.courseCommissionLedgerEntryCreate,
      },
      coursePayout: {
        findUnique: mocks.coursePayoutFindUnique,
        findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
        create: mocks.coursePayoutCreate,
        updateMany: mocks.coursePayoutUpdateMany,
      },
    }));

    await expect(updateSettlementAdjustmentAction(adjustmentFormData("-100"))).rejects.toThrow(
      "redirect:/admin/billing/settlements",
    );

    expect(mocks.settlementUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "update_settlement_adjustment",
      before: settlement,
      after: saved,
    }));
  });

  it("rejects locking a negative settlement before touching commissions", async () => {
    mocks.settlementFindUnique.mockResolvedValueOnce({ ...settlement, finalPayoutAmountCents: -1 });

    await expect(lockSettlementAction(lockFormData())).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=negative_payout",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.affiliateCommissionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("does not lock commissions when the settlement claim loses a race", async () => {
    mocks.settlementFindUnique.mockResolvedValueOnce(settlement);
    mocks.settlementUpdateMany.mockResolvedValueOnce({ count: 0 });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliateCommission: {
        findMany: mocks.affiliateCommissionFindMany,
        updateMany: mocks.affiliateCommissionUpdateMany,
      },
      affiliateCommissionLedgerEntry: { aggregate: mocks.affiliateCommissionLedgerEntryAggregate },
      affiliatePayout: {
        findUnique: mocks.affiliatePayoutFindUnique,
        create: mocks.affiliatePayoutCreate,
      },
      settlement: {
        findUnique: mocks.settlementFindUnique,
        updateMany: mocks.settlementUpdateMany,
      },
      courseCommissionAllocation: {
        findMany: mocks.courseCommissionAllocationFindMany,
        findUnique: mocks.courseCommissionAllocationFindUnique,
      },
      courseCommissionLedgerEntry: {
        aggregate: mocks.courseCommissionLedgerEntryAggregate,
        findUnique: mocks.courseCommissionLedgerEntryFindUnique,
        create: mocks.courseCommissionLedgerEntryCreate,
      },
      coursePayout: {
        findUnique: mocks.coursePayoutFindUnique,
        findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
        create: mocks.coursePayoutCreate,
        updateMany: mocks.coursePayoutUpdateMany,
      },
    }));

    await expect(lockSettlementAction(lockFormData())).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=conflict",
    );

    expect(mocks.affiliateCommissionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("allows a zero-value settlement to lock while preserving the conditional version predicate", async () => {
    const zeroSettlement = { ...settlement, finalPayoutAmountCents: 0 };
    const lockedSettlement = {
      ...zeroSettlement,
      status: "locked",
      lockedAt: new Date("2026-08-05T08:01:00.000Z"),
    };
    mocks.settlementFindUnique
      .mockResolvedValueOnce(zeroSettlement)
      .mockResolvedValueOnce(lockedSettlement);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliateCommission: {
        findMany: mocks.affiliateCommissionFindMany,
        updateMany: mocks.affiliateCommissionUpdateMany,
      },
      affiliateCommissionLedgerEntry: { aggregate: mocks.affiliateCommissionLedgerEntryAggregate },
      affiliatePayout: {
        findUnique: mocks.affiliatePayoutFindUnique,
        create: mocks.affiliatePayoutCreate,
      },
      settlement: {
        findUnique: mocks.settlementFindUnique,
        updateMany: mocks.settlementUpdateMany,
      },
      courseCommissionAllocation: {
        findMany: mocks.courseCommissionAllocationFindMany,
        findUnique: mocks.courseCommissionAllocationFindUnique,
      },
      courseCommissionLedgerEntry: {
        aggregate: mocks.courseCommissionLedgerEntryAggregate,
        findUnique: mocks.courseCommissionLedgerEntryFindUnique,
        create: mocks.courseCommissionLedgerEntryCreate,
      },
      coursePayout: {
        findUnique: mocks.coursePayoutFindUnique,
        findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
        create: mocks.coursePayoutCreate,
        updateMany: mocks.coursePayoutUpdateMany,
      },
    }));

    await expect(lockSettlementAction(lockFormData())).rejects.toThrow(
      "redirect:/admin/billing/settlements",
    );

    expect(mocks.settlementUpdateMany).toHaveBeenCalledWith({
      where: { id: settlement.id, lockedAt: null, updatedAt },
      data: expect.objectContaining({ status: "locked", lockedBy: "finance-1" }),
    });
    expect(mocks.affiliateCommissionUpdateMany).toHaveBeenCalledOnce();
  });

  it("creates one merchant-owned AffiliatePayout per affiliate from immutable ledger balances", async () => {
    const lockedSettlement = {
      ...settlement,
      status: "locked",
      lockedAt: new Date("2026-08-05T08:01:00.000Z"),
    };
    mocks.settlementFindUnique
      .mockResolvedValueOnce(settlement)
      .mockResolvedValueOnce(lockedSettlement);
    mocks.affiliateCommissionFindMany.mockResolvedValueOnce([
      { id: "commission-a1", affiliateId: "affiliate-a", commissionBaseAmountCents: 10_000, netReferenceAmountCents: 8_600 },
      { id: "commission-a2", affiliateId: "affiliate-a", commissionBaseAmountCents: 5_000, netReferenceAmountCents: 4_300 },
      { id: "commission-b1", affiliateId: "affiliate-b", commissionBaseAmountCents: 2_000, netReferenceAmountCents: 1_720 },
    ]);
    mocks.affiliateCommissionLedgerEntryAggregate
      .mockResolvedValueOnce({ _sum: { amountCents: 300 } })
      .mockResolvedValueOnce({ _sum: { amountCents: 200 } })
      .mockResolvedValueOnce({ _sum: { amountCents: 0 } });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliateCommission: {
        findMany: mocks.affiliateCommissionFindMany,
        updateMany: mocks.affiliateCommissionUpdateMany,
      },
      affiliateCommissionLedgerEntry: { aggregate: mocks.affiliateCommissionLedgerEntryAggregate },
      affiliatePayout: {
        findUnique: mocks.affiliatePayoutFindUnique,
        create: mocks.affiliatePayoutCreate,
      },
      settlement: {
        findUnique: mocks.settlementFindUnique,
        updateMany: mocks.settlementUpdateMany,
      },
      courseCommissionAllocation: {
        findMany: mocks.courseCommissionAllocationFindMany,
        findUnique: mocks.courseCommissionAllocationFindUnique,
      },
      courseCommissionLedgerEntry: {
        aggregate: mocks.courseCommissionLedgerEntryAggregate,
        findUnique: mocks.courseCommissionLedgerEntryFindUnique,
        create: mocks.courseCommissionLedgerEntryCreate,
      },
      coursePayout: {
        findUnique: mocks.coursePayoutFindUnique,
        findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
        create: mocks.coursePayoutCreate,
        updateMany: mocks.coursePayoutUpdateMany,
      },
    }));

    await expect(lockSettlementAction(lockFormData())).rejects.toThrow(
      "redirect:/admin/billing/settlements",
    );

    expect(mocks.affiliateCommissionFindMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        monthKey: "2026-08",
        status: "locked",
        affiliateId: { not: null },
      },
      select: {
        id: true,
        affiliateId: true,
        commissionBaseAmountCents: true,
        netReferenceAmountCents: true,
      },
    });
    expect(mocks.affiliatePayoutCreate).toHaveBeenCalledOnce();
    expect(mocks.affiliatePayoutCreate).toHaveBeenCalledWith({
      data: {
        vendorId: "vendor-1",
        affiliateId: "affiliate-a",
        monthKey: "2026-08",
        commissionAmountCents: 500,
        adjustmentAmountCents: 0,
        finalAmountCents: 500,
        grossSalesAmountCents: 15_000,
        netReferenceAmountCents: 12_900,
        status: "pending",
      },
    });
    expect(mocks.affiliatePayoutFindUnique).toHaveBeenCalledWith({
      where: {
        vendorId_affiliateId_monthKey: {
          vendorId: "vendor-1",
          affiliateId: "affiliate-a",
          monthKey: "2026-08",
        },
      },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "lock_settlement" }));
  });

  it("keeps an existing matching AffiliatePayout idempotent without creating another row", async () => {
    const lockedSettlement = { ...settlement, status: "locked", lockedAt: new Date("2026-08-05T08:01:00.000Z") };
    mocks.settlementFindUnique
      .mockResolvedValueOnce(settlement)
      .mockResolvedValueOnce(lockedSettlement);
    mocks.affiliateCommissionFindMany.mockResolvedValueOnce([{ id: "commission-a1", affiliateId: "affiliate-a" }]);
    mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValueOnce({ _sum: { amountCents: 500 } });
    mocks.affiliatePayoutFindUnique.mockResolvedValueOnce({
      id: "affiliate-payout-1",
      commissionAmountCents: 500,
      adjustmentAmountCents: 0,
      finalAmountCents: 500,
      status: "pending",
    });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliateCommission: {
        findMany: mocks.affiliateCommissionFindMany,
        updateMany: mocks.affiliateCommissionUpdateMany,
      },
      affiliateCommissionLedgerEntry: { aggregate: mocks.affiliateCommissionLedgerEntryAggregate },
      affiliatePayout: {
        findUnique: mocks.affiliatePayoutFindUnique,
        create: mocks.affiliatePayoutCreate,
      },
      settlement: {
        findUnique: mocks.settlementFindUnique,
        updateMany: mocks.settlementUpdateMany,
      },
      courseCommissionAllocation: {
        findMany: mocks.courseCommissionAllocationFindMany,
        findUnique: mocks.courseCommissionAllocationFindUnique,
      },
      courseCommissionLedgerEntry: {
        aggregate: mocks.courseCommissionLedgerEntryAggregate,
        findUnique: mocks.courseCommissionLedgerEntryFindUnique,
        create: mocks.courseCommissionLedgerEntryCreate,
      },
      coursePayout: {
        findUnique: mocks.coursePayoutFindUnique,
        findUniqueOrThrow: mocks.coursePayoutFindUniqueOrThrow,
        create: mocks.coursePayoutCreate,
        updateMany: mocks.coursePayoutUpdateMany,
      },
    }));

    await expect(lockSettlementAction(lockFormData())).rejects.toThrow(
      "redirect:/admin/billing/settlements",
    );

    expect(mocks.affiliatePayoutCreate).not.toHaveBeenCalled();
  });

  it("fails closed when an existing AffiliatePayout amount disagrees with the ledger", async () => {
    const lockedSettlement = { ...settlement, status: "locked", lockedAt: new Date("2026-08-05T08:01:00.000Z") };
    mocks.settlementFindUnique
      .mockResolvedValueOnce(settlement)
      .mockResolvedValueOnce(lockedSettlement);
    mocks.affiliateCommissionFindMany.mockResolvedValueOnce([{ id: "commission-a1", affiliateId: "affiliate-a" }]);
    mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValueOnce({ _sum: { amountCents: 500 } });
    mocks.affiliatePayoutFindUnique.mockResolvedValueOnce({
      id: "affiliate-payout-1",
      commissionAmountCents: 400,
      adjustmentAmountCents: 0,
      finalAmountCents: 400,
      status: "pending",
    });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliateCommission: {
        findMany: mocks.affiliateCommissionFindMany,
        updateMany: mocks.affiliateCommissionUpdateMany,
      },
      affiliateCommissionLedgerEntry: { aggregate: mocks.affiliateCommissionLedgerEntryAggregate },
      affiliatePayout: {
        findUnique: mocks.affiliatePayoutFindUnique,
        create: mocks.affiliatePayoutCreate,
      },
      settlement: {
        findUnique: mocks.settlementFindUnique,
        updateMany: mocks.settlementUpdateMany,
      },
    }));

    await expect(lockSettlementAction(lockFormData())).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=conflict",
    );

    expect(mocks.affiliatePayoutCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails closed when an existing AffiliatePayout gross or net snapshot disagrees with its locked commissions", async () => {
    const lockedSettlement = { ...settlement, status: "locked", lockedAt: new Date("2026-08-05T08:01:00.000Z") };
    mocks.settlementFindUnique
      .mockResolvedValueOnce(settlement)
      .mockResolvedValueOnce(lockedSettlement);
    mocks.affiliateCommissionFindMany.mockResolvedValueOnce([{
      id: "commission-a1",
      affiliateId: "affiliate-a",
      commissionBaseAmountCents: 10_000,
      netReferenceAmountCents: 8_600,
    }]);
    mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValueOnce({ _sum: { amountCents: 500 } });
    mocks.affiliatePayoutFindUnique.mockResolvedValueOnce({
      id: "affiliate-payout-1",
      commissionAmountCents: 500,
      adjustmentAmountCents: 0,
      finalAmountCents: 500,
      grossSalesAmountCents: 9_999,
      netReferenceAmountCents: 8_600,
      status: "pending",
    });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliateCommission: {
        findMany: mocks.affiliateCommissionFindMany,
        updateMany: mocks.affiliateCommissionUpdateMany,
      },
      affiliateCommissionLedgerEntry: { aggregate: mocks.affiliateCommissionLedgerEntryAggregate },
      affiliatePayout: {
        findUnique: mocks.affiliatePayoutFindUnique,
        create: mocks.affiliatePayoutCreate,
      },
      settlement: {
        findUnique: mocks.settlementFindUnique,
        updateMany: mocks.settlementUpdateMany,
      },
    }));

    await expect(lockSettlementAction(lockFormData())).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=conflict",
    );

    expect(mocks.affiliatePayoutCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("fails closed when an immutable ledger balance is negative", async () => {
    const lockedSettlement = { ...settlement, status: "locked", lockedAt: new Date("2026-08-05T08:01:00.000Z") };
    mocks.settlementFindUnique
      .mockResolvedValueOnce(settlement)
      .mockResolvedValueOnce(lockedSettlement);
    mocks.affiliateCommissionFindMany.mockResolvedValueOnce([{ id: "commission-a1", affiliateId: "affiliate-a" }]);
    mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValueOnce({ _sum: { amountCents: -1 } });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliateCommission: {
        findMany: mocks.affiliateCommissionFindMany,
        updateMany: mocks.affiliateCommissionUpdateMany,
      },
      affiliateCommissionLedgerEntry: { aggregate: mocks.affiliateCommissionLedgerEntryAggregate },
      affiliatePayout: {
        findUnique: mocks.affiliatePayoutFindUnique,
        create: mocks.affiliatePayoutCreate,
      },
      settlement: {
        findUnique: mocks.settlementFindUnique,
        updateMany: mocks.settlementUpdateMany,
      },
    }));

    await expect(lockSettlementAction(lockFormData())).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=conflict",
    );

    expect(mocks.affiliatePayoutCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("FIN-02 payout account fail-closed boundary", () => {
  const completeAccount = {
    mode: "platform",
    status: "active",
    bankAccountEncrypted: null,
    bankAccountLegacyName: "Synthetic Vendor",
    bankCodeLegacy: "700",
    bankAccountLegacyNumber: "synthetic-account-number",
  };

  function payoutFormData() {
    const formData = new FormData();
    formData.append("settlementIds", "settlement-fin-02-account");
    return formData;
  }

  it.each([
    ["no account", []],
    ["BYO-only", [{ ...completeAccount, mode: "byo" }]],
    ["inactive platform", [{ ...completeAccount, status: "inactive" }]],
    ["incomplete legacy", [{ ...completeAccount, bankCodeLegacy: null }]],
    ["ambiguous platform accounts", [completeAccount, { ...completeAccount }]],
    ["one complete plus one incomplete active platform account", [
      completeAccount,
      { ...completeAccount, bankAccountLegacyNumber: null },
    ]],
    ["unreadable encrypted account", [{
      ...completeAccount,
      bankAccountEncrypted: "invalid-envelope",
      bankAccountLegacyName: null,
      bankCodeLegacy: null,
      bankAccountLegacyNumber: null,
    }]],
  ])("rejects %s before creating a payout transaction", async (_label, paymentAccounts) => {
    mocks.settlementFindMany.mockResolvedValueOnce([{
      id: "settlement-fin-02-account",
      vendorId: "vendor-1",
      finalPayoutAmountCents: 5_000,
      vendor: { name: "Synthetic Vendor", paymentAccounts },
    }]);

    await expect(createPayoutBatchAction(payoutFormData())).rejects.toThrow(
      "redirect:/admin/billing/settlements?error=invalid_payout_account",
    );

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.payoutBatchCreate).not.toHaveBeenCalled();
    expect(mocks.payoutItemCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe("FIN-05 merchant AffiliatePayout outcome workflow", () => {
  const payout = {
    id: "affiliate-payout-fin-05",
    vendorId: "vendor-1",
    affiliateId: "affiliate-1",
    monthKey: "2026-08",
    commissionAmountCents: 500,
    adjustmentAmountCents: 0,
    finalAmountCents: 500,
    status: "pending",
    payoutItemId: null,
    outcomeReference: null,
    outcomeReason: null,
    paidAt: null,
  };
  const commission = { id: "commission-fin-05", vendorId: "vendor-1", affiliateId: "affiliate-1", monthKey: "2026-08", status: "locked" };
  const transitionAt = new Date("2026-08-06T09:00:00.000Z");

  function outcomeFormData(status = "paid", reason = "merchant transfer confirmed", id = payout.id, outcomeReference = "affiliate-transfer-ref-2026-08") {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("status", status);
    formData.set("reason", reason);
    if (outcomeReference !== undefined) formData.set("outcomeReference", outcomeReference);
    return formData;
  }

  function configureOutcomeTransaction(updatedPayout: Omit<typeof payout, "paidAt"> & { paidAt: Date | null }, commissions = [commission]) {
    mocks.affiliatePayoutFindFirst.mockResolvedValueOnce(payout);
    mocks.affiliatePayoutFindUnique.mockResolvedValueOnce(updatedPayout);
    mocks.affiliateCommissionFindMany.mockResolvedValueOnce(commissions);
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliateCommission: {
        findMany: mocks.affiliateCommissionFindMany,
        updateMany: mocks.affiliateCommissionUpdateMany,
      },
      affiliateCommissionLedgerEntry: {
        aggregate: mocks.affiliateCommissionLedgerEntryAggregate,
        findUnique: mocks.affiliateCommissionLedgerEntryFindUnique,
        create: mocks.affiliateCommissionLedgerEntryCreate,
      },
      affiliatePayout: {
        findFirst: mocks.affiliatePayoutFindFirst,
        findUnique: mocks.affiliatePayoutFindUnique,
        updateMany: mocks.affiliatePayoutUpdateMany,
      },
      auditLog: { create: mocks.auditLogCreate },
    }));
  }

  async function withFixedClock(run: () => Promise<void>) {
    vi.useFakeTimers();
    vi.setSystemTime(transitionAt);
    try {
      await run();
    } finally {
      vi.useRealTimers();
    }
  }

  it.each([
    ["failed", "merchant transfer failed"],
    ["unknown", "merchant transfer confirmed"],
    ["paid", ""],
    ["void", "x".repeat(501)],
  ])("rejects invalid status/reason %s before transaction", async (status, reason) => {
    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData(status, reason))).rejects.toThrow(
      "redirect:/affiliates/commissions?error=invalid_payout",
    );
    expect(mocks.requireVendorFinance).toHaveBeenCalledWith("/affiliates/commissions");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a paid outcome without a human payout reference before transaction", async () => {
    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData("paid", "merchant transfer confirmed", payout.id, ""))).rejects.toThrow(
      "redirect:/affiliates/commissions?error=invalid_payout",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("uses the merchant finance MFA boundary before accepting a valid outcome", async () => {
    mocks.requireVendorFinance.mockRejectedValueOnce(new Error("redirect:/mfa/verify"));

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow("redirect:/mfa/verify");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["foreign tenant", { ...payout, vendorId: "vendor-2" }],
  ])("fails closed identically for %s payout", async (_label, row) => {
    mocks.affiliatePayoutFindFirst.mockResolvedValueOnce(row);

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow(
      "redirect:/affiliates/commissions?error=conflict",
    );
    expect(mocks.affiliatePayoutUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("rejects a payout already attached to a platform payout item without delegating", async () => {
    mocks.affiliatePayoutFindFirst.mockResolvedValueOnce({ ...payout, payoutItemId: "platform-payout-item" });

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow(
      "redirect:/affiliates/commissions?error=conflict",
    );
    expect(mocks.payoutItemFindUnique).not.toHaveBeenCalled();
    expect(mocks.payoutItemUpdate).not.toHaveBeenCalled();
    expect(mocks.payoutBatchUpdate).not.toHaveBeenCalled();
    expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
  });

  it("marks pending payout paid atomically without creating a ledger entry", async () => {
    await withFixedClock(async () => {
      configureOutcomeTransaction({ ...payout, status: "paid", paidAt: transitionAt });
      mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValueOnce({ _sum: { amountCents: 500 } });

      await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow(
        "redirect:/affiliates/commissions",
      );

      expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
      expect(mocks.affiliatePayoutUpdateMany).toHaveBeenCalledWith({
          where: { id: payout.id, vendorId: "vendor-1", status: "pending", payoutItemId: null },
        data: {
          status: "paid",
          outcomeReference: "affiliate-transfer-ref-2026-08",
          outcomeReason: "merchant transfer confirmed",
          paidAt: transitionAt,
        },
      });
      expect(mocks.affiliateCommissionUpdateMany).toHaveBeenCalledWith({
        where: { vendorId: "vendor-1", id: { in: [commission.id] }, status: "locked" },
        data: { status: "paid", settledAt: transitionAt },
      });
      expect(mocks.affiliateCommissionLedgerEntryCreate).not.toHaveBeenCalled();
      expect(mocks.auditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vendorId: "vendor-1",
          actorId: "merchant-finance-1",
          actorLabel: "owner",
          action: "mark_affiliate_payout_paid",
          targetType: "AffiliatePayout",
          targetId: payout.id,
          after: expect.objectContaining({ reference: "affiliate-transfer-ref-2026-08", reason: "merchant transfer confirmed", transitionedAt: transitionAt }),
          ipAddress: "203.0.113.10",
          userAgent: "CelebrateDeal test",
        }),
      });
      expect(mocks.revalidatePath).toHaveBeenCalledWith("/affiliates/commissions");
      expect(mocks.payoutItemCreate).not.toHaveBeenCalled();
      expect(mocks.payoutBatchCreate).not.toHaveBeenCalled();
      expect(mocks.settlementUpdateMany).not.toHaveBeenCalled();
    });
  });

  it("marks pending payout void with one stable merchant reversal per positive commission", async () => {
    await withFixedClock(async () => {
      configureOutcomeTransaction({ ...payout, status: "void", paidAt: null });
      mocks.affiliateCommissionLedgerEntryAggregate
        .mockResolvedValueOnce({ _sum: { amountCents: 500 } })
        .mockResolvedValueOnce({ _sum: { amountCents: 500 } });

      await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData("void", "merchant cancelled transfer"))).rejects.toThrow(
        "redirect:/affiliates/commissions",
      );

      expect(mocks.affiliateCommissionLedgerEntryCreate).toHaveBeenCalledWith({
        data: {
          vendorId: "vendor-1",
          affiliateCommissionId: commission.id,
          entryType: "reversal",
          deduplicationKey: expect.stringMatching(/^commission-ledger:v1\|sha256:[a-f0-9]{64}$/),
          providerName: "merchant",
          eventIdentity: `affiliate-payout:void:${payout.id}:${commission.id}`,
          disputeCaseId: null,
          amountCents: -500,
          occurredAt: transitionAt,
        },
      });
      expect(mocks.affiliatePayoutUpdateMany).toHaveBeenCalledWith({
        where: { id: payout.id, vendorId: "vendor-1", status: "pending", payoutItemId: null },
        data: {
          status: "void",
          outcomeReference: null,
          outcomeReason: "merchant cancelled transfer",
          paidAt: null,
        },
      });
      expect(mocks.affiliateCommissionUpdateMany).toHaveBeenCalledWith({
        where: { vendorId: "vendor-1", id: { in: [commission.id] }, status: "locked" },
        data: { status: "void", settledAt: transitionAt },
      });
      expect(mocks.auditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "mark_affiliate_payout_void",
          after: expect.objectContaining({ reason: "merchant cancelled transfer", transitionedAt: transitionAt }),
        }),
      });
    });
  });

  it("fails closed on a ledger amount mismatch without claims or audit", async () => {
    configureOutcomeTransaction({ ...payout, status: "paid", paidAt: transitionAt });
    mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValueOnce({ _sum: { amountCents: 400 } });

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow(
      "redirect:/affiliates/commissions?error=conflict",
    );
    expect(mocks.affiliatePayoutUpdateMany).not.toHaveBeenCalled();
    expect(mocks.affiliateCommissionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["no commissions", []],
    ["unlocked commission", [{ ...commission, status: "approved" }]],
  ])("fails closed for %s", async (_label, commissions) => {
    configureOutcomeTransaction({ ...payout, status: "paid", paidAt: transitionAt }, commissions);

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow(
      "redirect:/affiliates/commissions?error=conflict",
    );
    expect(mocks.affiliatePayoutUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("rolls back success audit when the payout claim loses a race", async () => {
    configureOutcomeTransaction({ ...payout, status: "paid", paidAt: transitionAt });
    mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValueOnce({ _sum: { amountCents: 500 } });
    mocks.affiliatePayoutUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow(
      "redirect:/affiliates/commissions?error=conflict",
    );
    expect(mocks.affiliateCommissionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("rolls back success audit when the commission claim loses a race", async () => {
    configureOutcomeTransaction({ ...payout, status: "paid", paidAt: transitionAt });
    mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValueOnce({ _sum: { amountCents: 500 } });
    mocks.affiliateCommissionUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow(
      "redirect:/affiliates/commissions?error=conflict",
    );
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("treats the same terminal outcome as idempotent without adding audit or ledger rows", async () => {
    mocks.affiliatePayoutFindFirst.mockResolvedValueOnce({ ...payout, status: "paid", paidAt: transitionAt });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliatePayout: { findFirst: mocks.affiliatePayoutFindFirst },
    }));

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow(
      "redirect:/affiliates/commissions",
    );
    expect(mocks.affiliateCommissionFindMany).not.toHaveBeenCalled();
    expect(mocks.affiliateCommissionLedgerEntryCreate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("rejects a reverse terminal transition", async () => {
    mocks.affiliatePayoutFindFirst.mockResolvedValueOnce({ ...payout, status: "paid", paidAt: transitionAt });
    mocks.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      affiliatePayout: { findFirst: mocks.affiliatePayoutFindFirst },
    }));

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData("void", "merchant reversal request"))).rejects.toThrow(
      "redirect:/affiliates/commissions?error=conflict",
    );
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("does not redirect success when audit persistence fails", async () => {
    configureOutcomeTransaction({ ...payout, status: "paid", paidAt: transitionAt });
    mocks.affiliateCommissionLedgerEntryAggregate.mockResolvedValueOnce({ _sum: { amountCents: 500 } });
    mocks.auditLogCreate.mockRejectedValueOnce(new Error("audit persistence failed"));

    await expect(recordAffiliatePayoutOutcomeAction(outcomeFormData())).rejects.toThrow("audit persistence failed");
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/affiliates/commissions");
  });
});

describe("FIN-07 refund reconciliation closure", () => {
  it("does not call PayUni again while a pending refund reservation exists", async () => {
    mocks.refundRecordAggregate.mockReset();
    const payUniTransaction = { ...transaction, providerName: "payuni", providerTradeNo: "trade-123" };
    const providerRefund = vi.fn();
    mocks.findUnique.mockResolvedValue(payUniTransaction);
    mocks.getPaymentProvider.mockReturnValue({ refundPayment: providerRefund });
    mocks.refundRecordAggregate
      .mockResolvedValueOnce({ _sum: { refundAmountCents: 0, gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 } })
      .mockResolvedValueOnce({ _count: { _all: 1 } });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );
    expect(providerRefund).not.toHaveBeenCalled();
    expect(mocks.refundRecordCreate).not.toHaveBeenCalled();
  });

  it("keeps the provider-confirmed reservation pending when in-transaction audit fails", async () => {
    mocks.refundRecordAggregate.mockReset();
    mocks.transaction.mockReset();
    mocks.writeAuditLog.mockReset();
    const payUniTransaction = { ...transaction, providerName: "payuni", providerTradeNo: "trade-123" };
    const providerRefund = vi.fn().mockResolvedValue({ providerEventId: "refund-456" });
    let committedRefundStatus = "pending";
    let committedTransactionStatus = "paid";
    let transactionAttempts = 0;
    mocks.findUnique.mockResolvedValue(payUniTransaction);
    mocks.getPaymentProvider.mockReturnValue({ refundPayment: providerRefund });
    mocks.refundRecordAggregate
      .mockResolvedValueOnce({ _sum: { refundAmountCents: 0, gatewayFeeRefundCents: 0, platformFeeRefundCents: 0 } })
      .mockResolvedValueOnce({ _count: { _all: 0 } });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionAttempts += 1;
      let stagedRefundStatus = committedRefundStatus;
      let stagedTransactionStatus = committedTransactionStatus;
      const result = await callback({
        paymentTransaction: {
          findUnique: mocks.findUnique,
          update: async () => {
            stagedTransactionStatus = "refunded";
            return { ...payUniTransaction, status: stagedTransactionStatus, refundedAmountCents: 10_000 };
          },
        },
        refundRecord: {
          aggregate: mocks.refundRecordAggregate,
          create: async () => ({ id: "refund-1" }),
          update: async () => { stagedRefundStatus = "processed"; return { id: "refund-1", status: stagedRefundStatus }; },
        },
        auditLog: {
          create: async () => { throw new Error("audit persistence failed"); },
        },
      });
      committedRefundStatus = stagedRefundStatus;
      committedTransactionStatus = stagedTransactionStatus;
      return result;
    });

    await expect(refundPaymentTransactionAction(refundFormData("40"))).rejects.toThrow(
      "redirect:/admin/billing/dashboard?error=refund",
    );
    expect(transactionAttempts).toBe(2);
    expect(providerRefund).toHaveBeenCalledOnce();
    expect(committedRefundStatus).toBe("pending");
    expect(committedTransactionStatus).toBe("paid");
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
