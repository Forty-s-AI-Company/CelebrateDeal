import { notFound } from "next/navigation";
import { FunnelCustomCodeBrowserHarness, type FunnelCustomCodeHarnessVariant } from "@/components/landing-pages/funnel-custom-code-browser-harness";
import { isFunnelCustomCodeDisabled } from "@/lib/funnel-custom-code";

const VARIANTS = new Set<FunnelCustomCodeHarnessVariant>(["probe", "hide", "overlay"]);

export default async function FunnelCustomCodeBrowserHarnessPage({ searchParams }: { searchParams: Promise<{ variant?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const requested = (await searchParams).variant;
  const variant = requested && VARIANTS.has(requested as FunnelCustomCodeHarnessVariant) ? requested as FunnelCustomCodeHarnessVariant : "probe";
  // A different origin (localhost vs 127.0.0.1) for the popup target, so opener access would be cross-origin.
  return <FunnelCustomCodeBrowserHarness variant={variant} popupHref="http://localhost:31025/browser-qa/funnel-elements/custom-code?variant=probe&popup=1" scriptsEnabled={!isFunnelCustomCodeDisabled()} />;
}
