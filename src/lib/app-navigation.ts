import {
  Activity, Ban, Banknote, BarChart3, Bell, Bot, Boxes, Building2, CalendarCheck, ClipboardList, Cloud, Coins, CreditCard, DoorOpen, FileText, FlaskConical, Gauge,
  GitCompareArrows, Globe, GraduationCap, Handshake, Headphones, Landmark, LayoutTemplate, LifeBuoy, Lock, MessageSquareText, PackageCheck, Palette, PlaySquare,
  Radio, ReceiptText, Rocket, ScrollText, Send, Settings2, Shield, ShieldAlert, Tags, Target, TextCursorInput, ToggleRight, UserPlus, Users, UsersRound,
  WalletCards, Webhook, Workflow, type LucideIcon,
} from "lucide-react";
import { hasVendorFeature, type GatedFeature } from "@/lib/vendor-feature-toggles";
import { SECURITY_SETTINGS_PATH, SETTINGS_HUB_PATH } from "@/lib/settings-paths";
import { isVendorBackofficeRole, isVendorPartnerRole, PARTNER_PORTAL_PATH } from "@/lib/vendor-roles";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One-line summary shown on the settings hub. */
  description?: string;
  managerOnly?: boolean;
  financeOnly?: boolean;
  ownerOnly?: boolean;
  adminOnly?: boolean;
  feature?: GatedFeature;
  /** Extra path prefixes that also highlight this entry as the current page. */
  activePrefixes?: readonly string[];
};
export type NavGroup = {
  label: string;
  items: NavItem[];
  /**
   * Sales-project flows this group is core to. Omitted: always expanded by
   * default. Set: expanded by default only for those flows (and when no
   * project is selected); `[]` means secondary, collapsed whenever a project
   * is selected. Only the default changes; the entries stay reachable.
   */
  flows?: readonly SalesProjectFlowKey[];
};
/** Mirrors the Prisma `SalesProjectFlow` enum without importing the client into UI code. */
export type SalesProjectFlowKey = "live" | "consultation";

/** Whether a sidebar group starts expanded for the selected project's flow (`null`: no project selected). */
export function isGroupExpandedByDefault(group: Pick<NavGroup, "flows">, projectFlow: SalesProjectFlowKey | null): boolean {
  if (!group.flows) return true;
  if (projectFlow === null) return group.flows.length > 0;
  return group.flows.includes(projectFlow);
}

export { SECURITY_SETTINGS_PATH, SETTINGS_HUB_PATH };

/**
 * Every settings and billing page reachable from the 設定 hub. These used to
 * be listed one by one in the sidebar / account menu; the hub and the
 * sidebar entry now derive from this single list so they cannot drift apart.
 */
export const settingsGroups: NavGroup[] = [
  {
    label: "帳號與安全",
    items: [
      { href: SECURITY_SETTINGS_PATH, label: "安全性", icon: Shield, description: "變更登入 Email、密碼，並設定多因子驗證（MFA）與登入裝置。" },
    ],
  },
  {
    label: "工作區",
    items: [
      { href: "/settings/brand", label: "品牌設定", icon: Building2, managerOnly: true, description: "品牌名稱、Logo、主色、寄件人與公開頁聯絡資訊。" },
      { href: "/onboarding", label: "上線導引", icon: Rocket, managerOnly: true, description: "依步驟完成開賣前的必要設定，掌握目前進度。" },
    ],
  },
  {
    label: "系統設定",
    items: [
      { href: "/settings/tracking", label: "追蹤設定", icon: Target, managerOnly: true, description: "設定 Pixel、GTM 與事件開關。" },
      { href: "/settings/features", label: "功能模組", icon: ToggleRight, managerOnly: true, description: "開啟或停用工作區使用的功能模組。" },
      { href: "/settings/line", label: "LINE 整合", icon: Bell, ownerOnly: true, description: "連結 LINE 官方帳號推播與 LINE Login。" },
      { href: "/settings/automations", label: "自動化", icon: Workflow, managerOnly: true, description: "串接報名、直播、諮詢與訂單的行銷自動化流程。" },
      { href: "/settings/team", label: "團隊管理", icon: Users, managerOnly: true, description: "管理銷售團隊、商家成員與分潤歸屬關係。" },
    ],
  },
  {
    label: "帳務與方案",
    items: [
      { href: "/billing/usage", label: "用量與扣點", icon: Activity, financeOnly: true, feature: "billing", description: "查看串流、場次與儲存用量及服務費估算。" },
      { href: "/billing/payment-methods", label: "平台服務付款方式", icon: CreditCard, financeOnly: true, feature: "funnel_binding", description: "綁定與管理支付平台服務費的付款方式。" },
      { href: "/billing/plans", label: "方案", icon: Tags, financeOnly: true, feature: "billing", description: "比較並變更平台月費方案。" },
      { href: "/billing/invoices", label: "帳單", icon: ReceiptText, financeOnly: true, feature: "billing", description: "查看與下載平台帳單紀錄。" },
      { href: "/billing/electronic-invoices", label: "電子發票", icon: FileText, financeOnly: true, description: "查看發票紀錄、發票需求與退款折讓狀態。" },
      { href: "/billing/settlements", label: "月結", icon: WalletCards, financeOnly: true, feature: "billing", description: "核對每月結算明細與對帳狀態。" },
      { href: "/billing/payouts", label: "批次出款", icon: Banknote, financeOnly: true, feature: "tax_remuneration", description: "建立與追蹤批次出款，並管理收款帳戶。" },
      { href: "/affiliates/commissions", label: "佣金結算", icon: Coins, financeOnly: true, feature: "affiliate_program", description: "審核與結算推廣夥伴的佣金。" },
      { href: "/billing/course-payouts", label: "課程分潤", icon: GraduationCap, financeOnly: true, feature: "tax_remuneration", description: "查看課程分潤明細與撥款進度。" },
    ],
  },
];

