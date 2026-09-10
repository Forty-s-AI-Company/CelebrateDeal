import Link from "next/link";
import { Activity, Ban, Banknote, BarChart3, Bell, Bot, Boxes, CalendarCheck, ClipboardList, Cloud, CreditCard, Gauge, GitCompareArrows, Handshake, Headphones, Lock, LogOut, PackageCheck, Palette, PlaySquare, Radio, ReceiptText, Rocket, ScrollText, Settings2, Shield, Tags, UsersRound, WalletCards } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { AppShellNavLink } from "@/components/app-shell-nav-link";
import { AppShellNavGroup } from "@/components/app-shell-nav-group";
import { AppShellAccountMenu } from "@/components/app-shell-account-menu";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { FeatureAccessBoundary } from "@/components/feature-access-boundary";
import { hasVendorFeature, type VendorFeatureModule } from "@/lib/vendor-feature-toggles";

const navGroups = [
  {
    label: "營運總覽",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Gauge },
    ],
  },
  {
    label: "銷講中心",
    items: [
      { href: "/lives", label: "直播間", icon: Radio, managerOnly: true, feature: "live_webinar" },
      { href: "/videos", label: "媒體素材", icon: PlaySquare, managerOnly: true, feature: "live_webinar" },
      { href: "/forms", label: "報名管理", icon: ClipboardList, managerOnly: true, feature: "funnel_builder" },
    ],
  },
  {
    label: "成交管理",
    items: [
      { href: "/products", label: "商品", icon: Boxes, managerOnly: true },
      { href: "/orders", label: "訂單管理", icon: PackageCheck, managerOnly: true },
      { href: "/consultations", label: "諮詢預約", icon: CalendarCheck, managerOnly: true, feature: "consultation_booking" },
      { href: "/customers", label: "學員 CRM", icon: UsersRound, managerOnly: true },
      { href: "/support-cases", label: "售後服務", icon: Headphones, managerOnly: true },
    ],
  },
  {
    label: "互動與行銷",
    items: [
      { href: "/messages/templates", label: "訊息模板", icon: Bell, managerOnly: true },
      { href: "/messages/deliveries", label: "寄送紀錄", icon: ReceiptText, managerOnly: true },
      { href: "/interaction-scripts", label: "互動腳本", icon: ScrollText, managerOnly: true, feature: "live_webinar" },
      { href: "/interaction-roles", label: "互動角色", icon: Bot, managerOnly: true, feature: "live_webinar" },
      { href: "/blacklists", label: "封鎖名單", icon: Ban, managerOnly: true },
    ],
  },
  {
    label: "夥伴成長",
    items: [
      { href: "/affiliates", label: "推廣夥伴", icon: Handshake, managerOnly: true, feature: "affiliate_program" },
      { href: "/team-templates", label: "團隊模板", icon: UsersRound, feature: "funnel_builder" },
      { href: "/team-performance", label: "成效分析", icon: BarChart3, feature: "affiliate_program" },
    ],
  },
  {
    label: "設定",
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
      { href: "/onboarding", label: "上線導引", icon: Rocket, managerOnly: true },
      { href: "/settings/brand", label: "品牌設定", icon: Palette, managerOnly: true },
      { href: "/settings/tracking", label: "追蹤", icon: BarChart3, managerOnly: true },
      { href: "/settings/features", label: "功能模組", icon: Settings2, managerOnly: true },
      { href: "/settings/commissions", label: "分潤規則", icon: Handshake, managerOnly: true, feature: "affiliate_program" },
      { href: "/settings/automations", label: "自動化", icon: Bot, managerOnly: true },
      { href: "/settings/team", label: "團隊管理", icon: UsersRound, managerOnly: true },
      { href: "/settings/security", label: "安全性", icon: Shield },
    ],
  },
  {
    label: "平台營運",
    items: [
      { href: "/admin/billing/dashboard", label: "平台財務管理", icon: Shield, adminOnly: true },
      { href: "/admin/billing/stream-reconciliation", label: "Stream 用量對帳", icon: GitCompareArrows, adminOnly: true },
      { href: "/admin/billing/webhooks", label: "Webhook 對帳", icon: ReceiptText, adminOnly: true },
      { href: "/admin/support-cases", label: "退款客服交接", icon: Headphones, adminOnly: true },
      { href: "/admin/cloudflare/videos", label: "Stream 檢查", icon: Cloud, adminOnly: true },
    ],
  },
];

