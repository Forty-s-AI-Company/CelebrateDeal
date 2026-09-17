import {
  addFunnelStep,
  duplicateFunnelStep,
  moveFunnelStep,
  parseFunnelFlow,
  removeFunnelStep,
  renameFunnelStep,
  setFunnelStepPath,
  setFunnelStepTemplate,
  type FunnelFlow,
  type FunnelFlowMutationResult,
  type FunnelStep,
  type FunnelStepInput,
} from "@/lib/funnel-flow";
import {
  createEmptyPageDocument,
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type PageDocument,
} from "@/lib/funnel-page-document";

/**
 * A Funnel is a sequence of independently editable pages.  The existing
 * LandingPage JSON field can persist this whole object without a database
 * migration: `flow` retains workflow metadata and `pages` retains the actual
 * PageDocument snapshot selected by each step.
 */
export const FUNNEL_STEP_PAGES_SCHEMA_VERSION = 1 as const;

export type FunnelStepPageSnapshot = Omit<PageDocument, "flow">;

export type FunnelStepPages = {
  schemaVersion: typeof FUNNEL_STEP_PAGES_SCHEMA_VERSION;
  flow: FunnelFlow;
  activeStepId: string;
  pages: Record<string, FunnelStepPageSnapshot>;
};

export type FunnelStepPageMutationResult =
  | { ok: true; state: FunnelStepPages }
  | { ok: false; state: FunnelStepPages; error: string };

export type FunnelStepPageSelection = {
  step: FunnelStep;
  page: FunnelStepPageSnapshot;
  editable: boolean;
};

export type FunnelStepPersistenceMutation =
  | { type: "add"; input: FunnelStepInput; index?: number }
  | { type: "move"; stepId: string; toIndex: number }
  | { type: "remove"; stepId: string }
  | { type: "rename"; stepId: string; name: string }
  | { type: "set_path"; stepId: string; path: string };

const MAX_SERIALIZED_LENGTH = 20_000_000;
const MAX_IDENTIFIER_LENGTH = 100;

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, clone(child)]),
    ) as T;
  }
  return value;
}

