import {
  parsePageDocument,
  type FunnelNode,
  type FunnelNodeAction,
  type FunnelNodeStyle,
  type PageDocument,
} from "@/lib/funnel-page-document";
import type { FunnelFlow } from "@/lib/funnel-flow";

type NodeOverrides = FunnelNode["overrides"];

/**
 * Structured commands used by the Funnel editor.  Commands contain document
 * data only; no rendered HTML is ever placed in the history.
 */
export type FunnelPageCommand =
  | { type: "add"; node: FunnelNode; parentId?: string | null; popupId?: string | null; index?: number }
  | { type: "update"; nodeId: string; patch: FunnelNodePatch; replace?: boolean }
  | { type: "move"; nodeId: string; toParentId?: string | null; toPopupId?: string | null; index?: number }
  | { type: "duplicate"; nodeId: string; newId?: string; index?: number }
  | { type: "delete"; nodeId: string }
  | { type: "move_up"; nodeId: string }
  | { type: "move_down"; nodeId: string }
  | { type: "update_settings"; settings: Partial<PageDocument["settings"]> }
  | { type: "update_flow"; flow?: FunnelFlow }
  | { type: "restore"; node: FunnelNode; parentId: string | null; popupId: string | null; index: number };

export type FunnelNodePatch = {
  props?: Record<string, unknown>;
  style?: Partial<FunnelNodeStyle>;
  overrides?: NodeOverrides;
  visible?: boolean;
  actions?: FunnelNodeAction[];
  attributes?: Record<string, string>;
};

export interface FunnelPageHistoryEntry {
  command: FunnelPageCommand;
  inverse: FunnelPageCommand;
}

export interface FunnelPageHistory {
  present: PageDocument;
  past: readonly FunnelPageHistoryEntry[];
  future: readonly FunnelPageHistoryEntry[];
}

interface NodeLocation {
  node: FunnelNode;
  parentId: string | null;
  popupId: string | null;
  index: number;
}

interface ChildrenLocation {
  children: FunnelNode[];
  parentId: string | null;
  popupId: string | null;
}

interface CommandResult {
  document: PageDocument;
  inverse: FunnelPageCommand;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) output[key] = cloneValue(child);
    return output as T;
  }
  return value;
}

function cloneNode(node: FunnelNode): FunnelNode {
  return cloneValue(node);
}

function cloneDocument(document: PageDocument): PageDocument {
  return cloneValue(document);
}

function traverse(nodes: FunnelNode[], popupId: string | null, parentId: string | null, callback: (node: FunnelNode, index: number, parentId: string | null, popupId: string | null) => boolean): NodeLocation | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (callback(node, index, parentId, popupId)) return { node, parentId, popupId, index };
    if (node.children) {
      const match = traverse(node.children, popupId, node.id, callback);
      if (match) return match;
    }
  }
  return null;
}

function locateNode(document: PageDocument, nodeId: string): NodeLocation | null {
  const rootMatch = traverse(document.root, null, null, (node) => node.id === nodeId);
  if (rootMatch) return rootMatch;
  for (const popup of document.popups) {
    const match = traverse(popup.root, popup.id, null, (node) => node.id === nodeId);
    if (match) return match;
  }
  return null;
}

function findPopup(document: PageDocument, popupId: string | null | undefined) {
  return popupId ? document.popups.find((popup) => popup.id === popupId) ?? null : null;
}

function getChildrenLocation(document: PageDocument, parentId: string | null | undefined, popupId: string | null | undefined): ChildrenLocation | null {
  const normalizedParent = parentId ?? null;
  const normalizedPopup = popupId ?? null;
  if (normalizedParent === null) {
    if (normalizedPopup === null) return { children: document.root, parentId: null, popupId: null };
    const popup = findPopup(document, normalizedPopup);
    return popup ? { children: popup.root, parentId: null, popupId: popup.id } : null;
  }
  const parent = locateNode(document, normalizedParent);
  if (!parent || parent.popupId !== normalizedPopup || !parent.node.children) return null;
  return { children: parent.node.children, parentId: parent.node.id, popupId: parent.popupId };
}

