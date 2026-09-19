import { describe, expect, it } from "vitest";
import { cardLifecycle, CardAnswerSchema, CardCommandSchema, CardConfigSchema, publicCardAnswer, validCardAnswer } from "./interaction-card-contract";

const configuration = { version: 1 as const, kind: "interaction_card" as const, answerType: "text" as const, visibility: "instructor_only" as const, options: [] };
describe("interaction card contracts", () => {
  it("never projects a private answer to a public event", () => {
    const answer = { id: "a", runId: "r", value: "private" };
    expect(publicCardAnswer(configuration, answer)).toBeNull();
    expect(publicCardAnswer({ ...configuration, visibility: "public_display" }, answer)).toEqual({ ...answer, version: 1, type: "card.answer", visibility: "public_display" });
    const rawAnswer = { ...answer, participantHash: "private-identity" };
    expect(publicCardAnswer({ ...configuration, visibility: "public_display" }, rawAnswer)).not.toHaveProperty("participantHash");
  });
  it("defines lifecycle without carrying personal answers", () => {
    const card = { id: "r", title: "q", status: "active", configuration, startsAt: "2026-09-11T00:00:00Z", endsAt: null, ownValue: "secret" };
    expect(cardLifecycle(card, { vendorId: "v", liveId: "l" })).toEqual({ version: 1, type: "card.started", vendorId: "v", liveId: "l", runId: "r", startsAt: card.startsAt, endsAt: null, visibility: "instructor_only" });
    expect(cardLifecycle({ ...card, status: "draft" }, { vendorId: "v", liveId: "l" })).toBeNull();
  });
  it("rejects visibility, participant and event injection", () => {
    expect(CardAnswerSchema.safeParse({ vendorId: "v", liveId: "l", runId: "r", value: "ok", visibility: "public_display" }).success).toBe(false);
    expect(CardCommandSchema.safeParse({ action: "create", liveId: "l", title: "title", configuration, vendorId: "foreign" }).success).toBe(false);
    expect(CardConfigSchema.safeParse({ ...configuration, visibility: "unknown" }).success).toBe(false);
  });
  it("validates text, selection, custom quick values and the built-in sticker allowlist", () => {
    expect(validCardAnswer(configuration, " ")).toBe(false);
    expect(validCardAnswer(configuration, "x".repeat(161))).toBe(false);
    expect(validCardAnswer(configuration, "回答")).toBe(true);
    expect(validCardAnswer({ ...configuration, answerType: "single", options: ["A", "B"] }, "C")).toBe(false);
    expect(validCardAnswer({ ...configuration, answerType: "quick", options: ["666", "自訂"] }, "自訂")).toBe(true);
    expect(validCardAnswer({ ...configuration, answerType: "sticker" }, "👍")).toBe(true);
    expect(validCardAnswer({ ...configuration, answerType: "sticker" }, "https://image.test")).toBe(false);
    expect(CardConfigSchema.safeParse({ ...configuration, answerType: "single", options: ["A", "A"] }).success).toBe(false);
  });
});
