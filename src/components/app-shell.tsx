import Link from "next/link";
import { Ban, Banknote, BarChart3, Bell, Bot, Boxes, ClipboardList, Cloud, CreditCard, Gauge, GitCompareArrows, Handshake, Headphones, Lock, PackageCheck, Palette, PlaySquare, Radio, ReceiptText, Rocket, ScrollText, Shield, Tags, UsersRound, WalletCards } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { PublicResourceLinks } from "@/components/public-policy";

const navGroups = [
  {
    label: "營運",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge },
      { href: "/lives", label: "直播間", icon: Radio, managerOnly: true },
      { href: "/videos", label: "影片", icon: PlaySquare, managerOnly: true },
      { href: "/products", label: "商品", icon: Boxes, managerOnly: true },
      { href: "/orders", label: "訂單與履約", icon: PackageCheck, managerOnly: true },
      { href: "/support-cases", label: "客服案件", icon: Headphones, managerOnly: true },
      { href: "/forms", label: "報名表", icon: ClipboardList, managerOnly: true },
      { href: "/messages/templates", label: "訊息模板", icon: Bell, managerOnly: true },
      { href: "/messages/deliveries", label: "寄送紀錄", icon: ReceiptText, managerOnly: true },
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
      { href: "/billing/usage", label: "用量與扣點", icon: CreditCard, financeOnly: true },
      { href: "/billing/payment-methods", label: "付款方式", icon: CreditCard, financeOnly: true },
      { href: "/billing/plans", label: "方案", icon: Tags, financeOnly: true },
      { href: "/billing/invoices", label: "帳單", icon: ReceiptText, financeOnly: true },
      { href: "/billing/settlements", label: "月結", icon: WalletCards, financeOnly: true },
      { href: "/billing/payouts", label: "批次出款", icon: Banknote, financeOnly: true },
      { href: "/affiliates/commissions", label: "聯盟佣金", icon: Handshake, financeOnly: true },
      { href: "/billing/course-payouts", label: "課程分潤", icon: WalletCards, financeOnly: true },
      { href: "/admin/billing/dashboard", label: "平台財務管理", icon: Shield, adminOnly: true },
      { href: "/admin/billing/stream-reconciliation", label: "Stream 用量對帳", icon: GitCompareArrows, adminOnly: true },
      { href: "/admin/billing/webhooks", label: "Webhook 對帳", icon: ReceiptText, adminOnly: true },
      { href: "/admin/support-cases", label: "退款客服交接", icon: Headphones, adminOnly: true },
      { href: "/admin/cloudflare/videos", label: "Stream 檢查", icon: Cloud, adminOnly: true },
    ],
  },
  {
    label: "設定",
    items: [
      { href: "/onboarding", label: "上線導引", icon: Rocket, managerOnly: true },
      { href: "/settings/brand", label: "品牌", icon: Palette, managerOnly: true },
      { href: "/settings/tracking", label: "追蹤", icon: BarChart3, managerOnly: true },
      { href: "/settings/commissions", label: "分潤規則", icon: Handshake, managerOnly: true },
      { href: "/settings/security", label: "安全", icon: Shield },
    ],
  },
];

export function navigationForRole(memberRole: string | null, isPlatformAdmin = false) {
  if (isPlatformAdmin) {
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => "adminOnly" in item && item.adminOnly),
      }))
      .filter((group) => group.items.length > 0);
  }

  if (memberRole === "support") {
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.href === "/support-cases" || item.href === "/settings/security"),
      }))
      .filter((group) => group.items.length > 0);
  }

  if (memberRole !== "owner" && memberRole !== "admin" && memberRole !== "accountant") {
    return [];
  }

  const isManager = memberRole === "owner" || memberRole === "admin";
  const isFinance = isManager || memberRole === "accountant";
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const adminOnly = "adminOnly" in item && item.adminOnly;
        if (adminOnly) return false;
        if ("financeOnly" in item && item.financeOnly && !isFinance) return false;
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
  const homeHref = memberRole === "support" && !isPlatformAdmin ? "/support-cases" : "/dashboard";

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform focus:translate-y-0"
      >
        跳至主要內容
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-border bg-white p-4 lg:flex">
        <Link href={homeHref} className="mb-8 flex min-h-11 shrink-0 items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-white">
            <Tags size={20} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-bold text-slate-950">CelebrateDeal</span>
            <span className="block text-xs text-slate-500">{vendorName}</span>
          </span>
        </Link>

        <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1" aria-label="主要導覽">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-2 text-xs font-semibold uppercase text-slate-600">{group.label}</p>
              <div className="grid gap-1">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-blue-50 hover:text-primary"
                  >
                    <item.icon size={17} aria-hidden="true" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <form action={logoutAction} className="mt-4 shrink-0">
          <CsrfField />
          <FormSubmitButton
            pendingChildren="登出中…"
            pendingMessage="正在撤銷目前 session 並登出，請勿重複送出。"
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Lock size={16} aria-hidden="true" />
            登出
          </FormSubmitButton>
        </form>
      </aside>

      <header className="sticky top-0 z-20 border-b border-border bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between">
          <Link href={homeHref} className="inline-flex min-h-11 items-center font-bold text-slate-950">CelebrateDeal</Link>
          <form action={logoutAction}>
            <CsrfField />
            <FormSubmitButton
              pendingChildren="登出中…"
              pendingMessage="正在撤銷目前 session 並登出，請勿重複送出。"
              className="min-h-11 rounded-md border border-border px-3 py-2 text-sm font-semibold text-slate-600"
            >
              登出
            </FormSubmitButton>
          </form>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="行動版主要導覽">
          {visibleGroups.flatMap((group) => group.items).map((item) => (
            <Link key={item.href} href={item.href} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className="px-4 py-6 lg:ml-64 lg:px-8">
        {children}
        <footer className="mx-auto mt-12 max-w-5xl border-t border-border pt-5">
          <p className="mb-3 text-xs font-semibold text-slate-600">公開資訊與客服</p>
          <PublicResourceLinks />
        </footer>
      </main>
    </div>
  );
}
