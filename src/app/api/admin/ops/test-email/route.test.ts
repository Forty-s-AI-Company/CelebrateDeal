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

const smokeSecret = "test-fixture-ops-smoke-secret-0123456789abcdef";
const jobSecret = "test-fixture-job-secret-0123456789";

function authorizedRequest(payload: Record<string, unknown>) {
  return new Request("https://app.example.test/api/admin/ops/test-email", {
    method: "POST",
    headers: {
      authorization: `Bearer ${smokeSecret}`,
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
  vi.stubEnv("OPS_SMOKE_SECRET", smokeSecret);
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
    { name: "is incorrect", authorization: "Bearer test-fixture-wrong-ops-smoke-secret" },
  ])("returns 401 without reading the body or sending an email when OPS_SMOKE_SECRET $name", async ({ authorization }) => {
    const { request, json } = requestWithJsonSpy(authorization);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it.each([
    { name: "the shared JOB_SECRET", configured: smokeSecret },
    { name: "JOB_SECRET while OPS_SMOKE_SECRET is unset", configured: undefined },
  ])("rejects $name without reading the body or sending an email", async ({ configured }) => {
    vi.stubEnv("OPS_SMOKE_SECRET", configured);
    const { request, json } = requestWithJsonSpy(`Bearer ${jobSecret}`);

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("returns 401 without reading the body or sending an email when OPS_SMOKE_SECRET is not configured", async () => {
    vi.stubEnv("OPS_SMOKE_SECRET", undefined);
    const { request, json } = requestWithJsonSpy(`Bearer ${smokeSecret}`);

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

  it("uses the server-owned smoke recipient when the caller omits it", async () => {
    mocks.sendTransactionalEmail.mockResolvedValue({ id: "mock-email-id" });

    const response = await POST(authorizedRequest({}));

    expect(response.status).toBe(200);
    expect(mocks.isAllowedSmokeTestRecipient).toHaveBeenCalledWith("recipient@example.test");
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "recipient@example.test",
    }));
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
