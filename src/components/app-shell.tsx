import Link from "next/link";
import { Activity, Ban, Banknote, BarChart3, Bell, Bot, Boxes, CalendarCheck, ClipboardList, Cloud, CreditCard, Gauge, GitCompareArrows, Handshake, Headphones, Lock, LogOut, PackageCheck, Palette, PlaySquare, Radio, ReceiptText, Rocket, ScrollText, Settings2, Shield, Tags, UsersRound, WalletCards } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { AppShellNavLink } from "@/components/app-shell-nav-link";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { PublicResourceLinks } from "@/components/public-policy";
import { FeatureAccessBoundary } from "@/components/feature-access-boundary";
import { hasVendorFeature, type VendorFeatureModule } from "@/lib/vendor-feature-toggles";

const navGroups = [
  {
    label: "營運",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge },
      { href: "/lives", label: "直播間", icon: Radio, managerOnly: true, feature: "live_webinar" },
      { href: "/videos", label: "影片", icon: PlaySquare, managerOnly: true, feature: "live_webinar" },
      { href: "/products", label: "商品", icon: Boxes, managerOnly: true },
      { href: "/orders", label: "訂單與履約", icon: PackageCheck, managerOnly: true },
      { href: "/support-cases", label: "客服案件", icon: Headphones, managerOnly: true },
      { href: "/forms", label: "報名表", icon: ClipboardList, managerOnly: true, feature: "funnel_builder" },
      { href: "/consultations", label: "諮詢預約", icon: CalendarCheck, managerOnly: true, feature: "consultation_booking" },
      { href: "/customers", label: "學員 CRM", icon: UsersRound, managerOnly: true },
      { href: "/messages/templates", label: "訊息模板", icon: Bell, managerOnly: true },
      { href: "/messages/deliveries", label: "寄送紀錄", icon: ReceiptText, managerOnly: true },
    ],
  },
  {
    label: "自動化",
    items: [
      { href: "/interaction-scripts", label: "互動腳本", icon: ScrollText, managerOnly: true, feature: "live_webinar" },
      { href: "/interaction-roles", label: "互動角色", icon: Bot, managerOnly: true, feature: "live_webinar" },
      { href: "/blacklists", label: "黑名單", icon: Ban, managerOnly: true },
      { href: "/affiliates", label: "推廣夥伴", icon: Handshake, managerOnly: true, feature: "affiliate_program" },
      { href: "/team-templates", label: "團隊展業", icon: UsersRound, feature: "funnel_builder" },
      { href: "/team-performance", label: "展業成效", icon: BarChart3, feature: "affiliate_program" },
    ],
  },
  {
    label: "用量",
    items: [
      { href: "/billing/usage", label: "用量與扣點", icon: CreditCard, financeOnly: true },
      { href: "/billing/payment-methods", label: "付款方式", icon: CreditCard, financeOnly: true },
      { href: "/billing/plans", label: "方案", icon: Tags, financeOnly: true },
      { href: "/billing/invoices", label: "帳單", icon: ReceiptText, financeOnly: true },
      { href: "/billing/electronic-invoices", label: "電子發票", icon: ReceiptText, financeOnly: true },
      { href: "/billing/settlements", label: "月結", icon: WalletCards, financeOnly: true },
      { href: "/billing/payouts", label: "稅務匯出", icon: Banknote, financeOnly: true, feature: "tax_remuneration" },
      { href: "/affiliates/commissions", label: "佣金結算", icon: Handshake, financeOnly: true, feature: "affiliate_program" },
      { href: "/billing/course-payouts", label: "勞報單審核", icon: WalletCards, financeOnly: true, feature: "tax_remuneration" },
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
      { href: "/settings/features", label: "功能模組", icon: Settings2, managerOnly: true },
      { href: "/settings/commissions", label: "分潤規則", icon: Handshake, managerOnly: true, feature: "affiliate_program" },
      { href: "/settings/automations", label: "自動化", icon: Bot, managerOnly: true },
      { href: "/settings/security", label: "安全", icon: Shield },
    ],
  },
];

