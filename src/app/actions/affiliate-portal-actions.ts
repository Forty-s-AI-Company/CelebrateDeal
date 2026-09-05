"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  AUTH_COOKIE,
  createUserSession,
  revokeCurrentSession,
  sessionCookieOptions,
} from "@/lib/auth";
import { authenticateAffiliatePortal, requireAffiliatePortal } from "@/lib/affiliate-portal-auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { requestAuditMeta, writeAuditLog } from "@/lib/audit";
import { requestAffiliatePayout } from "@/lib/affiliate-portal-payout";
import { encryptBankAccount } from "@/lib/bank-account";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const BankAccountInput = z.object({
  accountName: z.string().trim().min(1).max(100),
  bankCode: z.string().trim().regex(/^\d{3,7}$/),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/),
});

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function forwardedRequest(headerStore: Awaited<ReturnType<typeof headers>>) {
  const forwarded = new Headers();
  for (const name of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = headerStore.get(name);
    if (value) forwarded.set(name, value);
  }
  return new Request(getCanonicalAppUrl(), { headers: forwarded });
}

export async function affiliatePortalLoginAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const email = text(formData, "email").toLowerCase();
  const password = text(formData, "password");
  const code = text(formData, "code");
  const headerStore = await headers();
  const rateLimitRequest = forwardedRequest(headerStore);
  const sourceLimited = await checkRateLimit(
    rateLimitRequest,
    "affiliate-portal-login-source",
    20,
    LOGIN_WINDOW_MS,
  );
  if (sourceLimited) redirect(`/affiliate-portal/login?error=${sourceLimited.status === 429 ? "rate_limited" : "unavailable"}`);
  const limited = await checkRateLimit(
    rateLimitRequest,
    `affiliate-portal-login:${email}:${code.toUpperCase()}`,
    5,
    LOGIN_WINDOW_MS,
  );
  if (limited) redirect(`/affiliate-portal/login?error=${limited.status === 429 ? "rate_limited" : "unavailable"}`);

  const principal = await authenticateAffiliatePortal(email, password, code);
  if (!principal) {
    await writeAuditLog({
      actorLabel: "anonymous",
      action: "affiliate_portal_login_failed",
      targetType: "AffiliatePortal",
      targetId: code.toUpperCase().slice(0, 80) || "unknown",
    });
    redirect("/affiliate-portal/login?error=invalid");
  }

  const { token, expiresAt } = await createUserSession({
    userId: principal.user.id,
    vendorId: principal.affiliate.vendorId,
    ipAddress: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerStore.get("user-agent"),
  });
  (await cookies()).set(AUTH_COOKIE, token, sessionCookieOptions(expiresAt));
  await writeAuditLog({
    vendorId: principal.affiliate.vendorId,
    actorId: principal.user.id,
    actorLabel: "affiliate",
    action: "affiliate_portal_login_success",
    targetType: "Affiliate",
    targetId: principal.affiliate.id,
  });
  redirect("/affiliate-portal");
}

export async function affiliatePortalLogoutAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  await revokeCurrentSession();
  (await cookies()).delete(AUTH_COOKIE);
  redirect("/affiliate-portal/login");
}

export async function saveAffiliateBankAccountAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, affiliate } = await requireAffiliatePortal();
  const parsed = BankAccountInput.safeParse({
    accountName: text(formData, "accountName"),
    bankCode: text(formData, "bankCode"),
    accountNumber: text(formData, "accountNumber"),
  });
  if (!parsed.success) redirect("/affiliate-portal?error=invalid_bank");

  const encrypted = encryptBankAccount(parsed.data, affiliate.vendorId);
  const result = await getDb().affiliate.updateMany({
    where: { id: affiliate.id, vendorId: affiliate.vendorId, userId: auth.user.id, isActive: true },
    data: { bankAccountEncrypted: encrypted },
  });
  if (result.count !== 1) redirect("/affiliate-portal/login?error=unauthorized");
  revalidatePath("/affiliate-portal");
  redirect("/affiliate-portal?bank=saved");
}

export async function requestAffiliatePayoutAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, affiliate } = await requireAffiliatePortal();
  const payoutId = text(formData, "payoutId");
  if (!payoutId || payoutId.length > 200) redirect("/affiliate-portal?error=invalid_payout");
  if (!affiliate.bankAccountEncrypted) redirect("/affiliate-portal?error=bank_required");

  const auditMeta = await requestAuditMeta();
  const requestedAt = new Date();
  const result = await requestAffiliatePayout(getDb(), {
    payoutId,
    vendorId: affiliate.vendorId,
    affiliateId: affiliate.id,
    userId: auth.user.id,
    bankAccountEncrypted: affiliate.bankAccountEncrypted,
    requestedAt,
    ipAddress: auditMeta.ipAddress,
    userAgent: auditMeta.userAgent,
  });

  if (result === "ineligible") redirect("/affiliate-portal?error=invalid_payout");

  revalidatePath("/affiliate-portal");
  redirect("/affiliate-portal?payout=requested");
}
