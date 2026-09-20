import { notFound } from "next/navigation";
import { FunnelAdvancedBrowserHarness } from "@/components/landing-pages/funnel-advanced-browser-harness";

export default function FunnelElementsBrowserHarnessPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <FunnelAdvancedBrowserHarness />;
}
