import Link from "next/link";
import { Headphones, Lock, LogOut, ScrollText, Settings2, Shield, Tags } from "lucide-react";
import { PublicResourceLinks } from "@/components/public-policy";
import { logoutAction } from "@/app/actions";
import { AppShellMobileNav } from "@/components/app-shell-mobile-nav";
import { AppShellNavLink } from "@/components/app-shell-nav-link";
import { AppShellNavGroup } from "@/components/app-shell-nav-group";
import { AppShellAccountMenu } from "@/components/app-shell-account-menu";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { FeatureAccessBoundary } from "@/components/feature-access-boundary";
import { type GatedFeature } from "@/lib/vendor-feature-toggles";
import { navigationForRole, SECURITY_SETTINGS_PATH, SETTINGS_HUB_PATH, settingsHubForRole } from "@/lib/app-navigation";
import { WorkspaceProjectSwitcher, type ProjectSwitcherItem } from "@/components/workspace-project-switcher";
import { SystemStatusIndicator } from "@/components/system-status-indicator";
import { OnboardingTaskPanel, type SidebarOnboardingTask } from "@/components/onboarding-task-panel";
import { isVendorPartnerRole, PARTNER_PORTAL_PATH } from "@/lib/vendor-roles";

export { navigationForRole };

const ROLE_LABELS: Record<string, string> = {
  owner: "品牌擁有者",
  admin: "品牌管理員",
  accountant: "財務協作者",
  support: "客服協作者",
  partner: "夥伴",
};

function roleLabelFor(memberRole: string | null, isPlatformAdmin: boolean) {
  if (isPlatformAdmin) return "平台管理員";
  return (memberRole && Object.hasOwn(ROLE_LABELS, memberRole) ? ROLE_LABELS[memberRole] : undefined) ?? "工作區成員";
}