/** Small deterministic ID component, avoiding unsafe or overlong user IDs. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function newIdentifier(kind: string, scope: string, used: Set<string>, ordinal = 0): string {
  let index = ordinal;
  let candidate = "";
  do {
    candidate = `${kind}_${shortHash(scope)}_${index}`.slice(0, MAX_IDENTIFIER_LENGTH);
    index += 1;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function pageIdFor(flow: FunnelFlow, step: FunnelStep, used: Set<string>): string {
  return newIdentifier("page", `${flow.id}|${step.id}`, used);
}

function snapshotFor(flow: FunnelFlow, step: FunnelStep, usedDocumentIds: Set<string>): FunnelStepPageSnapshot {
  const page = createEmptyPageDocument(pageIdFor(flow, step, usedDocumentIds), step.name);
  // Flow metadata belongs to the outer store.  Keeping it out prevents nested
  // snapshots from accidentally diverging after a user edits a step list.
  delete page.flow;
  return page;
}

function asSnapshot(value: unknown): FunnelStepPageSnapshot | null {
  const page = parsePageDocument(value);
  if (!page) return null;
  delete page.flow;
  return page;
}

function collectNodes(nodes: FunnelNode[], ids: Set<string>): boolean {
  for (const node of nodes) {
    if (ids.has(node.id)) return false;
    ids.add(node.id);
    if (node.children && !collectNodes(node.children, ids)) return false;
  }
  return true;
}

function validActions(nodes: FunnelNode[], page: FunnelStepPageSnapshot, stepIds: Set<string>): boolean {
  const popupIds = new Set(page.popups.map((popup) => popup.id));
  const visit = (children: FunnelNode[]): boolean => children.every((node) => {
    for (const action of node.actions) {
      if (action.type === "show_popup" && !popupIds.has(action.popupId)) return false;
      if (action.type === "next_step" && !stepIds.has(action.stepId)) return false;
    }
    return !node.children || visit(node.children);
  });
  return visit(nodes);
}

function validStore(state: FunnelStepPages): FunnelStepPages | null {
  const flow = parseFunnelFlow(state.flow);
  if (!flow || state.schemaVersion !== FUNNEL_STEP_PAGES_SCHEMA_VERSION) return null;
  const stepIds = new Set(flow.steps.map((step) => step.id));
  if (!stepIds.has(state.activeStepId) || Object.keys(state.pages).length !== stepIds.size) return null;
  if (Object.keys(state.pages).some((stepId) => !stepIds.has(stepId))) return null;

  const documentIds = new Set<string>();
  const nodeIds = new Set<string>();
  const popupIds = new Set<string>();
  const pages: Record<string, FunnelStepPageSnapshot> = {};
  for (const step of flow.steps) {
    const page = asSnapshot(state.pages[step.id]);
    if (!page || documentIds.has(page.id) || !collectNodes(page.root, nodeIds)) return null;
    if (page.popups.some((popup) => popupIds.has(popup.id))) return null;
    let popupNodesValid = true;
    page.popups.forEach((popup) => {
      popupIds.add(popup.id);
      // PageDocument validates popup root against the document root but stores
      // IDs in a separate tree.  We also require cross-page uniqueness here.
      if (!collectNodes(popup.root, nodeIds)) popupNodesValid = false;
    });
    if (!popupNodesValid || !validActions(page.root, page, stepIds) || page.popups.some((popup) => !validActions(popup.root, page, stepIds))) return null;
    documentIds.add(page.id);
    pages[step.id] = page;
  }
  return { schemaVersion: FUNNEL_STEP_PAGES_SCHEMA_VERSION, flow, activeStepId: state.activeStepId, pages };
}

function failure(state: FunnelStepPages, error: string): FunnelStepPageMutationResult {
  return { ok: false, state: clone(state), error };
}

function success(state: FunnelStepPages): FunnelStepPageMutationResult {
  return { ok: true, state: clone(state) };
}

function fromFlowMutation(
  state: FunnelStepPages,
  result: FunnelFlowMutationResult,
  synchronize: (next: FunnelStepPages, previous: FunnelFlow) => string | null,
): FunnelStepPageMutationResult {
  if (!result.ok) return failure(state, result.error);
  const next = clone(state);
  next.flow = result.flow;
  const error = synchronize(next, state.flow);
  if (error) return failure(state, error);
  const valid = validStore(next);
  return valid ? success(valid) : failure(state, "同步後的 Funnel steps 與頁面快照不符合規格，已回復原狀");
}

/** Creates one independently serializable page snapshot for every step, including the system inactive page. */
export function createFunnelStepPages(flow: FunnelFlow, options: { activeStepId?: string; initialPage?: PageDocument; initialStepId?: string } = {}): FunnelStepPages | null {
  const parsedFlow = parseFunnelFlow(flow);
  if (!parsedFlow) return null;
  const activeStepId = options.activeStepId ?? parsedFlow.steps[0]?.id;
  if (!activeStepId || !parsedFlow.steps.some((step) => step.id === activeStepId)) return null;
  const initialStepId = options.initialStepId ?? activeStepId;
  if (options.initialPage && !parsedFlow.steps.some((step) => step.id === initialStepId)) return null;

  const documentIds = new Set<string>();
  const pages: Record<string, FunnelStepPageSnapshot> = {};
  for (const step of parsedFlow.steps) {
    if (step.id === initialStepId && options.initialPage) {
      const page = asSnapshot(options.initialPage);
      if (!page || documentIds.has(page.id)) return null;
      documentIds.add(page.id);
      pages[step.id] = page;
    } else {
      pages[step.id] = snapshotFor(parsedFlow, step, documentIds);
    }
  }
  return validStore({ schemaVersion: FUNNEL_STEP_PAGES_SCHEMA_VERSION, flow: parsedFlow, activeStepId, pages });
}

/** Strict persistence boundary for a flow plus all of its per-step page snapshots. */
export function parseFunnelStepPages(value: unknown): FunnelStepPages | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<FunnelStepPages>;
  if (!candidate.pages || typeof candidate.pages !== "object" || Array.isArray(candidate.pages) || typeof candidate.activeStepId !== "string") return null;
  return validStore(candidate as FunnelStepPages);
}

export function serializeFunnelStepPages(state: FunnelStepPages): string {
  const valid = parseFunnelStepPages(state);
  if (!valid) throw new Error("無法序列化不符合規格的 Funnel step pages");
  return JSON.stringify(valid);
}

export function deserializeFunnelStepPages(serialized: string): FunnelStepPages | null {
  if (serialized.length > MAX_SERIALIZED_LENGTH) return null;
  try { return parseFunnelStepPages(JSON.parse(serialized) as unknown); } catch { return null; }
}

/** A pure selection transaction. The inactive page is intentionally selectable but non-editable. */
export function switchFunnelStep(state: FunnelStepPages, stepId: string): FunnelStepPageMutationResult {
  const valid = parseFunnelStepPages(state);
  if (!valid) return failure(state, "Funnel step pages 資料無法通過驗證，拒絕切換");
  if (!valid.flow.steps.some((step) => step.id === stepId)) return failure(valid, "找不到指定步驟");
  return success({ ...valid, activeStepId: stepId });
}