function replaceChildren(document: PageDocument, location: ChildrenLocation, children: FunnelNode[]): PageDocument {
  const result = cloneDocument(document);
  if (location.parentId === null) {
    if (location.popupId === null) result.root = children;
    else {
      const popup = result.popups.find((candidate) => candidate.id === location.popupId);
      if (popup) popup.root = children;
    }
    return result;
  }
  const parent = locateNode(result, location.parentId);
  if (parent?.node) parent.node.children = children;
  return result;
}

function validIndex(index: number | undefined, length: number): number | null {
  const value = index ?? length;
  return Number.isInteger(value) && value >= 0 && value <= length ? value : null;
}

function nodeIsInside(node: FunnelNode, targetId: string): boolean {
  if (node.id === targetId) return true;
  return Boolean(node.children?.some((child) => nodeIsInside(child, targetId)));
}

function mergeOverrides(base: NodeOverrides, patch: NodeOverrides): NodeOverrides {
  return {
    ...(base ?? {}),
    ...(patch.desktop ? { desktop: { ...(base.desktop ?? {}), ...patch.desktop, ...(patch.desktop.style ? { style: { ...(base.desktop?.style ?? {}), ...patch.desktop.style } } : {}), ...(patch.desktop.props ? { props: { ...(base.desktop?.props ?? {}), ...patch.desktop.props } } : {}) } } : {}),
    ...(patch.mobile ? { mobile: { ...(base.mobile ?? {}), ...patch.mobile, ...(patch.mobile.style ? { style: { ...(base.mobile?.style ?? {}), ...patch.mobile.style } } : {}), ...(patch.mobile.props ? { props: { ...(base.mobile?.props ?? {}), ...patch.mobile.props } } : {}) } } : {}),
  };
}

function applyPatch(node: FunnelNode, patch: FunnelNodePatch, replace = false): FunnelNode {
  const result = cloneNode(node);
  if (patch.props) result.props = replace ? cloneValue(patch.props) : { ...result.props, ...cloneValue(patch.props) };
  if (patch.style) result.style = replace ? cloneValue(patch.style) as FunnelNodeStyle : { ...result.style, ...cloneValue(patch.style) };
  if (patch.overrides) result.overrides = replace ? cloneValue(patch.overrides) : mergeOverrides(result.overrides, patch.overrides);
  if (patch.visible !== undefined) result.visible = patch.visible;
  if (patch.actions) result.actions = cloneValue(patch.actions);
  if (patch.attributes) result.attributes = cloneValue(patch.attributes);
  return result;
}

function replaceNode(document: PageDocument, nodeId: string, nextNode: FunnelNode): PageDocument | null {
  const location = locateNode(document, nodeId);
  if (!location) return null;
  const container = getChildrenLocation(document, location.parentId, location.popupId);
  if (!container) return null;
  const children = container.children.map((node, index) => index === location.index ? cloneNode(nextNode) : cloneNode(node));
  return replaceChildren(document, container, children);
}

function addNode(document: PageDocument, node: FunnelNode, parentId: string | null, popupId: string | null, index: number | undefined): PageDocument | null {
  const container = getChildrenLocation(document, parentId, popupId);
  if (!container) return null;
  const insertionIndex = validIndex(index, container.children.length);
  if (insertionIndex === null || locateNode(document, node.id)) return null;
  const next = container.children.map(cloneNode);
  next.splice(insertionIndex, 0, cloneNode(node));
  return replaceChildren(document, container, next);
}

function removeNode(document: PageDocument, nodeId: string): { document: PageDocument; removed: NodeLocation } | null {
  const location = locateNode(document, nodeId);
  if (!location) return null;
  const container = getChildrenLocation(document, location.parentId, location.popupId);
  if (!container) return null;
  const next = container.children.filter((_, index) => index !== location.index).map(cloneNode);
  const result = replaceChildren(document, container, next);
  return { document: result, removed: { ...location, node: cloneNode(location.node) } };
}

function allIds(document: PageDocument): Set<string> {
  const ids = new Set<string>(document.popups.map((popup) => popup.id));
  const visit = (nodes: FunnelNode[]) => { for (const node of nodes) { ids.add(node.id); if (node.children) visit(node.children); } };
  visit(document.root);
  for (const popup of document.popups) visit(popup.root);
  return ids;
}

