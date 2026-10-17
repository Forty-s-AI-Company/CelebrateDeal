import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ authorize: vi.fn(), getDb: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/wp4-runtime-boundary", () => ({ authorizeWp4Ops: deps.authorize, wp4Unavailable: (status: number) => new Response(null, { status }) }));
vi.mock("@/lib/db", () => ({ getDb: deps.getDb }));
vi.mock("@/lib/q1-downstream-readonly", () => ({ readQ1Downstream: deps.read }));
import { GET } from "./route";
describe("protected readonly downstream route", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([401, 404, 503])("rejects authorization status %i before touching the DB", async status => {
    deps.authorize.mockResolvedValue(new Response(null, { status }));
    expect((await GET(new Request("https://synthetic.example.test"))).status).toBe(status);
    expect(deps.getDb).not.toHaveBeenCalled();
    expect(deps.read).not.toHaveBeenCalled();
  });
  it("returns only the reviewed receipt with no cache", async () => {
    deps.authorize.mockResolvedValue({ sourceSha: "a".repeat(40) });
    deps.read.mockResolvedValue({ classification: "DOWNSTREAM_OBSERVED" });
    const response = await GET(new Request("https://synthetic.example.test"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ classification: "DOWNSTREAM_OBSERVED" });
  });
  it("does not expose an internal exception", async () => {
    deps.authorize.mockResolvedValue({ sourceSha: "a".repeat(40) });
    deps.read.mockRejectedValue(new Error("synthetic confidential diagnostic"));
    const response = await GET(new Request("https://synthetic.example.test"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("confidential");
  });
});
