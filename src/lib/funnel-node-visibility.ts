import type { FunnelNode } from "@/lib/funnel-page-document";
import type { FunnelPageCommand } from "@/lib/funnel-page-history";

export type FunnelDevice = "desktop" | "mobile";

/**
 * Device visibility (EDT-RESP-001) on the existing document model: a
 * per-viewport `overrides[device].visible` wins over the base `visible`,
 * exactly as the shared renderer resolves it. No persisted format change.
 */
export function funnelNodeVisibleOn(node: Pick<FunnelNode, "visible" | "overrides">, device: FunnelDevice): boolean {
  return node.overrides[device]?.visible ?? node.visible;
}

export function funnelNodeVisibility(node: Pick<FunnelNode, "visible" | "overrides">): Record<FunnelDevice, boolean> {
  return { desktop: funnelNodeVisibleOn(node, "desktop"), mobile: funnelNodeVisibleOn(node, "mobile") };
}

/** One toggle → one undoable update that only touches that device's override. */
export function funnelDeviceVisibilityCommand(node: FunnelNode, device: FunnelDevice, visible: boolean): FunnelPageCommand | null {
  if (funnelNodeVisibleOn(node, device) === visible) return null;
  return { type: "update", nodeId: node.id, patch: { overrides: { [device]: { visible } } } };
}
