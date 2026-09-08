import { describe, expect, it } from "vitest";
import {
  canTransitionLiveQuestionStatus,
  LIVE_QUESTION_MAX_BODY_LENGTH,
  normalizeLiveQuestionBody,
  parseLiveQuestionSubmission,
} from "./live-question";

describe("live question domain", () => {
  it("normalizes valid question text and rejects empty or oversized bodies by code point", () => {
    expect(normalizeLiveQuestionBody("  想問一下這個方案嗎？  ")).toBe("想問一下這個方案嗎?");
    expect(normalizeLiveQuestionBody("   ")).toBeNull();
    expect(normalizeLiveQuestionBody("😀".repeat(LIVE_QUESTION_MAX_BODY_LENGTH))).toHaveLength(LIVE_QUESTION_MAX_BODY_LENGTH * 2);
    expect(normalizeLiveQuestionBody("😀".repeat(LIVE_QUESTION_MAX_BODY_LENGTH + 1))).toBeNull();
  });

  it("accepts an anonymous question or a normalized nickname without accepting raw identity fields", () => {
    const anonymous = parseLiveQuestionSubmission({
      vendorId: "vendor-1",
      liveId: "live-1",
      participantHash: "a".repeat(43),
      body: "  匿名提問  ",
    });
    expect(anonymous).toMatchObject({ success: true, data: { displayName: null, body: "匿名提問" } });

    const nickname = parseLiveQuestionSubmission({
      vendorId: "vendor-1",
      liveId: "live-1",
      participantHash: "a".repeat(43),
      displayName: "  小明  ",
      body: "請問會有回放嗎？",
    });
    expect(nickname).toMatchObject({ success: true, data: { displayName: "小明" } });

    expect(parseLiveQuestionSubmission({
      vendorId: "vendor-1",
      liveId: "live-1",
      participantHash: "a".repeat(43),
      body: "問題",
      email: "should-not-be-persisted@example.test",
    }).success).toBe(false);
  });

  it("allows only the review flow into terminal question states", () => {
    expect(canTransitionLiveQuestionStatus("pending", "spotlight")).toBe(true);
    expect(canTransitionLiveQuestionStatus("pending", "hidden")).toBe(true);
    expect(canTransitionLiveQuestionStatus("spotlight", "answered")).toBe(true);
    expect(canTransitionLiveQuestionStatus("spotlight", "hidden")).toBe(true);
    expect(canTransitionLiveQuestionStatus("answered", "spotlight")).toBe(false);
    expect(canTransitionLiveQuestionStatus("hidden", "pending")).toBe(false);
  });
});
