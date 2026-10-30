import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { isTransientTransactionConflict, runSerializable, serializableRetryDelayMs, withSerializableRetry } from "@/lib/serializable-retry";

function conflict(code = "P2034") {
  return new Prisma.PrismaClientKnownRequestError("conflict", { code, clientVersion: "test" });
}

describe("F-055 shared Serializable retry", () => {
  it("retries a serialization failure with exponential backoff and full jitter", async () => {
    const sleep = vi.fn(async () => undefined);
    const operation = vi.fn()
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce("committed");

    await expect(withSerializableRetry(operation, { attempts: 5, baseDelayMs: 20, maxDelayMs: 400, sleep, random: () => 0.5 }))
      .resolves.toBe("committed");

    expect(operation).toHaveBeenCalledTimes(3);
    expect(operation.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
    // Half of 20 and of 40 (cap + 1 keeps the bound inclusive).
    expect(sleep.mock.calls).toEqual([[10], [20]]);
  });

  it("caps each delay and never sleeps after the last attempt", async () => {
    expect(serializableRetryDelayMs(10, { baseDelayMs: 20, maxDelayMs: 400, random: () => 0.999_999 })).toBe(400);
    expect(serializableRetryDelayMs(1, { baseDelayMs: 20, random: () => 0 })).toBe(0);

    const sleep = vi.fn(async () => undefined);
    const operation = vi.fn().mockRejectedValue(conflict());
    await expect(withSerializableRetry(operation, { attempts: 3, sleep })).rejects.toMatchObject({ code: "P2034" });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors unless the caller widens retryOn", async () => {
    const sleep = vi.fn(async () => undefined);
    const unique = vi.fn().mockRejectedValue(conflict("P2002"));
    await expect(withSerializableRetry(unique, { attempts: 3, sleep })).rejects.toMatchObject({ code: "P2002" });
    expect(unique).toHaveBeenCalledTimes(1);

    const widened = vi.fn().mockRejectedValueOnce(conflict("P2002")).mockResolvedValueOnce("ok");
    await expect(withSerializableRetry(widened, {
      attempts: 3, sleep, retryOn: (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    })).resolves.toBe("ok");
  });

  it("recognizes P2034 and raw 40001 / 40P01 as transient, and nothing else", () => {
    const known = (code: string, meta?: Record<string, unknown>, message = "raw") =>
      new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: "test", ...(meta ? { meta } : {}) });
    const unknown = (message: string) => new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: "test" });

    expect(isTransientTransactionConflict(conflict())).toBe(true);
    expect(isTransientTransactionConflict(known("P2010", { code: "40001" }))).toBe(true);
    expect(isTransientTransactionConflict(known("P2010", { code: "40P01" }))).toBe(true);
    expect(isTransientTransactionConflict(known("40P01"))).toBe(true);
    expect(isTransientTransactionConflict(unknown("ERROR: could not serialize access due to concurrent update"))).toBe(true);
    expect(isTransientTransactionConflict(unknown("deadlock detected"))).toBe(true);

    expect(isTransientTransactionConflict(conflict("P2002"))).toBe(false);
    expect(isTransientTransactionConflict(known("P2010", { code: "23505" }))).toBe(false);
    expect(isTransientTransactionConflict(unknown("connection refused"))).toBe(false);
    expect(isTransientTransactionConflict(new Error("connection refused"))).toBe(false);
    // Not Prisma request errors: never transient, even with a matching code or phrase.
    expect(isTransientTransactionConflict(Object.assign(new Error("raw"), { code: "P2010", meta: { code: "40001" } }))).toBe(false);
    expect(isTransientTransactionConflict(new Error("deadlock detected"))).toBe(false);
    // A validation error whose message merely contains "40001" must not be retried.
    expect(isTransientTransactionConflict(new Prisma.PrismaClientValidationError("Invalid value 40001 for field amount", { clientVersion: "test" }))).toBe(false);
    expect(isTransientTransactionConflict(known("P2000", undefined, "The value 40001 is too long for the column"))).toBe(false);
    expect(isTransientTransactionConflict(null)).toBe(false);
    expect(isTransientTransactionConflict("40001")).toBe(false);
  });

  it("opens each attempt as its own Serializable transaction with the caller's pool limits", async () => {
    const operation = vi.fn(async () => "done");
    const $transaction = vi.fn()
      .mockRejectedValueOnce(conflict())
      .mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));

    await expect(runSerializable({ $transaction } as never, operation, { attempts: 2, sleep: async () => undefined, maxWait: 5_000, timeout: 10_000 }))
      .resolves.toBe("done");

    expect($transaction).toHaveBeenCalledTimes(2);
    expect($transaction).toHaveBeenLastCalledWith(operation, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 10_000 });
  });
});
