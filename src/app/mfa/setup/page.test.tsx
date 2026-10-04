import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/app/actions", () => ({}));
vi.mock("@/lib/e2e-loading-diagnostic", () => ({ applyE2eLoadingDelay: vi.fn() }));

import MfaSetupPage from "./page";
import SecuritySettingsPage from "../../(app)/settings/security/page";

describe("MFA page authentication return context", () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset();
    // Stop at the guard as an unverified session would; no private setup data is read.
    mocks.requireAuth.mockRejectedValue(new Error("auth-guard-redirect"));
  });

  for (const [name, page] of [["setup", MfaSetupPage], ["settings", SecuritySettingsPage]] as const) {
    it.each(["/orders?status=paid", "//outside.invalid"])(`${name} passes only a safe next to the authentication guard: %s`, async (next) => {
      await expect(page({ searchParams: Promise.resolve({ next }) })).rejects.toThrow("auth-guard-redirect");
      expect(mocks.requireAuth).toHaveBeenCalledWith({ nextPath: next.startsWith("//") ? undefined : next });
    });
  }
});
