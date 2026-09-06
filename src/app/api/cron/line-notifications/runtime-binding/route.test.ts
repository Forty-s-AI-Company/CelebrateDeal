import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findFirst } }) }));

describe("LINE staging runtime binding", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret-which-is-long-enough-for-tests";
    process.env.VERCEL_ENV = "preview";
    process.env.LINE_STAGING_VALIDATION_ENABLED = "true";
  });

  it("rejects unauthorized requests before touching the database", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("https://preview.vercel.app/api/cron/line-notifications/runtime-binding"));
    expect(response.status).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns a proof only when the Preview sees the exact sentinel", async () => {
    const id = `line-e2e-v-${"a".repeat(24)}`;
    const challenge = "b".repeat(64);
    findFirst.mockResolvedValue({ id });
    const { GET } = await import("./route");
    const response = await GET(new Request("https://preview.vercel.app/api/cron/line-notifications/runtime-binding", { headers: {
      authorization: `Bearer ${process.env.CRON_SECRET}`,
      "x-line-staging-sentinel-id": id,
      "x-line-staging-sentinel-challenge": challenge,
    } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, proof: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(findFirst).toHaveBeenCalledWith({ where: { id, passwordHash: challenge }, select: { id: true } });
  });

  it("is unavailable outside an explicitly enabled Preview", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const response = await GET(new Request("https://example.com", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(response.status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
