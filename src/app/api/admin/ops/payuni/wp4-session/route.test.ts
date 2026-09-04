import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), db: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/auth", () => ({ AUTH_COOKIE: "celebrate_session" }));
vi.mock("@/lib/wp4-preview-owner-session", () => ({ createWp4PreviewOwnerSession: mocks.create, WP4_OWNER_SESSION_TTL: 900 }));
import { POST } from "./route";
const source = "a".repeat(40);
const credential = "synthetic-session-route-secret";
function request(auth = true, sha = source, body?: string) {
  return new Request("https://preview.example.test/api/admin/ops/payuni/wp4-session", {
    method: "POST", headers: { ...(auth ? { authorization: `Bearer ${credential}` } : {}), "x-celebratedeal-source-sha": sha }, body,
  });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("JOB_SECRET", credential);
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", source); vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "");
  mocks.create.mockResolvedValue({ token: "synthetic-session-token", expiresAt: new Date("2027-01-01") });
});
afterEach(() => vi.unstubAllEnvs());
it("returns only a secure short-lived HttpOnly cookie", async () => {
  const response = await POST(request());
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const cookie = response.cookies.get("celebrate_session");
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/" });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(mocks.db);
});
it("rejects missing authorization, other sources and any body before session creation", async () => {
  expect((await POST(request(false))).status).toBe(401);
  expect((await POST(request(true, "b".repeat(40)))).status).toBe(404);
  expect((await POST(request(true, source, "{}"))).status).toBe(404);
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each([["VERCEL_ENV", "production"], ["PAYUNI_ENV", "production"], ["WP4_SANDBOX_EXECUTOR_ENABLED", "false"]])(
  "rejects unsafe %s", async (key, value) => {
    vi.stubEnv(key, value);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  },
);
it("does not leak a failed session's internal error", async () => {
  mocks.create.mockRejectedValue(new Error("synthetic-private-detail"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({ error: "Service unavailable" });
  expect(response.headers.has("set-cookie")).toBe(false);
});
