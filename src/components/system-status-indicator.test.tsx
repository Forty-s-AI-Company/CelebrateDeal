import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HEALTH_POLL_INTERVAL_MS, SystemStatusView, checkSystemHealth } from "./system-status-indicator";

const res = (ok: boolean, body: unknown) => ({ ok, json: async () => body }) as unknown as Response;

describe("system status indicator", () => {
  it("polls no faster than every 60 seconds", () => {
    expect(HEALTH_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("maps /api/health results to a status", async () => {
    expect(await checkSystemHealth(vi.fn().mockResolvedValue(res(true, { ok: true })))).toBe("ok");
    expect(await checkSystemHealth(vi.fn().mockResolvedValue(res(false, { ok: false })))).toBe("error");
    expect(await checkSystemHealth(vi.fn().mockResolvedValue(res(true, { ok: false })))).toBe("error");
    expect(await checkSystemHealth(vi.fn().mockRejectedValue(new Error("offline")))).toBe("error");
  });

  it("renders honest labels", () => {
    expect(renderToStaticMarkup(<SystemStatusView status="ok" />)).toContain("系統連線正常");
    expect(renderToStaticMarkup(<SystemStatusView status="error" />)).toContain("連線異常");
    expect(renderToStaticMarkup(<SystemStatusView status="checking" />)).not.toContain("系統連線正常");
  });
});
