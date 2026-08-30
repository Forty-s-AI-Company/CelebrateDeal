import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  importReconciliation: vi.fn(),
  resolveReconciliation: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/stream-usage-reconciliation", () => ({
  importStreamUsageReconciliation: mocks.importReconciliation,
  resolveStreamUsageReconciliation: mocks.resolveReconciliation,
  StreamUsageReconciliationError: class StreamUsageReconciliationError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
}));

import {
  importStreamUsageReconciliationAction,
  resolveStreamUsageReconciliationAction,
} from "./actions";
import { StreamUsageReconciliationError } from "@/lib/stream-usage-reconciliation";

function importForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    csrf: "token",
    vendorId: "vendor-1",
    provider: "cloudflare",
    monthKey: "2026-07",
    sourceDigest: "A".repeat(64),
    sourceReference: "CF export 2026-07",
    providerWatchMinutes: "123",
    providerStorageMinutes: "45",
    capturedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "platform-user", role: "platform_admin" } });
  mocks.importReconciliation.mockResolvedValue({ id: "reconciliation-1", duplicate: false, status: "MATCHED" });
  mocks.resolveReconciliation.mockResolvedValue({ id: "reconciliation-1", status: "RESOLVED" });
});

describe("Stream usage reconciliation actions", () => {
  it("authenticates, authorizes and sends only normalized sanitized evidence to the domain", async () => {
    await expect(importStreamUsageReconciliationAction(importForm())).rejects.toThrow(
      "redirect:/admin/billing/stream-reconciliation?status=imported",
    );

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledOnce();
    expect(mocks.requireFinanceAdmin).toHaveBeenCalledOnce();
    expect(mocks.importReconciliation).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      provider: "CLOUDFLARE",
      monthKey: "2026-07",
      sourceDigest: "a".repeat(64),
      sourceReference: "CF export 2026-07",
      providerWatchMinutes: 123,
      providerStorageMinutes: 45,
      capturedAt: new Date("2026-08-01T00:00:00.000Z"),
      actorId: "platform-user",
      actorLabel: "platform_admin",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/billing/stream-reconciliation");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/billing/usage");
  });

  it("maps an idempotent duplicate to explicit feedback", async () => {
    mocks.importReconciliation.mockResolvedValueOnce({ id: "reconciliation-1", duplicate: true, status: "MATCHED" });

    await expect(importStreamUsageReconciliationAction(importForm())).rejects.toThrow(
      "redirect:/admin/billing/stream-reconciliation?status=duplicate",
    );
  });

  it("does not coerce malformed numeric evidence into a valid zero", async () => {
    await expect(importStreamUsageReconciliationAction(importForm({ providerWatchMinutes: "12.5", providerStorageMinutes: "-1" })))
      .rejects.toThrow("redirect:/admin/billing/stream-reconciliation?status=imported");

    expect(mocks.importReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      providerWatchMinutes: Number.NaN,
      providerStorageMinutes: Number.NaN,
    }));
  });

  it("does not let a timezone-less captured timestamp depend on the server locale", async () => {
    await expect(importStreamUsageReconciliationAction(importForm({ capturedAt: "2026-08-01T00:00" })))
      .rejects.toThrow("redirect:/admin/billing/stream-reconciliation?status=imported");

    const capturedAt = mocks.importReconciliation.mock.calls[0]?.[0]?.capturedAt as Date;
    expect(Number.isNaN(capturedAt.getTime())).toBe(true);
  });

  it("maps finite domain errors without exposing database details", async () => {
    mocks.importReconciliation.mockRejectedValueOnce(new StreamUsageReconciliationError("conflict" as never));

    await expect(importStreamUsageReconciliationAction(importForm())).rejects.toThrow(
      "redirect:/admin/billing/stream-reconciliation?error=conflict",
    );
  });

  it("resolves a mismatch with an explicit decision and human note", async () => {
    const formData = new FormData();
    formData.set("id", "reconciliation-1");
    formData.set("resolution", "ACCEPT_INTERNAL");
    formData.set("note", "Provider export includes pre-roll traffic; internal ledger is authoritative.");

    await expect(resolveStreamUsageReconciliationAction(formData)).rejects.toThrow(
      "redirect:/admin/billing/stream-reconciliation?status=resolved",
    );
    expect(mocks.resolveReconciliation).toHaveBeenCalledWith({
      id: "reconciliation-1",
      resolution: "ACCEPT_INTERNAL",
      note: "Provider export includes pre-roll traffic; internal ledger is authoritative.",
      actorId: "platform-user",
      actorLabel: "platform_admin",
    });
  });

  it("does not invoke the domain when CSRF verification fails", async () => {
    mocks.assertServerActionSecurity.mockRejectedValueOnce(new Error("Invalid CSRF token."));

    await expect(importStreamUsageReconciliationAction(importForm())).rejects.toThrow("Invalid CSRF token.");
    expect(mocks.requireFinanceAdmin).not.toHaveBeenCalled();
    expect(mocks.importReconciliation).not.toHaveBeenCalled();
  });
});
