import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * F-055 / B03-22 / B04-14: one retry policy for Serializable transactions.
 *
 * PostgreSQL aborts one side of a Serializable conflict (Prisma P2034). A hot
 * product during a live flash sale makes that routine, so callers retry with
 * exponential backoff and full jitter instead of immediately, which only
 * re-collides with the same competitors. Delays stay short because the
 * caller is usually an HTTP request.
 */
export type SerializableRetryOptions = {
  /** Total attempts including the first; at least 1. */
  attempts: number;
  /** Upper bound of the first retry delay in milliseconds. */
  baseDelayMs?: number;
  /** Cap of any single retry delay in milliseconds. */
  maxDelayMs?: number;
  /** Which errors are retried; defaults to a serialization failure (P2034). */
  retryOn?: (error: unknown) => boolean;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected in tests; must return a value in [0, 1). */
  random?: () => number;
};

export function isSerializationFailure(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

const DEFAULT_BASE_DELAY_MS = 20;
const DEFAULT_MAX_DELAY_MS = 400;

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Full jitter: a uniform delay in [0, min(max, base * 2^(retry - 1))]. */
export function serializableRetryDelayMs(retry: number, options: Pick<SerializableRetryOptions, "baseDelayMs" | "maxDelayMs" | "random">) {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const cap = Math.min(options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS, base * 2 ** Math.max(0, retry - 1));
  return Math.floor((options.random ?? Math.random)() * (cap + 1));
}

/** Re-run a whole operation (which opens its own transaction) on a retryable error. */
export async function withSerializableRetry<T>(operation: (attempt: number) => Promise<T>, options: SerializableRetryOptions): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts));
  const retryOn = options.retryOn ?? isSerializationFailure;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts || !retryOn(error)) throw error;
      await sleep(serializableRetryDelayMs(attempt, options));
    }
  }
}

/** One Serializable interactive transaction, retried by withSerializableRetry. */
export function runSerializable<T>(
  db: Pick<PrismaClient, "$transaction">,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: SerializableRetryOptions & { maxWait?: number; timeout?: number },
) {
  return withSerializableRetry(() => db.$transaction(operation, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    ...(options.maxWait !== undefined ? { maxWait: options.maxWait } : {}),
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
  }), options);
}
