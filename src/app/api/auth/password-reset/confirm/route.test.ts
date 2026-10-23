import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkRateLimit, consumePasswordResetToken, findPasswordResetTokenAccount } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  consumePasswordResetToken: vi.fn(),
  findPasswordResetTokenAccount: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/password-reset", () => ({ consumePasswordResetToken, findPasswordResetTokenAccount }));

import { POST } from "@/app/api/auth/password-reset/confirm/route";

const validPayload = {
  token: "test-fixture-valid-password-reset-token",
  password: "test-fixture-new-password",
};

function passwordResetConfirm(
  payload: Record<string, unknown> = validPayload,
  headers: Record<string, string> = {},
) {
  return new Request("https://app.example.test/api/auth/password-reset/confirm", {
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
  checkRateLimit.mockResolvedValue(null);
  consumePasswordResetToken.mockResolvedValue({ ok: true });
  findPasswordResetTokenAccount.mockResolvedValue({ email: "reset.member@example.test", platformRole: "none" });
});

describe("POST /api/auth/password-reset/confirm", () => {
  it.each([
    ["a cross-origin request", { origin: "https://attacker.example.test" }, "Invalid request origin"],
    ["a request without the trusted client header", { "x-celebratedeal-client": "" }, "Missing trusted client header"],
  ])("rejects %s before rate limiting or consuming a token", async (_description, headers, error) => {
    const response = await POST(passwordResetConfirm(validPayload, headers));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(consumePasswordResetToken).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response as-is without consuming a token", async () => {
    const limited = new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
    checkRateLimit.mockResolvedValue(limited);

    const response = await POST(passwordResetConfirm());

    expect(response).toBe(limited);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "password-reset-confirm", 10, 60_000);
    expect(consumePasswordResetToken).not.toHaveBeenCalled();
  });

  it.each([
    ["an invalid token", { ...validPayload, token: "test-fixture-token" }],
    ["an oversized password body", { ...validPayload, password: "x".repeat(1025) }],
  ])("returns 400 for %s without consuming a token", async (_description, payload) => {
    const response = await POST(passwordResetConfirm(payload));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid password reset confirmation" });
    expect(consumePasswordResetToken).not.toHaveBeenCalled();
  });

  it.each([
    ["a 7-character password", "tst-sho", { reason: "short", minLength: 8 }],
    ["a password over 128 characters", "x".repeat(129), { reason: "long" }],
    ["a listed common password", "Password123", { reason: "common" }],
    ["a repeated character", "aaaaaaaaaa", { reason: "common" }],
    ["a common word with a year", "dragon2026", { reason: "common" }],
    ["a password built from the account e-mail name", "reset.member!2026", { reason: "personal" }],
  ])("returns 400 for %s without consuming a token", async (_description, password, detail) => {
    const response = await POST(passwordResetConfirm({ ...validPayload, password }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid password reset confirmation", ...detail });
    expect(findPasswordResetTokenAccount).toHaveBeenCalledWith(validPayload.token);
    expect(consumePasswordResetToken).not.toHaveBeenCalled();
  });

  it("accepts an 8-character password that is not common", async () => {
    const response = await POST(passwordResetConfirm({ ...validPayload, password: "bluewhal" }));

    expect(response.status).toBe(200);
    expect(consumePasswordResetToken).toHaveBeenCalledWith(validPayload.token, "bluewhal");
  });

  it("checks and stores the same trimmed value that sign-in will compare", async () => {
    const response = await POST(passwordResetConfirm({ ...validPayload, password: "  bluewhal  " }));

    expect(response.status).toBe(200);
    expect(consumePasswordResetToken).toHaveBeenCalledWith(validPayload.token, "bluewhal");
  });

  it("refuses a 7-character password even when padded with spaces", async () => {
    const response = await POST(passwordResetConfirm({ ...validPayload, password: "bluewha      " }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid password reset confirmation", reason: "short", minLength: 8 });
    expect(consumePasswordResetToken).not.toHaveBeenCalled();
  });

  it("requires 12 characters when the token belongs to a platform administrator", async () => {
    findPasswordResetTokenAccount.mockResolvedValue({ email: "reset.admin@example.test", platformRole: "platform_admin" });

    const short = await POST(passwordResetConfirm({ ...validPayload, password: "bluewhale12" }));
    expect(short.status).toBe(400);
    await expect(short.json()).resolves.toEqual({ error: "Invalid password reset confirmation", reason: "short", minLength: 12 });
    expect(consumePasswordResetToken).not.toHaveBeenCalled();

    const accepted = await POST(passwordResetConfirm({ ...validPayload, password: "bluewhale123" }));
    expect(accepted.status).toBe(200);
    expect(consumePasswordResetToken).toHaveBeenCalledWith(validPayload.token, "bluewhale123");
  });

  it("applies the 8-character rule when the token is not usable, leaving the refusal to the reset service", async () => {
    findPasswordResetTokenAccount.mockResolvedValue(null);
    consumePasswordResetToken.mockResolvedValue({ ok: false });

    const response = await POST(passwordResetConfirm({ ...validPayload, password: "bluewhal" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid or expired reset token" });
  });

  it("returns 400 when the reset service rejects the token", async () => {
    consumePasswordResetToken.mockResolvedValue({ ok: false });

    const response = await POST(passwordResetConfirm());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid or expired reset token" });
    expect(consumePasswordResetToken).toHaveBeenCalledWith(validPayload.token, validPayload.password);
  });

  it("returns { ok: true } after successfully consuming the token", async () => {
    const response = await POST(passwordResetConfirm());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(consumePasswordResetToken).toHaveBeenCalledWith(validPayload.token, validPayload.password);
  });
});
