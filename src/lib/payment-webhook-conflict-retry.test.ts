import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const dependencies = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: dependencies.getDb }));
import { PaymentWebhookPayload, processPaymentWebhook } from "./payment-webhooks";
const payload = PaymentWebhookPayload.parse({ provider: "synthetic", eventId: "synthetic-retry", eventType: "paid", orderNumber: "synthetic-order" });
beforeEach(() => { dependencies.getDb.mockReset(); });
describe("payment webhook bounded conflict retry", () => {
  it("retries the observed driver deadlock once and rethrows after two attempts", async () => {
    const error = new Prisma.PrismaClientUnknownRequestError("ERROR: deadlock detected", { clientVersion: "synthetic" });
    dependencies.getDb.mockImplementation(() => { throw error; });
    await expect(processPaymentWebhook(payload)).rejects.toBe(error);
    expect(dependencies.getDb).toHaveBeenCalledTimes(2);
  });
  it("does not retry arbitrary application failures containing the same text", async () => {
    const error = new Error("deadlock detected");
    dependencies.getDb.mockImplementation(() => { throw error; });
    await expect(processPaymentWebhook(payload)).rejects.toBe(error);
    expect(dependencies.getDb).toHaveBeenCalledTimes(1);
  });
  it("retains the existing uniqueness-conflict retry budget", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("synthetic", { code: "P2002", clientVersion: "synthetic" });
    dependencies.getDb.mockImplementation(() => { throw error; });
    await expect(processPaymentWebhook(payload)).rejects.toBe(error);
    expect(dependencies.getDb).toHaveBeenCalledTimes(2);
  });
});
