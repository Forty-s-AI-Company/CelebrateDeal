import {
  FUNNEL_CAPABILITIES,
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type PageDocument,
} from "@/lib/funnel-page-document";
import { LANDING_PAGE_MAX_CONTENT_BYTES, landingPageContentBytes } from "@/lib/landing-page-limits";

/**
 * Pure helpers for merchant-owned templates (「我的範本」). A template is a
 * PageDocument that must be safe to apply to any page of the same vendor:
 * every reference to a vendor record or to the source page/funnel is removed
 * when it is saved, and node/popup ids are regenerated whenever it is used.
 */

export const LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH = 80;
/** Same ceiling as a saved draft (`LANDING_PAGE_MAX_CONTENT_BYTES`). */
export const LANDING_PAGE_TEMPLATE_MAX_CONTENT_BYTES = LANDING_PAGE_MAX_CONTENT_BYTES;
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

/** Action types that name a vendor form or a step of the source funnel. */
const BOUND_ACTION_TYPES: ReadonlySet<string> = new Set(["registration", "next_step"]);
/** Action types whose target lives in the same document and is remapped on rekey. */
const LOCAL_ACTION_TYPES: ReadonlySet<string> = new Set(["show_popup", "submit_form"]);
type ActionObject = Record<string, unknown> & { type: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Walks a JSON value (node `props`, override `props`) and rewrites every
 * object that looks like a node action. The renderer also reads a button's
 * `props.action` when `actions` is empty, so action-shaped objects can live
 * anywhere in the open `props` record.
 */
function mapActionObjects(value: unknown, map: (action: ActionObject) => Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => mapActionObjects(item, map));
  if (!isRecord(value)) return value;
  if (typeof value.type === "string" && (BOUND_ACTION_TYPES.has(value.type) || LOCAL_ACTION_TYPES.has(value.type))) return map(value as ActionObject);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapActionObjects(item, map)]));
}

const unbindAction = (action: ActionObject): Record<string, unknown> => (BOUND_ACTION_TYPES.has(action.type) ? { type: "none" } : action);

function stripProps(props: Record<string, unknown>): Record<string, unknown> {
  const kept = Object.fromEntries(Object.entries(props).filter(([key]) => !RESOURCE_PROP_KEYS.has(key)));
  return mapActionObjects(kept, unbindAction) as Record<string, unknown>;
}

function mapOverrideProps(node: FunnelNode, map: (props: Record<string, unknown>) => Record<string, unknown>): FunnelNode["overrides"] {
  const overrides = { ...node.overrides };
  for (const viewport of ["desktop", "mobile"] as const) {
    const override = overrides[viewport];
    if (override?.props) overrides[viewport] = { ...override, props: map(override.props) };
  }
  return overrides;
}

/**
 * Actions that name a vendor form or a step of the source funnel lose that
 * reference: `registration` (needs a registration-form record) and
 * `next_step` (needs a step of the target funnel) become `none`, which the
 * inspector shows as an unconfigured action. `submit_form.formId` and
 * `show_popup.popupId` name a form node / popup of this same document, so they
 * are kept here and remapped when the document is rekeyed.
 */
function stripNode(node: FunnelNode): FunnelNode {
  return {
    ...node,
    props: stripProps(node.props),
    overrides: mapOverrideProps(node, stripProps),
    actions: node.actions.map((action) => unbindAction(action as ActionObject) as FunnelNodeAction),
    ...(node.children ? { children: node.children.map(stripNode) } : {}),
  };
}

/**
 * Removes every binding to vendor resources or to the source page: commerce
 * binding (products, order bump, agreement), embedded flow, registration-form
 * and step action targets (in `actions` and in action-shaped `props` values,
 * including desktop/mobile overrides), resource-id props, popup page ownership
 * and the tracking / affiliate capability state (reset to the platform
 * defaults). Text, styles, images, HTML ids, in-page form/popup references and
 * `raw_html` content are kept as they are.
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
 * Gives the document new node and popup ids (`<prefix>_n1`, `<prefix>_p1`, ...)
 * and the given page id. `show_popup` follows its popup and `submit_form`
 * follows its form node, both in `actions` and in action-shaped `props`. A
 * `show_popup` whose popup is missing becomes `none`; a `submit_form` whose
 * form node is missing keeps submitting without naming a form.
 */
export function rekeyTemplateDocument(document: PageDocument, prefix: string, pageId: string): PageDocument {
  const copy = structuredClone(document);
  const popupIds = new Map(copy.popups.map((popup, index) => [popup.id, `${prefix}_p${(index + 1).toString(36)}`]));
  const nodeIds = new Map<string, string>();
  let sequence = 0;
  const assign = (nodes: FunnelNode[]) => nodes.forEach((node) => {
    sequence += 1;
    nodeIds.set(node.id, `${prefix}_n${sequence.toString(36)}`);
    if (node.children) assign(node.children);
  });
  assign(copy.root);
  copy.popups.forEach((popup) => assign(popup.root));

  const remap = (action: ActionObject): Record<string, unknown> => {
    if (action.type === "show_popup") {
      const popupId = typeof action.popupId === "string" ? popupIds.get(action.popupId) : undefined;
      return popupId ? { ...action, popupId } : { type: "none" };
    }
    if (action.type === "submit_form" && "formId" in action) {
      const { formId, ...rest } = action;
      const mapped = typeof formId === "string" ? nodeIds.get(formId) : undefined;
      return mapped ? { ...rest, formId: mapped } : rest;
    }
    return action;
  };
  const remapProps = (props: Record<string, unknown>) => mapActionObjects(props, remap) as Record<string, unknown>;
  const visit = (nodes: FunnelNode[]): FunnelNode[] => nodes.map((node) => ({
    ...node,
    id: nodeIds.get(node.id)!,
    props: remapProps(node.props),
    overrides: mapOverrideProps(node, remapProps),
    actions: node.actions.map((action) => remap(action as ActionObject) as FunnelNodeAction),
    ...(node.children ? { children: visit(node.children) } : {}),
  }));
  copy.id = pageId;
  copy.root = visit(copy.root);
  copy.popups = copy.popups.map((popup) => ({ ...popup, id: popupIds.get(popup.id)!, root: visit(popup.root) }));
  return copy;
}

export function templateContentBytes(document: PageDocument) {
  return landingPageContentBytes(document);
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

/** Trims; 1–80 characters, no control or bidirectional-formatting characters. */
export function normalizeTemplateName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/gu, " ").trim();
  if (!trimmed || [...trimmed].length > LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return null;
  // Bidi marks, embeddings, overrides and isolates can make a name display differently from its stored text.
  if (/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(trimmed)) return null;
  return trimmed;
}
