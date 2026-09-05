import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticateUser, getCurrentAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

const AffiliatePortalCode = z.string().trim().min(1).max(80).transform((value) => value.toUpperCase());

export async function authenticateAffiliatePortal(email: string, password: string, code: string) {
  const normalizedCode = AffiliatePortalCode.safeParse(code);
  if (!normalizedCode.success) return null;

  const auth = await authenticateUser(email.trim().toLowerCase(), password);
  if (!auth) return null;

  const affiliate = await getDb().affiliate.findFirst({
    where: {
      userId: auth.user.id,
      code: normalizedCode.data,
      isActive: true,
    },
    select: { id: true, vendorId: true, name: true, code: true },
  });
  return affiliate ? { user: auth.user, affiliate } : null;
}

/**
 * Resolves the portal principal from server-owned session state. Every caller
 * receives both tenant and affiliate identifiers and must keep both filters.
 */
export async function requireAffiliatePortal() {
  const auth = await getCurrentAuth();
  const vendorId = auth?.session.vendorId;
  if (!auth || !vendorId) redirect("/affiliate-portal/login");

  const affiliate = await getDb().affiliate.findFirst({
    where: { vendorId, userId: auth.user.id, isActive: true },
    include: { vendor: true },
  });
  if (!affiliate) redirect("/affiliate-portal/login?error=unauthorized");

  return { auth, affiliate, vendor: affiliate.vendor };
}

