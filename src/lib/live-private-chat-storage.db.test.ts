import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { decryptPrivateChatBody, encryptPrivateChatBody, privateChatMessageId } from "./live-private-chat-storage";

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
  return { vendor, member, live, submission, scope, data };
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
