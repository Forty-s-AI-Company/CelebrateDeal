import { notFound } from "next/navigation";
import { FunnelDesignBrowserHarness } from "@/components/landing-pages/funnel-design-browser-harness";

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function FunnelDesignBrowserHarnessPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  return <FunnelDesignBrowserHarness template={single(params.template)} block={single(params.block)} category={single(params.category)} viewport={single(params.viewport) === "mobile" ? "mobile" : "desktop"} />;
}