const accountMenuGroupLabels = new Set(["設定"]);

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
  planLabel = "Free",
}: {
  children: React.ReactNode;
  vendorName: string;
  memberRole: string | null;
  isPlatformAdmin?: boolean;
  enabledModules?: readonly VendorFeatureModule[];
  planLabel?: string;
}) {
  const visibleGroups = navigationForRole(memberRole, isPlatformAdmin, enabledModules);
  const primaryGroups = visibleGroups.filter((group) => !accountMenuGroupLabels.has(group.label));
  const accountItems = visibleGroups
    .filter((group) => accountMenuGroupLabels.has(group.label))
    .flatMap((group) => group.items);
  const accountItemByHref = new Map(accountItems.map((item) => [item.href, item]));
  const accountMenuSections = [
    { label: "工作區", hrefs: ["/onboarding", "/settings/brand"] },
    { label: "系統設定", hrefs: ["/settings/tracking", "/settings/features", "/settings/commissions", "/settings/automations", "/settings/team", "/settings/security"] },
    { label: "帳務與方案", hrefs: ["/billing/usage", "/billing/payment-methods", "/billing/plans", "/billing/invoices", "/billing/electronic-invoices", "/billing/settlements", "/billing/payouts", "/affiliates/commissions", "/billing/course-payouts"] },
  ];
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
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform focus:translate-y-0"
      >
        跳至主要內容
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-slate-200 bg-white px-3 pb-3 pt-4 text-slate-900 lg:flex">
        <Link href={homeHref} className="mb-5 flex min-h-14 shrink-0 items-center gap-3 rounded-xl px-2 transition-colors hover:bg-slate-50">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-200">
            <Tags size={19} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold tracking-tight text-slate-900">CelebrateDeal</span>
            <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-400">Live Commerce OS</span>
          </span>
          <span className="rounded-md border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-700">Beta</span>
        </Link>

        <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-color:rgba(148,163,184,0.45)_transparent] [scrollbar-width:thin]" aria-label="主要導覽">
          {primaryGroups.map((group) => {
            if (group.items.length === 1 && group.items[0]?.href === "/dashboard") {
              const item = group.items[0];
              return (
                <AppShellNavLink key={item.href} href={item.href}>
                  <item.icon className="size-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-700 group-aria-[current=page]:text-blue-600" strokeWidth={1.8} aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </AppShellNavLink>
              );
            }

            return (
              <AppShellNavGroup key={group.label} label={group.label} hrefs={group.items.map((item) => item.href)}>
                {group.items.map((item) => (
                  <AppShellNavLink key={item.href} href={item.href}>
                    <item.icon className="size-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-700 group-aria-[current=page]:text-blue-600" strokeWidth={1.8} aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </AppShellNavLink>
                ))}
              </AppShellNavGroup>
            );
          })}
        </nav>

        <div className="mt-3 shrink-0 border-t border-slate-200 pt-3">
          <div className="mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-2"><span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex size-2 rounded-full bg-emerald-500" /></span>系統連線正常</span>
            <Activity className="size-3.5" aria-hidden="true" />
          </div>
          <AppShellAccountMenu vendorName={vendorName} roleLabel={roleLabel} vendorInitial={vendorInitial} planLabel={planLabel}>
            {accountMenuSections.map((section) => {
              const items = section.hrefs.flatMap((href) => {
                const item = accountItemByHref.get(href);
                return item ? [item] : [];
              });
              if (items.length === 0) return null;
              return (
                <div key={section.label} className="border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
                  <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{section.label}</p>
                  {items.map((item) => {
                    const Icon = item.icon;
                    return <Link key={item.href} href={item.href} className="flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"><Icon className="size-4 text-slate-400" strokeWidth={1.8} aria-hidden="true" />{item.label}</Link>;
                  })}
                </div>
              );
            })}
            <div className="border-t border-slate-100 pt-2">
              <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">支援</p>
              <Link href="/policies" className="flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"><ScrollText className="size-4 text-slate-400" strokeWidth={1.8} aria-hidden="true" />說明與政策</Link>
              <Link href="/support" className="flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"><Headphones className="size-4 text-slate-400" strokeWidth={1.8} aria-hidden="true" />聯絡客服</Link>
            </div>
            <div className="border-t border-slate-100 pt-2">
              <form action={logoutAction}>
                <CsrfField />
                <FormSubmitButton
                  pendingChildren="登出中…"
                  pendingMessage="正在撤銷目前 session 並登出，請勿重複送出。"
                  className="flex min-h-10 w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-700"
                >
                  <LogOut className="size-4 text-slate-400" strokeWidth={1.8} aria-hidden="true" />
                  登出
                </FormSubmitButton>
              </form>
            </div>
          </AppShellAccountMenu>
        </div>
      </aside>

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm lg:hidden">
        <div className="flex items-center justify-between">
          <Link href={homeHref} className="inline-flex min-h-11 items-center gap-2.5 font-semibold text-slate-900">
            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600"><Tags className="size-4" aria-hidden="true" /></span>
            <span><span className="block text-sm">CelebrateDeal</span><span className="block max-w-40 truncate text-[10px] font-medium text-slate-400">{vendorName}</span></span>
          </Link>
          <form action={logoutAction}>
            <CsrfField />
            <FormSubmitButton
              pendingChildren="登出中…"
              pendingMessage="正在撤銷目前 session 並登出，請勿重複送出。"
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600"
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
      </main>
    </div>
  );
}
