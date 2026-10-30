"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SETTINGS_HUB_PATH } from "@/lib/settings-paths";

/**
 * 「← 設定」 breadcrumb shared by every settings and billing page. It lives in
 * the segment layouts so no page has to repeat it, and hides itself on the
 * hub page where it would link to itself.
 */
export function SettingsBackLink() {
  const pathname = usePathname();
  if (pathname === SETTINGS_HUB_PATH) return null;

  return (
    <nav aria-label="設定導覽" className="mb-2 print:hidden">
      <Link
        href={SETTINGS_HUB_PATH}
        aria-label="返回設定"
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        設定
      </Link>
    </nav>
  );
}
