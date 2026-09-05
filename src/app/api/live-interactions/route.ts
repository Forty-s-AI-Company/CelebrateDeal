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
  pollPercentagesFromCounts,
} from "@/lib/live-interaction";
import {
  hasActiveLiveViewerSession,
  hashLiveViewerToken,
  liveViewerTokenFromRequest,
} from "@/lib/live-quota-admission";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveLiveRuntime } from "@/lib/live-runtime-state";

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
  value: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(80).optional(),
}).strict();
const RequestBody = z.discriminatedUnion("action", [OpenRequest, RespondRequest]);

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
      ? getDb().liveInteractionResponse.findUnique({ where: { id: run.winnerResponseId }, select: { id: true, displayName: true } })
      : Promise.resolve(null),
  ]);
  const countMap = new Map(pollCounts.map((row) => [row.value, row._count._all]));
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
    winnerIsViewer: Boolean(run.winnerResponseId && ownResponse?.id === run.winnerResponseId),
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
  const runs = await getDb().liveInteractionRun.findMany({
    where: {
      vendorId,
      liveId,
      source: "manual",
      OR: [{ status: "active", endsAt: { gt: now } }, { winnerResponseId: { not: null }, updatedAt: { gt: new Date(now.getTime() - 30_000) } }],
    },
    orderBy: { startsAt: "desc" },
    take: 3,
    select: { id: true },
  });
  const projected = await Promise.all(runs.map(({ id }) => projectRun(id, viewer.participantHash)));
  return NextResponse.json({ runs: projected.filter(Boolean) }, { headers: { "Cache-Control": "private, no-store" } });
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

  if (data.action === "open") {
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
    if (!event || !["lucky_draw", "poll", "flash_voucher"].includes(event.eventType)) {
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
    return NextResponse.json({ run: await projectRun(run.id, viewer.participantHash) }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const run = await getDb().liveInteractionRun.findFirst({
    where: { id: data.runId, vendorId: data.vendorId, liveId: data.liveId, status: "active", endsAt: { gt: new Date() } },
  });
  const metadata = run ? configuration(run.configuration) : null;
  if (!run || !metadata) return NextResponse.json({ error: "Interaction closed" }, { status: 409 });
  if (metadata.kind === "poll" && !metadata.options.some(({ id }) => id === data.value)) {
    return NextResponse.json({ error: "Invalid poll option" }, { status: 400 });
  }
  if (metadata.kind === "lucky_draw" && data.value !== metadata.slogan) {
    return NextResponse.json({ error: "Draw slogan does not match" }, { status: 400 });
  }

  let bearer: string | null = null;
  try {
    await getDb().$transaction(async (tx) => {
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
          value: data.value,
          displayName: data.displayName,
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
