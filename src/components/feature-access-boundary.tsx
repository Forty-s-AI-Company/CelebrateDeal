"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@/components/ui";
import { hasVendorFeature, requiredFeatureForPath, type VendorFeatureModule } from "@/lib/vendor-feature-toggles";

export function FeatureAccessBoundary({ children, enabledModules }: { children: React.ReactNode; enabledModules?: readonly VendorFeatureModule[] }) {
  const pathname = usePathname();
  const requiredFeature = requiredFeatureForPath(pathname);
  const unavailable = requiredFeature && enabledModules && !hasVendorFeature(enabledModules, requiredFeature);

  if (!unavailable) return children;

  return (
    <div className="mx-auto max-w-2xl py-12" data-feature-disabled={requiredFeature}>
      <Card>
        <p className="text-sm font-semibold text-primary">功能尚未啟用</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">這個模組目前保持隱藏</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">該功能目前尚未在此特店啟用，可至功能設定中心一鍵開啟。既有資料仍安全保留，不會因停用而刪除。</p>
        <Link href="/settings/features" className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">前往功能設定中心</Link>
      </Card>
    </div>
  );
}
