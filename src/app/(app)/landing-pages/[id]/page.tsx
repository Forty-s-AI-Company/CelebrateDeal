import { redirect } from "next/navigation";
import { requireVendorManager } from "@/lib/auth";
import { landingPageEditorHref } from "@/lib/landing-page-editor-href";

/** The editor moved to the full-screen `/edit` route; keep old links working. */
export default async function LegacyLandingPageEditorRedirect({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string | string[] }> }) {
  const { id } = await params;
  const query = await searchParams;
  await requireVendorManager();
  redirect(landingPageEditorHref(id, query.step));
}
