import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient, LivePrivateChatMessage } from "@prisma/client";
import { LiveChatError, resolveVerifiedPrivateChatViewer } from "./live-chat";
import { PrivateViewerChatPost, PrivateViewerChatQuery, type PrivateChatMessageDto } from "./live-private-chat-contract";
import { decryptPrivateChatBody, encryptPrivateChatBody, normalizePrivateChatBody, privateChatMessageId } from "./live-private-chat-storage";
import { normalizeClientIp } from "./request-client-ip";
import { deriveSensitiveDataKey } from "./sensitive-data";

type Proof = { admissionToken: string | null; chatSessionToken: string | null; ipAddress: string | null; now?: Date };
type Scope = { vendorId: string; liveId: string; submissionId: string };
type Database = Pick<PrismaClient, "$transaction">;
const storageScope = (row: LivePrivateChatMessage) => ({
  vendorId: row.vendorId, liveId: row.liveId, submissionId: row.formSubmissionId,
  messageId: row.id, source: row.source as "viewer" | "instructor",
});
function dto(row: LivePrivateChatMessage, scope: Scope): PrivateChatMessageDto {
  if (row.vendorId !== scope.vendorId || row.liveId !== scope.liveId || row.formSubmissionId !== scope.submissionId
    || !["viewer", "instructor"].includes(row.source)) throw new LiveChatError("access_denied");
  return { id: row.id, source: row.source as "viewer" | "instructor", body: decryptPrivateChatBody(row.bodyEncrypted, storageScope(row)), createdAt: row.createdAt.toISOString() };
}
function signature(payload: string, scope: Scope, kind = "message") {
  const purpose = `live-private-chat-cursor:${JSON.stringify([kind, scope.vendorId, scope.liveId, scope.submissionId])}`;
  return createHmac("sha256", deriveSensitiveDataKey(purpose)).update(payload).digest("base64url");
}
function encodeCursor(row: { createdAt: Date; id: string }, scope: Scope, kind = "message") {
  const payload = Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");
  return `${payload}.${signature(payload, scope, kind)}`;
}
function decodeCursor(value: string, scope: Scope, kind = "message") {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value)) throw new LiveChatError("invalid_cursor");
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied) throw new LiveChatError("invalid_cursor");
  const expected = Buffer.from(signature(payload, scope, kind)), actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new LiveChatError("invalid_cursor");
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || typeof decoded[1] !== "string"
      || !(kind === "message" ? /^[a-f0-9]{64}$/u : /^[A-Za-z0-9_-]{1,128}$/u).test(decoded[1])) throw new Error("invalid");
    const date = new Date(decoded[0]);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== decoded[0]) throw new Error("invalid");
    return { createdAt: date, id: decoded[1] };
  } catch { throw new LiveChatError("invalid_cursor"); }
}

