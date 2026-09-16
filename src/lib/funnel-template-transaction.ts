import {
  createEmptyPageDocument,
  parsePageDocument,
  type FunnelNode,
  type FunnelPopup,
  type PageDocument,
} from "@/lib/funnel-page-document";

/**
 * Template replacement is deliberately a pure transaction.  The editor can
 * call it once to render the confirmation dialog and again with `confirm:
 * true` to commit.  There is no database write, mutation, or hidden side
 * effect in this module.
 */

export const FUNNEL_TEMPLATE_TRANSACTION_IDS = [
  "blank",
  "audience",
  "sell",
  "custom-info",
  "webinar",
] as const;

export type FunnelTemplateTransactionId = (typeof FUNNEL_TEMPLATE_TRANSACTION_IDS)[number];
export type FunnelTemplateTransactionStatus = "available" | "unverified" | "disabled";

export type FunnelTemplateTransactionTemplate = {
  id: FunnelTemplateTransactionId;
  name: string;
  description: string;
  status: FunnelTemplateTransactionStatus;
  reason: string;
  build: () => { root: FunnelNode[]; popups: FunnelPopup[] };
};

export type FunnelTemplateSettingsStrategy = "preserve" | "reset";

export type FunnelTemplateTransactionOptions = {
  templateId: string;
  /** A replacement is destructive to the current canvas, so this defaults to false. */
  confirm?: boolean;
  /** Preserve the existing page settings; defaults to true. */
  settingsStrategy?: FunnelTemplateSettingsStrategy;
  /** Friendly aliases used by UI callers. */
  preserveSettings?: boolean;
  preservePageSettings?: boolean;
};

export type FunnelTemplateImpactSummary = {
  templateId: string;
  templateName: string;
  previousRootCount: number;
  nextRootCount: number;
  previousPopupCount: number;
  nextPopupCount: number;
  settingsStrategy: FunnelTemplateSettingsStrategy;
  preservedMetadata: readonly ("id" | "name" | "revision")[];
  warning: string;
};

export type FunnelTemplateTransactionResult = {
  status: "preview" | "applied" | "rejected";
  ok: boolean;
  requiresConfirmation: boolean;
  document: PageDocument;
  impact: FunnelTemplateImpactSummary | null;
  error?: string;
  undo?: FunnelTemplateUndoAdapter;
};

export type FunnelTemplateUndoAdapter = {
  /** Return the exact pre-transaction document, with no mutation. */
  undo: (document?: PageDocument) => PageDocument;
  /** Return the exact committed document, with no mutation. */
  redo: (document?: PageDocument) => PageDocument;
};

function node(id: string, type: FunnelNode["type"], props: Record<string, unknown> = {}, children?: FunnelNode[]): FunnelNode {
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
    ...(children ? { children } : {}),
  };
}

function section(id: string, children: FunnelNode[]): FunnelNode {
  return node(id, "section", {}, [node(`${id}_row`, "row", {}, [node(`${id}_columns`, "columns_2", {}, children)])]);
}

function form(id: string, fields: string[], submitLabel: string): FunnelNode {
  return node(id, "form", { submitLabel }, [
    ...fields.map((label, index) => node(`${id}_input_${index + 1}`, "form_input", { label, name: label.toLowerCase().replace(/[^a-z0-9]+/gu, "_") || `field_${index + 1}`, required: index === 1 })),
    node(`${id}_button`, "button", { label: submitLabel, action: { type: "submit_form" } }),
  ]);
}

function emptyTemplate(): { root: FunnelNode[]; popups: FunnelPopup[] } {
  return { root: [], popups: [] };
}

function audienceTemplate(): { root: FunnelNode[]; popups: FunnelPopup[] } {
  return {
    root: [section("audience_section", [
      node("audience_headline", "headline", { text: "先了解你的需求" }),
      node("audience_description", "text", { text: "留下基本資料，我們會提供適合你的內容與下一步建議。" }),
      form("audience_form", ["姓名", "Email"], "開始了解"),
    ])],
    popups: [],
  };
}

function sellTemplate(): { root: FunnelNode[]; popups: FunnelPopup[] } {
  return {
    root: [section("sell_section", [
      node("sell_headline", "headline", { text: "把下一步變得簡單" }),
      node("sell_description", "text", { text: "清楚看見方案內容、適合對象與行動方式。" }),
      node("sell_offer", "content_box", { title: "方案重點" }, [
        node("sell_offer_title", "headline", { text: "從今天開始累積可衡量的成果" }),
        node("sell_offer_text", "text", { text: "先確認你的目標，再選擇適合的開始方式。" }),
      ]),
      node("sell_button", "button", { label: "查看方案", action: { type: "none" } }),
    ])],
    popups: [],
  };
}

