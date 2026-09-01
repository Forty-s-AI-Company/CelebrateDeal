import { createHash, randomBytes, randomInt } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { Prisma, PrismaClient } from "@prisma/client";
import { parseLiveQuotaPolicy } from "@/lib/live-quota-policy";
import { getRuntimeLivePublishReadiness } from "@/lib/live-runtime-readiness";
import { reconcileLiveRuntimeState, resolveLiveRuntime } from "@/lib/live-runtime-state";
import { publicLiveAvailabilityWhere } from "@/lib/sellable-live";
import { assertPaymentMethodReferenceForQuota, PaymentMethodReferenceRequiredError } from "@/lib/payment-method-reference";
import { assertStreamQuotaAvailable } from "@/lib/stream-quota";

export const LIVE_VIEWER_SESSION_COOKIE = "celebratedeal_live_viewer";
export const LIVE_VIEWER_SESSION_TTL_MS = 90_000;
const LIVE_ADMISSION_MAX_ATTEMPTS = 3;
const LIVE_ADMISSION_RETRY_BASE_MS = 20;
const LIVE_ADMISSION_RETRY_JITTER_MS = 20;
const LIVE_VIEWER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type LiveQuotaAdmissionErrorCode =
  | "live_not_found"
  | "viewer_limit_reached"
  | "credits_below_threshold"
  | "stream_minutes_exhausted"
  | "payment_method_required"
  | "admission_busy";

export class LiveQuotaAdmissionError extends Error {
  constructor(public readonly code: LiveQuotaAdmissionErrorCode) {
    super(code);
    this.name = "LiveQuotaAdmissionError";
  }
}

type AdmissionInput = {
  vendorId: string;
  liveId: string;
  token?: string | null;
  now?: Date;
};

type LiveViewerSessionIdentity = {
  id: string;
  vendorId: string;
  liveId: string;
};

function isValidViewerToken(value: string | null | undefined): value is string {
  return Boolean(value && LIVE_VIEWER_TOKEN_PATTERN.test(value));
}

export function hashLiveViewerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createLiveViewerToken() {
  return randomBytes(32).toString("base64url");
}

function readCookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    const value = segment.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function liveViewerTokenFromRequest(request: Request) {
  const token = readCookieValue(request.headers.get("cookie"), LIVE_VIEWER_SESSION_COOKIE);
  return isValidViewerToken(token) ? token : null;
}

/** Returns true only when an opaque viewer session is active for this exact vendor/live pair. */
export async function hasActiveLiveViewerSession(
  db: PrismaClient,
  input: { vendorId: string; liveId: string; token: string; now?: Date },
) {
  const session = await db.liveViewerSession.findUnique({
    where: { tokenHash: hashLiveViewerToken(input.token) },
    select: { vendorId: true, liveId: true, expiresAt: true },
  });
  const now = input.now ?? new Date();
  return Boolean(
    session
    && session.vendorId === input.vendorId
    && session.liveId === input.liveId
    && session.expiresAt > now,
  );
}

export function liveViewerCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: Math.ceil(LIVE_VIEWER_SESSION_TTL_MS / 1000),
  };
}

