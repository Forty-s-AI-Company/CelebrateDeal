import type { ReactNode } from "react";
import { FunnelCustomCodeRuntime } from "@/components/landing-pages/funnel-custom-code-runtime";

/** The emergency switch (FUNNEL_CUSTOM_CODE_DISABLED) is read on the server for this admin preview surface. */
export default function FunnelCustomCodeRuntimeLayout({ children }: { children: ReactNode }) {
  return <FunnelCustomCodeRuntime>{children}</FunnelCustomCodeRuntime>;
}