export async function listPrivateViewerChat(db: Database, input: { vendorId: string; liveId: string; cursor?: string } & Proof) {
  const query = PrivateViewerChatQuery.parse({ vendorId: input.vendorId, liveId: input.liveId, ...(input.cursor ? { cursor: input.cursor } : {}) });
  return db.$transaction(async tx => {
    const scope = await resolveVerifiedPrivateChatViewer(tx, input);
    const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
    const rows = await tx.livePrivateChatMessage.findMany({
      where: { vendorId: scope.vendorId, liveId: scope.liveId, formSubmissionId: scope.submissionId,
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
    });
    const page = rows.slice(0, 50);
    const boundary = page.at(-1);
    return { messages: page.map(row => dto(row, scope)).reverse(), nextCursor: rows.length > 50 && boundary ? encodeCursor(boundary, scope) : null };
  }, { isolationLevel: "RepeatableRead" });
}

/** All retries re-read authorization inside the transaction before looking up
 * an existing UUID. Revoked identity cannot retrieve even a previous retry. */
export async function createPrivateViewerChat(db: Database, input: { vendorId: string; liveId: string; clientMessageId: string; body: string } & Proof) {
  const post = PrivateViewerChatPost.parse({ vendorId: input.vendorId, liveId: input.liveId, clientMessageId: input.clientMessageId, body: input.body });
  const body = normalizePrivateChatBody(post.body);
  if (!normalizeClientIp(input.ipAddress)) throw new LiveChatError("access_denied");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const scope = await resolveVerifiedPrivateChatViewer(tx, { ...input, body });
        const id = privateChatMessageId({ vendorId: scope.vendorId, liveId: scope.liveId, submissionId: scope.submissionId,
          source: "viewer", actorId: scope.submissionId, clientMessageId: post.clientMessageId });
        const existing = await tx.livePrivateChatMessage.findUnique({ where: { id } });
        if (existing) {
          const message = dto(existing, scope);
          if (message.source !== "viewer" || message.body !== body) throw new LiveChatError("idempotency_conflict");
          return { message, created: false };
        }
        const row = await tx.livePrivateChatMessage.create({ data: {
          id, vendorId: scope.vendorId, liveId: scope.liveId, formSubmissionId: scope.submissionId, source: "viewer",
          bodyEncrypted: encryptPrivateChatBody(body, { vendorId: scope.vendorId, liveId: scope.liveId,
            submissionId: scope.submissionId, messageId: id, source: "viewer" }),
        } });
        return { message: dto(row, scope), created: true };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable = typeof error === "object" && error !== null && "code" in error && ["P2002", "P2034"].includes(String(error.code));
      if (!retryable) throw error;
    }
  }
  throw new LiveChatError("transaction_conflict");
}

type Instructor = { vendorId: string; liveId: string; userId: string; memberId: string; sessionId: string };

/** Route-derived identity is revalidated against live membership and selected
 * project within the same database transaction as every private read/write. */
async function instructorScope(tx: Prisma.TransactionClient, input: Instructor, write: boolean) {
  PrivateViewerChatQuery.parse({ vendorId: input.vendorId, liveId: input.liveId });
  const session = await tx.userSession.findFirst({ where: {
    id: input.sessionId, userId: input.userId,
    revokedAt: null, expiresAt: { gt: new Date() }, user: { status: "active" },
  }, select: { vendorId: true, mfaVerifiedAt: true, user: { select: { mfaFactor: { select: { id: true } } } } } });
  if (!session || (session.user.mfaFactor && !session.mfaVerifiedAt)) throw new LiveChatError("access_denied");
  const memberships = await tx.vendorMember.findMany({ where: { userId: input.userId, status: "active" },
    orderBy: { createdAt: "asc" }, select: { id: true, vendorId: true, role: true } });
  // Match auth.chooseVendor for legacy sessions without a selected vendor.
  // Re-read the choice rather than letting the caller choose any membership.
  const member = memberships.find(candidate => candidate.vendorId === session.vendorId) ?? memberships[0];
  if (!member || member.id !== input.memberId || member.vendorId !== input.vendorId || !["owner", "admin"].includes(member.role)) throw new LiveChatError("access_denied");
  const preference = await tx.userOnboardingPreference.findUnique({
    where: { userId_vendorId: { userId: input.userId, vendorId: input.vendorId } },
    select: { selectedProject: { select: { id: true, status: true } } },
  });
  const selected = preference?.selectedProject?.status !== "archived" ? preference?.selectedProject : null;
  if (write && preference && !selected) throw new LiveChatError("access_denied");
  const live = await tx.live.findFirst({ where: { id: input.liveId, vendorId: input.vendorId,
    ...(selected ? { projectId: selected.id } : {}) }, select: { id: true, formId: true } });
  if (!live) throw new LiveChatError("access_denied");
  return live;
}

