import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ vendor: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/lib/auth", () => ({ getCurrentVendor: mocks.vendor }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import HomePage from "./page";
afterEach(() => vi.clearAllMocks());
it.each([[null, "/login?from=home"], [{ id: "synthetic-vendor" }, "/dashboard"]])("waits for identity before redirecting to %s", async (vendor, destination) => {
  let resolve!: (value: unknown) => void;
  mocks.vendor.mockReturnValue(new Promise((done) => { resolve = done; }));
  const result = HomePage();
  expect(mocks.redirect).not.toHaveBeenCalled();
  resolve(vendor);
  await expect(result).rejects.toThrow(`redirect:${destination}`);
  expect(mocks.redirect).toHaveBeenCalledOnce();
  expect(mocks.redirect).toHaveBeenCalledWith(destination);
});
