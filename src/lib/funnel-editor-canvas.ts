import { getFunnelNodeDefinition, type FunnelNode, type FunnelNodeType } from "@/lib/funnel-page-document";
import type { FunnelPageCommand } from "@/lib/funnel-page-history";

/**
 * Pure geometry and tree rules behind the editor canvas (EDT-INT-001/002):
 * where a dragged element may land, where the insertion indicator is drawn
 * and where the floating node toolbar sits. The canvas measures DOM rects
 * lazily and passes them in; nothing here touches the DOM.
 */

/** What is being dragged: a new element, a layout block (always a section) or an existing node. */
export type FunnelDragPayload =
  | { kind: "element"; nodeType: FunnelNodeType }
  | { kind: "block"; templateId: string; nodeType: FunnelNodeType }
  | { kind: "node"; nodeId: string; nodeType: FunnelNodeType };

export type FunnelDropAxis = "vertical" | "horizontal";
export type FunnelDropPlacement = "before" | "after" | "inside";
export type FunnelRect = { left: number; top: number; width: number; height: number };
export type FunnelPoint = { x: number; y: number };

export type FunnelDropTarget = {
  /** Container receiving the node; null is the page (or popup) root. */
  parentId: string | null;
  /** Insertion index in the container's current children (before the move is applied). */
  index: number;
  /** Node whose rect anchors the indicator; null means the empty page itself. */
  anchorId: string | null;
  placement: FunnelDropPlacement;
  /** Flow direction of the anchor and its siblings (columns flow horizontally on desktop). */
  axis: FunnelDropAxis;
};

/** Registry rule shared with history validation: can `type` live directly inside `parent`? */
export function funnelNodeAccepts(parent: FunnelNodeType | "root", type: FunnelNodeType): boolean {
  if (parent !== "root" && !getFunnelNodeDefinition(parent).children) return false;
  return getFunnelNodeDefinition(type).allowedParents.includes(parent);
}

function findPath(nodes: readonly FunnelNode[], id: string, path: FunnelNode[] = []): FunnelNode[] | null {
  for (const node of nodes) {
    const next = [...path, node];
    if (node.id === id) return next;
    const nested = node.children ? findPath(node.children, id, next) : null;
    if (nested) return nested;
  }
  return null;
}

function locate(nodes: readonly FunnelNode[], id: string, parentId: string | null = null): { parentId: string | null; index: number } | null {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.id === id) return { parentId, index };
    const nested = node.children ? locate(node.children, id, node.id) : null;
    if (nested) return nested;
  }
  return null;
}

/**
 * Which part of a hovered rect the pointer is in. Edge bands (a quarter of the
 * size, clamped to 6–24px) mean before/after; the middle means inside. When
 * only one kind of drop is legal the whole rect maps to it.
 */
export function funnelDropZone(rect: FunnelRect, point: FunnelPoint, axis: FunnelDropAxis, options: { inside: boolean; beside: boolean }): FunnelDropPlacement | null {
  if (!options.inside && !options.beside) return null;
  if (!options.beside) return "inside";
  const start = axis === "vertical" ? rect.top : rect.left;
  const size = Math.max(0, axis === "vertical" ? rect.height : rect.width);
  const offset = (axis === "vertical" ? point.y : point.x) - start;
  if (!options.inside) return offset < size / 2 ? "before" : "after";
  const edge = Math.min(24, Math.max(6, size / 4));
  if (offset < edge) return "before";
  if (offset > size - edge) return "after";
  return "inside";
}

/** Moving a node next to itself changes nothing, so no indicator is shown. */
function isNoopMove(root: readonly FunnelNode[], payload: FunnelDragPayload, target: FunnelDropTarget): boolean {
  if (payload.kind !== "node") return false;
  const source = locate(root, payload.nodeId);
  if (!source || source.parentId !== target.parentId) return false;
  return target.index === source.index || target.index === source.index + 1;
}

/** Deepest, last container under `nodes` that accepts `type` (end of a section or page). */
function lastAccepting(nodes: readonly FunnelNode[], type: FunnelNodeType, excludeId?: string): FunnelNode | null {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]!;
    if (excludeId && node.id === excludeId) continue;
    const nested = node.children ? lastAccepting(node.children, type, excludeId) : null;
    if (nested) return nested;
    if (node.children && funnelNodeAccepts(node.type, type)) return node;
  }
  return null;
}

function appendTarget(container: FunnelNode): FunnelDropTarget {
  return { parentId: container.id, index: container.children?.length ?? 0, anchorId: container.id, placement: "inside", axis: "vertical" };
}

export type FunnelDropInput = {
  root: readonly FunnelNode[];
  payload: FunnelDragPayload;
  hoveredId: string;
  point: FunnelPoint;
  /** Lazily measures a node; called only for the hovered node and its ancestors. */
  measure: (nodeId: string) => FunnelRect | null;
  /** Flow axis of a node among its siblings; defaults to vertical. */
  axisOf?: (nodeId: string) => FunnelDropAxis;
};

/**
 * Resolves the drop target for a pointer over `hoveredId`. Walks from the
 * hovered node outwards so a section dragged over a paragraph lands
 * before/after the paragraph's section. Over a section's empty area an
 * element goes to the end of that section's last accepting container.
 * Invalid targets (the dragged node itself, its descendants, disallowed
 * parents, no-op moves) return null and must not show an indicator.
 */
