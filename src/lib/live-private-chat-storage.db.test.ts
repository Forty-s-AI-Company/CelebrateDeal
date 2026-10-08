import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { decryptPrivateChatBody, encryptPrivateChatBody, privateChatMessageId } from "./live-private-chat-storage";
import { createPrivateViewerChat, listPrivateViewerChat, createPrivateInstructorChat, listPrivateInstructorChat, listPrivateInstructorConversations } from "./live-private-chat";
import { createFormSubmissionChatSessionToken } from "./form-submission-chat-session";
import { hashLiveViewerToken } from "./live-quota-admission";
import { encryptMfaSecret } from "./mfa";

let db: PrismaClient;
const vendors: string[] = [], users: string[] = [];
beforeAll(() => { assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL); db = new PrismaClient({ log: [] }); });
afterEach(async () => {
  await db.livePrivateChatMessage.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
  await db.user.deleteMany({ where: { id: { in: users.splice(0) } } });
});
afterAll(async () => { await db.$disconnect(); });

async function fixture() {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic private chat", slug: `private-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic" } });
  vendors.push(vendor.id);
  const user = await db.user.create({ data: { name: "Synthetic manager", email: `manager-${suffix}@example.test`, passwordHash: "synthetic" } });
  users.push(user.id);
  const member = await db.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: "owner" } });
  const session = await db.userSession.create({ data: { vendorId: vendor.id, userId: user.id, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 60_000) } });
  const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Synthetic form", slug: `form-${suffix}`, headline: "合成報名", fields: [] } });
  const live = await db.live.create({ data: { vendorId: vendor.id, formId: form.id, title: "Synthetic live", slug: `private-live-${suffix}`, scheduledAt: new Date() } });
  const submission = await db.formSubmission.create({ data: { formId: form.id, liveId: live.id, name: "合成觀眾", email: `viewer-${suffix}@example.test`, verificationStatus: "VERIFIED" } });
  const identity = { vendorId: vendor.id, liveId: live.id, submissionId: submission.id, source: "viewer" as const, actorId: submission.id, clientMessageId: randomUUID() };
  const scope = { vendorId: vendor.id, liveId: live.id, submissionId: submission.id, source: "viewer" as const, messageId: privateChatMessageId(identity) };
  const data = { id: scope.messageId, vendorId: vendor.id, liveId: live.id, formSubmissionId: submission.id, source: "viewer", bodyEncrypted: encryptPrivateChatBody("合成私人問題", scope) };
  const now = new Date(), admissionToken = randomBytes(32).toString("base64url");
  await db.liveViewerSession.create({ data: { vendorId: vendor.id, liveId: live.id, tokenHash: hashLiveViewerToken(admissionToken), lastSeenAt: now, expiresAt: new Date(now.getTime() + 60_000) } });
  const input = { vendorId: vendor.id, liveId: live.id, admissionToken,
    chatSessionToken: createFormSubmissionChatSessionToken({ submissionId: submission.id, now }),
    ipAddress: "203.0.113.5", now, clientMessageId: identity.clientMessageId, body: "合成私人問題" };
  const viewerBinding = (await listPrivateViewerChat(db, input)).conversationBinding; const instructorBinding = (await listPrivateInstructorChat(db, { vendorId: vendor.id, liveId: live.id, userId: user.id, memberId: member.id, sessionId: session.id, submissionId: submission.id })).conversationBinding; return { vendor, member, session, live, submission, scope, data, input: { ...input, conversationBinding: viewerBinding }, instructorBinding };
}

