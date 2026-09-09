import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireSameOriginRequest, readJsonBody } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { normalizeInteractionEventDraft, type AdvancedInteractionMetadata } from "@/lib/interaction-event";
import {
  createInteractionBearer,
  FLASH_VOUCHER_COOKIE,
  FLASH_VOUCHER_TTL_MS,
  hashInteractionBearer,
  luckyDrawClaimEnvelopePurpose,
  pollPercentagesFromCounts,
} from "@/lib/live-interaction";
import {
  hasActiveLiveViewerSession,
  hashLiveViewerToken,
  liveViewerTokenFromRequest,
} from "@/lib/live-quota-admission";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveLiveRuntime } from "@/lib/live-runtime-state";
import { decryptSensitiveValue } from "@/lib/sensitive-data";
import { normalizeLiveQuestionBody, normalizeLiveQuestionDisplayName } from "@/lib/live-question";

const Identifier = z.string().trim().min(1).max(128);
const OpenRequest = z.object({
  action: z.literal("open"),
  vendorId: Identifier,
  liveId: Identifier,
  eventId: Identifier,
}).strict();
const RespondRequest = z.object({
  action: z.literal("respond"),
  vendorId: Identifier,
  liveId: Identifier,
  runId: Identifier,
  value: z.union([
    z.string().trim().min(1).max(160),
    z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  ]),
  displayName: z.string().trim().min(1).max(80).optional(),
}).strict();
const AskQuestionRequest = z.object({
  action: z.literal("ask_question"),
  vendorId: Identifier,
  liveId: Identifier,
  body: z.string(),
  displayName: z.string().optional(),
}).strict();
const RequestBody = z.discriminatedUnion("action", [OpenRequest, RespondRequest, AskQuestionRequest]);
const FORM_SUBMISSION_COOKIE = "celebratedeal_form_submission";
const FORM_SUBMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

function requestCookie(request: Request, name: string) {
  for (const segment of (request.headers.get("cookie") ?? "").split(";").slice(0, 100)) {
    const separator = segment.indexOf("=");
    if (separator > 0 && segment.slice(0, separator).trim() === name) return segment.slice(separator + 1).trim();
  }
  return null;
}

/**
 * Resolves a buyer only from the httpOnly, verified registration identity and
 * commerce records. Display names and viewer tokens are deliberately absent.
 */
async function verifiedPurchasedDrawRegistration(
  tx: Prisma.TransactionClient,
  request: Request,
  input: { vendorId: string; liveId: string },
) {
  const formSubmissionId = requestCookie(request, FORM_SUBMISSION_COOKIE);
  if (!formSubmissionId || !FORM_SUBMISSION_ID_PATTERN.test(formSubmissionId)) return null;

  const registration = await tx.formSubmission.findFirst({
    where: {
      id: formSubmissionId,
      liveId: input.liveId,
      verificationStatus: "VERIFIED",
      form: { vendorId: input.vendorId },
    },
    select: { id: true },
  });
  if (!registration) return null;

  const purchase = await tx.paymentTransaction.findFirst({
    where: {
      vendorId: input.vendorId,
      status: "paid",
      metadata: { path: ["formSubmissionId"], equals: registration.id },
      primaryCommerceOrder: {
        is: {
          vendorId: input.vendorId,
          status: "paid",
          items: {
            some: {
              product: {
                is: {
                  liveProducts: { some: { vendorId: input.vendorId, liveId: input.liveId } },
                },
              },
            },
          },
        },
      },
    },
    select: { id: true },
  });
  return purchase ? registration.id : null;
}

function scheduledInteractionWindow(
  sourceLive: Parameters<typeof resolveLiveRuntime>[0] | undefined,
  triggerSec: number,
  durationSec: number,
  now: Date,
) {
  if (!sourceLive) return null;
  const runtime = resolveLiveRuntime(sourceLive, now);
  if (runtime.state !== "playing") return null;
  const playbackStartedAt = sourceLive.streamMode === "live"
    ? sourceLive.startedAt
    : sourceLive.scheduledAt;
  if (!playbackStartedAt) return null;
  const startsAt = new Date(playbackStartedAt.getTime() + triggerSec * 1_000);
  const endsAt = new Date(startsAt.getTime() + durationSec * 1_000);
  return now >= startsAt && now < endsAt ? { startsAt, endsAt } : null;
}

