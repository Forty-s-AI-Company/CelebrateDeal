import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  lineUserIdHash,
  parseLineOfficialAccountCredentials,
  protectLineOfficialAccountCredentials,
  protectLineProfileValue,
  unprotectLineOfficialAccountCredentials,
  unprotectLineProfileValue,
} from "@/lib/line-credentials";

const credentials = {
  messagingChannelId: "2000123456",
  messagingChannelSecret: "messaging-secret-1234567890",
  messagingAccessToken: "access-token-with-at-least-thirty-two-characters",
  loginChannelId: "2000654321",
  loginChannelSecret: "login-secret-1234567890",
};

describe("LINE credential protection", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "line-test-encryption-secret-that-is-at-least-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes a complete merchant binding and rejects a half-configured login channel", () => {
    expect(parseLineOfficialAccountCredentials(credentials)).toMatchObject({ success: true, data: credentials });
    expect(parseLineOfficialAccountCredentials({ ...credentials, loginChannelSecret: "" })).toMatchObject({ success: false });
  });

  it("encrypts every credential with authenticated, tenant-bound envelopes", () => {
    const protectedCredentials = protectLineOfficialAccountCredentials("vendor-1", credentials);
    expect(Object.values(protectedCredentials).every((value) => typeof value === "string" && value.startsWith("v1."))).toBe(true);
    expect(JSON.stringify(protectedCredentials)).not.toContain(credentials.messagingChannelId);
    expect(unprotectLineOfficialAccountCredentials("vendor-1", protectedCredentials)).toEqual(credentials);
    expect(() => unprotectLineOfficialAccountCredentials("vendor-2", protectedCredentials)).toThrow();
  });

  it("protects LINE user ids while keeping a deterministic tenant-scoped lookup hash", () => {
    const encrypted = protectLineProfileValue("vendor-1", "userId", "U1234567890");
    expect(encrypted).not.toContain("U1234567890");
    expect(unprotectLineProfileValue("vendor-1", "userId", encrypted)).toBe("U1234567890");
    expect(lineUserIdHash("vendor-1", "U1234567890")).toBe(lineUserIdHash("vendor-1", "U1234567890"));
    expect(lineUserIdHash("vendor-2", "U1234567890")).not.toBe(lineUserIdHash("vendor-1", "U1234567890"));
  });
});
