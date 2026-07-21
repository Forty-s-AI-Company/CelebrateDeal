import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSmokeTestEmail: vi.fn(),
  isAllowedSmokeTestRecipient: vi.fn(),
  sendTransactionalEmail: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  getSmokeTestEmail: mocks.getSmokeTestEmail,
  isAllowedSmokeTestRecipient: mocks.isAllowedSmokeTestRecipient,
  sendTransactionalEmail: mocks.sendTransactionalEmail,
}));

import { POST } from "./route";

const jobSecret = "test-fixture-job-secret";

function authorizedRequest(payload: Record<string, unknown>) {
  return new Request("https://app.example.test/api/admin/ops/test-email", {
    method: "POST",
    headers: {
      authorization: `Bearer ${jobSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function requestWithJsonSpy(authorization?: string) {
  const json = vi.fn();
  return {
    request: {
      headers: new Headers(authorization ? { authorization } : undefined),
      json,
    } as unknown as Request,
    json,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  mocks.getSmokeTestEmail.mockReturnValue("recipient@example.test");
  mocks.isAllowedSmokeTestRecipient.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/test-email", () => {
  it.each([
    { name: "is missing", authorization: undefined },
    { name: "is incorrect", authorization: "Bearer test-fixture-wrong-job-secret" },
  ])("returns 401 without reading the body or sending an email when JOB_SECRET $name", async ({ authorization }) => {
    const { request, json } = requestWithJsonSpy(authorization);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns 401 without reading the body or sending an email when JOB_SECRET is not configured", async () => {
    vi.stubEnv("JOB_SECRET", undefined);
    const { request, json } = requestWithJsonSpy(`Bearer ${jobSecret}`);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid email without sending an email", async () => {
    const response = await POST(authorizedRequest({ to: "not-an-email" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid test email request" });
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns 503 without sending when the smoke-test recipient is not configured", async () => {
    mocks.getSmokeTestEmail.mockReturnValue(null);

    const response = await POST(authorizedRequest({ to: "recipient@example.test" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Test email recipient is not configured" });
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("rejects any recipient outside the configured smoke-test allowlist", async () => {
    mocks.isAllowedSmokeTestRecipient.mockReturnValue(false);

    const response = await POST(authorizedRequest({ to: "other@example.test" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Test email recipient is not allowed" });
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("sends the fixed smoke-test email without returning provider metadata", async () => {
    mocks.sendTransactionalEmail.mockResolvedValue({ id: "mock-email-id" });

    const response = await POST(authorizedRequest({ to: "recipient@example.test" }));

    expect(mocks.sendTransactionalEmail).toHaveBeenCalledOnce();
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledWith({
      to: "recipient@example.test",
      subject: "CelebrateDeal production email smoke test",
      text: "If you received this email, Resend is wired correctly.",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns a generic error without exposing the provider response", async () => {
    mocks.sendTransactionalEmail.mockRejectedValue(new Error("provider-secret-response"));

    const response = await POST(authorizedRequest({ to: "recipient@example.test" }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).toContain("Email provider request failed");
    expect(body).not.toContain("provider-secret-response");
  });
});
