import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { toSlug } from "@/lib/format";
import { isLiveSlugTaken } from "@/lib/live-slug";
import {
  type LiveStudioDraftPayload,
  SaveLiveStudioDraftRequestSchema,
} from "@/lib/live-studio-draft";
import { requireMerchantApiActor } from "@/lib/merchant-api-security";

export const runtime = "nodejs";
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const authorization = await requireMerchantApiActor(request);
  if (authorization.response) return authorization.response;

  const parsed = SaveLiveStudioDraftRequestSchema.safeParse(await readJsonBody(request, 96 * 1024));
  if (!parsed.success || Boolean(parsed.data.draftId) !== (parsed.data.revision !== null)) {
    return error("INVALID_DRAFT", 400);
  }

  const db = getDb();
  const liveId = parsed.data.liveId || null;
  if (liveId) {
    const live = await db.live.findFirst({
      where: { id: liveId, vendorId: authorization.actor.vendorId },
      select: { id: true },
    });
    if (!live) return error("INVALID_LIVE", 400);
  }
  // 草稿存檔時順便檢查直播網址，讓使用者在填表時就看到撞名提示（僅回傳是否被使用）。
  const slugCheck = await checkSlug(db, parsed.data.payload.slug, liveId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS);
  const payload = parsed.data.payload as Prisma.InputJsonValue;

  try {
    if (!parsed.data.draftId) {
      if (liveId) {
        const revived = await db.liveStudioDraft.updateManyAndReturn({
          where: {
            vendorId: authorization.actor.vendorId,
            liveId,
            OR: [
              { expiresAt: { lte: now } },
              { consumedAt: { not: null } },
            ],
          },
          data: {
            payload,
            revision: { increment: 1 },
            consumedAt: null,
            updatedByMemberId: authorization.actor.memberId,
            expiresAt,
          },
          select: { id: true, revision: true, updatedAt: true },
        });
        const [revivedDraft, ...additionalRevivedDrafts] = revived;
        if (revivedDraft && additionalRevivedDrafts.length === 0) {
          return NextResponse.json(envelope(revivedDraft, parsed.data.payload, slugCheck));
        }
        if (additionalRevivedDrafts.length > 0) return error("DRAFT_CONFLICT", 409);
      }
      const created = await db.liveStudioDraft.create({
        data: {
          vendorId: authorization.actor.vendorId,
          liveId,
          payload,
          updatedByMemberId: authorization.actor.memberId,
          expiresAt,
        },
        select: { id: true, revision: true, updatedAt: true },
      });
      return NextResponse.json(envelope(created, parsed.data.payload, slugCheck));
    }

    const revision = parsed.data.revision;
    if (revision === null) return error("INVALID_DRAFT", 400);

    const updated = await db.liveStudioDraft.updateManyAndReturn({
      where: {
        id: parsed.data.draftId,
        vendorId: authorization.actor.vendorId,
        ...(parsed.data.overwrite ? {} : { revision }),
        liveId,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        payload,
        revision: { increment: 1 },
        updatedByMemberId: authorization.actor.memberId,
        expiresAt,
      },
      select: { id: true, revision: true, updatedAt: true },
    });
    const [updatedDraft] = updated;
    if (!updatedDraft || updated.length !== 1) return error("DRAFT_CONFLICT", 409);
    return NextResponse.json(envelope(updatedDraft, parsed.data.payload, slugCheck));
  } catch (reason) {
    if (liveId && isUniqueConstraint(reason)) return error("DRAFT_CONFLICT", 409);
    return error("DRAFT_SAVE_FAILED", 500);
  }
}

/** 撞名檢查失敗時不能影響草稿存檔：回報「無法檢查」，由送出時的檢查把關。 */
async function checkSlug(db: ReturnType<typeof getDb>, rawSlug: string, liveId: string | null) {
  const slug = toSlug(rawSlug);
  if (!slug) return { slugTaken: false, slugCheckFailed: false };
  try {
    return { slugTaken: await isLiveSlugTaken(db, slug, liveId), slugCheckFailed: false };
  } catch {
    return { slugTaken: false, slugCheckFailed: true };
  }
}

function isUniqueConstraint(reason: unknown) {
  return Boolean(reason && typeof reason === "object" && "code" in reason && reason.code === "P2002");
}

function envelope(
  record: { id: string; revision: number; updatedAt: Date },
  payload: LiveStudioDraftPayload,
  slugCheck: { slugTaken: boolean; slugCheckFailed: boolean },
) {
  return {
    id: record.id,
    revision: record.revision,
    payload,
    updatedAt: record.updatedAt.toISOString(),
    slugTaken: slugCheck.slugTaken,
    slugCheckFailed: slugCheck.slugCheckFailed,
  };
}

function error(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
