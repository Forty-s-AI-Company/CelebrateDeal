import {
  FUNNEL_CAPABILITIES,
  FunnelPopupSchema,
  parsePageDocument,
  type FunnelNode,
  type FunnelPopup,
  type FunnelPopupSettings,
  type PageDocument,
} from "@/lib/funnel-page-document";

/**
 * Pure popup operations for PageDocument.
 *
 * Popup editing deliberately lives outside the UI.  Every operation creates a
 * new document and sends it through parsePageDocument before returning it, so
 * invalid parent/child relationships and duplicate ids fail closed.
 */

export type CreateFunnelPopupInput = {
  id?: string;
  name?: string;
  pageId?: string;
  settings?: PopupSettingsInput;
};

/** Fields measured in the popup settings panel but not yet represented by the
 * shared v1 PopupSettingsSchema. Width is persisted on the popup shell node
 * until that schema can be migrated safely. */
export type PopupSettingsInput = Partial<FunnelPopupSettings> & {
  width?: number | string;
};

export type UpdateFunnelPopupPatch = {
  name?: string;
  pageId?: string | null;
  settings?: PopupSettingsInput;
  root?: FunnelNode[];
};

export type PopupTrigger = "automatic_delay" | "exit_intent";
export type PopupTriggerEligibility = {
  trigger: PopupTrigger;
  status: "available" | "disabled" | "unverified";
  executable: boolean;
  /** Alias useful to callers that ask whether a preview may be opened. */
  canTrigger: boolean;
  reason: string;
  delayMs?: number;
};

function isIdentifier(value: string): boolean {
  return value.length >= 1 && value.length <= 100 && /^[A-Za-z0-9_-]+$/u.test(value);
}

function uniqueId(base: string, used: Set<string>): string {
  const cleanBase = base.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 88) || "popup";
  let candidate = cleanBase;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${cleanBase}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function collectNodeIds(nodes: FunnelNode[], ids: Set<string>): void {
  for (const node of nodes) {
    ids.add(node.id);
    if (node.children) collectNodeIds(node.children, ids);
  }
}

function collectIds(document: PageDocument): Set<string> {
  const ids = new Set<string>(document.popups.map((popup) => popup.id));
  collectNodeIds(document.root, ids);
  for (const popup of document.popups) collectNodeIds(popup.root, ids);
  return ids;
}

function node(id: string, type: FunnelNode["type"], props: Record<string, unknown> = {}): FunnelNode {
  return {
    schemaVersion: 1,
    id,
    type,
    props,
    style: {},
    overrides: {},
    visible: true,
    actions: [],
    attributes: {},
  };
}

/**
 * Creates a small but fully editable popup tree.  It is intentionally made of
 * normal Funnel nodes instead of an opaque HTML snapshot.
 */
function createEditablePopupRoot(popupId: string, used: Set<string>): FunnelNode[] {
  const section = uniqueId(`${popupId}_section`, used);
  const row = uniqueId(`${popupId}_row`, used);
  const column = uniqueId(`${popupId}_column`, used);
  const headline = uniqueId(`${popupId}_headline`, used);
  const text = uniqueId(`${popupId}_text`, used);
  const button = uniqueId(`${popupId}_button`, used);

  const headlineNode = node(headline, "headline", { text: "想和你分享一個好消息" });
  const textNode = node(text, "text", { text: "留下資料，我們會在第一時間通知你。" });
  const buttonNode = node(button, "button", { label: "立即了解", action: { type: "none" } });
  const columnNode = node(column, "columns_2");
  columnNode.children = [headlineNode, textNode, buttonNode];
  const rowNode = node(row, "row");
  rowNode.children = [columnNode];
  const sectionNode = node(section, "section", { variant: "popup" });
  sectionNode.children = [rowNode];
  return [sectionNode];
}

function applyPopupWidth(root: FunnelNode[], width: number | string | undefined): FunnelNode[] {
  if (width === undefined) return root;
  const section = root[0];
  if (!section) return root;
  return [{ ...section, style: { ...section.style, width } }, ...root.slice(1)];
}

function commit(document: unknown): PageDocument | null {
  return parsePageDocument(document);
}

function getPopup(document: PageDocument, popupId: string): FunnelPopup | null {
  return document.popups.find((popup) => popup.id === popupId) ?? null;
}

