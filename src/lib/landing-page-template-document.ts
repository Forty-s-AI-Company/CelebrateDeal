import {
  FUNNEL_CAPABILITIES,
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type PageDocument,
} from "@/lib/funnel-page-document";

/**
 * Pure helpers for merchant-owned templates (「我的範本」). A template is a
 * PageDocument that must be safe to apply to any page of the same vendor:
 * every reference to a vendor record or to the source page/funnel is removed
 * when it is saved, and node/popup ids are regenerated whenever it is used.
 */

export const LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH = 80;
/** Same ceiling as a saved draft (`landing-page-actions.ts` MAX_CONTENT_BYTES). */
export const LANDING_PAGE_TEMPLATE_MAX_CONTENT_BYTES = 128 * 1024;
export const LANDING_PAGE_TEMPLATE_VENDOR_LIMIT = 100;
/** Stable id prefix of stored templates, so previews render identically on server and client. */
export const STORED_TEMPLATE_ID_PREFIX = "tpl";
export const STORED_TEMPLATE_PAGE_ID = "tpl_page";
/** Recorded as the step's templateId when a merchant template is applied. */
export const MERCHANT_TEMPLATE_STEP_PREFIX = "mine_";

/**
 * Node `props` keys that point at a vendor record or a page-bound resource.
 * The renderer currently reads `eventId`/`calendarId`/`bookingEventId`
 * (consultation calendar); the rest are not read today but are accepted by the
 * open `props` record, so a stored document could carry them. All are removed
 * from `props` and from desktop/mobile `overrides.props`.
 */
export const TEMPLATE_RESOURCE_PROP_KEYS = [
  // Consultation calendar (`calendar`, `paid_calendar`).
  "eventId", "calendarId", "bookingEventId", "consultationEventId",
  // Registration forms and lives.
  "formId", "registrationFormId", "liveId", "webinarId",
  // Media library records (URLs such as `src` are kept: they are public assets).
  "videoId", "imageAssetId", "assetId", "mediaId",
  // Products, prices and checkout/offer references.
  "productId", "orderBumpProductId", "priceId", "pricePlanId", "planId", "offerId", "checkoutId", "couponId", "paymentMethodId",
  // Tracking and attribution.
  "affiliateId", "referralCode", "trackingId", "pixelId", "measurementId",
] as const;
const RESOURCE_PROP_KEYS: ReadonlySet<string> = new Set(TEMPLATE_RESOURCE_PROP_KEYS);

function stripProps(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([key]) => !RESOURCE_PROP_KEYS.has(key)));
}

/**
 * Actions that name a vendor form or a step of the source funnel lose that
 * reference: `submit_form` keeps submitting the page's own form, while
 * `registration` (needs a form id) and `next_step` (needs a step of the target
 * funnel) become `none`, which the inspector shows as an unconfigured action.
 * `show_popup` names a popup of the same document and is remapped on rekey.
 */
function stripAction(action: FunnelNodeAction): FunnelNodeAction {
  if (action.type === "submit_form") return { type: "submit_form" };
  if (action.type === "registration" || action.type === "next_step") return { type: "none" };
  return action;
}

function stripNode(node: FunnelNode): FunnelNode {
  const overrides = { ...node.overrides };
  for (const viewport of ["desktop", "mobile"] as const) {
    const override = overrides[viewport];
    if (override?.props) overrides[viewport] = { ...override, props: stripProps(override.props) };
  }
  return {
    ...node,
    props: stripProps(node.props),
    overrides,
    actions: node.actions.map(stripAction),
    ...(node.children ? { children: node.children.map(stripNode) } : {}),
  };
}

/**
 * Removes every binding to vendor resources or to the source page: commerce
 * binding (products, order bump, agreement), embedded flow, form/live/step
 * action targets, resource-id props, popup page ownership and the tracking /
 * affiliate capability state (reset to the platform defaults). Text, styles,
 * images, HTML ids and `raw_html` content are kept as they are.
 */
export function stripTemplateBindings(document: PageDocument): PageDocument {
  const copy = structuredClone(document);
  delete copy.commerce;
  delete copy.flow;
  copy.revision = 0;
  copy.settings = { ...copy.settings, tracking: { ...FUNNEL_CAPABILITIES.tracking }, affiliate: { ...FUNNEL_CAPABILITIES.affiliate } };
  copy.root = copy.root.map(stripNode);
  copy.popups = copy.popups.map((popup) => {
    const { pageId: _pageId, ...rest } = popup;
    void _pageId;
    return { ...rest, root: rest.root.map(stripNode) };
  });
  return copy;
}

/**
 * Gives the document new node and popup ids (`<prefix>_n1`, `<prefix>_p1`, …)
 * and the given page id. `show_popup` actions follow their popup; one that
 * points at a popup missing from the document becomes `none`.
 */
export function rekeyTemplateDocument(document: PageDocument, prefix: string, pageId: string): PageDocument {
  const copy = structuredClone(document);
  const popupIds = new Map(copy.popups.map((popup, index) => [popup.id, `${prefix}_p${(index + 1).toString(36)}`]));
  let sequence = 0;
  const visit = (nodes: FunnelNode[]): FunnelNode[] => nodes.map((node) => {
    sequence += 1;
    const actions = node.actions.map((action): FunnelNodeAction => {
      if (action.type !== "show_popup") return action;
      const popupId = popupIds.get(action.popupId);
      return popupId ? { ...action, popupId } : { type: "none" };
    });
    return { ...node, id: `${prefix}_n${sequence.toString(36)}`, actions, ...(node.children ? { children: visit(node.children) } : {}) };
  });
  copy.id = pageId;
  copy.root = visit(copy.root);
  copy.popups = copy.popups.map((popup) => ({ ...popup, id: popupIds.get(popup.id)!, root: visit(popup.root) }));
  return copy;
}

export function templateContentBytes(document: PageDocument) {
  return new TextEncoder().encode(JSON.stringify(document)).length;
}

/**
 * Builds the stored form of a template from a page the server read itself:
 * bindings stripped, stable ids, validated and within the size limit. Returns
 * null when the result is not a valid PageDocument or is too large.
 */
export function prepareStoredTemplateDocument(source: PageDocument, name: string): PageDocument | null {
  const stripped = stripTemplateBindings(source);
  const rekeyed = rekeyTemplateDocument({ ...stripped, name }, STORED_TEMPLATE_ID_PREFIX, STORED_TEMPLATE_PAGE_ID);
  const parsed = parsePageDocument(rekeyed);
  if (!parsed || templateContentBytes(parsed) > LANDING_PAGE_TEMPLATE_MAX_CONTENT_BYTES) return null;
  return parsed;
}

/** Reads a stored template. Strips again so a row written by any other path still cannot carry bindings. */
export function readStoredTemplateDocument(value: unknown): PageDocument | null {
  const parsed = parsePageDocument(value);
  if (!parsed) return null;
  return parsePageDocument(stripTemplateBindings(parsed));
}

/** Trims; 1–80 characters, no control characters. */
export function normalizeTemplateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/gu, " ").trim();
  if (!trimmed || [...trimmed].length > LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return null;
  return trimmed;
}