async function instructorConversation(tx: Prisma.TransactionClient, input: Instructor & { submissionId: string }, write: boolean) {
  const live = await instructorScope(tx, input, write);
  const submission = await tx.formSubmission.findFirst({ where: {
    id: input.submissionId, liveId: live.id, verificationStatus: "VERIFIED",
    form: { vendorId: input.vendorId }, ...(live.formId ? { formId: live.formId } : { id: "" }),
  }, select: { id: true } });
  if (!submission) throw new LiveChatError("access_denied");
  return { vendorId: input.vendorId, liveId: input.liveId, submissionId: submission.id };
}

export async function listPrivateInstructorConversations(db: Database, input: Instructor & { cursor?: string }) {
  PrivateViewerChatQuery.parse({ vendorId: input.vendorId, liveId: input.liveId, ...(input.cursor ? { cursor: input.cursor } : {}) });
  return db.$transaction(async tx => {
    const live = await instructorScope(tx, input, false);
    const scope = { vendorId: input.vendorId, liveId: input.liveId, submissionId: input.memberId };
    const cursor = input.cursor ? decodeCursor(input.cursor, scope, "conversation") : null;
    const rows = await tx.formSubmission.findMany({ where: {
      liveId: live.id, formId: live.formId ?? "", verificationStatus: "VERIFIED", form: { vendorId: input.vendorId },
      privateChatMessages: { some: { vendorId: input.vendorId, liveId: input.liveId } },
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    }, select: { id: true, name: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 });
    const page = rows.slice(0, 50);
    const boundary = page.at(-1);
    return { conversations: page.map(row => ({ submissionId: row.id, displayName: row.name.normalize("NFKC").trim().slice(0, 160) || "觀眾" })),
      nextCursor: rows.length > 50 && boundary ? encodeCursor(boundary, scope, "conversation") : null };
  }, { isolationLevel: "RepeatableRead" });
}

export async function listPrivateInstructorChat(db: Database, input: Instructor & { submissionId: string; cursor?: string }) {
  return db.$transaction(async tx => {
    const scope = await instructorConversation(tx, input, false);
    if (input.cursor && input.cursor.length > 256) throw new LiveChatError("invalid_cursor");
    const cursor = input.cursor ? decodeCursor(input.cursor, scope) : null;
    const rows = await tx.livePrivateChatMessage.findMany({ where: {
      vendorId: scope.vendorId, liveId: scope.liveId, formSubmissionId: scope.submissionId,
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 });
    const page = rows.slice(0, 50);
    const boundary = page.at(-1);
    return { messages: page.map(row => dto(row, scope)).reverse(), nextCursor: rows.length > 50 && boundary ? encodeCursor(boundary, scope) : null };
  }, { isolationLevel: "RepeatableRead" });
}

export async function createPrivateInstructorChat(db: Database, input: Instructor & { submissionId: string; body: string; clientMessageId: string }) {
  const post = PrivateViewerChatPost.parse({ vendorId: input.vendorId, liveId: input.liveId, body: input.body, clientMessageId: input.clientMessageId });
  const body = normalizePrivateChatBody(post.body);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const scope = await instructorConversation(tx, input, true);
        const id = privateChatMessageId({ ...scope, source: "instructor", actorId: input.memberId, clientMessageId: post.clientMessageId });
        const existing = await tx.livePrivateChatMessage.findUnique({ where: { id } });
        if (existing) {
          const message = dto(existing, scope);
          if (existing.authorMemberId !== input.memberId || message.source !== "instructor" || message.body !== body) throw new LiveChatError("idempotency_conflict");
          return { message, created: false };
        }
        const row = await tx.livePrivateChatMessage.create({ data: {
          id, vendorId: scope.vendorId, liveId: scope.liveId, formSubmissionId: scope.submissionId,
          source: "instructor", authorMemberId: input.memberId,
          bodyEncrypted: encryptPrivateChatBody(body, { ...scope, messageId: id, source: "instructor" }),
        } });
        return { message: dto(row, scope), created: true };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const retryable = typeof error === "object" && error !== null && "code" in error && ["P2002", "P2034"].includes(String(error.code));
      if (!retryable) throw error;
    }
  }
  throw new LiveChatError("transaction_conflict");
}
