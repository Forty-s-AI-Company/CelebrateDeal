import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { classifyLocalTestDatabase } from "../../scripts/local-database-safety";
import { getDb } from "@/lib/db";
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { createInstructorChatMessage, createViewerChatMessage, listInstructorChatMessages, listViewerChatMessages } from "@/lib/live-chat";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";
import { GET as viewerGet, POST as viewerPost } from "@/app/api/live-chat/messages/route";
import { GET as instructorGet, POST as instructorPost } from "@/app/api/live-chat/instructor/route";

const boundary = vi.hoisted(() => ({ auth: vi.fn() }));
// 僅替換登入、可信 ingress IP 與 rate limiter；route、domain、DB 全部真實執行。
vi.mock("@/lib/auth", () => ({ getCurrentAuth: boundary.auth }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/request-client-ip", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/request-client-ip")>(),
  getRequestClientIp: () => "203.0.113.7",
}));

const enabled = process.env.RT01_D2_DISPOSABLE_DB === "true";
const databaseIsDisposable = classifyLocalTestDatabase(process.env.DATABASE_URL).safe;

// 僅建立具唯一識別的 disposable fixtures，不載入環境檔、不刪除既有資料。
async function fixture() {
  const db = getDb();
  const suffix = randomUUID();
  const now = new Date();
  const vendor = await db.vendor.create({ data: {
    name: "Private chat fixture", slug: `private-${suffix}`,
    email: `private-${suffix}@example.test`, passwordHash: "disposable-test-only",
  } });
  const form = await db.registrationForm.create({ data: {
    vendorId: vendor.id, name: "Private form", slug: `private-form-${suffix}`,
    headline: "Private chat", fields: [],
  } });
  const live = await db.live.create({ data: {
    vendorId: vendor.id, formId: form.id, title: "Private live",
    slug: `private-live-${suffix}`, scheduledAt: now,
  } });
  const viewers = await Promise.all(["A", "B"].map(async (name) => {
    const submission = await db.formSubmission.create({ data: {
      formId: form.id, liveId: live.id, name,
      email: `${name}-${suffix}@example.test`, verificationStatus: "VERIFIED",
    } });
    const admissionToken = randomBytes(32).toString("base64url");
    await db.liveViewerSession.create({ data: {
      vendorId: vendor.id, liveId: live.id, tokenHash: hashLiveViewerToken(admissionToken),
      lastSeenAt: now, expiresAt: new Date(now.getTime() + 90_000),
    } });
    return {
      submission,
      input: {
        vendorId: vendor.id, liveId: live.id, admissionToken,
        chatSessionToken: createFormSubmissionChatSessionToken({ submissionId: submission.id, now }),
        ipAddress: "203.0.113.7", now,
      },
    };
  }));
  return { db, vendor, form, live, viewers, instructor: { vendorId: vendor.id, liveId: live.id } };
}

