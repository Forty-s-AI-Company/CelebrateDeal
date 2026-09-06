import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  readJsonBody: vi.fn(),
  rateLimit: vi.fn(),
  currentAuth: vi.fn(),
  beginLineLogin: vi.fn(),
  vendorFindUnique: vi.fn(),
  formSubmissionFindFirst: vi.fn(),
  cookies: vi.fn(),
  verifyChatToken: vi.fn(),
  verifyBindingToken: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/api-security", () => ({
  requireSameOriginRequest: mocks.sameOrigin,
  readJsonBody: mocks.readJsonBody,
}));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.currentAuth }));
vi.mock("@/lib/buyer-support-access", () => ({ resolveBuyerSupportGrant: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendor: { findUnique: mocks.vendorFindUnique },
    affiliate: { findUnique: vi.fn(), findFirst: vi.fn() },
    formSubmission: { findFirst: mocks.formSubmissionFindFirst },
  }),
}));
vi.mock("@/lib/form-submission-chat-session", () => ({
  FORM_SUBMISSION_CHAT_SESSION_COOKIE: "registration",
  verifyFormSubmissionChatSessionToken: mocks.verifyChatToken,
}));
vi.mock("@/lib/form-submission-line-binding-session", () => ({
  FORM_SUBMISSION_LINE_BINDING_COOKIE: "registration-line-binding",
  verifyFormSubmissionLineBindingToken: mocks.verifyBindingToken,
}));
vi.mock("@/lib/line-login", () => ({ beginLineLogin: mocks.beginLineLogin }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));

import { POST } from "./route";

describe("POST /api/auth/line/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sameOrigin.mockReturnValue(null);
    mocks.rateLimit.mockResolvedValue(null);
    mocks.cookies.mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) });
    mocks.verifyChatToken.mockReturnValue(null);
    mocks.verifyBindingToken.mockReturnValue(null);
  });

  it("derives an unverified registration subject only from a signed short-lived binding cookie", async () => {
    mocks.readJsonBody.mockResolvedValue({ mode: "registration", redirectPath: "/live/safe-live" });
    mocks.cookies.mockResolvedValue({ get: (name: string) => ({ value: name === "registration-line-binding" ? "signed" : "" }) });
    mocks.verifyBindingToken.mockReturnValue({ submissionId: "submission-1" });
    mocks.formSubmissionFindFirst.mockResolvedValue({ id: "submission-1", form: { vendorId: "vendor-1" } });
    mocks.beginLineLogin.mockResolvedValue({ authorizationUrl: "https://access.line.me/oauth2/v2.1/authorize?safe=1" });

    const response = await POST(new Request("https://app.example.test/api/auth/line/start", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(mocks.formSubmissionFindFirst).toHaveBeenCalledWith({
      where: { id: "submission-1" },
      select: { id: true, form: { select: { vendorId: true } } },
    });
    expect(mocks.beginLineLogin).toHaveBeenCalledWith(expect.anything(), {
      vendorId: "vendor-1",
      subjectType: "buyer_registration",
      subjectId: "submission-1",
      redirectPath: "/live/safe-live",
    });
  });

  it("stops before parsing when the same-origin boundary rejects the request", async () => {
    const blocked = Response.json({ error: "forbidden" }, { status: 403 });
    mocks.sameOrigin.mockReturnValue(blocked);

    const response = await POST(new Request("https://app.example.test/api/auth/line/start", { method: "POST" }));

    expect(response).toBe(blocked);
    expect(mocks.readJsonBody).not.toHaveBeenCalled();
  });

  it("returns a bounded not-found result for an unknown merchant selector", async () => {
    mocks.readJsonBody.mockResolvedValue({ mode: "login", vendorSlug: "missing", redirectPath: "/dashboard" });
    mocks.vendorFindUnique.mockResolvedValue(null);

    const response = await POST(new Request("https://app.example.test/api/auth/line/start", { method: "POST" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "line_login_unavailable" });
    expect(mocks.beginLineLogin).not.toHaveBeenCalled();
  });
});
