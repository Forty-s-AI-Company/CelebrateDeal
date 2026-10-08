import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decryptPrivateChatBody, encryptPrivateChatBody, normalizePrivateChatBody, privateChatMessageId } from "./live-private-chat-storage";

const identity = { vendorId: "tenant-a", liveId: "live-a", submissionId: "viewer-a", source: "viewer" as const, actorId: "viewer-a", clientMessageId: "123e4567-e89b-12d3-a456-426614174000" };
const scope = { vendorId: identity.vendorId, liveId: identity.liveId, submissionId: identity.submissionId, source: identity.source, messageId: privateChatMessageId(identity) };
beforeEach(() => vi.stubEnv("CSRF_SECRET", "private-chat-storage-synthetic-key-longer-than-thirty-two-bytes"));
afterEach(() => vi.unstubAllEnvs());
it("stores randomized ciphertext and decrypts only within the exact conversation", () => {
  const ciphertext = encryptPrivateChatBody("  私人問題  ", scope);
  expect(ciphertext).not.toContain("私人問題");
  expect(encryptPrivateChatBody("私人問題", scope)).not.toBe(ciphertext);
  expect(decryptPrivateChatBody(ciphertext, scope)).toBe("私人問題");
});
it.each(["vendorId", "liveId", "submissionId", "messageId", "source"] as const)("rejects ciphertext transplanted across %s", key => {
  const ciphertext = encryptPrivateChatBody("私人問題", scope);
  const altered = { ...scope, [key]: key === "source" ? "instructor" : key === "messageId" ? "b".repeat(64) : "other" };
  expect(() => decryptPrivateChatBody(ciphertext, altered as typeof scope)).toThrow();
});
it("rejects truncated, modified or extended envelopes", () => {
  const ciphertext = encryptPrivateChatBody("私人問題", scope);
  expect(() => decryptPrivateChatBody(`${ciphertext}.extra`, scope)).toThrow();
  expect(() => decryptPrivateChatBody(ciphertext.slice(0, -5), scope)).toThrow();
  const parts = ciphertext.split("."); parts[2] = "A".repeat(22);
  expect(() => decryptPrivateChatBody(parts.join("."), scope)).toThrow();
});
it("namespaces idempotency by tenant, conversation, author and source", () => {
  expect(privateChatMessageId(identity)).toBe(privateChatMessageId({ ...identity }));
  for (const changed of [{ vendorId: "tenant-b" }, { liveId: "live-b" }, { submissionId: "viewer-b" }, { actorId: "manager-a" }, { source: "instructor" as const }]) {
    expect(privateChatMessageId({ ...identity, ...changed })).not.toBe(scope.messageId);
  }
});
it("normalizes Unicode and enforces the actual character limit", () => {
  expect(normalizePrivateChatBody("  ＡＢＣ  ")).toBe("ABC");
  expect(normalizePrivateChatBody("😀".repeat(1_000))).toHaveLength(2_000);
  expect(() => normalizePrivateChatBody("😀".repeat(1_001))).toThrow();
  expect(() => normalizePrivateChatBody("  ")).toThrow();
});
