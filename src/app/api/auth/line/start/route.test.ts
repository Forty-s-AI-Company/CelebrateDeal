import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  readJsonBody: vi.fn(),
  rateLimit: vi.fn(),
  currentAuth: vi.fn(),
  beginLineLogin: vi.fn(),
  vendorFindUnique: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
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
  }),
}));
vi.mock("@/lib/form-submission-chat-session", () => ({
  FORM_SUBMISSION_CHAT_SESSION_COOKIE: "registration",
  verifyFormSubmissionChatSessionToken: vi.fn(),
}));
vi.mock("@/lib/line-login", () => ({ beginLineLogin: mocks.beginLineLogin }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));

import { POST } from "./route";

describe("POST /api/auth/line/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sameOrigin.mockReturnValue(null);
    mocks.rateLimit.mockResolvedValue(null);
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