function customInfoTemplate(): { root: FunnelNode[]; popups: FunnelPopup[] } {
  return {
    root: [section("custom_info_section", [
      node("custom_info_headline", "headline", { text: "告訴我們更多資訊" }),
      node("custom_info_description", "text", { text: "用幾個問題整理你的需求，方便我們提供更精準的回覆。" }),
      form("custom_info_form", ["姓名", "Email", "目前遇到的問題"], "送出資訊"),
    ])],
    popups: [],
  };
}

const unavailableTemplate = (id: FunnelTemplateTransactionId, name: string, reason: string): FunnelTemplateTransactionTemplate => ({
  id,
  name,
  description: "目前保留入口，但不可套用。",
  status: "unverified",
  reason,
  build: emptyTemplate,
});

/** Safe built-ins only. Webinar is visible to the picker as unavailable and can never be applied. */
export const FUNNEL_TEMPLATE_TRANSACTION_TEMPLATES: Readonly<Record<FunnelTemplateTransactionId, FunnelTemplateTransactionTemplate>> = {
  blank: { id: "blank", name: "空白頁面", description: "從空白畫布開始建立頁面。", status: "available", reason: "可安全套用", build: emptyTemplate },
  audience: { id: "audience", name: "名單收集", description: "標題、說明與基本資料表單。", status: "available", reason: "可安全套用", build: audienceTemplate },
  sell: { id: "sell", name: "方案介紹", description: "方案重點與行動按鈕。", status: "available", reason: "可安全套用；不建立假的付款流程", build: sellTemplate },
  "custom-info": { id: "custom-info", name: "自訂資訊", description: "可收集姓名、Email 與需求說明。", status: "available", reason: "可安全套用", build: customInfoTemplate },
  webinar: unavailableTemplate("webinar", "Webinar", "Webinar 模板目前尚未完成可驗證的直播、報名與排程整合，因此維持 unverified，禁止套用。"),
};

let transactionSequence = 0;

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) copy[key] = cloneValue(child);
    return copy as T;
  }
  return value;
}

function collectIds(nodes: FunnelNode[], ids: Set<string>): void {
  for (const item of nodes) {
    ids.add(item.id);
    if (item.children) collectIds(item.children, ids);
  }
}

function uniqueId(base: string, used: Set<string>): string {
  const clean = base.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 90) || "node";
  let result = clean;
  let suffix = 2;
  while (used.has(result)) {
    result = `${clean.slice(0, Math.max(1, 90 - String(suffix).length - 1))}_${suffix}`;
    suffix += 1;
  }
  used.add(result);
  return result;
}

function remapNodeIds(nodes: FunnelNode[], templateId: string, used: Set<string>): FunnelNode[] {
  transactionSequence += 1;
  const transactionKey = `${templateId}_${Date.now().toString(36)}_${transactionSequence}`;
  const remap = (item: FunnelNode): FunnelNode => {
    const id = uniqueId(`tpl_${transactionKey}_${item.id}`, used);
    return { ...cloneValue(item), id, ...(item.children ? { children: remapNodeIdsForTransaction(item.children, transactionKey, used) } : {}) };
  };
  const remapNodeIdsForTransaction = (children: FunnelNode[], key: string, target: Set<string>): FunnelNode[] => children.map((child) => {
    const id = uniqueId(`tpl_${key}_${child.id}`, target);
    return { ...cloneValue(child), id, ...(child.children ? { children: remapNodeIdsForTransaction(child.children, key, target) } : {}) };
  });
  return nodes.map(remap);
}

function remapPopups(popups: FunnelPopup[], templateId: string, used: Set<string>): FunnelPopup[] {
  return popups.map((popup) => {
    const popupId = uniqueId(`tpl_${templateId}_${popup.id}`, used);
    const roots = remapNodeIds(popup.root, templateId, used);
    return { ...cloneValue(popup), id: popupId, root: roots };
  });
}

