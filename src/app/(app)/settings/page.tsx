import { redirect } from "next/navigation";
import { requireVendorContext } from "@/lib/auth";

export default async function SettingsPage() {
  const { auth } = await requireVendorContext();
  redirect(auth.member?.role === "support" ? "/settings/security" : "/settings/brand");
}
