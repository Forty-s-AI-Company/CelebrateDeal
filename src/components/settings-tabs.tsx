"use client";

import { BarChart3, Bot, Handshake, Palette, Settings2, Shield, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const settingsTabs = [
  { href: "/settings/brand", label: "品牌設定", icon: Palette },
  { href: "/settings/tracking", label: "追蹤與分析", icon: BarChart3 },
  { href: "/settings/features", label: "功能模組", icon: Settings2 },
  { href: "/settings/commissions", label: "分潤規則", icon: Handshake },
  { href: "/settings/automations", label: "自動化", icon: Bot },
  { href: "/settings/team", label: "團隊管理", icon: UsersRound },
  { href: "/settings/security", label: "安全性", icon: Shield },
] as const;

export function SettingsTabs({ allowedHrefs }: { allowedHrefs: readonly string[] }) {
  const pathname = usePathname();

  return (
    <nav className="mt-3 grid gap-1" aria-label="設定頁籤">
      {settingsTabs.filter((tab) => allowedHrefs.includes(tab.href)).map((tab) => {
        const isActive = pathname === tab.href || Boolean(pathname?.startsWith(`${tab.href}/`));
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}
          >
            <Icon className={`size-4 ${isActive ? "text-blue-600" : "text-slate-400"}`} strokeWidth={1.8} aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