function configuration(value: Prisma.JsonValue): AdvancedInteractionMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("kind" in value)) return null;
  return value as unknown as AdvancedInteractionMetadata;
}

async function admittedViewer(request: Request, vendorId: string, liveId: string) {
  const token = liveViewerTokenFromRequest(request);
  if (!token || !await hasActiveLiveViewerSession(getDb(), { vendorId, liveId, token })) return null;
  return { token, participantHash: hashLiveViewerToken(token) };
}

async function projectRun(runId: string, participantHash: string) {
  const run = await getDb().liveInteractionRun.findUnique({
    where: { id: runId },
  });
  if (!run) return null;
  const metadata = configuration(run.configuration);
  if (!metadata) return null;
  const [responseCount, ownResponse, pollCounts, winnerResponse] = await Promise.all([
    getDb().liveInteractionResponse.count({ where: { runId } }),
    getDb().liveInteractionResponse.findUnique({
      where: { runId_participantHash: { runId, participantHash } },
      select: { id: true, value: true },
    }),
    metadata.kind === "poll"
      ? getDb().liveInteractionResponse.groupBy({ by: ["value"], where: { runId }, _count: { _all: true } })
      : Promise.resolve([]),
    run.winnerResponseId
      ? getDb().liveInteractionResponse.findUnique({ where: { id: run.winnerResponseId }, select: { id: true, displayName: true, winnerClaimCodeEncryptedEnvelope: true } })
      : Promise.resolve(null),
  ]);
  const countMap = new Map<string, number>();
  for (const row of pollCounts) {
    let selections: string[] = [row.value];
    if (row.value.startsWith("[")) {
      try {
        const parsed = JSON.parse(row.value) as unknown;
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) selections = parsed;
      } catch { /* Legacy/single values stay valid. */ }
    }
    for (const selection of selections) countMap.set(selection, (countMap.get(selection) ?? 0) + row._count._all);
  }
  const winnerIsViewer = Boolean(run.winnerResponseId && ownResponse?.id === run.winnerResponseId);
  let winnerClaimCode: string | null = null;
  // The encrypted code is read only for the matching winner response. A failed
  // decrypt stays fail-closed: the UI never receives an unverifiable fallback.
  if (winnerIsViewer && winnerResponse?.winnerClaimCodeEncryptedEnvelope) {
    try {
      winnerClaimCode = decryptSensitiveValue(
        winnerResponse.winnerClaimCodeEncryptedEnvelope,
        luckyDrawClaimEnvelopePurpose(run.vendorId, winnerResponse.id),
      );
    } catch {
      winnerClaimCode = null;
    }
  }
  return {
    id: run.id,
    eventType: run.eventType,
    title: run.title,
    status: run.status,
    startsAt: run.startsAt.toISOString(),
    endsAt: run.endsAt.toISOString(),
    metadata,
    responseCount,
    responded: Boolean(ownResponse),
    ownValue: ownResponse?.value ?? null,
    pollResults: metadata.kind === "poll" ? pollPercentagesFromCounts(metadata.options, countMap) : null,
    winner: winnerResponse ? winnerResponse.displayName ?? "幸運觀眾" : null,
    winnerIsViewer,
    winnerClaimCode,
    winnerRevealedAt: run.winnerResponseId ? run.updatedAt.toISOString() : null,
    prizeName: metadata.kind === "lucky_draw" ? (metadata.prizeName ?? null) : null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") ?? "";
  const liveId = url.searchParams.get("liveId") ?? "";
  if (!Identifier.safeParse(vendorId).success || !Identifier.safeParse(liveId).success) {
    return NextResponse.json({ error: "Invalid interaction scope" }, { status: 400 });
  }
  const viewer = await admittedViewer(request, vendorId, liveId);
  if (!viewer) return NextResponse.json({ error: "Viewer admission required" }, { status: 401 });
  const now = new Date();
  const [runs, spotlight] = await Promise.all([getDb().liveInteractionRun.findMany({
    where: {
      vendorId,
      liveId,
      source: "manual",
      OR: [{ status: "active", endsAt: { gt: now } }, { winnerResponseId: { not: null }, updatedAt: { gt: new Date(now.getTime() - 30_000) } }],
    },
    orderBy: { startsAt: "desc" },
    take: 3,
    select: { id: true },
  }), getDb().liveQuestion.findFirst({
    where: { vendorId, liveId, status: "spotlight" },
    orderBy: { spotlightedAt: "desc" },
    select: { id: true, body: true, displayName: true, spotlightedAt: true },
  })]);
  const projected = await Promise.all(runs.map(({ id }) => projectRun(id, viewer.participantHash)));
  return NextResponse.json({ runs: projected.filter(Boolean), spotlight }, { headers: { "Cache-Control": "private, no-store" } });
}

