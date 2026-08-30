import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildViewerChatMessageId,
  createViewerChatMessage,
  decodeLiveChatCursor,
  encodeLiveChatCursor,
  listViewerChatMessages,
} from "@/lib/live-chat";
import { createFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { hashLiveViewerToken } from "@/lib/live-quota-admission";

const now = new Date("2026-08-17T00:00:00.000Z");
const chatToken = "chat-token";
const admissionToken = "A".repeat(43);

type FixtureMessage = {
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

type FixtureCreateArgs = { data: Omit<FixtureMessage, "createdAt"> };
type FixtureFindManyArgs = {
  where: {
    vendorId: string;
    liveId: string;
    source: string;
    status: string;
    OR?: Array<{ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } }>;
  };
};

function dbFixture() {
  const submission = {
    id: "submission-1",
    name: "王小明",
    email: "lead@example.test",
    phone: "0912345678",
    formId: "form-1",
    live: { formId: "form-1" },
  };
  const messages: FixtureMessage[] = [];
  const db = {
    formSubmission: { findFirst: vi.fn().mockResolvedValue(submission) },
    liveViewerSession: { findUnique: vi.fn().mockResolvedValue({ vendorId: "vendor-1", liveId: "live-1", expiresAt: new Date(now.getTime() + 90_000) }) },
    blacklist: { findMany: vi.fn().mockResolvedValue([]) },
    liveChatMessage: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => messages.find((message) => message.id === where.id) ?? null),
      findMany: vi.fn().mockImplementation(async () => messages.filter((message) => message.source === "viewer" && message.status === "visible")),
      create: vi.fn().mockImplementation(async ({ data }: FixtureCreateArgs) => {
        if (messages.some((message) => message.id === data.id)) throw { code: "P2002" };
        const created = { ...data, createdAt: now, updatedAt: now };
        messages.push(created);
        return created;
      }),
    },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (callback: (transaction: typeof db) => unknown) => callback(db));
  return { db, messages, submission };
}

function baseInput(token: string | null = chatToken) {
  return {
    vendorId: "vendor-1",
    liveId: "live-1",
    clientMessageId: "123e4567-e89b-12d3-a456-426614174000",
    body: "  歡迎大家  ",
    chatSessionToken: token,
    admissionToken,
    ipAddress: "203.0.113.5",
    now,
  };
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "live-chat-test-secret-longer-than-thirty-two-bytes");
});

