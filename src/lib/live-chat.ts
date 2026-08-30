import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { BlacklistIdentifierType, matchesBlacklistKeyword, normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE, verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import type { ViewerRuntimeMessage as ContractViewerRuntimeMessage } from "@/lib/live-chat-contract";
import { hashLiveViewerToken, hasActiveLiveViewerSession } from "@/lib/live-quota-admission";
import { normalizeClientIp } from "@/lib/request-client-ip";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

export const LIVE_CHAT_PAGE_SIZE = 50;
export const LIVE_CHAT_CURSOR_MAX_LENGTH = 256;
export const LIVE_CHAT_CURSOR_PURPOSE = "live-chat-cursor";

const MAX_DISPLAY_NAME_LENGTH = 160;
const CHAT_COOKIE_MAX_LENGTH = 320;
const LIVE_VIEWER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = z.string().uuid();

export const ViewerChatQuerySchema = z.object({
  vendorId: z.string().trim().min(1).max(128),
  liveId: z.string().trim().min(1).max(128),
  cursor: z.string().trim().min(1).max(LIVE_CHAT_CURSOR_MAX_LENGTH).optional(),
}).strict();

export const ViewerChatPostSchema = z.object({
  vendorId: z.string().trim().min(1).max(128),
  liveId: z.string().trim().min(1).max(128),
  clientMessageId: UUID_PATTERN,
  body: z.string().trim().min(1).max(1_000),
}).strict();

export type ViewerChatQuery = z.infer<typeof ViewerChatQuerySchema>;
export type ViewerChatPost = z.infer<typeof ViewerChatPostSchema>;

export type ViewerRuntimeMessage = ContractViewerRuntimeMessage;

export type ViewerChatListResult = {
  messages: ViewerRuntimeMessage[];
  nextCursor: string | null;
  viewer: {
    canPost: boolean;
    displayName: string | null;
    reason: "verification_required" | "blocked" | null;
  };
};

export type ViewerChatCreateResult = {
  message: ViewerRuntimeMessage;
  created: boolean;
};

export class LiveChatError extends Error {
  constructor(
    public readonly code:
      | "access_denied"
      | "blocked"
      | "keyword_blocked"
      | "idempotency_conflict"
      | "transaction_conflict"
      | "invalid_cursor",
  ) {
    super(code);
    this.name = "LiveChatError";
  }
}

type StoredViewerMessage = {
  id: string;
  vendorId: string;
  liveId: string;
  formSubmissionId: string | null;
  roleId: string | null;
  authorName: string;
  body: string;
  source: string;
  status: string;
  isSimulated: boolean;
  createdAt: Date;
};

type LiveChatModels = Pick<
  PrismaClient,
  "formSubmission" | "liveViewerSession" | "blacklist" | "liveChatMessage"
>;

type LiveChatDatabase = LiveChatModels & Pick<PrismaClient, "$transaction">;

type ViewerChatContext = {
  submission: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
  };
  admissionToken: string;
};

type ViewerChatAdmissionContext = {
  admissionToken: string;
};

type CursorValue = {
  createdAt: Date;
  id: string;
};

function isPrismaCode(error: unknown, code: string) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function normalizeViewerBody(value: string) {
  const normalized = value.normalize("NFKC").trim();
  return normalized && Array.from(normalized).length <= 1_000 ? normalized : null;
}

function normalizeDisplayName(value: string) {
  const normalized = value.normalize("NFKC").trim();
  return normalized && Array.from(normalized).length <= MAX_DISPLAY_NAME_LENGTH ? normalized : "觀眾";
}

function readCookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie");
  if (!header || header.length > 8_192) return null;
  let found: string | null = null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    if (found !== null) return null;
    const rawValue = segment.slice(separator + 1).trim();
    try {
      found = decodeURIComponent(rawValue);
    } catch {
      return null;
    }
  }
  return found;
}

export function formSubmissionChatSessionTokenFromRequest(request: Request) {
  const token = readCookieValue(request, FORM_SUBMISSION_CHAT_SESSION_COOKIE);
  return token && token.length <= CHAT_COOKIE_MAX_LENGTH ? token : null;
}

// Short alias for route and consumer code that refers to the fss1 claim as a
// chat session token rather than repeating the cookie's storage name.
export const chatSessionTokenFromRequest = formSubmissionChatSessionTokenFromRequest;

function cursorSignature(payload: string) {
  return createHmac("sha256", deriveSensitiveDataKey(LIVE_CHAT_CURSOR_PURPOSE))
    .update(payload)
    .digest("base64url");
}

