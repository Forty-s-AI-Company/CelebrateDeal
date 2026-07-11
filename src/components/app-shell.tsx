import Link from "next/link";
import { Ban, Banknote, BarChart3, Bell, Bot, Boxes, ClipboardList, Cloud, CreditCard, Gauge, GraduationCap, Handshake, Lock, Palette, PlaySquare, Radio, ReceiptText, ScrollText, Shield, Tags, WalletCards } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";

const vendorNavGroups = [
  {
    label: "營運",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge },
      { href: "/lives", label: "直播間", icon: Radio },
      { href: "/courses", label: "課程與銷講", icon: GraduationCap },
      { href: "/videos", label: "影片", icon: PlaySquare },
      { href: "/products", label: "商品", icon: Boxes },
      { href: "/forms", label: "報名表", icon: ClipboardList },
      { href: "/messages/templates", label: "訊息模板", icon: Bell },
      { href: "/messages/deliveries", label: "通知紀錄", icon: Bell },
    ],
  },
  {
    label: "自動化",
    items: [
      { href: "/interaction-scripts", label: "互動腳本", icon: ScrollText },
      { href: "/interaction-roles", label: "互動角色", icon: Bot },
      { href: "/blacklists", label: "黑名單", icon: Ban },
      { href: "/affiliates", label: "聯盟夥伴", icon: Handshake },
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
    ],
  },
  {
    label: "設定",
    items: [
      { href: "/settings/brand", label: "品牌", icon: Palette },
      { href: "/settings/tracking", label: "追蹤", icon: BarChart3 },
      { href: "/settings/security", label: "安全", icon: Shield },
    ],
  },
];

const adminNavGroups = [
  {
    label: "平台營運",
    items: [
      { href: "/admin/billing/dashboard", label: "財務總覽", icon: Shield },
      { href: "/admin/billing/settlements", label: "月結管理", icon: WalletCards },
      { href: "/admin/billing/payouts", label: "批次出款", icon: Banknote },
      { href: "/admin/billing/affiliate-payouts", label: "聯盟出款", icon: Handshake },
      { href: "/admin/billing/webhooks", label: "Webhook 對帳", icon: ReceiptText },
      { href: "/admin/billing/external-orders", label: "外部訂單證據", icon: ClipboardList },
      { href: "/admin/cloudflare/videos", label: "Stream 檢查", icon: Cloud },
    ],
  },
];

export function AppShell({
  children,
  vendorName,
  mode = "vendor",
}: {
  children: React.ReactNode;
  vendorName: string;
  mode?: "vendor" | "admin";
}) {
  const navGroups = mode === "admin" ? adminNavGroups : vendorNavGroups;
  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-border bg-white p-4 lg:flex">
        <Link href={mode === "admin" ? "/admin/billing/dashboard" : "/dashboard"} className="mb-6 flex shrink-0 items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-white">
            <Tags size={20} />
          </span>
          <span>
            <span className="block text-sm font-bold text-slate-950">CelebrateDeal</span>
            <span className="block text-xs text-slate-500">{vendorName}</span>
          </span>
        </Link>

        <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          {navGroups.map((group) => (
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

        <form action={logoutAction} className="mt-4 shrink-0">
          <CsrfField />
          <button className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <Lock size={16} />
            登出
          </button>
        </form>
      </aside>

      <header className="sticky top-0 z-20 border-b border-border bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between">
          <Link href={mode === "admin" ? "/admin/billing/dashboard" : "/dashboard"} className="font-bold text-slate-950">CelebrateDeal</Link>
          <form action={logoutAction}>
            <CsrfField />
            <button className="rounded-md border border-border px-3 py-1.5 text-sm font-semibold text-slate-600">登出</button>
          </form>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {navGroups.flatMap((group) => group.items).map((item) => (
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
