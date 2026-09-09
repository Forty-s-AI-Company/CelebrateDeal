"use server";

import type { StudentPortalActionState } from "@/lib/student-portal-action-state";
export type { StudentPortalActionState } from "@/lib/student-portal-action-state";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { protectEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { checkRateLimit } from "@/lib/rate-limit";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { resolveBuyerSupportGrant } from "@/lib/buyer-support-access";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import {
  clearStudentPortalSessionCookie,
  createCheckoutStudentPortalAccessToken,
  createStudentPortalAccessToken,
} from "@/lib/student-portal-auth";

const EmailInput = z.string().trim().toLowerCase().email().max(254);
const SlugInput = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry : "";
}

async function sourceRequest() {
  const incoming = await headers();
  const forwarded = new Headers();
  for (const name of ["cf-connecting-ip", "x-forwarded-for", "user-agent"]) {
    const header = incoming.get(name);
    if (header) forwarded.set(name, header);
  }
  return new Request(getCanonicalAppUrl(), { headers: forwarded });
}

const genericSentMessage = "如果這個 Email 有可存取的內容，我們已寄出 15 分鐘有效的安全連結。";

export async function requestMagicLinkAction(
  _previous: StudentPortalActionState,
  formData: FormData,
): Promise<StudentPortalActionState> {
  await assertServerActionSecurity(formData);
  const email = EmailInput.safeParse(value(formData, "email"));
  const vendorSlug = SlugInput.safeParse(value(formData, "vendorSlug"));
  if (!email.success || !vendorSlug.success) {
    return { status: "invalid", message: "請確認 Email 格式後再試一次。" };
  }

  const limited = await checkRateLimit(await sourceRequest(), "student-portal-magic-link", 10, 15 * 60 * 1000);
  if (limited) return { status: "rate_limited", message: "申請次數較多，請稍後再試。" };

  const db = getDb();
  const vendor = await db.vendor.findUnique({
    where: { slug: vendorSlug.data },
    select: { id: true, slug: true, name: true, senderName: true, supportEmail: true, contactUrl: true },
  });
  if (!vendor) return { status: "sent", message: genericSentMessage };

  const customerKeyHash = automationCustomerKeyHash(vendor.id, email.data);
  // A second bucket intentionally uses no client-provided forwarding headers.
  // This keeps one tenant/student identity bounded even if XFF is spoofed.
  const recipientLimited = await checkRateLimit(
    new Request(getCanonicalAppUrl()),
    `student-portal-magic-link-recipient:${vendor.id}:${customerKeyHash}`,
    3,
    15 * 60 * 1000,
  );
  if (recipientLimited) return { status: "rate_limited", message: "申請次數較多，請稍後再試。" };
  const [orderCount, bookingCount, voucherCount] = await Promise.all([
    db.commerceOrder.count({ where: { vendorId: vendor.id, automationCustomerKeyHash: customerKeyHash, status: { in: ["paid", "partially_refunded", "refunded"] } } }),
    db.consultationBooking.count({ where: { vendorId: vendor.id, customerKeyHash } }),
    db.automationVoucherGrant.count({ where: { vendorId: vendor.id, customerKeyHash } }),
  ]);
  if (orderCount + bookingCount + voucherCount === 0) return { status: "sent", message: genericSentMessage };

  const token = await createStudentPortalAccessToken(db, { vendorId: vendor.id, email: email.data, purpose: "magic_link" });
  const accessUrl = new URL(`/portal/${encodeURIComponent(vendor.slug)}/access`, getCanonicalAppUrl());
  accessUrl.searchParams.set("token", token);

  if (process.env.NODE_ENV !== "production") {
    return { status: "sent", message: genericSentMessage, mockLink: accessUrl.toString() };
  }

  const deliveryId = `student_portal_${randomBytes(16).toString("hex")}`;
  const protectedPayload = protectEmailDeliveryPayload({
    recipientEmail: email.data,
    subject: `${vendor.name}｜學員中心登入連結`,
    body: `請在 15 分鐘內開啟以下連結進入學員中心：\n${accessUrl.toString()}\n\n若不是你本人申請，請直接忽略。`,
    brand: vendor,
  }, { vendorId: vendor.id, deliveryId });
  await db.emailDelivery.create({ data: {
    id: deliveryId,
    vendorId: vendor.id,
    sourceTemplateId: "student_portal_magic_link_v1",
    trigger: "student_portal_magic_link",
    ...protectedPayload,
    idempotencyKey: `student-portal:${createHash("sha256").update(token).digest("hex")}`,
    status: "queued",
    nextAttemptAt: new Date(),
  } });
  return { status: "sent", message: genericSentMessage };
}

export async function logoutStudentPortalAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendorSlug = SlugInput.safeParse(value(formData, "vendorSlug"));
  await clearStudentPortalSessionCookie();
  redirect(vendorSlug.success ? `/portal/${encodeURIComponent(vendorSlug.data)}/login` : "/portal");
}

/** Exchanges the checkout browser's existing HttpOnly order grant for a one-time portal capability. */
export async function enterStudentPortalFromCheckoutAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const grantId = value(formData, "grantId");
  if (!grantId || grantId.length > 200) redirect("/checkout/result");
  const db = getDb();
  const grant = await resolveBuyerSupportGrant(db, await cookies(), grantId);
  if (!grant || !["paid", "partially_refunded", "refunded"].includes(grant.order.status)) redirect("/checkout/result");
  const order = await db.commerceOrder.findFirst({
    where: { id: grant.orderId, vendorId: grant.vendorId, buyerSupportOrderGrants: { some: { id: grant.id, revokedAt: null, expiresAt: { gt: new Date() } } } },
    select: { id: true, vendorId: true, buyerEncryptedEnvelope: true, shippingEncryptedEnvelope: true, vendor: { select: { slug: true } } },
  });
  if (!order) redirect("/checkout/result");
  const pii = revealCommerceOrderPii({ buyerEncrypted: order.buyerEncryptedEnvelope, shippingEncrypted: order.shippingEncryptedEnvelope }, { vendorId: order.vendorId, orderId: order.id });
  const token = await createCheckoutStudentPortalAccessToken({ vendorId: order.vendorId, email: pii.buyer.email });
  redirect(`/portal/${encodeURIComponent(order.vendor.slug)}/access?purpose=checkout&token=${encodeURIComponent(token)}`);
}
