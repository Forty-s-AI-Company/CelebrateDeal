import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  findMembership: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendorMember: { findFirst: mocks.findMembership },
    userSession: { create: mocks.createSession },
    user: { update: mocks.updateUser },
  }),
}));

import { POST } from "./route";

const jobSecret = "test-fixture-job-secret";
const sourceSha = "a".repeat(40);

function request(authorization?: string, sha = sourceSha) {
  return new Request("https://app.example.test/api/admin/ops/payuni/wp4-session", {
    method: "POST",
    headers: {
      ...(authorization ? { authorization } : {}),
      ["x-celebratedeal-source-sha"]: sha,
    },
  });
}

function requestWithBodySpy(authorization?: string) {
  const body = new ReadableStream({ start: (controller) => controller.close() });
  const cancel = vi.spyOn(body, "cancel");
  return {
    request: new Request("https://app.example.test/api/admin/ops/payuni/wp4-session", {
      method: "POST",
      headers: authorization ? { authorization } : undefined,
      body,
      // Required by the Fetch implementation when a stream body is used.
      duplex: "half",
    } as RequestInit),
    cancel,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("SMOKE_VENDOR_ID", "vendor-preview");
  vi.stubEnv("WP4_SMOKE_OWNER_USER_ID", "owner-preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
  mocks.findMembership.mockResolvedValue({ id: "member-1" });
  mocks.createSession.mockResolvedValue({ id: "session-1" });
  mocks.updateUser.mockResolvedValue({ id: "owner-preview" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/payuni/wp4-session", () => {
  it("returns 401 before reading a body or touching the DB", async () => {
    const { request: unauthorizedRequest } = requestWithBodySpy();

    const response = await POST(unauthorizedRequest);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.findMembership).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("is disabled in production without DB access", async () => {
    vi.stubEnv("VERCEL_ENV", "production");

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it("rejects a source SHA mismatch without DB access", async () => {
    const response = await POST(request(`Bearer ${jobSecret}`, "b".repeat(40)));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it("rejects any request body without consuming it or touching the DB", async () => {
    const body = new ReadableStream({ start: (controller) => controller.close() });
    const requestWithBody = new Request(
      "https://app.example.test/api/admin/ops/payuni/wp4-session",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${jobSecret}`,
          ["x-celebratedeal-source-sha"]: sourceSha,
        },
        body,
        duplex: "half",
      } as RequestInit,
    );

    const response = await POST(requestWithBody);

    expect(response.status).toBe(404);
    expect(requestWithBody.bodyUsed).toBe(false);
    expect(mocks.findMembership).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("fails closed when server-owned configuration is missing", async () => {
    vi.stubEnv("SMOKE_VENDOR_ID", undefined);

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Service unavailable" });
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it.each([
    { name: "wrong owner membership", membership: null },
    { name: "inactive owner membership", membership: null },
  ])("does not create a session for a $name", async ({ membership }) => {
    mocks.findMembership.mockResolvedValue(membership);

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.findMembership).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-preview",
        userId: "owner-preview",
        role: "owner",
        status: "active",
        user: { status: "active" },
      },
      select: { id: true },
    });
  });

  it("sets only the hardened session cookie and atomically MFA-verifies the new session", async () => {
    const response = await POST(request(`Bearer ${jobSecret}`));
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(setCookie).toContain("celebrate_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toContain("Max-Age=900");
    expect(mocks.createSession).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        userId: "owner-preview",
        vendorId: "vendor-preview",
        mfaVerifiedAt: expect.any(Date),
      }),
    });
    expect(mocks.createSession.mock.calls[0]?.[0].data.mfaVerifiedAt).toBeInstanceOf(Date);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("does not leak database errors, identities, or session data", async () => {
    mocks.findMembership.mockRejectedValue(new Error("owner-preview vendor-preview raw-db-error"));

    const response = await POST(request(`Bearer ${jobSecret}`));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"error":"Service unavailable"}');
    expect(body).not.toContain("owner-preview");
    expect(body).not.toContain("vendor-preview");
    expect(body).not.toContain("raw-db-error");
  });
});