function uniqueId(base: string, used: Set<string>): string {
  const normalized = base.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 80) || "node_copy";
  let candidate = normalized;
  let suffix = 2;
  while (used.has(candidate)) { candidate = `${normalized.slice(0, Math.max(1, 80 - String(suffix).length - 1))}_copy_${suffix}`; suffix += 1; }
  used.add(candidate);
  return candidate;
}

function duplicateTree(node: FunnelNode, used: Set<string>, requestedId?: string): FunnelNode | null {
  if (requestedId && used.has(requestedId)) return null;
  const copy = cloneNode(node);
  copy.id = requestedId ? uniqueId(requestedId, used) : uniqueId(`${node.id}_copy`, used);
  if (copy.children) {
    const children = copy.children.map((child) => duplicateTree(child, used));
    if (children.some((child) => child === null)) return null;
    copy.children = children as FunnelNode[];
  }
  return copy;
}

function parseResult(next: PageDocument | null, inverse: FunnelPageCommand): CommandResult | null {
  const parsed = next ? parsePageDocument(next) : null;
  return parsed ? { document: parsed, inverse } : null;
}

function executeAdd(document: PageDocument, command: Extract<FunnelPageCommand, { type: "add" | "restore" }>): CommandResult | null {
  const next = addNode(document, command.node, command.parentId ?? null, command.popupId ?? null, command.index);
  return parseResult(next, { type: "delete", nodeId: command.node.id });
}

function executeUpdate(document: PageDocument, command: Extract<FunnelPageCommand, { type: "update" }>): CommandResult | null {
  const location = locateNode(document, command.nodeId);
  if (!location) return null;
  const next = replaceNode(document, command.nodeId, applyPatch(location.node, command.patch, command.replace));
  const previousPatch: FunnelNodePatch = { props: location.node.props, style: location.node.style, overrides: location.node.overrides, visible: location.node.visible, actions: location.node.actions, attributes: location.node.attributes };
  return parseResult(next, { type: "update", nodeId: command.nodeId, patch: previousPatch, replace: true });
}

function executeDelete(document: PageDocument, command: Extract<FunnelPageCommand, { type: "delete" }>): CommandResult | null {
  const removed = removeNode(document, command.nodeId);
  if (!removed) return null;
  return parseResult(removed.document, { type: "restore", node: removed.removed.node, parentId: removed.removed.parentId, popupId: removed.removed.popupId, index: removed.removed.index });
}

function executeDuplicate(document: PageDocument, command: Extract<FunnelPageCommand, { type: "duplicate" }>): CommandResult | null {
  const location = locateNode(document, command.nodeId);
  if (!location) return null;
  const container = getChildrenLocation(document, location.parentId, location.popupId);
  if (!container) return null;
  const index = validIndex(command.index, container.children.length);
  if (index === null) return null;
  const copy = duplicateTree(location.node, allIds(document), command.newId);
  if (!copy) return null;
  const nextChildren = container.children.map(cloneNode);
  nextChildren.splice(index, 0, copy);
  return parseResult(replaceChildren(document, container, nextChildren), { type: "delete", nodeId: copy.id });
}

function executeMoveAdjacent(document: PageDocument, command: Extract<FunnelPageCommand, { type: "move_up" | "move_down" }>): CommandResult | null {
  const location = locateNode(document, command.nodeId);
  if (!location) return null;
  const length = getChildrenLocation(document, location.parentId, location.popupId)?.children.length ?? 0;
  const targetIndex = command.type === "move_up" ? location.index - 1 : location.index + 1;
  if (targetIndex < 0 || targetIndex >= length) return null;
  return execute(document, { type: "move", nodeId: command.nodeId, toParentId: location.parentId, toPopupId: location.popupId, index: targetIndex });
}

