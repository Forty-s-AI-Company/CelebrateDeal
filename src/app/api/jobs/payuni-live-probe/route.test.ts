import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/payuni-live-probe-job", () => ({ runPayUniLiveProbeJob: mocks.run }));
import { POST } from "@/app/api/jobs/payuni-live-probe/route";

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.run.mockReset();
});

describe("POST /api/jobs/payuni-live-probe", () => {
  it("requires the dedicated live-probe bearer before invoking a charge", async () => {
    vi.stubEnv("PAYUNI_LIVE_PROBE_JOB_SECRET", "synthetic-dedicated-job-key");
    const unauthorized = await POST(new Request("https://staging.example.test/api/jobs/payuni-live-probe", { method: "POST" }));
    expect(unauthorized.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
    mocks.run.mockResolvedValue({ outcome: "not_due" });
    const authorized = await POST(new Request("https://staging.example.test/api/jobs/payuni-live-probe", {
      method: "POST", headers: { authorization: "Bearer synthetic-dedicated-job-key" },
    }));
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({ outcome: "not_due" });
    expect(mocks.run).toHaveBeenCalledOnce();
  });
});
