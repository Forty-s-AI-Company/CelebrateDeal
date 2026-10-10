import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ security: vi.fn(), auth: vi.fn(), save: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.auth }));
vi.mock("@/lib/tracking-settings", () => ({ saveTrackingCredentialConfiguration: mocks.save, TrackingConfigurationConflict: class extends Error {} }));
import { saveTrackingCredentialAction } from "@/app/actions/tracking-credential-actions";
import { TrackingConfigurationConflict } from "@/lib/tracking-settings";
function form() {
  const f = new FormData(); f.set("credentialRevision", "0"); f.set("facebookAccessToken", ""); f.set("facebookTestEventCode", "SYNTHETIC_TEST"); return f;
}
beforeEach(() => { vi.clearAllMocks(); mocks.security.mockResolvedValue(undefined); mocks.auth.mockResolvedValue({ id: "vendor-one" }); mocks.save.mockResolvedValue({ revision: 1 }); });
it("uses authenticated tenant and never accepts a client-supplied vendor", async () => {
  const f = form(); f.set("vendorId", "foreign-vendor");
  await expect(saveTrackingCredentialAction(f)).rejects.toThrow("/settings/tracking?tracking=saved");
  expect(mocks.save).toHaveBeenCalledWith("vendor-one", { expectedRevision: 0, token: "", testEventCode: "SYNTHETIC_TEST", clearToken: false });
  expect(mocks.revalidate).toHaveBeenCalledWith("/settings/tracking");
});
it("rejects CSRF before tenant lookup or persistence", async () => {
  mocks.security.mockRejectedValue(new Error("CSRF denied"));
  await expect(saveTrackingCredentialAction(form())).rejects.toThrow("CSRF denied");
  expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects unauthorized roles before persistence", async () => {
  mocks.auth.mockRejectedValue(new Error("Forbidden"));
  await expect(saveTrackingCredentialAction(form())).rejects.toThrow("Forbidden"); expect(mocks.save).not.toHaveBeenCalled();
});
it.each(["-1", "01", "1.5", "NaN"])("rejects malformed revision", revision => {
  const f = form(); f.set("credentialRevision", revision);
  return expect(saveTrackingCredentialAction(f)).rejects.toThrow("/settings/tracking?tracking=invalid").then(() => expect(mocks.save).not.toHaveBeenCalled());
});
it("reports a stale version without echoing the input", async () => {
  mocks.save.mockRejectedValue(new TrackingConfigurationConflict());
  await expect(saveTrackingCredentialAction(form())).rejects.toThrow("/settings/tracking?tracking=conflict"); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("keeps arbitrary provider or storage errors out of the response", async () => {
  mocks.save.mockRejectedValue(new Error("synthetic-sensitive-diagnostic-must-not-escape"));
  await expect(saveTrackingCredentialAction(form())).rejects.toThrow("/settings/tracking?tracking=invalid");
});
