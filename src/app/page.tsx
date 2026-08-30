import { redirect } from "next/navigation";
import { getCurrentVendor } from "@/lib/auth";

export default async function HomePage() {
  const vendor = await getCurrentVendor();
  // Preserve the public root-entry context after redirecting anonymous visitors
  // so the announcement can open once without blocking direct login flows.
  redirect(vendor ? "/dashboard" : "/login?from=home");
}
