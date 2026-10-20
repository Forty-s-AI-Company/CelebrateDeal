export const LIVE_PUBLISH_REQUIREMENT_CODES = [
  "media",
  "products",
  "registration_form",
  "registration_email",
  "live_reminder_email",
  "interaction_script",
] as const;

// Existing runtime/onboarding callers still use the pre-reminder contract.
// The scheduled publish path opts into the extended code explicitly below.
export type LivePublishRequirementCode = Exclude<
  typeof LIVE_PUBLISH_REQUIREMENT_CODES[number],
  "live_reminder_email"
>;
export type LivePublishRequirementCodeWithReminder = typeof LIVE_PUBLISH_REQUIREMENT_CODES[number];

export type LivePublishReadinessInput = {
  studioPreset?: "CONTENT" | "COMMERCE" | "CUSTOM";
  mode?: "auto" | "content" | "commerce";
  productCount: number;
  productsReady: boolean;
  videoReady: boolean;
  formReady: boolean;
  registrationEmailReady: boolean;
  liveReminderEmailReady?: boolean;
  interactionScriptReady: boolean;
};

export type LivePublishRequirement = {
  code: LivePublishRequirementCode;
  ready: boolean;
};

export function requiresLivePublishReadiness(status: string, replayEnabled: boolean) {
  return status === "scheduled"
    || status === "live"
    || (status === "ended" && replayEnabled);
}

export function getLivePublishReadiness(input: LivePublishReadinessInput) {
  const mode = input.studioPreset === "COMMERCE" || input.mode === "commerce"
    ? "commerce"
    : input.studioPreset === "CONTENT" || input.mode === "content"
      ? input.productCount > 0 ? "commerce" : "content"
      : input.productCount > 0 ? "commerce" : "content";
  const requirements: LivePublishRequirement[] = [
    { code: "media", ready: input.videoReady },
  ];
  // Keep the operational checklist in the same order as the webinar wizard:
  // media → product (sales only) → registration → email. Interaction scripts are
  // recommendations only (see below).
  if (mode === "commerce") {
    requirements.push({ code: "products", ready: input.productsReady && input.productCount > 0 });
  }
  requirements.push(
    { code: "registration_form", ready: input.formReady },
    { code: "registration_email", ready: input.registrationEmailReady },
  );
  // 互動腳本（虛擬使用者）是選配：沒有腳本也能發布，只在銷售直播提示「建議」。
  const recommendations: LivePublishRequirement[] = mode === "commerce"
    ? [{ code: "interaction_script", ready: input.interactionScriptReady }]
    : [];

  const blockers = requirements.filter((requirement) => !requirement.ready);
  return {
    mode,
    requirements,
    /** 建議但不阻擋發布的項目。 */
    recommendations,
    blockers,
    ready: blockers.length === 0,
  } as const;
}
