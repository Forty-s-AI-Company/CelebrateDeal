import { notFound } from "next/navigation";
import { FunnelEditorBrowserHarness } from "@/components/landing-pages/funnel-editor-browser-harness";

export default function FunnelEditorBrowserHarnessPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <FunnelEditorBrowserHarness />;
}
