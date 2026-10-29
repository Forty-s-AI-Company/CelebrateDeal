import type { FunnelTemplateGoal } from "@/lib/funnel-template-gallery";

/**
 * Client-safe part of the template-library labels (用途／風格) and filter. It
 * must not import the template registry (`funnel-template-gallery.ts`, every
 * template's build code) so the library's client component keeps it out of the
 * browser bundle; the registry-dependent catalog lives in `funnel-template-catalog.ts`.
 */
export const FUNNEL_TEMPLATE_PURPOSES = ["sales", "leads", "webinar", "brand", "policy"] as const;
export type FunnelTemplatePurpose = (typeof FUNNEL_TEMPLATE_PURPOSES)[number];
export const FUNNEL_TEMPLATE_PURPOSE_LABELS: Readonly<Record<FunnelTemplatePurpose, string>> = {
  sales: "銷售",
  leads: "名單",
  webinar: "Webinar",
  brand: "品牌首頁",
  policy: "條款與政策",
};

export const FUNNEL_TEMPLATE_STYLES = ["minimal", "warm", "natural", "professional", "vivid", "luxe"] as const;
export type FunnelTemplateStyle = (typeof FUNNEL_TEMPLATE_STYLES)[number];
export const FUNNEL_TEMPLATE_STYLE_LABELS: Readonly<Record<FunnelTemplateStyle, string>> = {
  minimal: "簡約",
  warm: "溫暖",
  natural: "自然",
  professional: "專業",
  vivid: "活潑",
  luxe: "高質感",
};
export const DEFAULT_FUNNEL_TEMPLATE_STYLE: FunnelTemplateStyle = "minimal";


export type FunnelTemplateCatalogEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  goal: FunnelTemplateGoal;
  status: "available" | "limited";
  statusReason: string;
  purposes: FunnelTemplatePurpose[];
  styles: FunnelTemplateStyle[];
  registered: boolean;
};

export type FunnelTemplateCatalogFilter = { purpose?: FunnelTemplatePurpose | null; style?: FunnelTemplateStyle | null };

export function filterFunnelTemplateCatalog<T extends Pick<FunnelTemplateCatalogEntry, "purposes" | "styles">>(entries: readonly T[], filter: FunnelTemplateCatalogFilter): T[] {
  return entries.filter((entry) => (!filter.purpose || entry.purposes.includes(filter.purpose)) && (!filter.style || entry.styles.includes(filter.style)));
}