it("persists only encrypted body in an independent private table", async () => {
  const f = await fixture(); const row = await db.livePrivateChatMessage.create({ data: f.data });
  expect(row.bodyEncrypted).not.toContain("合成私人問題");
  expect(decryptPrivateChatBody(row.bodyEncrypted, f.scope)).toBe("合成私人問題");
  expect(await db.liveChatMessage.count({ where: { liveId: f.live.id } })).toBe(0);
});
it("rejects a live from another tenant through the composite FK", async () => {
  const f = await fixture(), other = await fixture();
  await expect(db.livePrivateChatMessage.create({ data: { ...f.data, liveId: other.live.id, formSubmissionId: other.submission.id } })).rejects.toMatchObject({ code: "P2003" });
  expect(await db.livePrivateChatMessage.count()).toBe(0);
});
it("rejects a submission from another live through the conversation FK", async () => {
  const f = await fixture(), other = await fixture();
  await expect(db.livePrivateChatMessage.create({ data: { ...f.data, formSubmissionId: other.submission.id } })).rejects.toMatchObject({ code: "P2003" });
  expect(await db.livePrivateChatMessage.count()).toBe(0);
});
it("rejects a foreign instructor membership", async () => {
  const f = await fixture(), other = await fixture();
  await expect(db.livePrivateChatMessage.create({ data: { ...f.data, source: "instructor", authorMemberId: other.member.id } })).rejects.toMatchObject({ code: "P2003" });
});
it("enforces author provenance, source, identity and encrypted envelope checks", async () => {
  const f = await fixture();
  for (const change of [{ source: "instructor" }, { authorMemberId: f.member.id }, { source: "staff" }, { id: "client-raw-id" }, { bodyEncrypted: "plaintext private message" }, { bodyEncrypted: `${f.data.bodyEncrypted}.extra` }]) {
    await expect(db.livePrivateChatMessage.create({ data: { ...f.data, ...change } })).rejects.toThrow();
  }
  expect(await db.livePrivateChatMessage.count()).toBe(0);
});
it("prevents concurrent duplicate UUID identities at the database boundary", async () => {
  const f = await fixture();
  const outcomes = await Promise.allSettled([db.livePrivateChatMessage.create({ data: f.data }), db.livePrivateChatMessage.create({ data: f.data })]);
  expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find(outcome => outcome.status === "rejected")).toMatchObject({ reason: { code: "P2002" } });
  expect(await db.livePrivateChatMessage.count({ where: { id: f.data.id } })).toBe(1);
});

it("creates and reads a private viewer conversation without exposing another viewer", async () => {
  const f = await fixture(), other = await fixture();
  const created = await createPrivateViewerChat(db, f.input);
  expect(created.created).toBe(true);
  expect((await listPrivateViewerChat(db, f.input)).messages).toEqual([created.message]);
  expect((await listPrivateViewerChat(db, other.input)).messages).toEqual([]);
  const second = await db.formSubmission.create({ data: { formId: f.submission.formId, liveId: f.live.id, name: "其他合成觀眾", email: `${randomUUID()}@example.test`, verificationStatus: "VERIFIED" } });
  const secondClaim = createFormSubmissionChatSessionToken({ submissionId: second.id, now: f.input.now });
  expect((await listPrivateViewerChat(db, { ...f.input, chatSessionToken: secondClaim })).messages).toEqual([]);
  expect(Object.keys(created.message).sort()).toEqual(["body", "createdAt", "id", "source"]);
});
it("reconciles concurrent retries to one message and rejects altered bodies", async () => {
  const f = await fixture();
  const outcomes = await Promise.all([createPrivateViewerChat(db, f.input), createPrivateViewerChat(db, f.input)]);
  expect(outcomes.filter(result => result.created)).toHaveLength(1);
  expect(outcomes[0].message).toEqual(outcomes[1].message);
  expect(await db.livePrivateChatMessage.count({ where: { liveId: f.live.id } })).toBe(1);
  await expect(createPrivateViewerChat(db, { ...f.input, body: "另一個問題" })).rejects.toMatchObject({ code: "idempotency_conflict" });
});
it("rejects an earlier viewer binding before UUID retry after the same-live identity changes", async () => {
  const f = await fixture(); await createPrivateViewerChat(db, f.input);
  const second = await db.formSubmission.create({ data: { formId: f.submission.formId, liveId: f.live.id,
    name: "切換後合成觀眾", email: `${randomUUID()}@example.test`, verificationStatus: "VERIFIED" } });
  const switched = { ...f.input, chatSessionToken: createFormSubmissionChatSessionToken({ submissionId: second.id, now: f.input.now }) };
  const current = await listPrivateViewerChat(db, switched);
  expect(current.conversationBinding).not.toBe(f.input.conversationBinding);
  expect(current.messages).toEqual([]);
  await expect(createPrivateViewerChat(db, switched)).rejects.toMatchObject({ code: "access_denied" });
  expect(await db.livePrivateChatMessage.count({ where: { liveId: f.live.id } })).toBe(1);
  expect(await db.livePrivateChatMessage.count({ where: { formSubmissionId: second.id } })).toBe(0);
});
it("rejects a previous instructor actor binding even when the new actor has current manager rights", async () => {
  const f = await fixture(), other = await fixture();
  const member = await db.vendorMember.create({ data: { vendorId: f.vendor.id, userId: other.member.userId, role: "owner" } });
  await db.userSession.update({ where: { id: other.session.id }, data: { vendorId: f.vendor.id } });
  const switched = { vendorId: f.vendor.id, liveId: f.live.id, userId: other.member.userId, memberId: member.id,
    sessionId: other.session.id, submissionId: f.submission.id, conversationBinding: f.instructorBinding,
    body: "原講師草稿", clientMessageId: randomUUID() };
  expect((await listPrivateInstructorChat(db, switched)).conversationBinding).not.toBe(f.instructorBinding);
  await expect(createPrivateInstructorChat(db, switched)).rejects.toMatchObject({ code: "access_denied" });
  expect(await db.livePrivateChatMessage.count({ where: { liveId: f.live.id } })).toBe(0);
});
it("rechecks current verification and moderation before an idempotent retry", async () => {
  const f = await fixture(); await createPrivateViewerChat(db, f.input);
  await db.formSubmission.update({ where: { id: f.submission.id }, data: { verificationStatus: "UNVERIFIED" } });
  await expect(createPrivateViewerChat(db, f.input)).rejects.toMatchObject({ code: "access_denied" });
  await expect(listPrivateViewerChat(db, f.input)).rejects.toMatchObject({ code: "access_denied" });
  await db.formSubmission.update({ where: { id: f.submission.id }, data: { verificationStatus: "VERIFIED" } });
  await db.blacklist.create({ data: { vendorId: f.vendor.id, identifierType: "keyword", identifier: "私人問題", reason: "Synthetic moderation" } });
  await expect(createPrivateViewerChat(db, f.input)).rejects.toMatchObject({ code: "keyword_blocked" });
  expect(await db.livePrivateChatMessage.count({ where: { liveId: f.live.id } })).toBe(1);
});
it("paginates all private messages and rejects a cursor in another conversation", async () => {
  const f = await fixture(), other = await fixture();
  const rows = Array.from({ length: 51 }, (_, index) => {
    const id = privateChatMessageId({ vendorId: f.vendor.id, liveId: f.live.id, submissionId: f.submission.id, source: "viewer", actorId: f.submission.id, clientMessageId: randomUUID() });
    return { ...f.data, id, createdAt: new Date(f.input.now.getTime() - 51_000 + index * 100),
      bodyEncrypted: encryptPrivateChatBody(`合成問題 ${index}`, { ...f.scope, messageId: id }) };
  });
  await db.livePrivateChatMessage.createMany({ data: rows });
  const first = await listPrivateViewerChat(db, f.input);
  expect(first.messages).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
  const next = await listPrivateViewerChat(db, { ...f.input, cursor: first.nextCursor! });
  expect(next.messages).toHaveLength(1); expect(next.nextCursor).toBeNull();
  expect(new Set([...first.messages, ...next.messages].map(message => message.id)).size).toBe(51);
  await expect(listPrivateViewerChat(db, { ...other.input, cursor: first.nextCursor! })).rejects.toMatchObject({ code: "invalid_cursor" });
});