/** Create a popup and bind it to the supplied page id when one is provided. */
export function createFunnelPopup(document: PageDocument, input: CreateFunnelPopupInput = {}): PageDocument | null {
  const parsed = parsePageDocument(document);
  if (!parsed) return null;
  if (input.id !== undefined && !isIdentifier(input.id)) return null;
  if (input.pageId !== undefined && !isIdentifier(input.pageId)) return null;

  const used = collectIds(parsed);
  const popupId = uniqueId(input.id ?? "popup", used);
  const { width, ...persistedSettings } = input.settings ?? {};
  const popupCandidate = {
    schemaVersion: 1 as const,
    id: popupId,
    name: input.name ?? "未命名視窗",
    ...(input.pageId ? { pageId: input.pageId } : {}),
    settings: persistedSettings,
    root: applyPopupWidth(createEditablePopupRoot(popupId, used), width),
    capabilities: { exitIntent: FUNNEL_CAPABILITIES.exitIntent },
  };
  const popup = FunnelPopupSchema.safeParse(popupCandidate);
  if (!popup.success) return null;
  return commit({ ...parsed, popups: [...parsed.popups, popup.data] });
}

/** Update only the requested popup fields; the popup id itself is immutable. */
export function updateFunnelPopup(document: PageDocument, popupId: string, patch: UpdateFunnelPopupPatch): PageDocument | null {
  const parsed = parsePageDocument(document);
  if (!parsed || !isIdentifier(popupId)) return null;
  const current = getPopup(parsed, popupId);
  if (!current) return null;
  if (patch.pageId !== undefined && patch.pageId !== null && !isIdentifier(patch.pageId)) return null;
  const { width, ...persistedSettings } = patch.settings ?? {};
  const nextRoot = patch.root !== undefined ? patch.root : current.root;
  const nextPopupInput = {
    ...current,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...("pageId" in patch ? { pageId: patch.pageId ?? undefined } : {}),
    root: applyPopupWidth(nextRoot, width),
    ...(patch.settings !== undefined ? { settings: { ...current.settings, ...persistedSettings } } : {}),
  };
  const nextPopup = FunnelPopupSchema.safeParse(nextPopupInput);
  if (!nextPopup.success) return null;
  const popups = parsed.popups.map((popup) => popup.id === popupId ? nextPopup.data : popup);
  return commit({ ...parsed, popups });
}

export function deleteFunnelPopup(document: PageDocument, popupId: string): PageDocument | null {
  const parsed = parsePageDocument(document);
  if (!parsed || !getPopup(parsed, popupId)) return null;
  return commit({ ...parsed, popups: parsed.popups.filter((popup) => popup.id !== popupId) });
}

/** Bind/unbind a popup to a page. Passing null removes the binding. */
export function bindFunnelPopupToPage(document: PageDocument, popupId: string, pageId: string | null = document.id): PageDocument | null {
  const parsed = parsePageDocument(document);
  if (!parsed || !getPopup(parsed, popupId)) return null;
  if (pageId !== null && !isIdentifier(pageId)) return null;
  return updateFunnelPopup(parsed, popupId, { pageId });
}

/**
 * Returns an explicit execution status for preview/runtime callers.
 * Automatic delay and desktop exit intent share the same explicit capability
 * contract. The UI still performs a pointer-capability check before listening.
 */
export function validatePopupTrigger(popup: FunnelPopup, trigger: PopupTrigger): PopupTriggerEligibility {
  const parsed = FunnelPopupSchema.safeParse(popup);
  if (!parsed.success) {
    return { trigger, status: "disabled", executable: false, canTrigger: false, reason: "Popup 設定無法通過驗證" };
  }
  const current = parsed.data;
  if (trigger === "automatic_delay") {
    if (!current.settings.openAutomatically) {
      return { trigger, status: "disabled", executable: false, canTrigger: false, reason: "Popup 未啟用自動顯示" };
    }
    return {
      trigger,
      status: "available",
      executable: true,
      canTrigger: true,
      reason: "可依設定延遲顯示 Popup",
      delayMs: current.settings.automaticDelaySeconds * 1000,
    };
  }

  if (!current.settings.openOnExitIntent) {
    return { trigger, status: "disabled", executable: false, canTrigger: false, reason: "Popup 未啟用離開意圖" };
  }
  return {
    trigger,
    status: "available",
    executable: true,
    canTrigger: true,
    reason: current.capabilities.exitIntent.reason || FUNNEL_CAPABILITIES.exitIntent.reason,
  };
}

/** Page-level convenience helper for editor preview buttons. */
export function getFunnelPopupTriggerEligibility(document: PageDocument, popupId: string, trigger: PopupTrigger): PopupTriggerEligibility {
  const parsed = parsePageDocument(document);
  const popup = parsed ? getPopup(parsed, popupId) : null;
  if (!popup) return { trigger, status: "disabled", executable: false, canTrigger: false, reason: "找不到指定 Popup" };
  return validatePopupTrigger(popup, trigger);
}

// Short aliases keep call sites readable while retaining the explicit names
// for code that uses the Funnel domain vocabulary.
export const createPopup = createFunnelPopup;
export const updatePopup = updateFunnelPopup;
export const deletePopup = deleteFunnelPopup;
export const bindPopupToPage = bindFunnelPopupToPage;
