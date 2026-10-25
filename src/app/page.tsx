import { redirect } from "next/navigation";
import { getCurrentAuth } from "@/lib/auth";
import { PARTNER_PORTAL_PATH } from "@/lib/vendor-roles";

export default async function HomePage() {
  const auth = await getCurrentAuth();
  // Preserve the public root-entry context after redirecting anonymous visitors
  // so the announcement can open once without blocking direct login flows.
  // A partner-only account has no merchant back office; it lands on its portal.
  redirect(auth?.vendor ? "/dashboard" : auth?.partnerPortalOnly ? PARTNER_PORTAL_PATH : "/login?from=home");
}
