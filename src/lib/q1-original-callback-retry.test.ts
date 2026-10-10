import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { retryQ1OriginalBuyerCallback, retryWp4HistoricalBuyerCallback } from "./wp4-buyer-callback-retry";
import { wp4HistoricalBuyerWhere } from "./wp4-buyer-recovery";

vi.mock("./webhook-retry", () => ({ retryWebhookEvent: vi.fn() }));

describe("catalog-owned original callback selectors", () => {
  it("binds Q1 to the paid original source and preserves the historical selector", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { $transaction: vi.fn(async (work: (tx: unknown) => unknown) =>
      work({ paymentTransaction: { findMany } })) } as unknown as Pick<PrismaClient, "$transaction">;
    await expect(retryQ1OriginalBuyerCallback(db)).resolves.toMatchObject({
      status: "FIXTURE_UNAVAILABLE", retryAttempts: 0,
    });
    expect(findMany).toHaveBeenLastCalledWith({
      where: wp4HistoricalBuyerWhere("9acfe8d2dba62430e950cff2c0387841ab91f44b"), take: 2,
    });
    await retryWp4HistoricalBuyerCallback(db);
    expect(findMany).toHaveBeenLastCalledWith({ where: wp4HistoricalBuyerWhere(), take: 2 });
  });

  it("rejects ambiguous original payments before reading or dispatching callbacks", async () => {
    const callbacks = vi.fn();
    const db = { $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({
      paymentTransaction: { findMany: vi.fn().mockResolvedValue([{}, {}]) },
      webhookEvent: { findMany: callbacks },
    })) } as unknown as Pick<PrismaClient, "$transaction">;
    await expect(retryQ1OriginalBuyerCallback(db)).resolves.toMatchObject({
      status: "CANDIDATE_AMBIGUOUS", retryAttempts: 0,
    });
    expect(callbacks).not.toHaveBeenCalled();
  });
});
