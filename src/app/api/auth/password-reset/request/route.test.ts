import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkRateLimit, sendPasswordResetLink } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  sendPasswordResetLink: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/password-reset", () => ({ sendPasswordResetLink }));

import { POST } from "@/app/api/auth/password-reset/request/route";

function passwordResetRequest(
  payload: Record<string, unknown> = { email: "member@example.test" },
  headers: Record<string, string> = {},
) {
  return new Request("https://app.example.test/api/auth/password-reset/request", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://configured.example.test");
  vi.stubEnv("NODE_ENV", "test");
  checkRateLimit.mockResolvedValue(null);
  sendPasswordResetLink.mockResolvedValue({
    resetUrl: "https://configured.example.test/password-reset/confirm?token=test-fixture-reset-token",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/password-reset/request", () => {
  it.each([
    ["a cross-origin request", { origin: "https://attacker.example.test" }, "Invalid request origin"],
    ["a request without the trusted client header", { "x-celebratedeal-client": "" }, "Missing trusted client header"],
  ])("rejects %s before rate limiting or sending email", async (_description, headers, error) => {
    const response = await POST(passwordResetRequest({ email: "member@example.test" }, headers));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response without sending a reset email", async () => {
    const limited = new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
    checkRateLimit.mockResolvedValue(limited);

    const response = await POST(passwordResetRequest());

    expect(response).toBe(limited);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "password-reset-request", 5, 60_000);
    expect(sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid email without sending a reset email", async () => {
    const response = await POST(passwordResetRequest({ email: "not-an-email" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid password reset request" });
    expect(sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("returns success for valid requests whether or not the email belongs to an account", async () => {
    sendPasswordResetLink
      .mockResolvedValueOnce({ resetUrl: "https://configured.example.test/password-reset/confirm?token=test-fixture-existing-token" })
      .mockResolvedValueOnce(null);

    const existingAccountResponse = await POST(passwordResetRequest({ email: "member@example.test" }));
    const unknownAccountResponse = await POST(passwordResetRequest({ email: "unknown@example.test" }));

    expect(existingAccountResponse.status).toBe(200);
    expect(unknownAccountResponse.status).toBe(200);
    await expect(existingAccountResponse.json()).resolves.toMatchObject({ ok: true });
    await expect(unknownAccountResponse.json()).resolves.toEqual({ ok: true });
  });

  it("forwards the email, first forwarded IP, user agent, and configured app URL to the reset service", async () => {
    const response = await POST(passwordResetRequest(
      { email: "member@example.test" },
      {
        "x-forwarded-for": "203.0.113.10, 198.51.100.10",
        "user-agent": "CelebrateDeal test fixture browser",
      },
    ));

    expect(response.status).toBe(200);
    expect(sendPasswordResetLink).toHaveBeenCalledWith({
      email: "member@example.test",
      appUrl: "https://configured.example.test",
      ipAddress: "203.0.113.10",
      userAgent: "CelebrateDeal test fixture browser",
    });
  });

  it("does not expose the reset URL in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await POST(passwordResetRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
