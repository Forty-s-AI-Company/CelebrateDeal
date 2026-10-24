import { FeatureAccessBoundary } from "@/components/feature-access-boundary";
import { requireVendorManager } from "@/lib/auth";
import { enabledFeaturesForVendor } from "@/lib/vendor-feature-toggles";

/**
 * Full-screen editors render without the AppShell (sidebar, onboarding panel).
 * The same vendor-manager session and module gate apply as inside `(app)`;
 * every page below still performs its own scoped data checks.
 */
export default async function FullScreenEditorLayout({ children }: { children: React.ReactNode }) {
  const vendor = await requireVendorManager();
  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-100">
    <FeatureAccessBoundary enabledModules={enabledFeaturesForVendor(vendor)}>{children}</FeatureAccessBoundary>
  </div>;
}
