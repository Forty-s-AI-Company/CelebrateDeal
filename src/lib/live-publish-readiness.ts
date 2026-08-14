export const LIVE_PUBLISH_REQUIREMENT_CODES = [
  "media",
  "products",
  "registration_form",
  "registration_email",
  "interaction_script",
] as const;

export type LivePublishRequirementCode = typeof LIVE_PUBLISH_REQUIREMENT_CODES[number];

export type LivePublishReadinessInput = {
  mode?: "auto" | "content" | "commerce";
  productCount: number;
  productsReady: boolean;
  videoReady: boolean;
  formReady: boolean;
  registrationEmailReady: boolean;
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
  const mode = input.mode && input.mode !== "auto"
    ? input.mode
    : input.productCount > 0 ? "commerce" : "content";
  const requirements: LivePublishRequirement[] = [
    { code: "media", ready: input.videoReady },
  ];

  if (mode === "commerce") {
    requirements.push(
      { code: "products", ready: input.productsReady },
      { code: "registration_form", ready: input.formReady },
      { code: "registration_email", ready: input.registrationEmailReady },
      { code: "interaction_script", ready: input.interactionScriptReady },
    );
  }

  const blockers = requirements.filter((requirement) => !requirement.ready);
  return {
    mode,
    requirements,
    blockers,
    ready: blockers.length === 0,
  } as const;
}
