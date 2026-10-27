import type { ReactNode } from "react";
import { FunnelCustomCodeSurfaceProvider } from "@/components/landing-pages/sandboxed-html";
import { PublicTrackingTagScripts } from "@/components/landing-pages/public-tracking-tags";
import { loadPublicFunnelTrackingTags } from "@/lib/public-funnel-tracking";

/**
 * 公開一頁式網站（`/lp/*`）。這些回應帶 `Cross-Origin-Opener-Policy: same-origin`
 * （見 next.config.ts），所以只有這裡允許自訂程式碼開新分頁。
 */
export default async function PublicFunnelLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const tags = await loadPublicFunnelTrackingTags((await params).slug);
  return <FunnelCustomCodeSurfaceProvider allowPopups>
    {children}
    <PublicTrackingTagScripts tags={tags} />
  </FunnelCustomCodeSurfaceProvider>;
}
