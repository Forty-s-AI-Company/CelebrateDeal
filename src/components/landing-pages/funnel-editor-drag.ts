import type { DragEvent as ReactDragEvent } from "react";
import type { FunnelDragPayload } from "@/lib/funnel-editor-canvas";

export const FUNNEL_ELEMENT_DRAG_TYPE = "application/x-celebratedeal-funnel-element";
export const FUNNEL_BLOCK_DRAG_TYPE = "application/x-celebratedeal-funnel-block";
export const FUNNEL_NODE_DRAG_TYPE = "application/x-celebratedeal-funnel-node";

/**
 * The drag in progress inside this window. `dataTransfer.getData` is not
 * readable during dragover, but the canvas needs the dragged node type to
 * decide legal targets while the pointer moves, so the source records it here.
 */
let activeDrag: FunnelDragPayload | null = null;

export function beginFunnelDrag(event: Pick<ReactDragEvent, "dataTransfer">, payload: FunnelDragPayload) {
  activeDrag = payload;
  const transfer = event.dataTransfer;
  transfer.effectAllowed = payload.kind === "node" ? "move" : "copy";
  if (payload.kind === "element") transfer.setData(FUNNEL_ELEMENT_DRAG_TYPE, payload.nodeType);
  else if (payload.kind === "block") transfer.setData(FUNNEL_BLOCK_DRAG_TYPE, payload.templateId);
  else transfer.setData(FUNNEL_NODE_DRAG_TYPE, payload.nodeId);
}

export function endFunnelDrag() {
  activeDrag = null;
}

/** Payload for the current drag, or null for foreign drags (files, other windows). */
export function currentFunnelDrag(types?: readonly string[]): FunnelDragPayload | null {
  if (!activeDrag) return null;
  if (types && !types.some((type) => type === FUNNEL_ELEMENT_DRAG_TYPE || type === FUNNEL_BLOCK_DRAG_TYPE || type === FUNNEL_NODE_DRAG_TYPE)) return null;
  return activeDrag;
}