describe.skipIf(!enabled || !databaseIsDisposable)("private chat disposable database contract", () => {
  it("isolates A/B conversations, instructor replies and reconnects without rewriting legacy rows", async () => {
    const { db, viewers: [a, b], instructor } = await fixture();
    const legacy = await db.liveChatMessage.create({ data: {
      ...instructor, formSubmissionId: a.submission.id, authorName: "A",
      body: "Legacy A", source: "viewer", status: "visible", isSimulated: false,
    } });
    const aMessage = await createViewerChatMessage(db, { ...a.input, clientMessageId: randomUUID(), body: "A private" });
    const bMessage = await createViewerChatMessage(db, { ...b.input, clientMessageId: randomUUID(), body: "B private" });
    const reply = await createInstructorChatMessage(db, {
      ...instructor, submissionId: a.submission.id, clientMessageId: randomUUID(), body: "Reply only A",
    });
    const bReply = await createInstructorChatMessage(db, {
      ...instructor, submissionId: b.submission.id, clientMessageId: randomUUID(), body: "Reply only B",
    });
    const bExpected = [bMessage.message.id, bReply.message.id].sort();
    expect(aMessage.message.source).toBe("viewer");
    expect(reply.message.source).toBe("instructor");
    const aExpected = [legacy.id, aMessage.message.id, reply.message.id].sort();
    const first = await listViewerChatMessages(db, a.input);
    expect(first.messages.map((message) => message.id).sort()).toEqual(aExpected);
    expect((await listViewerChatMessages(db, b.input)).messages.map((message) => message.id).sort()).toEqual(bExpected);
    expect(await listViewerChatMessages(db, a.input)).toEqual(first);
    expect((await listViewerChatMessages(db, { ...a.input, chatSessionToken: null })).messages).toEqual([]);

    const inbox = await listInstructorChatMessages(db, instructor);
    expect(inbox.messages).toEqual([]);
    expect(inbox.conversations).toEqual(expect.arrayContaining([
      { id: a.submission.id, name: "A" }, { id: b.submission.id, name: "B" },
    ]));
    expect((await listInstructorChatMessages(db, { ...instructor, submissionId: a.submission.id })).messages.map((message) => message.id).sort()).toEqual(aExpected);
    expect((await listInstructorChatMessages(db, { ...instructor, submissionId: b.submission.id })).messages.map((message) => message.id).sort()).toEqual(bExpected);
    expect(await db.liveChatMessage.findUnique({ where: { id: legacy.id } })).toEqual(legacy);
    expect(await db.liveChatMessage.findUnique({ where: { id: aMessage.message.id } })).toMatchObject({ source: "private_viewer", formSubmissionId: a.submission.id });
    expect(await db.liveChatMessage.findUnique({ where: { id: reply.message.id } })).toMatchObject({ source: "private_instructor", formSubmissionId: a.submission.id });
  });

  it("rejects cross-vendor, cross-live and mismatched-form instructor access without writes", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const otherLive = await f.db.live.create({ data: {
      vendorId: f.vendor.id, formId: f.form.id, title: "Other live",
      slug: `private-other-${randomUUID()}`, scheduledAt: new Date(),
    } });
    const mismatch = await f.db.formSubmission.create({ data: {
      liveId: f.live.id, formId: foreign.form.id, name: "Mismatch",
      email: "mismatch@example.test", verificationStatus: "VERIFIED",
    } });
    for (const input of [
      { vendorId: foreign.vendor.id, liveId: f.live.id, submissionId: f.viewers[0].submission.id },
      { ...f.instructor, submissionId: foreign.viewers[0].submission.id },
      { ...f.instructor, liveId: otherLive.id, submissionId: f.viewers[0].submission.id },
      { ...f.instructor, submissionId: mismatch.id },
    ]) {
      await expect(listInstructorChatMessages(f.db, input)).rejects.toMatchObject({ code: "access_denied" });
      await expect(createInstructorChatMessage(f.db, { ...input, clientMessageId: randomUUID(), body: "Denied" })).rejects.toMatchObject({ code: "access_denied" });
    }
    await expect(listInstructorChatMessages(f.db, { vendorId: foreign.vendor.id, liveId: f.live.id })).rejects.toMatchObject({ code: "access_denied" });
    expect(await f.db.liveChatMessage.count({ where: { liveId: f.live.id } })).toBe(0);
  });

  it("converges retries, rejects changed bodies and separates instructor/viewer idempotency", async () => {
    const { db, viewers: [a], instructor } = await fixture();
    const clientMessageId = randomUUID();
    const viewerInput = { ...a.input, clientMessageId, body: "Viewer retry" };
    const viewerResults = await Promise.all([createViewerChatMessage(db, viewerInput), createViewerChatMessage(db, viewerInput)]);
    expect(viewerResults.filter((result) => result.created)).toHaveLength(1);
    expect(viewerResults[0].message.id).toBe(viewerResults[1].message.id);
    await expect(createViewerChatMessage(db, { ...viewerInput, body: "Changed" })).rejects.toMatchObject({ code: "idempotency_conflict" });
    const replyInput = { ...instructor, submissionId: a.submission.id, clientMessageId, body: "Instructor retry" };
    const replies = await Promise.all([createInstructorChatMessage(db, replyInput), createInstructorChatMessage(db, replyInput)]);
    expect(replies.filter((result) => result.created)).toHaveLength(1);
    expect(replies[0].message.id).toBe(replies[1].message.id);
    expect(replies[0].message.id).not.toBe(viewerResults[0].message.id);
    await expect(createInstructorChatMessage(db, { ...replyInput, body: "Changed reply" })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(await db.liveChatMessage.count({ where: instructor })).toBe(2);
  });

  it("enforces private identity constraints directly in PostgreSQL", async () => {
    const { db, viewers: [a], instructor } = await fixture();
    const role = await db.interactionRole.create({ data: { vendorId: instructor.vendorId, name: "Fixture role" } });
    for (const invalid of [
      { source: "private_viewer", formSubmissionId: null, roleId: null, isSimulated: false },
      { source: "private_instructor", formSubmissionId: a.submission.id, roleId: role.id, isSimulated: false },
      { source: "private_instructor", formSubmissionId: a.submission.id, roleId: null, isSimulated: true },
    ]) {
      // 真實合法 FK fixtures，讓失敗只能來自私訊 identity check。
      await expect(db.liveChatMessage.create({ data: {
        ...instructor, ...invalid, authorName: "Constraint fixture", body: "Must reject", status: "visible",
      } })).rejects.toThrow(/LiveChatMessage_identity_check/u);
    }
    expect(await db.liveChatMessage.count({ where: instructor })).toBe(0);
  });

  it("integrates real API routes and database with mocked authentication boundaries", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const [a, b] = f.viewers;
    const request = (path: string, input: Record<string, string>, viewer?: typeof a, writing = false) => new Request(
      `http://localhost/api/live-chat/${path}${writing ? "" : `?${new URLSearchParams(input)}`}`,
      {
        method: writing ? "POST" : "GET",
        headers: {
          origin: "http://localhost", "x-celebratedeal-client": "web", "content-type": "application/json",
          ...(viewer ? { cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${viewer.input.admissionToken}; ${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${viewer.input.chatSessionToken}` } : {}),
        },
        ...(writing ? { body: JSON.stringify(input) } : {}),
      },
    );
    const check = async (response: Response, status: number) => {
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      return response.json();
    };
    boundary.auth.mockResolvedValue({ vendor: { id: f.vendor.id }, user: { id: "synthetic-manager" }, member: { role: "owner", status: "active" } });
    const aPost = await check(await viewerPost(request("messages", { ...f.instructor, clientMessageId: randomUUID(), body: "API A" }, a, true)), 201);
    const bPost = await check(await viewerPost(request("messages", { ...f.instructor, clientMessageId: randomUUID(), body: "API B" }, b, true)), 201);
    const replies = [];
    for (const viewer of [a, b]) {
      replies.push(await check(await instructorPost(request("instructor", {
        liveId: f.live.id, submissionId: viewer.submission.id, clientMessageId: randomUUID(), body: `API reply ${viewer.submission.name}`,
      }, undefined, true)), 201));
    }
    for (const [index, viewer] of [a, b].entries()) {
      const expected = [(index === 0 ? aPost : bPost).id, replies[index].id].sort();
      const result = await check(await viewerGet(request("messages", f.instructor, viewer)), 200);
      expect(result.messages.map((message: { id: string }) => message.id).sort()).toEqual(expected);
      const manager = await check(await instructorGet(request("instructor", { liveId: f.live.id, submissionId: viewer.submission.id })), 200);
      expect(manager.messages.map((message: { id: string }) => message.id).sort()).toEqual(expected);
    }
    for (const key of ["submissionId", "id"]) {
      await check(await viewerGet(request("messages", { ...f.instructor, [key]: b.submission.id }, a)), 400);
    }
    for (const scope of [
      { ...f.instructor, vendorId: foreign.vendor.id },
      { ...f.instructor, liveId: foreign.live.id },
    ]) await check(await viewerGet(request("messages", scope, a)), 403);
    for (const scope of [
      { liveId: f.live.id, submissionId: foreign.viewers[0].submission.id },
      { liveId: foreign.live.id, submissionId: foreign.viewers[0].submission.id },
    ]) {
      await check(await instructorGet(request("instructor", scope)), 403);
      await check(await instructorPost(request("instructor", { ...scope, clientMessageId: randomUUID(), body: "Denied" }, undefined, true)), 403);
    }
    boundary.auth.mockResolvedValue(null);
    await check(await instructorGet(request("instructor", { liveId: f.live.id })), 403);
    await check(await instructorPost(request("instructor", { liveId: f.live.id, submissionId: a.submission.id, clientMessageId: randomUUID(), body: "Unauthenticated" }, undefined, true)), 403);
    expect(await f.db.liveChatMessage.count({ where: f.instructor })).toBe(4);
    expect(await f.db.liveChatMessage.count({ where: foreign.instructor })).toBe(0);
  });
});