/** 呼叫端完成觀眾准入後，才可依已發布腳本建立排定的互動。 */
async function openScheduledInteraction(data: z.infer<typeof OpenRequest>, participantHash: string) {
  const event = await getDb().interactionEvent.findFirst({
    where: {
      id: data.eventId,
      script: {
        vendorId: data.vendorId,
        status: "published",
        lives: { some: { id: data.liveId, vendorId: data.vendorId } },
      },
    },
    include: {
      script: {
        select: {
          lives: {
            where: { id: data.liveId, vendorId: data.vendorId },
            take: 1,
            select: { streamMode: true, scheduledAt: true, status: true, startedAt: true, endedAt: true, replayAvailableUntil: true, replayEnabled: true, video: { select: { durationSec: true } } },
          },
        },
      },
    },
  });
  if (!event || !["lucky_draw", "poll", "flash_voucher", "flash_sale"].includes(event.eventType)) {
    return NextResponse.json({ error: "Interaction unavailable" }, { status: 404 });
  }
  const normalized = normalizeInteractionEventDraft({
    eventType: event.eventType,
    triggerSec: event.triggerSec,
    title: event.title,
    productId: event.productId,
    metadata: event.metadata,
  });
  if (!normalized.success || !normalized.data.metadata) {
    return NextResponse.json({ error: "Interaction unavailable" }, { status: 404 });
  }
  const now = new Date();
  const window = scheduledInteractionWindow(
    event.script.lives[0],
    event.triggerSec,
    normalized.data.metadata.durationSec,
    now,
  );
  if (!window) {
    return NextResponse.json({ error: "Interaction is outside its scheduled window" }, { status: 409 });
  }
  const run = await getDb().liveInteractionRun.upsert({
    where: { liveId_sourceEventId: { liveId: data.liveId, sourceEventId: event.id } },
    create: {
      vendorId: data.vendorId,
      liveId: data.liveId,
      source: "script",
      sourceEventId: event.id,
      eventType: event.eventType,
      title: normalized.data.title,
      configuration: normalized.data.metadata as unknown as Prisma.InputJsonValue,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    },
    update: {},
    select: { id: true },
  });
  return NextResponse.json({ run: await projectRun(run.id, participantHash) }, { headers: { "Cache-Control": "private, no-store" } });
}

