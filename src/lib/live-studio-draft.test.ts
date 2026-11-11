import { describe, expect, it } from "vitest";
import {
  emptyLiveStudioDraft,
  LIVE_STUDIO_V2_STEP_KEYS,
  LiveStudioDraftPayloadSchema,
  parseStoredLiveStudioDraft,
  SaveLiveStudioDraftRequestSchema,
} from "./live-studio-draft";
import { LIVE_STUDIO_STEPS, liveStudioStepIndex } from "./live-studio-steps";

describe("LiveStudioDraftPayloadSchema", () => {
  it("builds a canonical bounded four-step draft", () => {
    expect(emptyLiveStudioDraft()).toMatchObject({
      studioPreset: "CUSTOM",
      title: "",
      productIds: [],
      streamMode: "vod",
      usageAttributionMode: "PROMOTER",
      quotaPayerScope: "VENDOR",
      liveReminderTemplateId: "",
      liveReminderOffsetMinutes: "60",
      notificationRules: [],
      replayAvailableUntil: "",
      flowVersion: 3,
      activeStep: 0,
    });
    expect(LIVE_STUDIO_STEPS.map((step) => step.key)).toEqual(["content", "sales", "notifications", "publish"]);
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
      notificationRules: [{
        id: "rule-1",
        trigger: "before_live",
        messageTemplateId: "reminder-template-1",
        offsetMinutes: 60,
        sortOrder: 0,
        isActive: true,
      }],
      replayAvailableUntil: "2026-08-21T20:00",
      activeStep: 3,
    }).success).toBe(true);
    expect(LiveStudioDraftPayloadSchema.safeParse({
      ...emptyLiveStudioDraft(),
      heroImageUrl: "https://",
    }).success).toBe(true);
  });

  // v1 → v2 keeps the existing legacy table ([0, 2, 1, 6, 7]); v2 → v3 then
  // folds it into the four steps.
  it.each([
    [0, "content"], [1, "sales"], [2, "content"], [3, "sales"], [4, "publish"],
  ] as const)("maps legacy v1 step %s through v2 to the v3 %s step without changing values", (legacyStep, step) => {
    const { flowVersion, ...legacy } = emptyLiveStudioDraft();
    expect(flowVersion).toBe(3);
    const parsed = LiveStudioDraftPayloadSchema.parse({ ...legacy, title: "保留內容", activeStep: legacyStep });
    expect(parsed).toMatchObject({ flowVersion: 3, activeStep: liveStudioStepIndex(step), title: "保留內容" });
  });

  it.each([
    [0, "content"], [1, "content"], [2, "sales"], [3, "content"],
    [4, "content"], [5, "notifications"], [6, "sales"], [7, "publish"],
  ] as const)("maps eight-step v2 step %s to the v3 %s step without changing values", (versionTwoStep, step) => {
    const versionTwo = {
      ...emptyLiveStudioDraft(),
      flowVersion: 2,
      title: "八步草稿",
      productIds: ["product-1"],
      messageTemplateId: "template-1",
      activeStep: versionTwoStep,
    };
    const parsed = LiveStudioDraftPayloadSchema.parse(versionTwo);
    expect(parsed).toEqual({ ...versionTwo, flowVersion: 3, activeStep: liveStudioStepIndex(step) });
    expect(LIVE_STUDIO_V2_STEP_KEYS[versionTwoStep]).toBe(step);
  });

  it("does not remap an already canonical v3 step and enforces every version's boundaries", () => {
    expect(LiveStudioDraftPayloadSchema.parse({ ...emptyLiveStudioDraft(), activeStep: 2 }).activeStep).toBe(2);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), activeStep: 3 }).success).toBe(true);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), activeStep: 4 }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), activeStep: -1 }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), flowVersion: 2, activeStep: 7 }).success).toBe(true);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), flowVersion: 2, activeStep: 8 }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), flowVersion: 4 }).success).toBe(false);
    const { flowVersion: _flowVersion, ...legacy } = emptyLiveStudioDraft();
    void _flowVersion;
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...legacy, activeStep: 5 }).success).toBe(false);
  });

  it("keeps v2 and v1 drafts strict: unknown fields are still rejected", () => {
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), flowVersion: 2, cloudflareLiveInputUid: "forged" }).success).toBe(false);
    const { flowVersion: _flowVersion, ...legacy } = emptyLiveStudioDraft();
    void _flowVersion;
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...legacy, cloudflareLiveInputUid: "forged" }).success).toBe(false);
  });

  it("rejects unknown fields, unsafe URLs, oversized arrays, and unbounded JSON text", () => {
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), cloudflareLiveInputUid: "forged" }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), heroImageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), productIds: Array.from({ length: 101 }, (_, index) => `product-${index}`) }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), customAllocations: "x".repeat(20_001) }).success).toBe(false);
    expect(LiveStudioDraftPayloadSchema.safeParse({ ...emptyLiveStudioDraft(), liveReminderOffsetMinutes: "45" }).success).toBe(false);
  });
});

describe("parseStoredLiveStudioDraft", () => {
  it("reports a stored v3 row as current regardless of key order", () => {
    const stored = { ...emptyLiveStudioDraft(), title: "目前版本", activeStep: 2 };
    const reordered = Object.fromEntries(Object.entries(stored).reverse());
    expect(parseStoredLiveStudioDraft(stored)).toEqual({ payload: stored, outdated: false });
    expect(parseStoredLiveStudioDraft(reordered)).toEqual({ payload: stored, outdated: false });
  });

  it("converts a stored v2 row to v3 and marks it for a re-save before publishing", () => {
    const stored = { ...emptyLiveStudioDraft(), flowVersion: 2, title: "八步草稿", activeStep: 5 };
    const parsed = parseStoredLiveStudioDraft(stored);
    expect(parsed).toEqual({ payload: { ...stored, flowVersion: 3, activeStep: liveStudioStepIndex("notifications") }, outdated: true });
  });

  it("marks a v3 row that is missing defaulted fields as outdated and rejects invalid rows", () => {
    expect(parseStoredLiveStudioDraft({ flowVersion: 3, title: "缺欄位", activeStep: 0 })?.outdated).toBe(true);
    expect(parseStoredLiveStudioDraft({ flowVersion: 3, activeStep: 9 })).toBeNull();
    expect(parseStoredLiveStudioDraft("not-a-draft")).toBeNull();
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
