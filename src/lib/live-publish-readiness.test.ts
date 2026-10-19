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
      formReady: true,
      registrationEmailReady: true,
      liveReminderEmailReady: true,
      interactionScriptReady: false,
    })).toEqual({
      mode: "content",
      requirements: [
        { code: "media", ready: true },
        { code: "registration_form", ready: true },
        { code: "registration_email", ready: true },
      ],
      recommendations: [],
      blockers: [],
      ready: true,
    });
  });

  it("requires products, media, form and email for a sales live, but only recommends an interaction script", () => {
    expect(getLivePublishReadiness({
      productCount: 2,
      productsReady: true,
      videoReady: true,
      formReady: false,
      registrationEmailReady: true,
      liveReminderEmailReady: true,
      interactionScriptReady: false,
    })).toEqual({
      mode: "commerce",
      requirements: [
        { code: "media", ready: true },
        { code: "products", ready: true },
        { code: "registration_form", ready: false },
        { code: "registration_email", ready: true },
      ],
      recommendations: [{ code: "interaction_script", ready: false }],
      blockers: [{ code: "registration_form", ready: false }],
      ready: false,
    });
  });

  it("lets a sales live with products publish without any interaction script", () => {
    const readiness = getLivePublishReadiness({
      productCount: 1,
      productsReady: true,
      videoReady: true,
      formReady: true,
      registrationEmailReady: true,
      liveReminderEmailReady: true,
      interactionScriptReady: false,
    });
    expect(readiness.mode).toBe("commerce");
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.requirements.map((requirement) => requirement.code)).not.toContain("interaction_script");
    expect(readiness.recommendations).toEqual([{ code: "interaction_script", ready: false }]);
  });

  it("still blocks an explicit commerce live that has no product selected", () => {
    const readiness = getLivePublishReadiness({
      studioPreset: "COMMERCE",
      productCount: 0,
      productsReady: true,
      videoReady: true,
      formReady: true,
      registrationEmailReady: true,
      interactionScriptReady: true,
    });
    expect(readiness.blockers).toEqual([{ code: "products", ready: false }]);
  });

  it("can evaluate a commerce starter before the first product is created", () => {
    expect(getLivePublishReadiness({
      mode: "commerce",
      productCount: 0,
      productsReady: false,
      videoReady: true,
      formReady: true,
      registrationEmailReady: true,
      liveReminderEmailReady: true,
      interactionScriptReady: true,
    })).toMatchObject({
      mode: "commerce",
      blockers: [{ code: "products", ready: false }],
      ready: false,
    });
  });

  it("derives custom mode from the selected product count", () => {
    expect(getLivePublishReadiness({
      studioPreset: "CUSTOM",
      productCount: 0,
      productsReady: true,
      videoReady: true,
      formReady: true,
      registrationEmailReady: true,
      liveReminderEmailReady: true,
      interactionScriptReady: false,
    }).mode).toBe("content");

    expect(getLivePublishReadiness({
      studioPreset: "CUSTOM",
      productCount: 1,
      productsReady: true,
      videoReady: true,
      formReady: true,
      registrationEmailReady: true,
      liveReminderEmailReady: true,
      interactionScriptReady: true,
    }).mode).toBe("commerce");
  });

  it("keeps optional notification rules out of content publishing blockers", () => {
    expect(getLivePublishReadiness({
      studioPreset: "CONTENT",
      productCount: 0,
      productsReady: true,
      videoReady: true,
      formReady: true,
      registrationEmailReady: true,
      liveReminderEmailReady: false,
      interactionScriptReady: true,
    })).toMatchObject({
      mode: "content",
      blockers: [],
      ready: true,
    });
  });

  it("keeps an explicit commerce preset in commerce mode before a product is selected", () => {
    expect(getLivePublishReadiness({
      studioPreset: "COMMERCE",
      productCount: 0,
      productsReady: false,
      videoReady: true,
      formReady: true,
      registrationEmailReady: true,
      liveReminderEmailReady: true,
      interactionScriptReady: true,
    })).toMatchObject({
      mode: "commerce",
      blockers: [{ code: "products", ready: false }],
      ready: false,
    });
  });

  it("promotes a content preset with products to commerce mode", () => {
    expect(getLivePublishReadiness({
      studioPreset: "CONTENT",
      productCount: 1,
      productsReady: true,
      videoReady: true,
      formReady: true,
      registrationEmailReady: true,
      liveReminderEmailReady: true,
      interactionScriptReady: false,
    })).toMatchObject({
      mode: "commerce",
      blockers: [],
      recommendations: [{ code: "interaction_script", ready: false }],
      ready: true,
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
