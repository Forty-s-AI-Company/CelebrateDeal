import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), database: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/wp4-runtime-boundary", () => ({ authorizeWp4Ops: async () => ({}), wp4Unavailable: (status: number) => new Response(null, { status }) }));
vi.mock("@/lib/wp4-payuni-sandbox-reconciliation", () => ({ reconcileWp4PayUniSandboxRefund: mocks.reconcile }));
import { POST } from "./route";
import { WP4_REFUND_RECOVERY_SOURCE } from "@/lib/wp4-buyer-recovery";
beforeEach(() => vi.clearAllMocks());
describe("fixed historical refund recovery HTTP contract", () => {
 it.each([["RECONCILED", 200], ["FIXTURE_UNAVAILABLE", 404], ["CANDIDATE_AMBIGUOUS", 409],
  ["PENDING_RESERVATION_UNAVAILABLE", 409], ["REFUND_NOT_CONFIRMED", 409], ["PROJECTION_UNAVAILABLE", 503]] as const)("reports %s with %i", async (status, httpStatus) => {
  const result = { reconciled: status === "RECONCILED", status }; mocks.reconcile.mockResolvedValue(result);
  const response = await POST(new Request("http://127.0.0.1/api/admin/ops/payuni/wp4-refund-recovery", { method: "POST" }));
  expect(response.status).toBe(httpStatus); expect(await response.json()).toEqual(result);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith(mocks.database, WP4_REFUND_RECOVERY_SOURCE);
 });
});
