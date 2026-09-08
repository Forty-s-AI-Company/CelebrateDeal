import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  security: vi.fn(),
  context: vi.fn(),
  updateMany: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.context }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { updateMany: mocks.updateMany } }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { updateVendorFeaturesAction } from "./actions";

function form(modules: unknown) {
  const data = new FormData();
  data.set("_csrf", "synthetic-token");
  data.set("enabledModules", JSON.stringify(modules));
  data.set("vendorId", "attacker-vendor");
  return data;
}

describe("updateVendorFeaturesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ vendor: { id: "session-vendor" }, auth: {} });
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("verifies CSRF and derives tenant scope only from vendor manager context", async () => {
    await expect(updateVendorFeaturesAction(form(["funnel_builder", "live_webinar"]))).resolves.toEqual({ enabledModules: ["funnel_builder", "live_webinar"] });
    expect(mocks.security).toHaveBeenCalledOnce();
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: "session-vendor" }, data: { enabledFeatureModules: ["funnel_builder", "live_webinar"] } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("rejects unknown modules before any database write", async () => {
    await expect(updateVendorFeaturesAction(form(["funnel_builder", "root_access"]))).rejects.toThrow("Invalid vendor feature modules");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
