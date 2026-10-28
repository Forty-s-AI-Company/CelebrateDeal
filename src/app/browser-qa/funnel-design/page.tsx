import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { funnelViewportHint } from "@/lib/funnel-public-render-hints";
import { FunnelDesignBrowserHarness } from "@/components/landing-pages/funnel-design-browser-harness";

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function FunnelDesignBrowserHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  const requested = single(params.viewport);
  const viewport = requested === "responsive" ? "responsive" : requested === "mobile" ? "mobile" : "desktop";
  // Same first-paint hint as the public /lp routes, so the responsive mode measures what visitors get.
  const initialViewport = funnelViewportHint((await headers()).get("user-agent"));
  return <FunnelDesignBrowserHarness template={single(params.template)} block={single(params.block)} category={single(params.category)} viewport={viewport} stress={single(params.stress) === "1"} initialViewport={initialViewport} />;
}