/** Paths under which the sidebar 設定 entry counts as the current section. */
const SETTINGS_ACTIVE_PREFIXES: readonly string[] = [
  SETTINGS_HUB_PATH,
  "/billing",
  ...settingsGroups.flatMap((group) => group.items.map((item) => item.href)).filter((href) => !href.startsWith("/settings") && !href.startsWith("/billing")),
];

const settingsEntry: NavItem = { href: SETTINGS_HUB_PATH, label: "設定", icon: Settings2, activePrefixes: SETTINGS_ACTIVE_PREFIXES };

const operationalGroups: NavGroup[] = [
  {
    label: "總覽與專案",
    items: [
      { href: "/dashboard", label: "營運總覽", icon: Gauge },
      { href: "/projects", label: "銷售專案", icon: ClipboardList, managerOnly: true },
    ],
  },
  {
    label: "銷講中心",
    flows: ["live"],
    items: [
      { href: "/lives", label: "直播間", icon: Radio, managerOnly: true, feature: "live_webinar" },
      { href: "/videos", label: "影片素材", icon: PlaySquare, managerOnly: true, feature: "live_webinar" },
      { href: "/landing-pages", label: "一頁式網站", icon: Palette, managerOnly: true, feature: "funnel_builder" },
      { href: "/forms", label: "報名管理", icon: TextCursorInput, managerOnly: true, feature: "funnel_builder" },
    ],
  },
  {
    label: "成交管理",
    items: [
      { href: "/products", label: "商品", icon: Boxes, managerOnly: true },
      { href: "/orders", label: "訂單與履約", icon: PackageCheck, managerOnly: true },
      { href: "/consultations", label: "諮詢預約", icon: CalendarCheck, managerOnly: true, feature: "consultation_booking" },
      { href: "/customers", label: "學員 CRM", icon: UsersRound, managerOnly: true },
      { href: "/support-cases", label: "客服案件", icon: Headphones, managerOnly: true },
    ],
  },
  {
    label: "互動與行銷",
    flows: ["live"],
    items: [
      { href: "/messages/templates", label: "訊息模板", icon: MessageSquareText, managerOnly: true },
      { href: "/messages/deliveries", label: "寄送管理", icon: Send, managerOnly: true },
      { href: "/interaction-scripts", label: "互動腳本", icon: ScrollText, managerOnly: true, feature: "live_webinar" },
      { href: "/interaction-roles", label: "互動角色", icon: Bot, managerOnly: true, feature: "live_webinar" },
      { href: "/blacklists", label: "封鎖名單", icon: Ban, managerOnly: true },
    ],
  },
  {
    label: "夥伴成長",
    flows: [],
    items: [
      { href: "/affiliates", label: "推廣夥伴", icon: Handshake, managerOnly: true, feature: "affiliate_program" },
      { href: "/team-templates", label: "團隊模板", icon: LayoutTemplate, feature: "funnel_builder" },
      { href: "/partner-pages", label: "我的夥伴頁", icon: Globe, feature: "funnel_builder" },
      { href: "/team-performance", label: "成效分析", icon: BarChart3, feature: "affiliate_program" },
    ],
  },
];