export function encodeLiveChatCursor(value: CursorValue) {
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    createdAt: value.createdAt.toISOString(),
    id: value.id,
  }), "utf8").toString("base64url");
  return `${payload}.${cursorSignature(payload)}`;
}

export function decodeLiveChatCursor(value: string | undefined): CursorValue | null {
  if (!value || value.length > LIVE_CHAT_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }
  const [payload, suppliedSignature] = value.split(".");
  if (!payload || !suppliedSignature || suppliedSignature.length !== 43) return null;

  let expectedSignature: string;
  try {
    expectedSignature = cursorSignature(payload);
  } catch {
    return null;
  }
  const expected = Buffer.from(expectedSignature, "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      version?: unknown;
      createdAt?: unknown;
      id?: unknown;
    };
    if (decoded.version !== 1 || typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") return null;
    if (decoded.id.length < 1 || decoded.id.length > 128) return null;
    const createdAt = new Date(decoded.createdAt);
    if (!Number.isFinite(createdAt.getTime())) return null;
    return { createdAt, id: decoded.id };
  } catch {
    return null;
  }
}

export function buildViewerChatMessageId(input: {
  vendorId: string;
  liveId: string;
  submissionId: string;
  clientMessageId: string;
}) {
  const canonical = JSON.stringify([input.vendorId, input.liveId, input.submissionId, input.clientMessageId]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function messageSelect() {
  return {
    id: true,
    vendorId: true,
    liveId: true,
    formSubmissionId: true,
    roleId: true,
    authorName: true,
    body: true,
    source: true,
    status: true,
    isSimulated: true,
    createdAt: true,
  } as const;
}

function toViewerRuntimeMessage(message: StoredViewerMessage): ViewerRuntimeMessage | null {
  if (
    !message.id
    || message.id.length > 128
    || typeof message.authorName !== "string"
    || typeof message.body !== "string"
    || message.source !== "viewer"
    || message.status !== "visible"
    || message.isSimulated !== false
    || message.roleId !== null
    || !message.formSubmissionId
  ) return null;

  const body = normalizeViewerBody(message.body);
  if (!body) return null;
  const createdAt = message.createdAt instanceof Date ? message.createdAt : new Date(message.createdAt);
  if (!Number.isFinite(createdAt.getTime())) return null;

  return {
    id: message.id,
    source: "viewer",
    createdAt: createdAt.toISOString(),
    body,
    actor: { name: normalizeDisplayName(message.authorName) },
  };
}

function sameIdempotentMessage(
  existing: StoredViewerMessage,
  input: { id: string; vendorId: string; liveId: string; submissionId: string; body: string; source: "viewer" },
) {
  return existing.id === input.id
    && existing.vendorId === input.vendorId
    && existing.liveId === input.liveId
    && existing.formSubmissionId === input.submissionId
    && existing.roleId === null
    && existing.source === input.source
    && existing.isSimulated === false
    && normalizeViewerBody(existing.body) === input.body;
}

async function resolveViewerAdmissionContext(
  database: LiveChatModels,
  input: { vendorId: string; liveId: string; admissionToken: string | null; now?: Date },
): Promise<ViewerChatAdmissionContext> {
  if (!input.admissionToken || !LIVE_VIEWER_TOKEN_PATTERN.test(input.admissionToken)) {
    throw new LiveChatError("access_denied");
  }

  const activeAdmission = await hasActiveLiveViewerSession(database as unknown as PrismaClient, {
    vendorId: input.vendorId,
    liveId: input.liveId,
    token: input.admissionToken,
    now: input.now,
  });
  if (!activeAdmission) throw new LiveChatError("access_denied");

  return { admissionToken: input.admissionToken };
}

async function resolveVerifiedViewerContext(
  database: LiveChatModels,
  input: { vendorId: string; liveId: string; chatSessionToken: string | null; now?: Date },
  admission: ViewerChatAdmissionContext,
): Promise<ViewerChatContext | null> {
  if (!input.chatSessionToken) return null;

  let claim: ReturnType<typeof verifyFormSubmissionChatSessionToken>;
  try {
    claim = verifyFormSubmissionChatSessionToken(input.chatSessionToken, input.now ?? new Date());
  } catch {
    claim = null;
  }
  if (!claim) return null;

  const submission = await database.formSubmission.findFirst({
    where: {
      id: claim.submissionId,
      liveId: input.liveId,
      verificationStatus: "VERIFIED",
      form: { vendorId: input.vendorId },
      live: { id: input.liveId, vendorId: input.vendorId },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      formId: true,
      live: { select: { formId: true } },
    },
  });
  if (!submission || !submission.live || submission.live.formId !== submission.formId) return null;

  return {
    submission: {
      id: submission.id,
      name: submission.name,
      email: submission.email,
      phone: submission.phone,
    },
    admissionToken: admission.admissionToken,
  };
}

async function activeBlacklists(database: LiveChatModels, vendorId: string) {
  return database.blacklist.findMany({
    where: {
      vendorId,
      isActive: true,
      identifierType: { in: ["email", "phone", "ip", "visitor_id", "keyword"] },
    },
    select: { identifier: true, identifierType: true },
  });
}

function isIdentityBlocked(
  rows: Array<{ identifier: string; identifierType: string }>,
  input: { email: string; phone: string | null; ip: string | null; visitorId: string },
) {
  const current = {
    email: normalizeBlacklistIdentifier("email", input.email),
    phone: input.phone ? normalizeBlacklistIdentifier("phone", input.phone) : null,
    ip: input.ip ? normalizeBlacklistIdentifier("ip", input.ip) : null,
    visitor_id: normalizeBlacklistIdentifier("visitor_id", input.visitorId),
  };

  return rows.some((row) => {
    if (row.identifierType === "keyword") return false;
    const parsedType = BlacklistIdentifierType.safeParse(row.identifierType);
    if (!parsedType.success || !(parsedType.data in current)) return false;
    const stored = normalizeBlacklistIdentifier(parsedType.data, row.identifier);
    return stored !== null && stored === current[parsedType.data as keyof typeof current];
  });
}

function isKeywordBlocked(rows: Array<{ identifier: string; identifierType: string }>, body: string) {
  return rows.some((row) => row.identifierType === "keyword" && matchesBlacklistKeyword(body, row.identifier));
}

async function assertViewerIdentityAllowed(
  database: LiveChatModels,
  context: ViewerChatContext,
  vendorId: string,
  ip: string | null,
) {
  const rows = await activeBlacklists(database, vendorId);
  if (isIdentityBlocked(rows, {
    email: context.submission.email,
    phone: context.submission.phone,
    ip,
    visitorId: hashLiveViewerToken(context.admissionToken),
  })) throw new LiveChatError("blocked");
  return rows;
}

async function findExistingMessage(database: LiveChatModels, id: string) {
  return database.liveChatMessage.findUnique({
    where: { id },
    select: messageSelect(),
  }) as Promise<StoredViewerMessage | null>;
}

export async function listViewerChatMessages(
  database: LiveChatDatabase,
  input: ViewerChatQuery & {
    chatSessionToken: string | null;
    admissionToken: string | null;
    ipAddress?: string | null;
    now?: Date;
  },
): Promise<ViewerChatListResult> {
  const admission = await resolveViewerAdmissionContext(database, input);
  const context = await resolveVerifiedViewerContext(database, input, admission);
  const blacklistRows = context ? await activeBlacklists(database, input.vendorId) : [];
  const blocked = context
    ? isIdentityBlocked(blacklistRows, {
        email: context.submission.email,
        phone: context.submission.phone,
        ip: normalizeClientIp(input.ipAddress ?? null),
        visitorId: hashLiveViewerToken(context.admissionToken),
      })
    : false;

  const cursor = input.cursor ? decodeLiveChatCursor(input.cursor) : null;
  if (input.cursor && !cursor) throw new LiveChatError("invalid_cursor");

  const rows = await database.liveChatMessage.findMany({
    where: {
      vendorId: input.vendorId,
      liveId: input.liveId,
      source: "viewer",
      status: "visible",
      ...(cursor ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      } : {}),
    },
    select: messageSelect(),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIVE_CHAT_PAGE_SIZE + 1,
  }) as unknown as StoredViewerMessage[];

  const hasMore = rows.length > LIVE_CHAT_PAGE_SIZE;
  const pageRows = rows.slice(0, LIVE_CHAT_PAGE_SIZE);
  const messages = pageRows.map(toViewerRuntimeMessage).filter((message): message is ViewerRuntimeMessage => message !== null).reverse();
  const oldest = pageRows[pageRows.length - 1];

  return {
    messages,
    nextCursor: hasMore && oldest ? encodeLiveChatCursor({ createdAt: oldest.createdAt, id: oldest.id }) : null,
    viewer: {
      canPost: Boolean(context && !blocked),
      displayName: context ? normalizeDisplayName(context.submission.name) : null,
      reason: !context ? "verification_required" : blocked ? "blocked" : null,
    },
  };
}

export async function createViewerChatMessage(
  database: LiveChatDatabase,
  input: ViewerChatPost & {
    chatSessionToken: string | null;
    admissionToken: string | null;
    ipAddress?: string | null;
    now?: Date;
  },
): Promise<ViewerChatCreateResult> {
  const body = normalizeViewerBody(input.body);
  if (!body) throw new LiveChatError("access_denied");

  // A POST must have an ingress-resolved address. A missing or malformed
  // address is intentionally indistinguishable from other access failures so
  // callers cannot probe deployment trust configuration.
  const ipAddress = normalizeClientIp(input.ipAddress ?? null);
  if (!ipAddress) throw new LiveChatError("access_denied");

  type IdempotencyInput = {
    id: string;
    vendorId: string;
    liveId: string;
    submissionId: string;
    body: string;
    source: "viewer";
  };

  let attemptedIdempotency: IdempotencyInput | null = null;

  const reconcileP2002OutsideTransaction = async () => {
    const attempted = attemptedIdempotency;
    if (!attempted) throw new LiveChatError("transaction_conflict");

    // P2002 aborts the interactive transaction in PostgreSQL. This read must
    // use the base client after the failed transaction has fully rolled back.
    const raced = await findExistingMessage(database, attempted.id);
    if (!raced) throw new LiveChatError("transaction_conflict");
    if (!sameIdempotentMessage(raced, attempted)) {
      throw new LiveChatError("idempotency_conflict");
    }
    const message = toViewerRuntimeMessage(raced);
    if (!message) throw new LiveChatError("idempotency_conflict");
    return { message, created: false };
  };

  const runSerializableTransaction = async () => database.$transaction(async (tx) => {
    // Every attempt opens a fresh serializable transaction and re-reads the
    // authoritative admission, identity, blacklist and idempotency state.
    const admission = await resolveViewerAdmissionContext(tx, input);
    const context = await resolveVerifiedViewerContext(tx, input, admission);
    if (!context) throw new LiveChatError("access_denied");

    const id = buildViewerChatMessageId({
      vendorId: input.vendorId,
      liveId: input.liveId,
      submissionId: context.submission.id,
      clientMessageId: input.clientMessageId,
    });
    const idempotency: IdempotencyInput = {
      id,
      vendorId: input.vendorId,
      liveId: input.liveId,
      submissionId: context.submission.id,
      body,
      source: "viewer",
    };
    attemptedIdempotency = idempotency;

    // Idempotency is checked before moderation so a retry of an already-created
    // message cannot fail merely because a new blacklist rule was added later.
    const existing = await findExistingMessage(tx, id);
    if (existing) {
      if (!sameIdempotentMessage(existing, idempotency)) throw new LiveChatError("idempotency_conflict");
      const message = toViewerRuntimeMessage(existing);
      if (!message) throw new LiveChatError("idempotency_conflict");
      return { message, created: false };
    }

    const rows = await assertViewerIdentityAllowed(tx, context, input.vendorId, ipAddress);
    if (isKeywordBlocked(rows, body)) throw new LiveChatError("keyword_blocked");

    const created = await tx.liveChatMessage.create({
      data: {
        id,
        vendorId: input.vendorId,
        liveId: input.liveId,
        formSubmissionId: context.submission.id,
        roleId: null,
        authorName: normalizeDisplayName(context.submission.name),
        body,
        source: "viewer",
        status: "visible",
        isSimulated: false,
      },
      select: messageSelect(),
    }) as unknown as StoredViewerMessage;
    const message = toViewerRuntimeMessage(created);
    if (!message) throw new Error("Created viewer chat message was not safe to project.");
    return { message, created: true };
  }, { isolationLevel: "Serializable" });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    attemptedIdempotency = null;
    try {
      return await runSerializableTransaction();
    } catch (error) {
      if (isPrismaCode(error, "P2002")) {
        return reconcileP2002OutsideTransaction();
      }
      if (!isPrismaCode(error, "P2034")) throw error;
      if (attempt === 3) throw new LiveChatError("transaction_conflict");
      // The next iteration starts a new transaction, so no identity,
      // admission, blacklist or idempotency result is reused.
    }
  }

  throw new LiveChatError("transaction_conflict");
}
