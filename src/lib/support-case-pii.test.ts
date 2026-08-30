import { beforeEach, describe, expect, it } from "vitest";

import {
  parseSupportCaseContent,
  protectSupportCaseContent,
  revealSupportCaseContent,
  SupportCaseContentError,
} from "@/lib/support-case-pii";

const binding = {
  vendorId: "vendor-1",
  supportCaseId: "case-1",
  recordId: "event-1",
  kind: "initial_summary" as const,
};

beforeEach(() => {
  process.env.CSRF_SECRET = "support-case-test-secret-with-at-least-32-bytes";
});

describe("support case encrypted content", () => {
  it("normalizes, encrypts and reveals content only for the exact binding", () => {
    const envelope = protectSupportCaseContent("  第一行\r\n第二行  ", binding);

    expect(envelope).toMatch(/^v1\./u);
    expect(envelope).not.toContain("第一行");
    expect(revealSupportCaseContent(envelope, binding)).toBe("第一行\n第二行");
    expect(() => revealSupportCaseContent(envelope, { ...binding, supportCaseId: "case-2" }))
      .toThrow(SupportCaseContentError);
  });

  it("rejects empty, oversized and unsafe control-character content", () => {
    expect(() => parseSupportCaseContent("   ")).toThrow(SupportCaseContentError);
    expect(() => parseSupportCaseContent("x".repeat(4_001))).toThrow(SupportCaseContentError);
    expect(() => parseSupportCaseContent("unsafe\u0000text")).toThrow(SupportCaseContentError);
  });

  it("rejects malformed binding parts without exposing content", () => {
    expect(() => protectSupportCaseContent("內容", { ...binding, vendorId: "bad:value" }))
      .toThrow(SupportCaseContentError);
  });
});