const platformGroup: NavGroup = {
  label: "平台營運",
  items: [
    { href: "/admin/billing/dashboard", label: "平台財務管理", icon: Landmark, adminOnly: true },
    { href: "/admin/billing/stream-reconciliation", label: "Stream 用量對帳", icon: GitCompareArrows, adminOnly: true },
    { href: "/admin/billing/webhooks", label: "系統通知對帳", icon: Webhook, adminOnly: true },
    { href: "/admin/support-cases", label: "退款客服交接", icon: LifeBuoy, adminOnly: true },
    { href: "/admin/vendor-features", label: "商家封測模組", icon: FlaskConical, adminOnly: true },
    { href: "/admin/merchant-invitations", label: "商家邀請", icon: UserPlus, adminOnly: true },
    { href: "/admin/account-holds", label: "帳號安全暫停", icon: ShieldAlert, adminOnly: true },
    { href: "/admin/cloudflare/videos", label: "Stream 檢查", icon: Cloud, adminOnly: true },
    { href: "/mfa/setup", label: "MFA 安全設定", icon: Lock, adminOnly: true },
  ],
};

/** The portal lives outside the merchant back office and authorizes per grant. */
const partnerPortalGroup: NavGroup = {
  label: "夥伴專區",
  items: [{ href: PARTNER_PORTAL_PATH, label: "夥伴入口", icon: DoorOpen }],
};

function filterGroups(groups: NavGroup[], keep: (item: NavItem) => boolean): NavGroup[] {
  return groups.map((group) => ({ ...group, items: group.items.filter(keep) })).filter((group) => group.items.length > 0);
}

/**
 * Role + feature filter shared by the sidebar, the mobile drawer and the
 * settings hub. Support sees only its case queue and personal security.
 * Unknown / legacy roles see nothing. This only filters navigation; every
 * page keeps its own server-side guard.
 */
function backofficeItemVisible(item: NavItem, memberRole: string | null, enabledModules?: readonly GatedFeature[]) {
  if (item.adminOnly) return false;
  if (memberRole === "support") return item.href === "/support-cases" || item.href === SECURITY_SETTINGS_PATH;
  if (memberRole !== "owner" && memberRole !== "admin" && memberRole !== "accountant") return false;
  const isManager = memberRole === "owner" || memberRole === "admin";
  const isFinance = isManager || memberRole === "accountant";
  // Match the existing LINE page guard.
  if (item.ownerOnly && memberRole !== "owner") return false;
  if (item.financeOnly && !isFinance) return false;
  if (item.managerOnly && !isManager) return false;
  return !item.feature || !enabledModules || hasVendorFeature(enabledModules, item.feature);
}

/** Grouped settings and billing pages the member may open; empty for platform admins and partners. */
export function settingsHubForRole(
  memberRole: string | null,
  isPlatformAdmin = false,
  enabledModules?: readonly GatedFeature[],
): NavGroup[] {
  if (isPlatformAdmin || isVendorPartnerRole(memberRole)) return [];
  return filterGroups(settingsGroups, (item) => backofficeItemVisible(item, memberRole, enabledModules));
}

/**
 * `hasPartnerPortal` is true only when the current member holds a valid
 * AffiliatePortalAccess grant in the current vendor (see the protected
 * layout). A partner sees nothing but the portal; partners never reach the
 * back office shell in the first place (`requireVendorContext`).
 */
export function navigationForRole(
  memberRole: string | null,
  isPlatformAdmin = false,
  enabledModules?: readonly GatedFeature[],
  { hasPartnerPortal = false }: { hasPartnerPortal?: boolean } = {},
): NavGroup[] {
  if (isPlatformAdmin) return filterGroups([platformGroup], (item) => Boolean(item.adminOnly));
  if (isVendorPartnerRole(memberRole)) return [partnerPortalGroup];
  const groups = filterGroups(operationalGroups, (item) => backofficeItemVisible(item, memberRole, enabledModules));
  // The whole settings area collapses into one entry, shown only when the
  // hub has at least one page this member can open.
  if (settingsHubForRole(memberRole, false, enabledModules).length > 0) {
    groups.push({ label: "系統管理", items: [settingsEntry] });
  }
  return hasPartnerPortal && isVendorBackofficeRole(memberRole) ? [...groups, partnerPortalGroup] : groups;
}
