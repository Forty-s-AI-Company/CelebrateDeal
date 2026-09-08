import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/taiwan-electronic-invoice-job", () => ({ runElectronicInvoiceJob: mocks.run }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.capture }));
import { POST } from "./route";

const secret = "test-electronic-invoice-job-secret";
function request(authorization?: string) {
  return new Request("https://app.example.test/api/jobs/electronic-invoices", { method: "POST", headers: authorization ? { authorization } : undefined });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", secret);
  mocks.run.mockResolvedValue({ adapterAvailable: false, attempted: 0, issued: 0, allowances: 0, voided: 0, failed: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/jobs/electronic-invoices", () => {
  it("rejects missing job authorization before touching the queue", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("keeps queued work durable when no fiscal adapter is configured", async () => {
    const response = await POST(request(`Bearer ${secret}`));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: false, adapterAvailable: false, attempted: 0 });
  });

  it("returns only a sanitized failure contract", async () => {
    mocks.run.mockRejectedValueOnce(new Error("sensitive provider detail"));
    const response = await POST(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "electronic_invoice_job_failed" });
    expect(mocks.capture).toHaveBeenCalledOnce();
  });
});