describe("live chat domain", () => {
  it("creates a server-owned viewer message with a safe DTO and deterministic id", async () => {
    const { db, messages } = dbFixture();
    const result = await createViewerChatMessage(db as never, {
      ...baseInput(),
      chatSessionToken: createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) }),
    });

    expect(result.created).toBe(true);
    expect(result.message).toEqual({
      id: buildViewerChatMessageId({ vendorId: "vendor-1", liveId: "live-1", submissionId: "submission-1", clientMessageId: baseInput().clientMessageId }),
      source: "viewer",
      createdAt: now.toISOString(),
      body: "歡迎大家",
      actor: { name: "王小明" },
    });
    expect(messages[0]).toMatchObject({
      source: "viewer",
      roleId: null,
      formSubmissionId: "submission-1",
      authorName: "王小明",
      isSimulated: false,
      status: "visible",
    });
    expect(JSON.stringify(result)).not.toContain("lead@example.test");
    expect(JSON.stringify(result)).not.toContain("0912345678");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  it("lets an admitted but unverified viewer read, while keeping posting disabled", async () => {
    const { db } = dbFixture();
    const result = await listViewerChatMessages(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      chatSessionToken: null,
      admissionToken,
      now,
    });

    expect(result.viewer).toEqual({ canPost: false, displayName: null, reason: "verification_required" });
    expect(db.formSubmission.findFirst).not.toHaveBeenCalled();
  });

  it("keeps visible messages readable for a verified but blacklisted viewer", async () => {
    const { db, messages } = dbFixture();
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });
    messages.push({
      id: "visible-1",
      vendorId: "vendor-1",
      liveId: "live-1",
      formSubmissionId: "submission-1",
      roleId: null,
      authorName: "另一位觀眾",
      body: "大家好",
      source: "viewer",
      status: "visible",
      isSimulated: false,
      createdAt: now,
    });
    db.blacklist.findMany.mockResolvedValue([{ identifier: "lead@example.test", identifierType: "email" }]);

    const result = await listViewerChatMessages(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      chatSessionToken: token,
      admissionToken,
      ipAddress: "203.0.113.5",
      now,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.viewer).toEqual({ canPost: false, displayName: "王小明", reason: "blocked" });
  });

  it("returns the same row on retry before moderation and conflicts on different content", async () => {
    const { db } = dbFixture();
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });
    const input = { ...baseInput(), chatSessionToken: token };
    const first = await createViewerChatMessage(db as never, input);
    db.blacklist.findMany.mockResolvedValue([{ identifier: "歡迎", identifierType: "keyword" }]);

    await expect(createViewerChatMessage(db as never, input)).resolves.toMatchObject({ created: false, message: first.message });
    await expect(createViewerChatMessage(db as never, { ...input, body: "其他內容" })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(db.blacklist.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["email", { identifier: "lead@example.test", identifierType: "email" }],
    ["phone", { identifier: "0912345678", identifierType: "phone" }],
    ["ip", { identifier: "203.0.113.5", identifierType: "ip" }],
    ["visitor_id", { identifier: hashLiveViewerToken(admissionToken), identifierType: "visitor_id" }],
  ])("blocks an active %s blacklist without exposing its value", async (_type, row) => {
    const { db } = dbFixture();
    db.blacklist.findMany.mockResolvedValue([row]);
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });

    await expect(createViewerChatMessage(db as never, { ...baseInput(), chatSessionToken: token }))
      .rejects.toMatchObject({ code: "blocked" });
  });

  it("blocks literal normalized keywords and does not treat regex characters as regex", async () => {
    const { db } = dbFixture();
    db.blacklist.findMany.mockResolvedValue([{ identifier: "  foo.* ", identifierType: "keyword" }]);
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });

    await expect(createViewerChatMessage(db as never, { ...baseInput(), chatSessionToken: token, body: "FOO.*" }))
      .rejects.toMatchObject({ code: "keyword_blocked" });
    await expect(createViewerChatMessage(db as never, { ...baseInput(), chatSessionToken: token, body: "fooZZ" }))
      .resolves.toMatchObject({ created: true });
  });

  it("rejects forged, expired, wrong-live and old admission/session boundaries", async () => {
    const { db } = dbFixture();
    const input = baseInput("forged");
    await expect(createViewerChatMessage(db as never, input)).rejects.toMatchObject({ code: "access_denied" });

    const expired = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1_000) });
    await expect(createViewerChatMessage(db as never, { ...baseInput(), chatSessionToken: expired })).rejects.toMatchObject({ code: "access_denied" });

    db.liveViewerSession.findUnique.mockResolvedValue({ vendorId: "other-vendor", liveId: "live-1", expiresAt: new Date(now.getTime() + 90_000) });
    const valid = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });
    await expect(createViewerChatMessage(db as never, { ...baseInput(), chatSessionToken: valid })).rejects.toMatchObject({ code: "access_denied" });

    db.liveViewerSession.findUnique.mockResolvedValue({ vendorId: "vendor-1", liveId: "live-1", expiresAt: new Date(now.getTime() - 1) });
    await expect(createViewerChatMessage(db as never, { ...baseInput(), chatSessionToken: valid })).rejects.toMatchObject({ code: "access_denied" });

    db.liveViewerSession.findUnique.mockResolvedValue({ vendorId: "vendor-1", liveId: "live-1", expiresAt: new Date(now.getTime() + 90_000) });
    db.formSubmission.findFirst.mockResolvedValue({
      id: "submission-1",
      name: "王小明",
      email: "lead@example.test",
      phone: "0912345678",
      formId: "form-other",
      live: { formId: "form-1" },
    });
    await expect(createViewerChatMessage(db as never, { ...baseInput(), chatSessionToken: valid })).rejects.toMatchObject({ code: "access_denied" });
  });

  it("fails closed when a POST has no ingress-resolved IP", async () => {
    const { db } = dbFixture();
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });
    await expect(createViewerChatMessage(db as never, { ...baseInput(), chatSessionToken: token, ipAddress: null }))
      .rejects.toMatchObject({ code: "access_denied" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("converges a P2002 race by rereading the existing row", async () => {
    const { db, messages } = dbFixture();
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });
    const input = { ...baseInput(), chatSessionToken: token };
    const id = buildViewerChatMessageId({ vendorId: "vendor-1", liveId: "live-1", submissionId: "submission-1", clientMessageId: input.clientMessageId });
    const raced = {
      id,
      vendorId: "vendor-1",
      liveId: "live-1",
      formSubmissionId: "submission-1",
      roleId: null,
      authorName: "王小明",
      body: "歡迎大家",
      source: "viewer",
      status: "visible",
      isSimulated: false,
      createdAt: now,
    } satisfies FixtureMessage;
    const transactionFindUnique = vi.fn().mockResolvedValue(null);
    const baseFindUnique = db.liveChatMessage.findUnique;
    db.$transaction.mockImplementationOnce(async (callback: (transaction: typeof db) => unknown) => callback({
      ...db,
      liveChatMessage: { ...db.liveChatMessage, findUnique: transactionFindUnique },
    }));
    db.liveChatMessage.create.mockRejectedValueOnce({ code: "P2002" });
    baseFindUnique.mockResolvedValueOnce(raced);
    messages.push(raced);

    await expect(createViewerChatMessage(db as never, input)).resolves.toMatchObject({ created: false, message: { id } });
    expect(transactionFindUnique).toHaveBeenCalledTimes(1);
    expect(baseFindUnique).toHaveBeenCalledTimes(1);
    expect(db.blacklist.findMany).toHaveBeenCalledTimes(1);
  });

  it("retries serializable conflicts three times with fresh authoritative reads", async () => {
    const { db } = dbFixture();
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });
    const input = { ...baseInput(), chatSessionToken: token };
    db.liveChatMessage.create
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" });

    await expect(createViewerChatMessage(db as never, input)).resolves.toMatchObject({ created: true });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(db.liveViewerSession.findUnique).toHaveBeenCalledTimes(3);
    expect(db.formSubmission.findFirst).toHaveBeenCalledTimes(3);
    expect(db.blacklist.findMany).toHaveBeenCalledTimes(3);
    expect(db.liveChatMessage.findUnique).toHaveBeenCalledTimes(3);
  });

  it("returns a generic transaction conflict after the third serializable failure", async () => {
    const { db } = dbFixture();
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });
    db.liveChatMessage.create.mockRejectedValue({ code: "P2034" });

    await expect(createViewerChatMessage(db as never, { ...baseInput(), chatSessionToken: token }))
      .rejects.toMatchObject({ code: "transaction_conflict" });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(db.liveViewerSession.findUnique).toHaveBeenCalledTimes(3);
    expect(db.formSubmission.findFirst).toHaveBeenCalledTimes(3);
  });

  it("lists only visible viewer rows, returns newest fifty ascending, and uses a signed bounded cursor", async () => {
    const { db, messages } = dbFixture();
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });
    for (let index = 0; index < 53; index += 1) {
      messages.push({
        id: `message-${index}`,
        vendorId: "vendor-1",
        liveId: "live-1",
        formSubmissionId: "submission-1",
        roleId: null,
        authorName: "王小明",
        body: `訊息 ${index}`,
        source: index === 51 ? "scheduled" : "viewer",
        status: index === 50 ? "hidden" : "visible",
        isSimulated: false,
        createdAt: new Date(now.getTime() + index * 1_000),
      });
    }
    db.liveChatMessage.findMany.mockImplementation(async ({ where }: FixtureFindManyArgs) => messages.filter((message) => {
      if (message.vendorId !== where.vendorId || message.liveId !== where.liveId || message.source !== "viewer" || message.status !== "visible") return false;
      if (!where.OR) return true;
      const cutoff = (where.OR[0] as { createdAt: { lt: Date } }).createdAt.lt;
      const tieBreakId = (where.OR[1] as { createdAt: Date; id: { lt: string } }).id.lt;
      return message.createdAt < cutoff || (message.createdAt.getTime() === cutoff.getTime() && message.id < tieBreakId);
    }).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id)).slice(0, 51));

    const result = await listViewerChatMessages(db as never, { vendorId: "vendor-1", liveId: "live-1", chatSessionToken: token, admissionToken, now });
    expect(result.messages).toHaveLength(50);
    expect(result.messages[0]?.body).toBe("訊息 1");
    expect(result.messages.at(-1)?.body).toBe("訊息 52");
    expect(result.nextCursor).toBeTruthy();
    expect(result.messages.some((message) => message.source !== "viewer")).toBe(false);
    expect(result.nextCursor && result.nextCursor.length <= 256).toBe(true);
    expect(result.nextCursor && decodeLiveChatCursor(result.nextCursor)).toBeTruthy();
  });

  it("uses the message id as the cursor tie-breaker for equal timestamps", async () => {
    const { db, messages } = dbFixture();
    const token = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date(now.getTime() - 1_000) });
    messages.push(...["message-a", "message-b"].map((id) => ({
      id,
      vendorId: "vendor-1",
      liveId: "live-1",
      formSubmissionId: "submission-1",
      roleId: null,
      authorName: "王小明",
      body: id,
      source: "viewer",
      status: "visible",
      isSimulated: false,
      createdAt: now,
    })));
    db.liveChatMessage.findMany.mockImplementation(async ({ where }: FixtureFindManyArgs) => {
      const cursor = where.OR?.[1] as { createdAt: Date; id: { lt: string } } | undefined;
      return messages
        .filter((message) => message.id === "message-a" || message.id === "message-b")
        .filter((message) => !cursor || (message.createdAt < (where.OR?.[0] as { createdAt: { lt: Date } }).createdAt.lt
          || (message.createdAt.getTime() === cursor.createdAt.getTime() && message.id < cursor.id.lt)))
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
    });

    const result = await listViewerChatMessages(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      chatSessionToken: token,
      admissionToken,
      cursor: encodeLiveChatCursor({ createdAt: now, id: "message-b" }),
      now,
    });

    expect(db.liveChatMessage.findMany.mock.calls[0]?.[0]?.where.OR).toEqual([
      { createdAt: { lt: now } },
      { createdAt: now, id: { lt: "message-b" } },
    ]);
    expect(result.messages.map((message) => message.id)).toEqual(["message-a"]);
  });

  it("encodes and rejects tampered cursors without exposing raw fields", () => {
    const cursor = encodeLiveChatCursor({ createdAt: now, id: "message-1" });
    expect(cursor).not.toContain("message-1");
    expect(decodeLiveChatCursor(cursor)).toEqual({ createdAt: now, id: "message-1" });
    expect(decodeLiveChatCursor(`${cursor.slice(0, -1)}x`)).toBeNull();
    expect(decodeLiveChatCursor("a".repeat(257))).toBeNull();
  });
});
