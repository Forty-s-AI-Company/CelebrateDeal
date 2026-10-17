import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const dependencies = vi.hoisted(() => ({ db: { $transaction: vi.fn() } }));
vi.mock("@/lib/db", () => ({ getDb: () => dependencies.db }));
import { failPendingCheckoutAndReleaseInventory } from "./inventory-reservations";
const input = { vendorId: "synthetic-vendor", transactionId: "synthetic-payment", reason: "provider_checkout_failed" as const };
beforeEach(() => { dependencies.db.$transaction.mockReset(); });
describe("inventory conflict retry budget", () => {
  it("retains exactly three attempts for the observed driver deadlock", async () => {
    const error = new Prisma.PrismaClientUnknownRequestError("ERROR: deadlock detected", { clientVersion: "synthetic" });
    dependencies.db.$transaction.mockRejectedValue(error);
    await expect(failPendingCheckoutAndReleaseInventory(input)).rejects.toBe(error);
    expect(dependencies.db.$transaction).toHaveBeenCalledTimes(3);
  });
  it("does not retry application errors", async () => {
    const error = new Error("deadlock detected");
    dependencies.db.$transaction.mockRejectedValue(error);
    await expect(failPendingCheckoutAndReleaseInventory(input)).rejects.toBe(error);
    expect(dependencies.db.$transaction).toHaveBeenCalledTimes(1);
  });
});
