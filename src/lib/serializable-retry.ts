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

const TRANSIENT_SQLSTATES = new Set(["40001", "40P01"]);
const TRANSIENT_MESSAGE = /could not serialize access|deadlock detected/iu;

/**
 * A transaction abort that is safe to re-run when the whole operation is
 * idempotent: Prisma P2034, or the PostgreSQL SQLSTATEs serialization failure
 * (40001) and deadlock (40P01) when the driver surfaces them without the P2034
 * mapping. Only Prisma request errors qualify, so an application or validation
 * error that merely mentions a number is never retried. A known error is
 * matched on its structured `code` / `meta.code`; an unknown request error
 * carries no code, so only the two PostgreSQL phrases are accepted.
 */
export function isTransientTransactionConflict(error: unknown) {
  if (isSerializationFailure(error)) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: unknown } | undefined;
    return TRANSIENT_SQLSTATES.has(error.code)
      || (typeof meta?.code === "string" && TRANSIENT_SQLSTATES.has(meta.code))
      || TRANSIENT_MESSAGE.test(error.message);
  }
  return error instanceof Prisma.PrismaClientUnknownRequestError && TRANSIENT_MESSAGE.test(error.message);
}

const LOCK_TIMEOUT_SQLSTATE = "55P03";
const LOCK_TIMEOUT_MESSAGE = /canceling statement due to lock timeout/iu;

/**
 * A statement cancelled by `lock_timeout` (PostgreSQL 55P03, lock_not_available).
 * Safe to re-run only when the whole operation is idempotent. Matched like
 * isTransientTransactionConflict: structured `code` / `meta.code` on a known
 * request error, or the PostgreSQL phrase on a known or unknown one.
 */
export function isLockTimeout(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: unknown } | undefined;
    return error.code === LOCK_TIMEOUT_SQLSTATE || meta?.code === LOCK_TIMEOUT_SQLSTATE || LOCK_TIMEOUT_MESSAGE.test(error.message);
  }
  return error instanceof Prisma.PrismaClientUnknownRequestError && LOCK_TIMEOUT_MESSAGE.test(error.message);
}

const QUERY_CANCELED_SQLSTATE = "57014";
const QUERY_CANCELED_MESSAGE = /canceling statement due to (?:user request|statement timeout)/iu;

/**
 * A bounded lock wait that ended without the lock: lock_timeout (55P03) or a
 * cancelled statement (57014, query_canceled). Both roll the transaction back
 * and leave nothing written, so a writer can report "busy, try again".
 *
 * 57014 belongs here because PostgreSQL can report a lock_timeout as a "user
 * request" cancel: when a waiter's lock_timeout fires just as its lock is
 * granted (e.g. the tuple lock of a FOR UPDATE, handed over by a waiter that
 * gave up at the same moment), ProcSleep keeps the timeout's indicator and the
 * pending cancel, but the next lock wait of the same statement (the holder's
 * transaction id) re-arms LOCK_TIMEOUT, which clears the indicator. The
 * pending cancel is then reported as "canceling statement due to user
 * request" (at least PostgreSQL 16, checked against REL_16_STABLE: proc.c
 * ProcSleep / timeout.c enable_timeout / postgres.c ProcessInterrupts). A
 * statement_timeout or pg_cancel_backend ends the wait the same way.
 *
 * For mapping to a "busy" result only: never retry on it automatically (a
 * deliberate cancel must stay cancelled); use isLockTimeout for retries.
 */
export function isLockWaitGivenUp(error: unknown) {
  if (isLockTimeout(error)) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: unknown } | undefined;
    return error.code === QUERY_CANCELED_SQLSTATE || meta?.code === QUERY_CANCELED_SQLSTATE || QUERY_CANCELED_MESSAGE.test(error.message);
  }
  return error instanceof Prisma.PrismaClientUnknownRequestError && QUERY_CANCELED_MESSAGE.test(error.message);
}

/**
 * A rule write (automation rule, its steps, the funnel editor) that waited on
 * the rule row FOR UPDATE and gave up: the wait was given up
 * (isLockWaitGivenUp: 55P03, or 57014 which PostgreSQL also reports for a
 * lock_timeout), or the transaction could not start or finish in time
 * (P2028). The transaction rolled back and nothing was written, so the writer
 * answers "busy, try again".
 */
export function isRuleWriteBusy(error: unknown) {
  return isLockWaitGivenUp(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028");
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
