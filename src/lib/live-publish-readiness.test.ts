import { describe, expect, it } from "vitest";

import {
  getLivePublishReadiness,
  requiresLivePublishReadiness,
} from "@/lib/live-publish-readiness";

describe("live publish readiness", () => {
  it("allows a content live to publish with ready playback media", () => {
    expect(getLivePublishReadiness({
      productCount: 0,
      productsReady: true,
      videoReady: true,
      formReady: false,
      registrationEmailReady: false,
      interactionScriptReady: false,
    })).toEqual({
      mode: "content",
      requirements: [{ code: "media", ready: true }],
      blockers: [],
      ready: true,
    });
  });

  it("requires the complete conversion path when products are selected", () => {
    expect(getLivePublishReadiness({
      productCount: 2,
      productsReady: true,
      videoReady: true,
      formReady: false,
      registrationEmailReady: true,
      interactionScriptReady: false,
    })).toEqual({
      mode: "commerce",
      requirements: [
        { code: "media", ready: true },
        { code: "products", ready: true },
        { code: "registration_form", ready: false },
        { code: "registration_email", ready: true },
        { code: "interaction_script", ready: false },
      ],
      blockers: [
        { code: "registration_form", ready: false },
        { code: "interaction_script", ready: false },
      ],
      ready: false,
    });
  });

  it("can evaluate a commerce starter before the first product is created", () => {
    expect(getLivePublishReadiness({
      mode: "commerce",
      productCount: 0,
      productsReady: false,
      videoReady: true,
      formReady: true,
      registrationEmailReady: true,
      interactionScriptReady: true,
    })).toMatchObject({
      mode: "commerce",
      blockers: [{ code: "products", ready: false }],
      ready: false,
    });
  });

  it("guards every buyer-visible state including ended replay", () => {
    expect(requiresLivePublishReadiness("draft", true)).toBe(false);
    expect(requiresLivePublishReadiness("scheduled", false)).toBe(true);
    expect(requiresLivePublishReadiness("live", false)).toBe(true);
    expect(requiresLivePublishReadiness("ended", true)).toBe(true);
    expect(requiresLivePublishReadiness("ended", false)).toBe(false);
  });
});
