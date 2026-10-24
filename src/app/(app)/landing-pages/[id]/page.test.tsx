import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ manager: vi.fn(), redirect: vi.fn((href: string) => { throw new Error(`redirect:${href}`); }) }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.manager }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import LegacyLandingPageEditorRedirect from "./page";

const props = (id: string, searchParams: { step?: string | string[] } = {}) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });

beforeEach(() => vi.clearAllMocks());

it("redirects the old editor URL to the full-screen editor and keeps the step", async () => {
  await expect(LegacyLandingPageEditorRedirect(props("page-1", { step: "step_abc" }))).rejects.toThrow("redirect:/landing-pages/page-1/edit?step=step_abc");
  expect(mocks.manager).toHaveBeenCalledOnce();
});

it("redirects without a step when none (or an ambiguous list) is given", async () => {
  await expect(LegacyLandingPageEditorRedirect(props("page-1"))).rejects.toThrow("redirect:/landing-pages/page-1/edit");
  await expect(LegacyLandingPageEditorRedirect(props("page-1", { step: ["a", "b"] }))).rejects.toThrow(/redirect:\/landing-pages\/page-1\/edit$/u);
});

it("encodes ids and steps so the redirect cannot leave the editor route", async () => {
  await expect(LegacyLandingPageEditorRedirect(props("a/../b", { step: "x&tab=y" }))).rejects.toThrow("redirect:/landing-pages/a%2F..%2Fb/edit?step=x%26tab%3Dy");
});

it("checks the manager role before redirecting", async () => {
  const denied = new Error("synthetic authorization denial");
  mocks.manager.mockRejectedValueOnce(denied);
  await expect(LegacyLandingPageEditorRedirect(props("page-1"))).rejects.toBe(denied);
  expect(mocks.redirect).not.toHaveBeenCalled();
});
