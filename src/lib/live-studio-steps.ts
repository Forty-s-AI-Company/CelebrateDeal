/**
 * The single definition of the Live Studio wizard steps. Every consumer
 * (the studio's navigation and panels, readiness "fix" jumps, the draft
 * schema's step bounds, the publish action's final step and the draft
 * resume list) derives from this list, so a step is identified by its key
 * and never by a hard-coded index.
 *
 * The draft payload still persists the position (`activeStep`) as an index
 * into this list for the current `flowVersion`.
 */
export const LIVE_STUDIO_STEPS = [
  { key: "purpose", label: "用途與基本資料" },
  { key: "media", label: "影片與即時直播" },
  { key: "products", label: "商品優惠" },
  { key: "registration", label: "報名頁" },
  { key: "schedule", label: "時間、回放與品牌" },
  { key: "emails", label: "Email" },
  { key: "interactions", label: "留言、商品浮窗與 CTA" },
  { key: "review", label: "桌機／手機預覽發布" },
] as const;

export type LiveStudioStep = (typeof LIVE_STUDIO_STEPS)[number];
export type LiveStudioStepKey = LiveStudioStep["key"];

export const LIVE_STUDIO_STEP_COUNT = LIVE_STUDIO_STEPS.length;
export const LIVE_STUDIO_FIRST_STEP_INDEX = 0;
export const LIVE_STUDIO_LAST_STEP_INDEX = LIVE_STUDIO_STEP_COUNT - 1;

const stepKeys: ReadonlySet<string> = new Set(LIVE_STUDIO_STEPS.map((step) => step.key));

export function isLiveStudioStepKey(value: unknown): value is LiveStudioStepKey {
  return typeof value === "string" && stepKeys.has(value);
}

export function liveStudioStepIndex(key: LiveStudioStepKey): number {
  return LIVE_STUDIO_STEPS.findIndex((step) => step.key === key);
}

/** The step persisted at `index`; out-of-range or non-integer positions fall back to the first step. */
export function liveStudioStepAt(index: number): LiveStudioStep {
  return (Number.isInteger(index) ? LIVE_STUDIO_STEPS[index] : undefined) ?? LIVE_STUDIO_STEPS[LIVE_STUDIO_FIRST_STEP_INDEX];
}