function executeMove(document: PageDocument, command: Extract<FunnelPageCommand, { type: "move" }>): CommandResult | null {
  const location = locateNode(document, command.nodeId);
  if (!location) return null;
  const destinationParentId = command.toParentId ?? null;
  const destinationPopupId = command.toPopupId === undefined ? location.popupId : command.toPopupId;
  const destination = getChildrenLocation(document, destinationParentId, destinationPopupId);
  const sourceContainer = getChildrenLocation(document, location.parentId, location.popupId);
  if (!destination || !sourceContainer || (destinationParentId !== null && nodeIsInside(location.node, destinationParentId))) return null;
  const destinationIndex = validIndex(command.index, destination.children.length);
  if (destinationIndex === null) return null;
  const sourceIndex = location.index;
  const moving = cloneNode(location.node);
  const without = sourceContainer.children.filter((_, index) => index !== sourceIndex).map(cloneNode);
  let adjustedIndex = destinationIndex;
  if (sourceContainer.parentId === destination.parentId && sourceContainer.popupId === destination.popupId && sourceIndex < destinationIndex) adjustedIndex -= 1;
  const afterRemove = replaceChildren(document, sourceContainer, without);
  const destinationAfterRemove = getChildrenLocation(afterRemove, destination.parentId, destination.popupId);
  if (!destinationAfterRemove) return null;
  const finalChildren = destinationAfterRemove.children.map(cloneNode);
  finalChildren.splice(adjustedIndex, 0, moving);
  const parsed = parsePageDocument(replaceChildren(afterRemove, destinationAfterRemove, finalChildren));
  return parsed ? { document: parsed, inverse: { type: "move", nodeId: moving.id, toParentId: location.parentId, toPopupId: location.popupId, index: sourceIndex } } : null;
}

function execute(document: PageDocument, command: FunnelPageCommand): CommandResult | null {
  const source = cloneDocument(document);
  switch (command.type) {
    case "add":
    case "restore": return executeAdd(source, command);
    case "update": return executeUpdate(source, command);
    case "delete": return executeDelete(source, command);
    case "duplicate": return executeDuplicate(source, command);
    case "move_up":
    case "move_down": return executeMoveAdjacent(source, command);
    case "move": return executeMove(source, command);
    case "update_settings": {
      const previous = cloneValue(source.settings);
      source.settings = { ...source.settings, ...cloneValue(command.settings) };
      return parseResult(source, { type: "update_settings", settings: previous });
    }
    case "update_flow": {
      const previous = source.flow ? cloneValue(source.flow) : undefined;
      source.flow = command.flow ? cloneValue(command.flow) : undefined;
      return parseResult(source, { type: "update_flow", flow: previous });
    }
  }
}

/** Apply one command without changing a history object. Invalid commands fail closed. */
export function applyFunnelPageCommand(document: PageDocument, command: FunnelPageCommand): PageDocument | null {
  const parsed = parsePageDocument(document);
  if (!parsed) return null;
  return execute(parsed, command)?.document ?? null;
}

export function createFunnelPageHistory(document: PageDocument): FunnelPageHistory {
  const parsed = parsePageDocument(document);
  if (!parsed) throw new Error("無法建立不符合規格的 Funnel history");
  return { present: parsed, past: [], future: [] };
}

export function dispatchFunnelPageCommand(history: FunnelPageHistory, command: FunnelPageCommand): FunnelPageHistory {
  const result = execute(history.present, command);
  if (!result) return history;
  return { present: result.document, past: [...history.past, { command, inverse: result.inverse }], future: [] };
}

export function undoFunnelPageHistory(history: FunnelPageHistory): FunnelPageHistory {
  const entry = history.past.at(-1);
  if (!entry) return history;
  const result = execute(history.present, entry.inverse);
  if (!result) return history;
  return { present: result.document, past: history.past.slice(0, -1), future: [{ command: entry.command, inverse: entry.inverse }, ...history.future] };
}

export function redoFunnelPageHistory(history: FunnelPageHistory): FunnelPageHistory {
  const entry = history.future[0];
  if (!entry) return history;
  const result = execute(history.present, entry.command);
  if (!result) return history;
  return { present: result.document, past: [...history.past, { command: entry.command, inverse: result.inverse }], future: history.future.slice(1) };
}

// Short aliases keep reducer wiring readable in editor code.
export const reduceFunnelPageHistory = dispatchFunnelPageCommand;
export const undoFunnelPage = undoFunnelPageHistory;
export const redoFunnelPage = redoFunnelPageHistory;
