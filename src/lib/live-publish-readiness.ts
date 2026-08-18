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
  // media → product (sales only) → registration → email → interaction.
  if (mode === "commerce") {
    requirements.push({ code: "products", ready: input.productsReady });
  }
  requirements.push(
    { code: "registration_form", ready: input.formReady },
    { code: "registration_email", ready: input.registrationEmailReady },
  );
  if (input.studioPreset !== undefined || input.liveReminderEmailReady !== undefined) {
    requirements.push({
      code: "live_reminder_email" as LivePublishRequirementCode,
      ready: input.liveReminderEmailReady ?? false,
    });
  }

  if (mode === "commerce") {
    requirements.push({ code: "interaction_script", ready: input.interactionScriptReady });
  }

  const blockers = requirements.filter((requirement) => !requirement.ready);
  return {
    mode,
    requirements,
    blockers,
    ready: blockers.length === 0,
  } as const;
}