export function resolveFunnelDrop({ root, payload, hoveredId, point, measure, axisOf }: FunnelDropInput): FunnelDropTarget | null {
  const path = findPath(root, hoveredId);
  if (!path) return null;
  if (payload.kind === "node" && path.some((node) => node.id === payload.nodeId)) return null;
  const type = payload.nodeType;
  for (let depth = path.length - 1; depth >= 0; depth -= 1) {
    const candidate = path[depth]!;
    const parent = depth > 0 ? path[depth - 1]! : null;
    const rect = measure(candidate.id);
    if (!rect) continue;
    const inside = Boolean(candidate.children) && funnelNodeAccepts(candidate.type, type);
    const beside = funnelNodeAccepts(parent?.type ?? "root", type);
    const axis = axisOf?.(candidate.id) ?? "vertical";
    const zone = funnelDropZone(rect, point, axis, { inside, beside });
    if (!zone) continue;
    const siblings = parent?.children ?? root;
    const index = siblings.findIndex((node) => node.id === candidate.id);
    const target: FunnelDropTarget = zone === "inside"
      ? { ...appendTarget(candidate), axis }
      : { parentId: parent?.id ?? null, index: zone === "before" ? index : index + 1, anchorId: candidate.id, placement: zone, axis };
    return isNoopMove(root, payload, target) ? null : target;
  }
  // Only the section's own empty area (padding below its rows) falls back to "end of this section".
  if (path.length !== 1) return null;
  const fallback = lastAccepting(path, type, payload.kind === "node" ? payload.nodeId : undefined);
  if (!fallback) return null;
  const target = appendTarget(fallback);
  return isNoopMove(root, payload, target) ? null : target;
}

/** Drop on the canvas background: sections go to the end of the page, elements into the last accepting container. */
export function resolveFunnelEndDrop(root: readonly FunnelNode[], payload: FunnelDragPayload): FunnelDropTarget | null {
  const type = payload.nodeType;
  let target: FunnelDropTarget | null = null;
  if (funnelNodeAccepts("root", type)) {
    const last = root.at(-1);
    target = last ? { parentId: null, index: root.length, anchorId: last.id, placement: "after", axis: "vertical" } : { parentId: null, index: 0, anchorId: null, placement: "inside", axis: "vertical" };
  } else {
    // The dragged subtree is skipped, so a node never lands inside itself.
    const container = lastAccepting(root, type, payload.kind === "node" ? payload.nodeId : undefined);
    if (container) target = appendTarget(container);
  }
  return target && !isNoopMove(root, payload, target) ? target : null;
}

/** The single history command a drop commits. A new node must be supplied for library drops. */
export function funnelDropCommand(target: FunnelDropTarget, payload: FunnelDragPayload, popupId: string | null, node?: FunnelNode): FunnelPageCommand | null {
  if (payload.kind === "node") return { type: "move", nodeId: payload.nodeId, toParentId: target.parentId, index: target.index };
  if (!node || node.type !== payload.nodeType) return null;
  return { type: "add", node, parentId: target.parentId, popupId, index: target.index };
}

export type FunnelIndicatorGeometry = { kind: "line" | "box"; left: number; top: number; width: number; height: number };

/** Insertion line on the anchor's leading/trailing edge, or a container highlight for inside drops. */
export function funnelDropIndicatorGeometry(target: FunnelDropTarget, rect: FunnelRect, thickness = 4): FunnelIndicatorGeometry {
  if (target.placement === "inside") return { kind: "box", ...rect };
  const half = thickness / 2;
  if (target.axis === "horizontal") {
    const left = target.placement === "before" ? rect.left - half : rect.left + rect.width - half;
    return { kind: "line", left, top: rect.top, width: thickness, height: rect.height };
  }
  const top = target.placement === "before" ? rect.top - half : rect.top + rect.height - half;
  return { kind: "line", left: rect.left, top, width: rect.width, height: thickness };
}

export type FunnelToolbarPlacement = { left: number; top: number; side: "above" | "below" | "inside" };

/**
 * Floating toolbar position: above the node's top-right corner when it fits
 * in the visible canvas, otherwise below the node, otherwise pinned to the top
 * of the visible part of a tall node. Always clamped inside `visible`, so it
 * never leaves the canvas viewport and avoids covering the edited text.
 */
export function placeFunnelNodeToolbar(node: FunnelRect, visible: FunnelRect, toolbar: { width: number; height: number }, gap = 6): FunnelToolbarPlacement {
  const visibleBottom = visible.top + visible.height;
  const nodeBottom = node.top + node.height;
  const maxLeft = visible.left + Math.max(0, visible.width - toolbar.width);
  const left = Math.min(Math.max(node.left + node.width - toolbar.width, visible.left), maxLeft);
  const above = node.top - toolbar.height - gap;
  if (above >= visible.top) return { left, top: above, side: "above" };
  const below = nodeBottom + gap;
  if (below + toolbar.height <= visibleBottom) return { left, top: below, side: "below" };
  const pinned = Math.min(Math.max(visible.top + gap, node.top + gap), Math.max(visible.top, visibleBottom - toolbar.height - gap));
  return { left, top: pinned, side: "inside" };
}
