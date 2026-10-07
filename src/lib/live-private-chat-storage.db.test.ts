import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { decryptPrivateChatBody, encryptPrivateChatBody, privateChatMessageId } from "./live-private-chat-storage";
import { createPrivateViewerChat, listPrivateViewerChat } from "./live-private-chat";
import { createFormSubmissionChatSessionToken } from "./form-submission-chat-session";
import { hashLiveViewerToken } from "./live-quota-admission";

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
  return { vendor, member, live, submission, scope, data, input };
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