export function getActiveFunnelStepPage(state: FunnelStepPages): FunnelStepPageSelection | null {
  const valid = parseFunnelStepPages(state);
  if (!valid) return null;
  const step = valid.flow.steps.find((item) => item.id === valid.activeStepId);
  const page = step ? valid.pages[step.id] : undefined;
  return step && page ? { step, page, editable: !step.isSystem } : null;
}

/** Replaces only one selected PageDocument while retaining its step-owned document identity. */
export function replaceFunnelStepPage(state: FunnelStepPages, stepId: string, page: PageDocument, templateId?: string): FunnelStepPageMutationResult {
  const valid = parseFunnelStepPages(state);
  if (!valid) return failure(state, "Funnel step pages 資料無法通過驗證，拒絕儲存頁面");
  const step = valid.flow.steps.find((item) => item.id === stepId);
  if (!step) return failure(valid, "找不到指定步驟");
  if (step.isSystem) return failure(valid, "停用頁由系統管理，不能覆寫內容");
  const snapshot = asSnapshot(page);
  if (!snapshot) return failure(valid, "頁面資料不符合 PageDocument 規格");
  snapshot.id = valid.pages[stepId]!.id;
  const next = clone(valid);
  if (templateId) {
    const updated = setFunnelStepTemplate(next.flow, stepId, templateId);
    if (!updated.ok) return failure(valid, updated.error);
    next.flow = updated.flow;
  }
  next.pages[stepId] = snapshot;
  const parsed = parseFunnelStepPages(next);
  return parsed ? success(parsed) : failure(valid, "頁面包含與其他 Funnel step 重複的 ID 或失效動作，已回復原狀");
}

export function addFunnelStepPage(state: FunnelStepPages, input: FunnelStepInput, index?: number): FunnelStepPageMutationResult {
  const valid = parseFunnelStepPages(state);
  if (!valid) return failure(state, "Funnel step pages 資料無法通過驗證，拒絕新增步驟");
  return fromFlowMutation(valid, addFunnelStep(valid.flow, input, index), (next) => {
    const added = next.flow.steps.find((step) => !valid.flow.steps.some((old) => old.id === step.id));
    if (!added) return "找不到新增後的步驟";
    const used = new Set(Object.values(next.pages).map((page) => page.id));
    next.pages[added.id] = snapshotFor(next.flow, added, used);
    return null;
  });
}

function rewriteAction(action: FunnelNodeAction, nodeIds: Map<string, string>, popupIds: Map<string, string>, originalStepId: string, copyStepId: string): FunnelNodeAction {
  if (action.type === "show_popup") return { ...action, popupId: popupIds.get(action.popupId) ?? action.popupId };
  if (action.type === "submit_form" && action.formId) return { ...action, formId: nodeIds.get(action.formId) ?? action.formId };
  if (action.type === "next_step" && action.stepId === originalStepId) return { ...action, stepId: copyStepId };
  return clone(action);
}

function duplicateSnapshot(source: FunnelStepPageSnapshot, flow: FunnelFlow, originalStepId: string, copyStepId: string, usedDocumentIds: Set<string>, usedNodeIds: Set<string>, usedPopupIds: Set<string>): FunnelStepPageSnapshot {
  const page = clone(source);
  const nodeIds = new Map<string, string>();
  const popupIds = new Map<string, string>();
  const pageScope = `${flow.id}|${copyStepId}`;
  page.id = newIdentifier("page", pageScope, usedDocumentIds);
  let ordinal = 0;
  const allocateNodes = (nodes: FunnelNode[]) => nodes.forEach((node) => {
    const nextId = newIdentifier("node", `${pageScope}|${node.id}`, usedNodeIds, ordinal);
    ordinal += 1;
    nodeIds.set(node.id, nextId);
    node.id = nextId;
    if (node.children) allocateNodes(node.children);
  });
  allocateNodes(page.root);
  for (const popup of page.popups) {
    const nextId = newIdentifier("popup", `${pageScope}|${popup.id}`, usedPopupIds, ordinal);
    ordinal += 1;
    popupIds.set(popup.id, nextId);
    popup.id = nextId;
    popup.pageId = page.id;
    allocateNodes(popup.root);
  }
  const rewriteNodes = (nodes: FunnelNode[]) => nodes.forEach((node) => {
    node.actions = node.actions.map((action) => rewriteAction(action, nodeIds, popupIds, originalStepId, copyStepId));
    if (node.children) rewriteNodes(node.children);
  });
  rewriteNodes(page.root);
  page.popups.forEach((popup) => rewriteNodes(popup.root));
  return page;
}

