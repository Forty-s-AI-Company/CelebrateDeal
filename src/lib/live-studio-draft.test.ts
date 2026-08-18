import { describe, expect, it } from "vitest";
import { emptyLiveStudioDraft, LiveStudioDraftPayloadSchema, SaveLiveStudioDraftRequestSchema } from "./live-studio-draft";

describe("LiveStudioDraftPayloadSchema", () => {
  it("builds a canonical bounded eight-step draft", () => {
    expect(emptyLiveStudioDraft()).toMatchObject({
      studioPreset: "CUSTOM",
      title: "",
      productIds: [],
      streamMode: "vod",
      usageAttributionMode: "PROMOTER",
      quotaPayerScope: "VENDOR",
      liveReminderTemplateId: "",
      liveReminderOffsetMinutes: "60",
      replayAvailableUntil: "",
      flowVersion: 2,
      activeStep: 0,
    });
  });

  it("persists a bounded Live Studio purpose without accepting invented presets", () => {
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), studioPreset: "COMMERCE" }).success).toBe(true);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), studioPreset: "CONTENT" }).success).toBe(true);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), studioPreset: "FAKE_VIEWERS" }).success).toBe(false);
  });

  it("accepts a complete recoverable draft without secrets or provider identifiers", () => {
    expect(LiveStudioDraftPayloadSchema.safeParse({
      ...emptyLiveStudioDraft(),
      title: "新品直播",
      slug: "new-products",
      productIds: ["product-1"],
      heroImageUrl: "https://media.example.test/hero.webp",
      heroImageAssetId: "asset-1",
      messageTemplateId: "registration-template-1",
      liveReminderTemplateId: "reminder-template-1",
      liveReminderOffsetMinutes: "30",
      replayAvailableUntil: "2026-08-21T20:00",
      activeStep: 7,
    }).success).toBe(true);
    expect(LiveStudioDraftPayloadSchema.safeParse({
      ...emptyLiveStudioDraft(),
      heroImageUrl: "https://",
    }).success).toBe(true);
  });

  it.each([
    [0, 0], [1, 2], [2, 1], [3, 6], [4, 7],
  ])("maps legacy v1 step %s to canonical v2 step %s without changing values", (legacyStep, canonicalStep) => {
    const { flowVersion, ...legacy } = emptyLiveStudioDraft();
    expect(flowVersion).toBe(2);
    const parsed = LiveStudioDraftPayloadSchema.parse({ ...legacy, title: "保留內容", activeStep: legacyStep });
    expect(parsed).toMatchObject({ flowVersion: 2, activeStep: canonicalStep, title: "保留內容" });
  });

  it("does not remap an already canonical v2 step and enforces its boundaries", () => {
    expect(LiveStudioDraftPayloadSchema.parse({ ...emptyLiveStudioDraft(), activeStep: 2 }).activeStep).toBe(2);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), activeStep: 7 }).success).toBe(true);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), activeStep: 8 }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), activeStep: -1 }).success).toBe(false);
  });

  it("rejects unknown fields, unsafe URLs, oversized arrays, and unbounded JSON text", () => {
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), cloudflareLiveInputUid: "forged" }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), heroImageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), productIds: Array.from({ length: 101 }, (_, index) => `product-${index}`) }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), customAllocations: "x".repeat(20_001) }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), liveReminderOffsetMinutes: "45" }).success).toBe(false);
  });
});

describe("SaveLiveStudioDraftRequestSchema", () => {
  it("requires a positive optimistic revision when one is supplied", () => {
    const payload = emptyLiveStudioDraft();
    expect(SaveLiveStudioDraftRequestSchema.safeParse({ draftId: "", revision: null, payload }).success).toBe(true);
    expect(SaveLiveStudioDraftRequestSchema.safeParse({ draftId: "draft-1", revision: 2, payload }).success).toBe(true);
    expect(SaveLiveStudioDraftRequestSchema.safeParse({ draftId: "draft-1", revision: 0, payload }).success).toBe(false);
  });
});
