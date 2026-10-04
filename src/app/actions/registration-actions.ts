"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AUTH_COOKIE, LEGACY_VENDOR_COOKIE, createUserSession, sessionCookieOptions } from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { hashPasswordAsync } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";

const RegistrationInput = z.object({
  name: z.string().trim().min(2).max(120),
  workspaceName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  // Match the existing login action, which trims submitted passwords.
  password: z.string().max(128).transform((value) => value.trim()).pipe(z.string().min(12)),
});

/** Create the original self-service workspace flow using current security boundaries. */
export async function registerAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const parsed = RegistrationInput.safeParse({ name: formData.get("name"), workspaceName: formData.get("workspaceName"), email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) redirect("/register?error=invalid");
  const input = parsed.data;
  const incoming = await headers();
  const forwarded = new Headers();
  for (const name of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  const limited = await checkRateLimit(new Request(getCanonicalAppUrl(), { headers: forwarded }), "registration-source", 4, 15 * 60 * 1000);
  if (limited) redirect(`/register?error=${limited.status === 429 ? "rate_limited" : "temporarily_unavailable"}`);
  const passwordHash = await hashPasswordAsync(input.password);
  const slugBase = input.workspaceName.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "workspace";
  let created: { userId: string; vendorId: string };
  try {
    // Ownership, onboarding state and audit become visible together or roll back together.
    created = await getDb().$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash } });
      const vendor = await tx.vendor.create({ data: { name: input.workspaceName, slug: `${slugBase}-${randomUUID()}`, email: input.email, passwordHash } });
      await tx.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: "owner", status: "active" } });
      await tx.userOnboardingPreference.create({ data: { userId: user.id, vendorId: vendor.id, questionnaireStep: 0 } });
      await tx.auditLog.create({ data: { vendorId: vendor.id, actorId: user.id, actorLabel: "owner", action: "registration_completed", targetType: "User", targetId: user.id } });
      return { userId: user.id, vendorId: vendor.id };
    });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    redirect(`/register?error=${duplicate ? "exists" : "temporarily_unavailable"}`);
  }
  try {
    const session = await createUserSession({ ...created, ipAddress: incoming.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: incoming.get("user-agent") });
    const store = await cookies();
    store.set(AUTH_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    store.delete(LEGACY_VENDOR_COOKIE);
  } catch {
    // Provisioning has committed: offer login recovery instead of asking for another signup.
    redirect("/login?registered=1");
  }
  redirect("/welcome");
}