export function navigationForRole(memberRole: string | null, isPlatformAdmin = false, enabledModules?: readonly VendorFeatureModule[]) {
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
        if ("managerOnly" in item && item.managerOnly && !isManager) return false;
        return !("feature" in item && item.feature) || !enabledModules || hasVendorFeature(enabledModules, item.feature as VendorFeatureModule);
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function AppShell({
  children,
  vendorName,
  memberRole,
  isPlatformAdmin = false,
  enabledModules,
}: {
  children: React.ReactNode;
  vendorName: string;
  memberRole: string | null;
  isPlatformAdmin?: boolean;
  enabledModules?: readonly VendorFeatureModule[];
}) {
  const visibleGroups = navigationForRole(memberRole, isPlatformAdmin, enabledModules);
  const homeHref = memberRole === "support" && !isPlatformAdmin ? "/support-cases" : "/dashboard";
  const roleLabel = isPlatformAdmin
    ? "平台管理員"
    : memberRole === "owner"
      ? "品牌擁有者"
      : memberRole === "admin"
        ? "品牌管理員"
        : memberRole === "accountant"
          ? "財務協作者"
          : memberRole === "support"
            ? "客服協作者"
            : "工作區成員";
  const vendorInitial = vendorName.trim().charAt(0).toUpperCase() || "C";

  return (
    <div className="min-h-screen bg-slate-50/80">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform focus:translate-y-0"
      >
        跳至主要內容
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-slate-800/80 bg-slate-950 px-3 pb-3 pt-4 text-white shadow-[8px_0_30px_rgba(15,23,42,0.08)] lg:flex">
        <Link href={homeHref} className="mb-4 flex min-h-14 shrink-0 items-center gap-3 rounded-xl px-2 transition-colors hover:bg-white/[0.04]">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-950/40 ring-1 ring-white/15">
            <Tags size={19} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold tracking-tight text-white">CelebrateDeal</span>
            <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-400">Live Commerce OS</span>
          </span>
          <span className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-300">Beta</span>
        </Link>

        <div className="mb-4 rounded-xl border border-white/[0.08] bg-gradient-to-b from-white/[0.07] to-white/[0.03] p-3 shadow-inner shadow-white/[0.02]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">目前工作區</p>
          <div className="mt-2 flex items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-xs font-bold text-slate-200 ring-1 ring-white/10">{vendorInitial}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-100">{vendorName}</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">{roleLabel}</span>
            </span>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 [scrollbar-color:rgba(148,163,184,0.25)_transparent] [scrollbar-width:thin]" aria-label="主要導覽">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">{group.label}</p>
              <div className="grid gap-0.5">
                {group.items.map((item) => (
                  <AppShellNavLink key={item.href} href={item.href}>
                    <item.icon className="size-4 shrink-0 text-slate-500 transition-colors group-hover:text-slate-300 group-aria-[current=page]:text-blue-400" strokeWidth={1.8} aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </AppShellNavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-3 shrink-0 border-t border-white/[0.08] pt-3">
          <div className="mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-2"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>系統連線正常</span>
            <Activity className="size-3.5" aria-hidden="true" />
          </div>
          <form action={logoutAction}>
            <CsrfField />
            <FormSubmitButton
              pendingChildren="登出中…"
              pendingMessage="正在撤銷目前 session 並登出，請勿重複送出。"
              className="flex min-h-10 w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              <LogOut className="size-4" strokeWidth={1.8} aria-hidden="true" />
              登出
            </FormSubmitButton>
          </form>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950 px-4 py-3 text-white shadow-sm lg:hidden">
        <div className="flex items-center justify-between">
          <Link href={homeHref} className="inline-flex min-h-11 items-center gap-2.5 font-semibold text-white">
            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600"><Tags className="size-4" aria-hidden="true" /></span>
            <span><span className="block text-sm">CelebrateDeal</span><span className="block max-w-40 truncate text-[10px] font-medium text-slate-400">{vendorName}</span></span>
          </Link>
          <form action={logoutAction}>
            <CsrfField />
            <FormSubmitButton
              pendingChildren="登出中…"
              pendingMessage="正在撤銷目前 session 並登出，請勿重複送出。"
              className="min-h-10 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-medium text-slate-300"
            >
              <Lock className="mr-1 inline size-3.5" aria-hidden="true" />
              登出
            </FormSubmitButton>
          </form>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="行動版主要導覽">
          {visibleGroups.flatMap((group) => group.items).map((item) => (
            <AppShellNavLink key={item.href} href={item.href} mobile>
              {item.label}
            </AppShellNavLink>
          ))}
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className="px-4 py-6 lg:ml-72 lg:px-8 xl:px-10">
        <FeatureAccessBoundary enabledModules={enabledModules}>{children}</FeatureAccessBoundary>
        <footer className="mx-auto mt-12 max-w-5xl border-t border-border pt-5">
          <p className="mb-3 text-xs font-semibold text-slate-600">公開資訊與客服</p>
          <PublicResourceLinks />
        </footer>
      </main>
    </div>
  );
}