function resolveSettingsStrategy(options: FunnelTemplateTransactionOptions): FunnelTemplateSettingsStrategy {
  if (options.settingsStrategy) return options.settingsStrategy;
  if (options.preservePageSettings !== undefined) return options.preservePageSettings ? "preserve" : "reset";
  if (options.preserveSettings !== undefined) return options.preserveSettings ? "preserve" : "reset";
  return "preserve";
}

function unchanged(document: PageDocument): PageDocument {
  return cloneValue(document);
}

function rejected(document: PageDocument, error: string): FunnelTemplateTransactionResult {
  return { status: "rejected", ok: false, requiresConfirmation: false, document: unchanged(document), impact: null, error };
}

export function getFunnelTemplateTransactionTemplate(templateId: string): FunnelTemplateTransactionTemplate | null {
  return FUNNEL_TEMPLATE_TRANSACTION_TEMPLATES[templateId as FunnelTemplateTransactionId] ?? null;
}

export function createFunnelTemplateUndoAdapter(before: PageDocument, after: PageDocument): FunnelTemplateUndoAdapter | null {
  const previous = parsePageDocument(before);
  const next = parsePageDocument(after);
  if (!previous || !next) return null;
  const beforeCopy = cloneValue(previous);
  const afterCopy = cloneValue(next);
  return {
    undo: () => cloneValue(beforeCopy),
    redo: () => cloneValue(afterCopy),
  };
}

/**
 * Preview or apply a template replacement.  The input document is never
 * mutated.  Without explicit confirmation, `document` remains unchanged.
 */
export function changeFunnelTemplate(document: PageDocument, options: FunnelTemplateTransactionOptions): FunnelTemplateTransactionResult {
  const parsed = parsePageDocument(document);
  if (!parsed) return rejected(document, "目前頁面文件無法通過驗證，拒絕套用模板");

  const template = getFunnelTemplateTransactionTemplate(options.templateId);
  if (!template) return rejected(parsed, "找不到指定的安全內建模板，拒絕套用");
  if (template.status !== "available") return rejected(parsed, template.reason);

  const settingsStrategy = resolveSettingsStrategy(options);
  if (settingsStrategy !== "preserve" && settingsStrategy !== "reset") return rejected(parsed, "未知的 page settings 保留策略，拒絕套用");

  const built = template.build();
  // Include the old document ids even though root/popups are replaced. This
  // makes the collision guarantee explicit for callers that keep old history
  // snapshots beside the newly generated document.
  const used = new Set<string>();
  collectIds(parsed.root, used);
  parsed.popups.forEach((popup) => { used.add(popup.id); collectIds(popup.root, used); });
  const nextRoot = remapNodeIds(built.root, template.id, used);
  const nextPopups = remapPopups(built.popups, template.id, used);
  const cleanSettings = settingsStrategy === "preserve" ? cloneValue(parsed.settings) : createEmptyPageDocument(parsed.id, parsed.name).settings;
  const candidate = parsePageDocument({
    schemaVersion: parsed.schemaVersion,
    id: parsed.id,
    name: parsed.name,
    revision: parsed.revision,
    root: nextRoot,
    popups: nextPopups,
    settings: cleanSettings,
  });
  if (!candidate) return rejected(parsed, "模板內容無法通過 PageDocument 驗證，拒絕套用");

  const impact: FunnelTemplateImpactSummary = {
    templateId: template.id,
    templateName: template.name,
    previousRootCount: parsed.root.length,
    nextRootCount: candidate.root.length,
    previousPopupCount: parsed.popups.length,
    nextPopupCount: candidate.popups.length,
    settingsStrategy,
    preservedMetadata: ["id", "name", "revision"],
    warning: "套用模板會替換目前畫布與 Popup；既有節點內容不會自動合併。請確認後繼續。",
  };

  if (options.confirm !== true) {
    return { status: "preview", ok: true, requiresConfirmation: true, document: unchanged(parsed), impact };
  }

  return {
    status: "applied",
    ok: true,
    requiresConfirmation: false,
    document: candidate,
    impact,
    undo: createFunnelTemplateUndoAdapter(parsed, candidate) ?? undefined,
  };
}

export const previewFunnelTemplateChange = (document: PageDocument, options: Omit<FunnelTemplateTransactionOptions, "confirm">) => changeFunnelTemplate(document, { ...options, confirm: false });
export const applyFunnelTemplateChange = (document: PageDocument, options: Omit<FunnelTemplateTransactionOptions, "confirm">) => changeFunnelTemplate(document, { ...options, confirm: true });
