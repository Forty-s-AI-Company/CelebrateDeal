import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSecurity: vi.fn(),
  requireVendorManager: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ interactionScript: { findMany: mocks.findMany } }) }));

import { listLiveInteractionScriptsAction } from "./live-interaction-scripts";

function input(values: Record<string, string> = {}) {
  const data = new FormData();
  data.set("_csrf", "synthetic");
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertSecurity.mockResolvedValue(undefined);
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-session" });
  mocks.findMany.mockResolvedValue([{ id: "script-1", name: "首波促購腳本" }]);
});

describe("listLiveInteractionScriptsAction", () => {
  it("lists the session vendor's published scripts, newest first, and ignores any vendor in the input", async () => {
    const result = await listLiveInteractionScriptsAction(input({ vendorId: "vendor-forged" }));

    expect(result).toEqual({ status: "success", scripts: [{ id: "script-1", name: "首波促購腳本" }] });
    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.findMany.mock.calls[0]![0]).toMatchObject({
      where: { vendorId: "vendor-session", status: "published" },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    });
  });

  it("refuses a request without a valid security token before touching the session or the database", async () => {
    mocks.assertSecurity.mockRejectedValue(new Error("Invalid CSRF token."));

    expect(await listLiveInteractionScriptsAction(input())).toEqual({ status: "error" });
    expect(mocks.requireVendorManager).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("does not list anything when the caller is not a vendor manager", async () => {
    mocks.requireVendorManager.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(listLiveInteractionScriptsAction(input())).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