function allNodeIds(state: FunnelStepPages): Set<string> {
  const result = new Set<string>();
  Object.values(state.pages).forEach((page) => {
    collectNodes(page.root, result);
    page.popups.forEach((popup) => collectNodes(popup.root, result));
  });
  return result;
}

function allPopupIds(state: FunnelStepPages): Set<string> {
  return new Set(Object.values(state.pages).flatMap((page) => page.popups.map((popup) => popup.id)));
}

export function duplicateFunnelStepPage(state: FunnelStepPages, stepId: string, input: Pick<FunnelStepInput, "id" | "name" | "path">): FunnelStepPageMutationResult {
  const valid = parseFunnelStepPages(state);
  if (!valid) return failure(state, "Funnel step pages 資料無法通過驗證，拒絕複製步驟");
  const source = valid.flow.steps.find((step) => step.id === stepId);
  return fromFlowMutation(valid, duplicateFunnelStep(valid.flow, stepId, input), (next) => {
    if (!source) return "找不到要複製的步驟";
    const copy = next.flow.steps.find((step) => !valid.flow.steps.some((old) => old.id === step.id));
    if (!copy || !valid.pages[source.id]) return "找不到複製後的步驟或頁面";
    next.pages[copy.id] = duplicateSnapshot(
      valid.pages[source.id], next.flow, source.id, copy.id,
      new Set(Object.values(next.pages).map((page) => page.id)), allNodeIds(valid), allPopupIds(valid),
    );
    return null;
  });
}

export function moveFunnelStepPage(state: FunnelStepPages, stepId: string, toIndex: number): FunnelStepPageMutationResult {
  const valid = parseFunnelStepPages(state);
  if (!valid) return failure(state, "Funnel step pages 資料無法通過驗證，拒絕移動步驟");
  return fromFlowMutation(valid, moveFunnelStep(valid.flow, stepId, toIndex), () => null);
}

export function removeFunnelStepPage(state: FunnelStepPages, stepId: string): FunnelStepPageMutationResult {
  const valid = parseFunnelStepPages(state);
  if (!valid) return failure(state, "Funnel step pages 資料無法通過驗證，拒絕移除步驟");
  return fromFlowMutation(valid, removeFunnelStep(valid.flow, stepId), (next) => {
    delete next.pages[stepId];
    if (next.activeStepId === stepId) next.activeStepId = next.flow.steps.find((step) => !step.isSystem)?.id ?? "inactive";
    return null;
  });
}

export function renameFunnelStepPage(state: FunnelStepPages, stepId: string, name: string): FunnelStepPageMutationResult {
  const valid = parseFunnelStepPages(state);
  if (!valid) return failure(state, "Funnel step pages 資料無法通過驗證，拒絕重新命名步驟");
  return fromFlowMutation(valid, renameFunnelStep(valid.flow, stepId, name), (next) => {
    const step = next.flow.steps.find((item) => item.id === stepId);
    const page = next.pages[stepId];
    if (!step || !page) return "找不到重新命名後的步驟頁面";
    page.name = step.name;
    return null;
  });
}

/** Updates the public step URL while retaining every independently stored page snapshot. */
export function setFunnelStepPathPage(state: FunnelStepPages, stepId: string, path: string): FunnelStepPageMutationResult {
  const valid = parseFunnelStepPages(state);
  if (!valid) return failure(state, "Funnel step pages 資料無法通過驗證，拒絕修改 URL Path");
  return fromFlowMutation(valid, setFunnelStepPath(valid.flow, stepId, path), () => null);
}

/** Applies the narrow command accepted by metadata auto-save. Page content can
 * only be created by `add`; existing page snapshots are never accepted from
 * the client and therefore cannot be overwritten by a background save. */
export function applyFunnelStepPersistenceMutation(
  state: FunnelStepPages,
  mutation: FunnelStepPersistenceMutation,
): FunnelStepPageMutationResult {
  if (mutation.type === "add") return addFunnelStepPage(state, mutation.input, mutation.index);
  if (mutation.type === "move") return moveFunnelStepPage(state, mutation.stepId, mutation.toIndex);
  if (mutation.type === "remove") return removeFunnelStepPage(state, mutation.stepId);
  if (mutation.type === "rename") return renameFunnelStepPage(state, mutation.stepId, mutation.name);
  return setFunnelStepPathPage(state, mutation.stepId, mutation.path);
}
