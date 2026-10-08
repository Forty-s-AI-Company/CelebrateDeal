"use server";
import {normalizeStudentPortalLocale} from "@/lib/student-portal-locale";
import {portalText} from "@/lib/student-portal-translations";

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
import {
  clearStudentPortalSessionCookie,
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
  const locale=normalizeStudentPortalLocale(value(formData,"locale"));
  const t=(text:string)=>portalText(locale,text);
  const email = EmailInput.safeParse(value(formData, "email"));
  const vendorSlug = SlugInput.safeParse(value(formData, "vendorSlug"));
  if (!email.success || !vendorSlug.success) {
    return { status: "invalid", message: t("請確認 Email 格式後再試一次。") };
  }

  const limited = await checkRateLimit(await sourceRequest(), "student-portal-magic-link", 10, 15 * 60 * 1000);
  if (limited) return { status: "rate_limited", message: t("申請次數較多，請稍後再試。") };

  const db = getDb();
  const vendor = await db.vendor.findUnique({
    where: { slug: vendorSlug.data },
    select: { id: true, slug: true, name: true, senderName: true, supportEmail: true, contactUrl: true },
  });
  if (!vendor) return { status: "sent", message: t(genericSentMessage) };

  const customerKeyHash = automationCustomerKeyHash(vendor.id, email.data);
  // A second bucket intentionally uses no client-provided forwarding headers.
  // This keeps one tenant/student identity bounded even if XFF is spoofed.
  const recipientLimited = await checkRateLimit(
    new Request(getCanonicalAppUrl()),
    `student-portal-magic-link-recipient:${vendor.id}:${customerKeyHash}`,
    3,
    15 * 60 * 1000,
  );
  if (recipientLimited) return { status: "rate_limited", message: t("申請次數較多，請稍後再試。") };
  const [orderCount, bookingCount, voucherCount] = await Promise.all([
    db.commerceOrder.count({ where: { vendorId: vendor.id, automationCustomerKeyHash: customerKeyHash, status: { in: ["paid", "partially_refunded", "refunded"] } } }),
    db.consultationBooking.count({ where: { vendorId: vendor.id, customerKeyHash } }),
    db.automationVoucherGrant.count({ where: { vendorId: vendor.id, customerKeyHash } }),
  ]);
  if (orderCount + bookingCount + voucherCount === 0) return { status: "sent", message: t(genericSentMessage) };

  const token = await createStudentPortalAccessToken(db, { vendorId: vendor.id, email: email.data, purpose: "magic_link" });
  const accessUrl = new URL(`/portal/${encodeURIComponent(vendor.slug)}/access`, getCanonicalAppUrl());
  accessUrl.searchParams.set("token", token);

  const deliveryId = `student_portal_${randomBytes(16).toString("hex")}`;
  const protectedPayload = protectEmailDeliveryPayload({
    recipientEmail: email.data,
    subject: locale==="en"?`${vendor.name} | Learner sign-in link`:`${vendor.name}｜學員中心登入連結`,
    body: locale==="en"?`Open this link within 15 minutes to enter your learner centre:\n${accessUrl.toString()}\n\nIf you did not request it, ignore this message.`:`請在 15 分鐘內開啟以下連結進入學員中心：\n${accessUrl.toString()}\n\n若不是你本人申請，請直接忽略。`,
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
  return { status: "sent", message: t(genericSentMessage) };
}

export async function logoutStudentPortalAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const vendorSlug = SlugInput.safeParse(value(formData, "vendorSlug"));
  await clearStudentPortalSessionCookie();
  redirect(vendorSlug.success ? `/portal/${encodeURIComponent(vendorSlug.data)}/login` : "/portal");
}

/** An order grant identifies this checkout, but never proves ownership of its email address. */
export async function enterStudentPortalFromCheckoutAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const grantId = value(formData, "grantId");
  if (!grantId || grantId.length > 200) redirect("/checkout/result");
  const db = getDb();
  const grant = await resolveBuyerSupportGrant(db, await cookies(), grantId);
  if (!grant || !["paid", "partially_refunded", "refunded"].includes(grant.order.status)) redirect("/checkout/result");
  const vendor = await db.vendor.findUnique({ where: { id: grant.vendorId }, select: { slug: true } });
  if (!vendor) redirect("/checkout/result");
  // Account-wide access is granted only after the student consumes the emailed capability.
  redirect(`/portal/${encodeURIComponent(vendor.slug)}/login`);
}
