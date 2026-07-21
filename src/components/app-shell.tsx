import Link from "next/link";
import { Ban, Banknote, BarChart3, Bell, Bot, Boxes, ClipboardList, Cloud, CreditCard, Gauge, Handshake, Lock, Palette, PlaySquare, Radio, ReceiptText, ScrollText, Shield, Tags, UsersRound, WalletCards } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";

const navGroups = [
  {
    label: "營運",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge },
      { href: "/lives", label: "直播間", icon: Radio, managerOnly: true },
      { href: "/videos", label: "影片", icon: PlaySquare, managerOnly: true },
      { href: "/products", label: "商品", icon: Boxes, managerOnly: true },
      { href: "/forms", label: "報名表", icon: ClipboardList, managerOnly: true },
      { href: "/messages/templates", label: "訊息模板", icon: Bell, managerOnly: true },
    ],
  },
  {
    label: "自動化",
    items: [
      { href: "/interaction-scripts", label: "互動腳本", icon: ScrollText, managerOnly: true },
      { href: "/interaction-roles", label: "互動角色", icon: Bot, managerOnly: true },
      { href: "/blacklists", label: "黑名單", icon: Ban, managerOnly: true },
      { href: "/affiliates", label: "聯盟夥伴", icon: Handshake, managerOnly: true },
      { href: "/team-templates", label: "團隊展業", icon: UsersRound },
      { href: "/team-performance", label: "展業成效", icon: BarChart3 },
    ],
  },
  {
    label: "用量",
    items: [
      { href: "/billing/usage", label: "用量與扣點", icon: CreditCard },
      { href: "/billing/plans", label: "方案", icon: Tags },
      { href: "/billing/invoices", label: "帳單", icon: ReceiptText },
      { href: "/billing/settlements", label: "月結", icon: WalletCards },
      { href: "/billing/payouts", label: "批次出款", icon: Banknote },
      { href: "/affiliates/commissions", label: "聯盟佣金", icon: Handshake },
      { href: "/admin/billing/dashboard", label: "平台財務管理", icon: Shield, adminOnly: true },
      { href: "/admin/billing/webhooks", label: "Webhook 對帳", icon: ReceiptText, adminOnly: true },
      { href: "/admin/cloudflare/videos", label: "Stream 檢查", icon: Cloud, adminOnly: true },
    ],
  },
  {
    label: "設定",
    items: [
      { href: "/settings/brand", label: "品牌", icon: Palette, managerOnly: true },
      { href: "/settings/tracking", label: "追蹤", icon: BarChart3, managerOnly: true },
      { href: "/settings/security", label: "安全", icon: Shield },
    ],
  },
];

export function navigationForRole(memberRole: string | null, isPlatformAdmin = false) {
  const isManager = memberRole === "owner" || memberRole === "admin";
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const adminOnly = "adminOnly" in item && item.adminOnly;
        if (isPlatformAdmin) return adminOnly;
        if (adminOnly) return false;
        return !("managerOnly" in item && item.managerOnly) || isManager;
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function AppShell({
  children,
  vendorName,
  memberRole,
  isPlatformAdmin = false,
}: {
  children: React.ReactNode;
  vendorName: string;
  memberRole: string | null;
  isPlatformAdmin?: boolean;
}) {
  const visibleGroups = navigationForRole(memberRole, isPlatformAdmin);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-white p-4 lg:block">
        <Link href="/dashboard" className="mb-8 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-white">
            <Tags size={20} />
          </span>
          <span>
            <span className="block text-sm font-bold text-slate-950">CelebrateDeal</span>
            <span className="block text-xs text-slate-500">{vendorName}</span>
          </span>
        </Link>

        <nav className="space-y-6">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-2 text-xs font-semibold uppercase text-slate-400">{group.label}</p>
              <div className="grid gap-1">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-blue-50 hover:text-primary"
                  >
                    <item.icon size={17} />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <form action={logoutAction} className="absolute bottom-4 left-4 right-4">
          <CsrfField />
          <button className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <Lock size={16} />
            登出
          </button>
        </form>
      </aside>

      <header className="sticky top-0 z-20 border-b border-border bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="font-bold text-slate-950">CelebrateDeal</Link>
          <form action={logoutAction}>
            <CsrfField />
            <button className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-slate-600">登出</button>
          </form>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {visibleGroups.flatMap((group) => group.items).map((item) => (
            <Link key={item.href} href={item.href} className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              {item.label}
            </Link>
          ))}
        </div>
      </header>

      <main className="px-4 py-6 lg:ml-64 lg:px-8">{children}</main>
    </div>
  );
}
