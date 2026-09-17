import type { FunnelStepPages } from "@/lib/funnel-step-pages";

/** Broadcast media must pass through the server-gated Live admission route. */
export function hasDirectWebinarVideo(state: FunnelStepPages): boolean {
  const containsVideo = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsVideo);
    if (!value || typeof value !== "object") return false;
    const object = value as Record<string, unknown>;
    // Scan overrides and nested popup/child data too; hidden media is not exempt.
    return object.type === "video" || Object.values(object).some(containsVideo);
  };
  return state.flow.steps.some((step) => {
    if (step.type !== "webinar_broadcast_page") return false;
    const page = state.pages[step.id];
    return Boolean(page && (containsVideo(page.root) || containsVideo(page.popups)));
  });
}
