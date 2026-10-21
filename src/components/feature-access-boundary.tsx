"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@/components/ui";
import { hasVendorFeature, isBetaGatedFeature, requiredFeatureForPath, type GatedFeature } from "@/lib/vendor-feature-toggles";

/**
 * UX only: hides a module the vendor has not enabled. Every page, Server
 * Action and route handler behind it enforces the same rule on the server
 * through `@/lib/feature-gates` (F-001).
 */
export function FeatureAccessBoundary({ children, enabledModules }: { children: React.ReactNode; enabledModules?: readonly GatedFeature[] }) {
  const pathname = usePathname();
  const requiredFeature = requiredFeatureForPath(pathname);
  const unavailable = requiredFeature && enabledModules && !hasVendorFeature(enabledModules, requiredFeature);

  if (!unavailable) return children;
  const betaOnly = isBetaGatedFeature(requiredFeature);

  return (
    <div className="mx-auto max-w-2xl py-12" data-feature-disabled={requiredFeature}>
      <Card>
        <p className="text-sm font-semibold text-primary">功能尚未啟用</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">這個模組目前保持隱藏</h1>
        {betaOnly ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">此功能在封測期間尚未開放；如需使用，請聯絡平台客服評估是否為你的商店個別開啟。既有資料仍安全保留。</p>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-600">該功能目前尚未在此特店啟用，可至功能設定中心一鍵開啟。既有資料仍安全保留，不會因停用而刪除。</p>
            <Link href="/settings/features" className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">前往功能設定中心</Link>
          </>
        )}
      </Card>
    </div>
  );
}