export function AppShell({
  children,
  vendorName,
  memberRole,
  isPlatformAdmin = false,
  enabledModules,
  hasPartnerPortal = false,
  planLabel = "Free",
  projects = [],
  selectedProjectId = null,
  onboardingTasks = [],
  taskPanelCollapsed = true,
  selectProject,
  persistTaskPanelCollapsed,
}: {
  children: React.ReactNode;
  vendorName: string;
  memberRole: string | null;
  isPlatformAdmin?: boolean;
  enabledModules?: readonly GatedFeature[];
  hasPartnerPortal?: boolean;
  planLabel?: string;
  projects?: ProjectSwitcherItem[];
  selectedProjectId?: string | null;
  onboardingTasks?: SidebarOnboardingTask[];
  taskPanelCollapsed?: boolean;
  selectProject?: (projectId: string | null) => Promise<void>;
  persistTaskPanelCollapsed?: (collapsed: boolean) => Promise<void>;
}) {
  const visibleGroups = navigationForRole(memberRole, isPlatformAdmin, enabledModules, { hasPartnerPortal });
  // The account menu only carries account-level entries; every settings and
  // billing page lives behind the single 設定 hub.
  const settingsGroups = settingsHubForRole(memberRole, isPlatformAdmin, enabledModules);
  const showSettingsLink = settingsGroups.length > 0;
  const showSecurityLink = settingsGroups.some((group) => group.items.some((item) => item.href === SECURITY_SETTINGS_PATH));
  // Platform administrators have no merchant security page; they use the standalone MFA page.
  const securityHref = isPlatformAdmin ? "/mfa/setup" : showSecurityLink ? SECURITY_SETTINGS_PATH : null;
  const menuLinkClass = "flex min-h-9 items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950";
  const homeHref = isPlatformAdmin ? "/dashboard" : memberRole === "support" ? "/support-cases" : isVendorPartnerRole(memberRole) ? PARTNER_PORTAL_PATH : "/dashboard";
  const roleLabel = roleLabelFor(memberRole, isPlatformAdmin);
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
            <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-600">Live Commerce OS</span>
          </span>
          <span className="rounded-md border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-700">Beta</span>
        </Link>

        {!isPlatformAdmin && selectProject ? <WorkspaceProjectSwitcher workspaceName={vendorName} projects={projects} selectedProjectId={selectedProjectId} selectProject={selectProject} /> : null}
        {!isPlatformAdmin && persistTaskPanelCollapsed ? <OnboardingTaskPanel title={selectedProjectId ? "專案上線任務" : "商家上線任務"} tasks={onboardingTasks} initiallyCollapsed={taskPanelCollapsed} persistCollapsed={persistTaskPanelCollapsed} /> : null}

        <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-color:rgba(148,163,184,0.45)_transparent] [scrollbar-width:thin]" aria-label="主要導覽">
          {visibleGroups.map((group) => {
            if (group.items.length === 1 && (group.items[0]?.href === "/dashboard" || group.items[0]?.href === SETTINGS_HUB_PATH)) {
              const item = group.items[0];
              return (
                <AppShellNavLink key={item.href} href={item.href} activePrefixes={item.activePrefixes}>
                  <item.icon className="size-4 shrink-0 text-slate-500 transition-colors group-hover:text-slate-700 group-aria-[current=page]:text-blue-600" strokeWidth={1.8} aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </AppShellNavLink>
              );
            }

            return (
              <AppShellNavGroup key={group.label} label={group.label} hrefs={group.items.map((item) => item.href)}>
                {group.items.map((item) => (
                  <AppShellNavLink key={item.href} href={item.href}>
                    <item.icon className="size-4 shrink-0 text-slate-500 transition-colors group-hover:text-slate-700 group-aria-[current=page]:text-blue-600" strokeWidth={1.8} aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </AppShellNavLink>
                ))}
              </AppShellNavGroup>
            );
          })}
        </nav>

        <div className="mt-3 shrink-0 border-t border-slate-200 pt-3">
          <SystemStatusIndicator />
          <AppShellAccountMenu vendorName={vendorName} roleLabel={roleLabel} vendorInitial={vendorInitial} planLabel={planLabel}>
            <div className="px-3 pb-2 pt-1">
              <p className="truncate text-sm font-semibold text-slate-900">{vendorName}</p>
              <p className="truncate text-xs font-medium text-slate-600">{roleLabel}</p>
            </div>
            {showSettingsLink || securityHref ? (
              <div className="border-t border-slate-100 pt-2">
                {showSettingsLink ? <Link href={SETTINGS_HUB_PATH} className={menuLinkClass}><Settings2 className="size-4 text-slate-500" strokeWidth={1.8} aria-hidden="true" />設定</Link> : null}
                {securityHref ? <Link href={securityHref} className={menuLinkClass}><Shield className="size-4 text-slate-500" strokeWidth={1.8} aria-hidden="true" />安全性</Link> : null}
              </div>
            ) : null}
            <div className="border-t border-slate-100 pt-2">
              <Link href="/support" className={menuLinkClass}><Headphones className="size-4 text-slate-500" strokeWidth={1.8} aria-hidden="true" />客服與付款協助</Link>
              <Link href="/policies" className={menuLinkClass}><ScrollText className="size-4 text-slate-500" strokeWidth={1.8} aria-hidden="true" />服務條款與政策</Link>
            </div>
            <div className="border-t border-slate-100 pt-2">
              <form action={logoutAction}>
                <CsrfField />
                <FormSubmitButton
                  pendingChildren="登出中…"
                  pendingMessage="正在結束目前登入並登出，請勿重複送出。"
                  className="flex min-h-10 w-full items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-700"
                >
                  <LogOut className="size-4 text-slate-500" strokeWidth={1.8} aria-hidden="true" />
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
            <span><span className="block text-sm">CelebrateDeal</span><span className="block max-w-40 truncate text-[10px] font-medium text-slate-500">{vendorName}</span></span>
          </Link>
          <form action={logoutAction}>
            <CsrfField />
            <FormSubmitButton
              pendingChildren="登出中…"
              pendingMessage="正在結束目前登入並登出，請勿重複送出。"
              className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600"
            >
              <Lock className="mr-1 inline size-3.5" aria-hidden="true" />
              登出
            </FormSubmitButton>
          </form>
        </div>
        {!isPlatformAdmin && selectProject ? <details className="mt-2"><summary className="min-h-11 cursor-pointer rounded-lg border border-slate-200 px-3 py-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-blue-700">專案：{projects.find((project) => project.id === selectedProjectId)?.name ?? "全部專案總覽"}</summary><div className="mt-2"><WorkspaceProjectSwitcher workspaceName={vendorName} projects={projects} selectedProjectId={selectedProjectId} selectProject={selectProject} /></div></details> : null}
      </header>

      <main id="main-content" tabIndex={-1} className="px-4 pb-24 pt-6 lg:ml-72 lg:px-8 lg:pb-6 xl:px-10">
        {/* Place mobile guidance in normal document flow, outside the sticky header. */}
        <div className="lg:hidden">
        {!isPlatformAdmin && persistTaskPanelCollapsed ? <OnboardingTaskPanel title={selectedProjectId ? "專案上線任務" : "商家上線任務"} tasks={onboardingTasks} initiallyCollapsed={taskPanelCollapsed} persistCollapsed={persistTaskPanelCollapsed} /> : null}
        </div>
        <FeatureAccessBoundary enabledModules={enabledModules}>{children}</FeatureAccessBoundary>
        <footer className="mx-auto mt-12 max-w-5xl border-t border-border pt-5">
          <p className="mb-3 text-xs font-semibold text-slate-600">公開資訊與客服</p>
          <PublicResourceLinks />
        </footer>
      </main>
      <AppShellMobileNav
        groups={visibleGroups.map((group) => ({ label: group.label, items: group.items.map((item) => ({ href: item.href, label: item.label, activePrefixes: item.activePrefixes })) }))}
        supportLinks={[{ href: "/support", label: "客服與付款協助" }, { href: "/policies", label: "服務條款與政策" }]}
      />
    </div>
  );
}
