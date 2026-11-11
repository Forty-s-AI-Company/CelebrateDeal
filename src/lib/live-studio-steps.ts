/**
 * The single definition of the Live Studio wizard steps. Every consumer
 * (the studio's navigation and panels, readiness "fix" jumps, the draft
 * schema's step bounds, the publish action's final step and the draft
 * resume list) derives from this list, so a step is identified by its key
 * and never by a hard-coded index.
 *
 * The draft payload still persists the position (`activeStep`) as an index
 * into this list for the current `flowVersion`; older flow versions are
 * mapped onto these keys in `live-studio-draft.ts`.
 */
export const LIVE_STUDIO_STEPS = [
  { key: "content", label: "內容", description: "標題、影片、報名頁與開播時間" },
  { key: "sales", label: "成交", description: "主打商品、促銷短句與互動腳本" },
  { key: "notifications", label: "通知", description: "報名成功信與開播、課後通知" },
  { key: "publish", label: "發布", description: "檢查發布條件、預覽並送出" },
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

/** Merchant-facing summary such as 「4 個步驟（內容、成交、通知、發布）」. */
export function liveStudioStepSummary() {
  return `${LIVE_STUDIO_STEP_COUNT} 個步驟（${LIVE_STUDIO_STEPS.map((step) => step.label).join("、")}）`;
}
