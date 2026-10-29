import type { FunnelNode } from "@/lib/funnel-page-document";
import type { FunnelPageCommand } from "@/lib/funnel-page-history";

export type FunnelDevice = "desktop" | "tablet" | "mobile";

/**
 * Device visibility (EDT-RESP-001) on the existing document model: a
 * per-viewport `overrides[device].visible` wins over the base `visible`,
 * exactly as the shared renderer resolves it. No persisted format change.
 */
export function funnelNodeVisibleOn(node: Pick<FunnelNode, "visible" | "overrides">, device: FunnelDevice): boolean {
  // Tablet inherits the desktop override (it meant "640px and up" before the tablet breakpoint).
  if (device === "tablet") return node.overrides.tablet?.visible ?? node.overrides.desktop?.visible ?? node.visible;
  return node.overrides[device]?.visible ?? node.visible;
}

export function funnelNodeVisibility(node: Pick<FunnelNode, "visible" | "overrides">): Record<FunnelDevice, boolean> {
  return { desktop: funnelNodeVisibleOn(node, "desktop"), tablet: funnelNodeVisibleOn(node, "tablet"), mobile: funnelNodeVisibleOn(node, "mobile") };
}

/** One toggle → one undoable update that only touches that device's override. */
export function funnelDeviceVisibilityCommand(node: FunnelNode, device: FunnelDevice, visible: boolean): FunnelPageCommand | null {
  if (funnelNodeVisibleOn(node, device) === visible) return null;
  return { type: "update", nodeId: node.id, patch: { overrides: { [device]: { visible } } } };
}
