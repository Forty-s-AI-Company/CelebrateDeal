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
function signature(payload: string, scope: Scope) {
  const purpose = `live-private-chat-cursor:${JSON.stringify([scope.vendorId, scope.liveId, scope.submissionId])}`;
  return createHmac("sha256", deriveSensitiveDataKey(purpose)).update(payload).digest("base64url");
}
function encodeCursor(row: LivePrivateChatMessage, scope: Scope) {
  const payload = Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");
  return `${payload}.${signature(payload, scope)}`;
}
function decodeCursor(value: string, scope: Scope) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value)) throw new LiveChatError("invalid_cursor");
  const [payload, supplied] = value.split(".");
  const expected = Buffer.from(signature(payload, scope)), actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new LiveChatError("invalid_cursor");
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || typeof decoded[1] !== "string"
      || !/^[a-f0-9]{64}$/u.test(decoded[1])) throw new Error("invalid");
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
    return { messages: page.map(row => dto(row, scope)).reverse(), nextCursor: rows.length > 50 ? encodeCursor(page[49], scope) : null };
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
