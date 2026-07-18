import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
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

  it("sends the fixed smoke-test email and returns its result for a valid request", async () => {
    const result = { id: "mock-email-id" };
    mocks.sendTransactionalEmail.mockResolvedValue(result);

    const response = await POST(authorizedRequest({ to: "recipient@example.test" }));

    expect(mocks.sendTransactionalEmail).toHaveBeenCalledOnce();
    expect(mocks.sendTransactionalEmail).toHaveBeenCalledWith({
      to: "recipient@example.test",
      subject: "CelebrateDeal production email smoke test",
      text: "If you received this email, Resend is wired correctly.",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result });
  });
});
