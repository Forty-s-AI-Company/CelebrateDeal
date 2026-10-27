import { FUNNEL_STEP_TYPES, type FunnelStepType } from "@/lib/funnel-flow";
import {
  FUNNEL_TEMPLATE_GALLERY,
  listFunnelTemplateGallery,
  type FunnelTemplateGalleryItem,
  type FunnelTemplateGoal,
} from "@/lib/funnel-template-gallery";

/**
 * Template-library labels (用途／風格) for platform templates. Kept apart from
 * `funnel-template-gallery.ts` so the gallery data stays untouched: a template
 * that is not registered here still appears, with its purpose derived from its
 * goal and compatible step types and the default style 「簡約」.
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

type CatalogTags = { purposes: readonly FunnelTemplatePurpose[]; styles: readonly FunnelTemplateStyle[] };

/** Registered labels by template id. Ids missing from the gallery are ignored. */
export const FUNNEL_TEMPLATE_CATALOG_TAGS: Readonly<Record<string, CatalogTags>> = {
  "webinar-broadcast": { purposes: ["webinar"], styles: ["professional"] },
  "webinar-thank-you": { purposes: ["webinar"], styles: ["natural"] },
  "webinar-registration": { purposes: ["webinar"], styles: ["professional"] },
  "webinar-course-registration": { purposes: ["webinar"], styles: ["professional"] },
  "webinar-workshop-registration": { purposes: ["webinar"], styles: ["natural"] },
  "webinar-strategy-registration": { purposes: ["webinar", "sales"], styles: ["warm"] },
  "sell-product-checkout": { purposes: ["sales"], styles: ["warm"] },
  "sell-simple-checkout": { purposes: ["sales"], styles: ["minimal"] },
  "sell-content-subscription": { purposes: ["sales"], styles: ["warm"] },
  "audience-volunteer": { purposes: ["leads"], styles: ["warm"] },
  "audience-charity-event": { purposes: ["leads"], styles: ["vivid"] },
  "audience-environment": { purposes: ["leads"], styles: ["natural"] },
  "audience-course-workbook": { purposes: ["leads"], styles: ["professional"] },
  "audience-course-consultation": { purposes: ["leads"], styles: ["minimal"] },
  "audience-course-lesson": { purposes: ["leads"], styles: ["warm"] },
  "custom-privacy": { purposes: ["policy"], styles: ["minimal"] },
  "custom-terms": { purposes: ["policy"], styles: ["minimal"] },
  "custom-brand-info": { purposes: ["brand"], styles: ["professional"] },
  "custom-luxury-course": { purposes: ["brand"], styles: ["luxe"] },
};

const SALES_STEPS: ReadonlySet<FunnelStepType> = new Set(["sales_page", "order_form", "upsell", "downsell", "thank_you_page"]);
const LEAD_STEPS: ReadonlySet<FunnelStepType> = new Set(["opt_in_page", "opt_in_thank_you_page", "inline_form", "popup_form", "link_in_bio"]);
const GOAL_PURPOSE: Readonly<Record<FunnelTemplateGoal, FunnelTemplatePurpose>> = { sell: "sales", audience: "leads", webinar: "webinar", custom: "brand" };

/** Step types the gallery offers this template for. */
export function compatibleStepTypes(item: Pick<FunnelTemplateGalleryItem, "id" | "goal">): FunnelStepType[] {
  return FUNNEL_STEP_TYPES.filter((type) => listFunnelTemplateGallery(item.goal, type).some((candidate) => candidate.id === item.id));
}

/** Purpose of an unregistered template: its goal, plus what its compatible step types add. */
export function deriveFunnelTemplatePurposes(item: Pick<FunnelTemplateGalleryItem, "id" | "goal">, stepTypes: readonly FunnelStepType[] = compatibleStepTypes(item)): FunnelTemplatePurpose[] {
  const purposes = new Set<FunnelTemplatePurpose>([GOAL_PURPOSE[item.goal]]);
  if (stepTypes.some((type) => type.startsWith("webinar_"))) purposes.add("webinar");
  if (stepTypes.some((type) => SALES_STEPS.has(type))) purposes.add("sales");
  if (stepTypes.some((type) => LEAD_STEPS.has(type))) purposes.add("leads");
  return FUNNEL_TEMPLATE_PURPOSES.filter((purpose) => purposes.has(purpose));
}

export type FunnelTemplateCatalogEntry = {
  id: string;
  name: string;
  description: string;
  category: string;
  goal: FunnelTemplateGoal;
  status: FunnelTemplateGalleryItem["status"];
  statusReason: string;
  purposes: FunnelTemplatePurpose[];
  styles: FunnelTemplateStyle[];
  registered: boolean;
};

export function funnelTemplateCatalogEntry(item: FunnelTemplateGalleryItem): FunnelTemplateCatalogEntry {
  const tags = Object.hasOwn(FUNNEL_TEMPLATE_CATALOG_TAGS, item.id) ? FUNNEL_TEMPLATE_CATALOG_TAGS[item.id] : undefined;
  const purposes = tags?.purposes.length ? [...tags.purposes] : deriveFunnelTemplatePurposes(item);
  const styles = tags?.styles.length ? [...tags.styles] : [DEFAULT_FUNNEL_TEMPLATE_STYLE];
  return {
    id: item.id, name: item.name, description: item.description, category: item.category, goal: item.goal,
    status: item.status, statusReason: item.statusReason, purposes, styles, registered: Boolean(tags),
  };
}

/** Every platform template, in gallery order, with its library labels. */
export function listFunnelTemplateCatalog(gallery: readonly FunnelTemplateGalleryItem[] = FUNNEL_TEMPLATE_GALLERY): FunnelTemplateCatalogEntry[] {
  return gallery.map(funnelTemplateCatalogEntry);
}

export type FunnelTemplateCatalogFilter = { purpose?: FunnelTemplatePurpose | null; style?: FunnelTemplateStyle | null };

export function filterFunnelTemplateCatalog<T extends Pick<FunnelTemplateCatalogEntry, "purposes" | "styles">>(entries: readonly T[], filter: FunnelTemplateCatalogFilter): T[] {
  return entries.filter((entry) => (!filter.purpose || entry.purposes.includes(filter.purpose)) && (!filter.style || entry.styles.includes(filter.style)));
}