function activeSessionWhere(vendorId: string, liveId: string, now: Date, tokenHash?: string) {
  return {
    vendorId,
    liveId,
    expiresAt: { gt: now },
    ...(tokenHash ? { tokenHash: { not: tokenHash } } : {}),
  };
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function assertCreditsAvailable(
  usageLimit: { creditsLimit: number; creditsUsed: number } | null,
  stopWhenCreditsBelow: number,
) {
  if (!usageLimit || usageLimit.creditsLimit <= 0) return;
  const remainingCredits = Math.max(0, usageLimit.creditsLimit - usageLimit.creditsUsed);
  if (remainingCredits < stopWhenCreditsBelow) {
    throw new LiveQuotaAdmissionError("credits_below_threshold");
  }
}

async function admitWithinTransaction(tx: Prisma.TransactionClient, input: AdmissionInput) {
  const now = input.now ?? new Date();
  const live = await tx.live.findFirst({
    where: {
      id: input.liveId,
      vendorId: input.vendorId,
      ...publicLiveAvailabilityWhere(),
    },
    select: {
      id: true,
      vendorId: true,
      streamMode: true,
      scheduledAt: true,
      status: true,
      startedAt: true,
      endedAt: true,
      replayAvailableUntil: true,
      replayEnabled: true,
      quotaPolicy: true,
      video: { select: { vendorId: true, durationSec: true, sourceType: true, status: true, cloudflareReadyToStream: true, cloudflareLiveInputUid: true, liveInputStatus: true } },
      form: { select: { vendorId: true, isActive: true, fields: true } },
      messageTemplate: { select: { vendorId: true, channel: true, trigger: true, isActive: true, subject: true, body: true } },
      interactionScript: { select: { vendorId: true, status: true } },
      products: {
        select: {
          vendorId: true,
          product: { select: { vendorId: true, isActive: true, fulfillmentTypeConfirmed: true } },
        },
      },
    },
  });
  if (!live || !getRuntimeLivePublishReadiness(live).ready) {
    throw new LiveQuotaAdmissionError("live_not_found");
  }
  const runtime = resolveLiveRuntime(live, now);
  if (runtime.state !== "playing" && runtime.state !== "replay") {
    throw new LiveQuotaAdmissionError("live_not_found");
  }

  const policy = parseLiveQuotaPolicy(live.quotaPolicy);
  const quotaMemberIds = [
    ...policy.customAllocations.map((allocation) => allocation.membershipId),
    ...policy.memberQuotas.map((quota) => quota.membershipId),
  ];
  if (quotaMemberIds.length > 0 || policy.pageQuotas.length > 0) {
    try {
      await assertPaymentMethodReferenceForQuota(tx, {
        vendorId: input.vendorId,
        payerScope: policy.quotaPayerScope,
        memberIds: quotaMemberIds,
        now,
      });
    } catch (error) {
      if (error instanceof PaymentMethodReferenceRequiredError) {
        throw new LiveQuotaAdmissionError("payment_method_required");
      }
      throw error;
    }
  }

  const usageLimit = await tx.vendorUsageLimit.findUnique({
    where: { vendorId: input.vendorId },
    select: { creditsLimit: true, creditsUsed: true, streamMinutesLimit: true, streamMinutesUsed: true, resetAt: true },
  });
  assertCreditsAvailable(usageLimit, policy.stopWhenCreditsBelow);
  const streamMinutesLimit = usageLimit?.streamMinutesLimit ?? 0;
  if (streamMinutesLimit > 0) {
    const ledgerUsage = await tx.streamUsageLedgerEntry.aggregate({
      where: { vendorId: input.vendorId, monthKey: monthKey(now) },
      _sum: { watchSeconds: true },
    });
    const ledgerSeconds = ledgerUsage._sum.watchSeconds ?? 0;
    const legacySeconds = usageLimit?.resetAt && usageLimit.resetAt > now
      ? (usageLimit.streamMinutesUsed ?? 0) * 60
      : 0;
    assertStreamQuotaAvailable({
      includedMinutes: streamMinutesLimit,
      usedSeconds: Math.max(ledgerSeconds, legacySeconds),
      requestedSeconds: 1,
    });
  }

  const requestedToken = isValidViewerToken(input.token) ? input.token : null;
  const requestedTokenHash = requestedToken ? hashLiveViewerToken(requestedToken) : null;
  const existing = requestedTokenHash
    ? await tx.liveViewerSession.findUnique({
        where: { tokenHash: requestedTokenHash },
        select: { id: true, vendorId: true, liveId: true },
      }) as LiveViewerSessionIdentity | null
    : null;

  if (requestedToken && existing?.vendorId === input.vendorId && existing.liveId === input.liveId) {
    const expiresAt = new Date(now.getTime() + LIVE_VIEWER_SESSION_TTL_MS);
    await tx.liveViewerSession.update({
      where: { id: existing.id },
      data: { lastSeenAt: now, expiresAt },
    });
    return { token: requestedToken, expiresAt, reused: true };
  }

  const activeSessions = await tx.liveViewerSession.count({
    where: activeSessionWhere(input.vendorId, input.liveId, now),
  });
  if (activeSessions >= policy.maxConcurrentViewers) {
    throw new LiveQuotaAdmissionError("viewer_limit_reached");
  }

  const token = createLiveViewerToken();
  const expiresAt = new Date(now.getTime() + LIVE_VIEWER_SESSION_TTL_MS);
  await tx.liveViewerSession.create({
    data: {
      vendorId: input.vendorId,
      liveId: input.liveId,
      tokenHash: hashLiveViewerToken(token),
      lastSeenAt: now,
      expiresAt,
    },
    select: { id: true },
  });
  return { token, expiresAt, reused: false };
}

function isPrismaCode(error: unknown, code: string) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

export function liveAdmissionRetryDelayMs(attempt: number, jitter: number) {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.trunc(attempt) : 1;
  const normalizedJitter = Number.isFinite(jitter) ? Math.trunc(jitter) : 0;
  const boundedAttempt = Math.max(1, Math.min(LIVE_ADMISSION_MAX_ATTEMPTS - 1, normalizedAttempt));
  const boundedJitter = Math.max(0, Math.min(LIVE_ADMISSION_RETRY_JITTER_MS, normalizedJitter));
  return (LIVE_ADMISSION_RETRY_BASE_MS * boundedAttempt) + boundedJitter;
}

export async function admitLiveViewer(db: PrismaClient, input: AdmissionInput) {
  const now = input.now ?? new Date();
  const transactionInput = { ...input, now };

  // This write must commit independently. If quota or payment admission later
  // fails, the natural VOD completion marker must remain durable.
  await reconcileLiveRuntimeState(db, {
    vendorId: input.vendorId,
    liveId: input.liveId,
    now,
  });

  for (let attempt = 1; attempt <= LIVE_ADMISSION_MAX_ATTEMPTS; attempt += 1) {
    try {
      // Every retry starts a fresh Serializable transaction and re-reads the
      // live plus all quota state through the transaction callback.
      return await db.$transaction(
        (tx) => admitWithinTransaction(tx, transactionInput),
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (!isPrismaCode(error, "P2034")) throw error;
      if (attempt === LIVE_ADMISSION_MAX_ATTEMPTS) {
        throw new LiveQuotaAdmissionError("admission_busy");
      }
      // Immediate Serializable retries tend to collide with the same competing
      // transaction again. This bounded jitter clears that conflict window.
      await sleep(liveAdmissionRetryDelayMs(
        attempt,
        randomInt(0, LIVE_ADMISSION_RETRY_JITTER_MS + 1),
      ));
    }
  }

  throw new LiveQuotaAdmissionError("admission_busy");
}

export async function releaseLiveViewer(db: PrismaClient, input: Omit<AdmissionInput, "now">) {
  const token = isValidViewerToken(input.token) ? input.token : null;
  if (!token) return 0;
  const result = await db.liveViewerSession.deleteMany({
    where: {
      vendorId: input.vendorId,
      liveId: input.liveId,
      tokenHash: hashLiveViewerToken(token),
    },
  });
  return result.count;
}