it("delivers instructor replies only to the selected verified conversation", async () => {
  const f = await fixture(); const viewer = await createPrivateViewerChat(db, f.input);
  const instructor = { conversationBinding: f.instructorBinding, vendorId: f.vendor.id, liveId: f.live.id, userId: f.member.userId, memberId: f.member.id, sessionId: f.session.id, submissionId: f.submission.id };
  expect(await listPrivateInstructorConversations(db, instructor)).toEqual({ conversations: [{ submissionId: f.submission.id, displayName: f.submission.name }], nextCursor: null });
  const reply = await createPrivateInstructorChat(db, { ...instructor, body: "合成講師回覆", clientMessageId: randomUUID() });
  expect(reply.created).toBe(true); expect(reply.message.source).toBe("instructor");
  expect((await listPrivateViewerChat(db, f.input)).messages.map(message => message.id)).toEqual([viewer.message.id, reply.message.id]);
  expect((await listPrivateInstructorChat(db, instructor)).messages).toHaveLength(2);
  expect(await db.livePrivateChatMessage.findUnique({ where: { id: reply.message.id } })).toMatchObject({ authorMemberId: f.member.id });
});
it("rejects foreign instructors and immediately revoked role before reads and retries", async () => {
  const f = await fixture(), foreign = await fixture();
  const input = { conversationBinding: f.instructorBinding, vendorId: f.vendor.id, liveId: f.live.id, userId: f.member.userId, memberId: f.member.id, sessionId: f.session.id, submissionId: f.submission.id, body: "合成講師回覆", clientMessageId: randomUUID() };
  await createPrivateInstructorChat(db, input);
  await expect(listPrivateInstructorChat(db, { ...input, userId: foreign.member.userId, memberId: foreign.member.id })).rejects.toMatchObject({ code: "access_denied" });
  await db.vendorMember.update({ where: { id: f.member.id }, data: { role: "member" } });
  await expect(createPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
  await expect(listPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
  await expect(listPrivateInstructorConversations(db, input)).rejects.toMatchObject({ code: "access_denied" });
  expect(await db.livePrivateChatMessage.count({ where: { liveId: f.live.id } })).toBe(1);
});
it("keeps aggregate project scope read-only for instructor replies", async () => {
  const f = await fixture(); await createPrivateViewerChat(db, f.input);
  const input = { conversationBinding: f.instructorBinding, vendorId: f.vendor.id, liveId: f.live.id, userId: f.member.userId, memberId: f.member.id, sessionId: f.session.id, submissionId: f.submission.id, body: "合成講師回覆", clientMessageId: randomUUID() };
  await db.userOnboardingPreference.create({ data: { vendorId: f.vendor.id, userId: f.member.userId } });
  expect((await listPrivateInstructorChat(db, input)).messages).toHaveLength(1);
  await expect(createPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
});
it("rejects a different live conversation even under the same authorized manager", async () => {
  const f = await fixture(), other = await fixture();
  const input = { conversationBinding: f.instructorBinding, vendorId: f.vendor.id, liveId: f.live.id, userId: f.member.userId, memberId: f.member.id, sessionId: f.session.id, submissionId: other.submission.id, body: "合成講師回覆", clientMessageId: randomUUID() };
  await expect(createPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
  await expect(listPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
});

it("rechecks session revocation and newly enrolled MFA inside the reply transaction", async () => {
  const f = await fixture();
  const input = { conversationBinding: f.instructorBinding, vendorId: f.vendor.id, liveId: f.live.id, userId: f.member.userId, memberId: f.member.id, sessionId: f.session.id, submissionId: f.submission.id, body: "合成講師回覆", clientMessageId: randomUUID() };
  await db.userMfaFactor.create({ data: { userId: f.member.userId, secretEncrypted: encryptMfaSecret("JBSWY3DPEHPK3PXP") } });
  await expect(createPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
  await db.userSession.update({ where: { id: f.session.id }, data: { mfaVerifiedAt: new Date() } });
  expect((await createPrivateInstructorChat(db, input)).created).toBe(true);
  await db.userSession.update({ where: { id: f.session.id }, data: { revokedAt: new Date() } });
  await expect(createPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
  await expect(listPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
});

it("rechecks the selected project before a manager can read or reply", async () => {
  const f = await fixture();
  const project = await db.salesProject.create({ data: { vendorId: f.vendor.id, name: "合成專案", slug: `project-${randomUUID()}`, mode: "live_course", primaryFlow: "live" } });
  await db.userOnboardingPreference.create({ data: { vendorId: f.vendor.id, userId: f.member.userId, selectedProjectId: project.id } });
  const input = { conversationBinding: f.instructorBinding, vendorId: f.vendor.id, liveId: f.live.id, userId: f.member.userId, memberId: f.member.id, sessionId: f.session.id, submissionId: f.submission.id, body: "合成講師回覆", clientMessageId: randomUUID() };
  await expect(listPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
  await expect(createPrivateInstructorChat(db, input)).rejects.toMatchObject({ code: "access_denied" });
  await db.live.update({ where: { id: f.live.id }, data: { projectId: project.id } });
  expect((await createPrivateInstructorChat(db, input)).created).toBe(true);
});

it("preserves the canonical default workspace for a legacy unselected session", async () => {
  const f = await fixture(), other = await fixture();
  await db.userSession.update({ where: { id: f.session.id }, data: { vendorId: null } });
  const extraMember = await db.vendorMember.create({ data: { vendorId: other.vendor.id, userId: f.member.userId, role: "owner" } });
  const input = { conversationBinding: f.instructorBinding, vendorId: f.vendor.id, liveId: f.live.id, userId: f.member.userId, memberId: f.member.id, sessionId: f.session.id, submissionId: f.submission.id, body: "合成講師回覆", clientMessageId: randomUUID() };
  expect((await createPrivateInstructorChat(db, input)).created).toBe(true);
  await expect(listPrivateInstructorChat(db, { ...input, vendorId: other.vendor.id, liveId: other.live.id, memberId: extraMember.id, submissionId: other.submission.id })).rejects.toMatchObject({ code: "access_denied" });
});
