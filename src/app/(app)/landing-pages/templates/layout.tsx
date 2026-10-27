import type { ReactNode } from "react";
import { FunnelCustomCodeRuntime } from "@/components/landing-pages/funnel-custom-code-runtime";

/**
 * Template thumbnails and previews render custom code nodes (their HTML, in the sandbox).
 * The library strips template JS before rendering; the runtime still carries the
 * emergency switch (FUNNEL_CUSTOM_CODE_DISABLED) here like every other surface.
 */
export default function FunnelCustomCodeRuntimeLayout({ children }: { children: ReactNode }) {
  return <FunnelCustomCodeRuntime>{children}</FunnelCustomCodeRuntime>;
}