/** 投票選項與抽獎口號的驗證共用同一份正規化設定。 */
function invalidInteractionValueResponse(metadata: AdvancedInteractionMetadata, value: z.infer<typeof RespondRequest>["value"], submittedValue: string[]) {
  if (metadata.kind === "poll") {
    const uniqueValues = [...new Set(submittedValue)];
    const maxSelections = metadata.selectionMode === "multiple" ? (metadata.maxSelections ?? metadata.options.length) : 1;
    if (uniqueValues.length !== submittedValue.length || uniqueValues.length > maxSelections || uniqueValues.some((value) => !metadata.options.some(({ id }) => id === value))) {
      return NextResponse.json({ error: "Invalid poll option" }, { status: 400 });
    }
  } else if (Array.isArray(value)) {
    return NextResponse.json({ error: "Invalid interaction value" }, { status: 400 });
  }
  if (metadata.kind === "lucky_draw") {
    const isSloganMode = !metadata.eligibility || metadata.eligibility === "slogan";
    if (isSloganMode && value !== metadata.slogan) {
      return NextResponse.json({ error: "Draw slogan does not match" }, { status: 400 });
    }
  }

  return null;
}

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "live-interactions", 60, 60_000);
  if (limited) return limited;
  const parsed = RequestBody.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid interaction request" }, { status: 400 });
  const data = parsed.data;
  const viewer = await admittedViewer(request, data.vendorId, data.liveId);
  if (!viewer) return NextResponse.json({ error: "Viewer admission required" }, { status: 401 });

  if (data.action === "ask_question") {
    const body = normalizeLiveQuestionBody(data.body);
    const displayName = normalizeLiveQuestionDisplayName(data.displayName);
    if (!body) return NextResponse.json({ error: "Invalid question" }, { status: 400 });
    const live = await getDb().live.findFirst({ where: { id: data.liveId, vendorId: data.vendorId, status: "live" }, select: { id: true } });
    if (!live) return NextResponse.json({ error: "Live unavailable" }, { status: 409 });
    const question = await getDb().$transaction(async (tx) => {
      const recentCount = await tx.liveQuestion.count({
        where: { vendorId: data.vendorId, liveId: data.liveId, participantHash: viewer.participantHash, createdAt: { gt: new Date(Date.now() - 60_000) } },
      });
      if (recentCount >= 3) return null;
      return tx.liveQuestion.create({
        data: { vendorId: data.vendorId, liveId: data.liveId, participantHash: viewer.participantHash, displayName, body },
        select: { id: true, status: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!question) return NextResponse.json({ error: "Question rate limit exceeded" }, { status: 429 });
    return NextResponse.json({ question }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  }

  if (data.action === "open") return openScheduledInteraction(data, viewer.participantHash);

  const run = await getDb().liveInteractionRun.findFirst({
    where: { id: data.runId, vendorId: data.vendorId, liveId: data.liveId, status: "active", endsAt: { gt: new Date() } },
  });
  const metadata = run ? configuration(run.configuration) : null;
  if (!run || !metadata) return NextResponse.json({ error: "Interaction closed" }, { status: 409 });
  const submittedValue = Array.isArray(data.value) ? data.value : [data.value];
  const invalidValueResponse = invalidInteractionValueResponse(metadata, data.value, submittedValue);
  if (invalidValueResponse) return invalidValueResponse;

  let bearer: string | null = null;
  try {
    await getDb().$transaction(async (tx) => {
      const purchasedRegistrationId = metadata.kind === "lucky_draw" && metadata.eligibility === "purchased"
        ? await verifiedPurchasedDrawRegistration(tx, request, { vendorId: run.vendorId, liveId: run.liveId })
        : null;
      if (metadata.kind === "lucky_draw" && metadata.eligibility === "purchased" && !purchasedRegistrationId) {
        throw new Error("PURCHASED_ELIGIBILITY_REQUIRED");
      }
      if (metadata.kind === "flash_voucher") {
        const claimed = await tx.liveInteractionResponse.count({ where: { runId: run.id } });
        if (claimed >= metadata.maxClaims) throw new Error("VOUCHER_SOLD_OUT");
        bearer = createInteractionBearer();
      }
      await tx.liveInteractionResponse.create({
        data: {
          vendorId: run.vendorId,
          liveId: run.liveId,
          runId: run.id,
          participantHash: viewer.participantHash,
          eventType: run.eventType,
          value: metadata.kind === "poll" && submittedValue.length > 1 ? JSON.stringify(submittedValue) : submittedValue[0]!,
          displayName: data.displayName,
          ...(purchasedRegistrationId ? { formSubmissionId: purchasedRegistrationId } : {}),
          ...(bearer ? {
            claimTokenHash: hashInteractionBearer(bearer),
            productId: metadata.kind === "flash_voucher" ? metadata.productId : null,
            expiresAt: new Date(Math.min(run.endsAt.getTime() + FLASH_VOUCHER_TTL_MS, Date.now() + FLASH_VOUCHER_TTL_MS)),
          } : {}),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Already responded" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "VOUCHER_SOLD_OUT") {
      return NextResponse.json({ error: "Voucher sold out" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "PURCHASED_ELIGIBILITY_REQUIRED") {
      return NextResponse.json({ error: "Purchased eligibility required" }, { status: 403 });
    }
    throw error;
  }
  const response = NextResponse.json({ run: await projectRun(run.id, viewer.participantHash) }, { headers: { "Cache-Control": "private, no-store" } });
  if (bearer) response.cookies.set(FLASH_VOUCHER_COOKIE, bearer, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: FLASH_VOUCHER_TTL_MS / 1_000,
  });
  return response;
}
