import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { interactionRoleAvatarUrl } from "@/lib/interaction-role";
import { dataRetentionPolicy, purgeExpiredData } from "@/lib/data-retention";
import { clearLiveChatBlacklistCache, createViewerChatMessage, listViewerChatMessages, resolveViewerProfileModeration } from "@/lib/live-chat";
import { hashLiveViewerToken } from "@/lib/live-quota-admission";
import { readLiveViewerProfile, saveLiveViewerProfile } from "@/lib/live-viewer-profile";

// Real PostgreSQL: the unique indexes, composite foreign keys and CHECKs of
// 20261126100000_live_viewer_profiles decide what the unit tests only mock.
const db = getDb();
const vendors: string[] = [];
const NOW = new Date("2026-11-26T10:00:00.000Z");

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

function token() {
  return randomBytes(32).toString("base64url");
}

async function vendorWithLive(label: string, options: { vendorName?: string } = {}) {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: options.vendorName ?? `Synthetic ${label}`, slug: `nick-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendors.push(vendor.id);
  const form = await db.registrationForm.create({
    data: { vendorId: vendor.id, name: "form", slug: `form-${suffix}`, headline: "form", fields: [] },
  });
  const activeRole = await db.interactionRole.create({ data: { vendorId: vendor.id, name: "小助理 Amy", isScheduled: true } });
  const inactiveRole = await db.interactionRole.create({ data: { vendorId: vendor.id, name: "退休角色", isActive: false } });
  const script = await db.interactionScript.create({
    data: {
      vendorId: vendor.id,
      name: "script",
      status: "published",
      events: {
        create: [
          { roleId: activeRole.id, eventType: "chat_message", triggerSec: 5, title: "hi", message: "大家好" },
          { roleId: inactiveRole.id, eventType: "chat_message", triggerSec: 9, title: "old", message: "舊訊息" },
        ],
      },
    },
  });
  const live = await db.live.create({
    data: { vendorId: vendor.id, formId: form.id, interactionScriptId: script.id, title: "live", slug: `live-${suffix}`, scheduledAt: NOW },
  });
  return { vendor, form, live };
}

async function admit(vendorId: string, liveId: string) {
  const admissionToken = token();
  await db.liveViewerSession.create({
    data: { vendorId, liveId, tokenHash: hashLiveViewerToken(admissionToken), lastSeenAt: NOW, expiresAt: new Date(NOW.getTime() + 90_000) },
  });
  return admissionToken;
}

function save(scope: { vendorId: string; liveId: string }, admissionToken: string, profileToken: string | null, nickname: string, avatarSeed = "host-blue") {
  return saveLiveViewerProfile(db, { ...scope, admissionToken, profileToken, nickname, avatarSeed, now: NOW });
}

describe("LiveViewerProfile on PostgreSQL", () => {
  it("remembers a viewer's nickname by its cookie and lets it rename", async () => {
    const { vendor, live } = await vendorWithLive("remember");
    const scope = { vendorId: vendor.id, liveId: live.id };
    const admissionToken = await admit(vendor.id, live.id);

    const first = await save(scope, admissionToken, null, "小明", "care-teal");
    expect(first.issuedProfileToken).toBeTruthy();
    const profileToken = first.issuedProfileToken!;

    // A later visit has a new admission session but the same profile cookie.
    const laterAdmission = await admit(vendor.id, live.id);
    await expect(readLiveViewerProfile(db, { ...scope, admissionToken: laterAdmission, profileToken, now: NOW }))
      .resolves.toEqual({ scope, profile: { nickname: "小明", avatarSeed: "care-teal", avatarUrl: interactionRoleAvatarUrl("care-teal") }, previousNickname: null });

    const renamed = await save(scope, laterAdmission, profileToken, "小明 2", "chat-mint");
    expect(renamed.issuedProfileToken).toBeNull();
    // Saving the own name again in another case is not a clash with itself.
    await expect(save(scope, laterAdmission, profileToken, "小明 2", "chat-mint")).resolves.toBeTruthy();
    const rows = await db.liveViewerProfile.findMany({ where: { liveId: live.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ nickname: "小明 2", normalizedNickname: "小明2", avatarSeed: "chat-mint", vendorId: vendor.id });
  });

  it("refuses another viewer's name in any case, width or spacing", async () => {
    const { vendor, live } = await vendorWithLive("duplicate");
    const scope = { vendorId: vendor.id, liveId: live.id };
    await save(scope, await admit(vendor.id, live.id), null, "Alice Chen");

    for (const nickname of ["alice chen", "ＡＬＩＣＥ　ＣＨＥＮ", "AliceChen", " A l i c e  C h e n "]) {
      await expect(save(scope, await admit(vendor.id, live.id), null, nickname)).rejects.toMatchObject({ code: "nickname_taken" });
    }
    expect(await db.liveViewerProfile.count({ where: { liveId: live.id } })).toBe(1);
  });

  it("refuses an active role of the bound script and the vendor name, but not an inactive role", async () => {
    const { vendor, live } = await vendorWithLive("reserved", { vendorName: "幸福烘焙 Studio" });
    const scope = { vendorId: vendor.id, liveId: live.id };
    for (const nickname of ["小助理amy", "小助理 ＡＭＹ", "幸福烘焙studio", "觀眾"]) {
      await expect(save(scope, await admit(vendor.id, live.id), null, nickname)).rejects.toMatchObject({ code: "nickname_taken" });
    }
    await expect(save(scope, await admit(vendor.id, live.id), null, "退休角色")).resolves.toBeTruthy();
  });

  it("lets exactly one of three concurrent viewers take the same name", async () => {
    const { vendor, live } = await vendorWithLive("race");
    const scope = { vendorId: vendor.id, liveId: live.id };
    const [a, b, c] = await Promise.all([admit(vendor.id, live.id), admit(vendor.id, live.id), admit(vendor.id, live.id)]);

    const results = await Promise.allSettled([save(scope, a, null, "搶名字"), save(scope, b, null, "搶名字"), save(scope, c, null, "搶 名字")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const result of rejected) expect(result.reason).toMatchObject({ code: "nickname_taken" });
    expect(await db.liveViewerProfile.count({ where: { liveId: live.id } })).toBe(1);
  });

  it("keeps names per live and per vendor", async () => {
    const a = await vendorWithLive("tenant-a");
    const b = await vendorWithLive("tenant-b");
    const secondLiveOfA = await db.live.create({ data: { vendorId: a.vendor.id, title: "second", slug: `second-${randomUUID()}`, scheduledAt: NOW } });

    await save({ vendorId: a.vendor.id, liveId: a.live.id }, await admit(a.vendor.id, a.live.id), null, "同名");
    await expect(save({ vendorId: b.vendor.id, liveId: b.live.id }, await admit(b.vendor.id, b.live.id), null, "同名")).resolves.toBeTruthy();
    await expect(save({ vendorId: a.vendor.id, liveId: secondLiveOfA.id }, await admit(a.vendor.id, secondLiveOfA.id), null, "同名")).resolves.toBeTruthy();
  });

  it("refuses client ids that differ from the admission session", async () => {
    const a = await vendorWithLive("scope-a");
    const b = await vendorWithLive("scope-b");
    const admissionForA = await admit(a.vendor.id, a.live.id);

    await expect(save({ vendorId: b.vendor.id, liveId: b.live.id }, admissionForA, null, "越界")).rejects.toMatchObject({ code: "access_denied" });
    await expect(save({ vendorId: a.vendor.id, liveId: b.live.id }, admissionForA, null, "越界")).rejects.toMatchObject({ code: "access_denied" });
    expect(await db.liveViewerProfile.count({ where: { vendorId: { in: [a.vendor.id, b.vendor.id] } } })).toBe(0);
  });

  it("shows the nickname and avatar on chat while authorName keeps the registration name", async () => {
    const { vendor, form, live } = await vendorWithLive("chat");
    const scope = { vendorId: vendor.id, liveId: live.id };
    const submission = await db.formSubmission.create({
      data: { formId: form.id, liveId: live.id, name: "王大明", email: `viewer-${randomUUID()}@example.test`, verificationStatus: "VERIFIED" },
    });
    const chatSessionToken = createFormSubmissionChatSessionToken({ submissionId: submission.id, now: new Date(NOW.getTime() - 1_000) });
    const admissionToken = await admit(vendor.id, live.id);
    const post = (body: string, profileToken: string | null) => createViewerChatMessage(db, {
      ...scope,
      clientMessageId: randomUUID(),
      body,
      chatSessionToken,
      admissionToken,
      profileToken,
      ipAddress: "203.0.113.7",
      now: NOW,
    });

    // Verified but no nickname yet: the registration name shows, no avatar.
    const before = await post("還沒取暱稱", null);
    expect(before.message.actor).toEqual({ name: "王大明" });

    const { issuedProfileToken } = await save(scope, admissionToken, null, "阿明", "sales-amber");
    const after = await post("有暱稱了", issuedProfileToken);
    expect(after.message.actor).toEqual({ name: "阿明", avatarUrl: interactionRoleAvatarUrl("sales-amber") });

    const stored = await db.liveChatMessage.findUniqueOrThrow({ where: { id: after.message.id } });
    expect(stored.authorName).toBe("王大明");
    expect(stored.viewerProfileId).not.toBeNull();

    // A rename shows on that viewer's earlier messages too.
    await save(scope, admissionToken, issuedProfileToken, "明哥", "sales-amber");
    const listed = await listViewerChatMessages(db, { ...scope, chatSessionToken, admissionToken, now: NOW });
    expect(listed.messages.map((message) => message.actor)).toEqual([
      { name: "王大明" },
      { name: "明哥", avatarUrl: interactionRoleAvatarUrl("sales-amber") },
    ]);
  });

  it("never attaches a profile from another live to a message", async () => {
    const { vendor, form, live } = await vendorWithLive("cross-live");
    const other = await db.live.create({ data: { vendorId: vendor.id, title: "other", slug: `other-${randomUUID()}`, scheduledAt: NOW } });
    const { issuedProfileToken } = await save({ vendorId: vendor.id, liveId: other.id }, await admit(vendor.id, other.id), null, "別場暱稱");
    const otherProfile = await db.liveViewerProfile.findFirstOrThrow({ where: { liveId: other.id } });

    const submission = await db.formSubmission.create({
      data: { formId: form.id, liveId: live.id, name: "觀眾甲", email: `viewer-${randomUUID()}@example.test`, verificationStatus: "VERIFIED" },
    });
    // The same cookie hashes to another key in this live: no profile, registration name.
    const result = await createViewerChatMessage(db, {
      vendorId: vendor.id,
      liveId: live.id,
      clientMessageId: randomUUID(),
      body: "hi",
      chatSessionToken: createFormSubmissionChatSessionToken({ submissionId: submission.id, now: new Date(NOW.getTime() - 1_000) }),
      admissionToken: await admit(vendor.id, live.id),
      profileToken: issuedProfileToken,
      ipAddress: "203.0.113.7",
      now: NOW,
    });
    expect(result.message.actor).toEqual({ name: "觀眾甲" });

    // The composite foreign key refuses the other live's profile outright.
    await expect(db.liveChatMessage.create({
      data: { vendorId: vendor.id, liveId: live.id, authorName: "x", body: "x", formSubmissionId: submission.id, viewerProfileId: otherProfile.id },
    })).rejects.toMatchObject({ code: "P2003" });
  });

  it("enforces the stored shape and cascades with the live", async () => {
    const { vendor, form, live } = await vendorWithLive("constraints");
    const submission = await db.formSubmission.create({
      data: { formId: form.id, liveId: live.id, name: "觀眾乙", email: `viewer-${randomUUID()}@example.test`, verificationStatus: "VERIFIED" },
    });
    const role = await db.interactionRole.findFirstOrThrow({ where: { vendorId: vendor.id, isActive: true } });
    const base = { vendorId: vendor.id, liveId: live.id, viewerKeyHash: "a".repeat(64), createdBySessionHash: "b".repeat(64), nickname: "ok", normalizedNickname: "ok" as string | null, avatarSeed: "host-blue" };
    await expect(db.liveViewerProfile.create({ data: { ...base, createdBySessionHash: "x" } })).rejects.toThrow();
    // Released rows (NULL) never collide with each other or with an active holder.
    await db.liveViewerProfile.create({ data: { ...base, viewerKeyHash: "c".repeat(64), normalizedNickname: null } });
    await db.liveViewerProfile.create({ data: { ...base, viewerKeyHash: "d".repeat(64), normalizedNickname: null } });
    await expect(db.liveViewerProfile.create({ data: { ...base, nickname: "一".repeat(21) } })).rejects.toThrow();
    await expect(db.liveViewerProfile.create({ data: { ...base, avatarSeed: "https://evil.example/a.png" } })).rejects.toThrow();
    await expect(db.liveViewerProfile.create({ data: { ...base, viewerKeyHash: "not-a-hash" } })).rejects.toThrow();
    await expect(db.liveViewerProfile.create({ data: { ...base, normalizedNickname: "has space" } })).rejects.toThrow();
    const profile = await db.liveViewerProfile.create({ data: base });
    await db.liveChatMessage.create({
      data: { vendorId: vendor.id, liveId: live.id, authorName: "x", body: "x", formSubmissionId: submission.id, viewerProfileId: profile.id },
    });
    // A scripted role row can never carry a viewer's profile.
    await expect(db.liveChatMessage.create({
      data: { vendorId: vendor.id, liveId: live.id, authorName: "role", body: "x", source: "scheduled", roleId: role.id, viewerProfileId: profile.id },
    })).rejects.toThrow(/LiveChatMessage_viewerProfile_source_check/u);

    // NO ACTION is checked at the end of the statement, so one Live delete
    // removes both the message and the profile it points at.
    await db.live.delete({ where: { id: live.id } });
    expect(await db.liveViewerProfile.count({ where: { vendorId: vendor.id } })).toBe(0);
    expect(await db.liveChatMessage.count({ where: { vendorId: vendor.id } })).toBe(0);
  });
});

async function verifiedViewer(form: { id: string }, live: { id: string }, name: string) {
  const submission = await db.formSubmission.create({
    data: { formId: form.id, liveId: live.id, name, email: `viewer-${randomUUID()}@example.test`, verificationStatus: "VERIFIED" },
  });
  return { submission, chatSessionToken: createFormSubmissionChatSessionToken({ submissionId: submission.id, now: new Date(NOW.getTime() - 1_000) }) };
}

function post(scope: { vendorId: string; liveId: string }, input: { chatSessionToken: string; admissionToken: string; profileToken: string | null; body: string; now?: Date }) {
  return createViewerChatMessage(db, {
    ...scope,
    clientMessageId: randomUUID(),
    body: input.body,
    chatSessionToken: input.chatSessionToken,
    admissionToken: input.admissionToken,
    profileToken: input.profileToken,
    ipAddress: "203.0.113.7",
    now: input.now ?? NOW,
  });
}

describe("LiveViewerProfile moderation, limits and retention on PostgreSQL", () => {
  it("applies the vendor's keyword and identity blacklist to the nickname, also at display time", async () => {
    clearLiveChatBlacklistCache();
    const { vendor, form, live } = await vendorWithLive("moderation");
    const scope = { vendorId: vendor.id, liveId: live.id };
    const { submission, chatSessionToken } = await verifiedViewer(form, live, "王大明");
    const admissionToken = await admit(vendor.id, live.id);
    await db.blacklist.create({ data: { vendorId: vendor.id, identifier: "假貨", identifierType: "keyword", reason: "synthetic" } });
    const moderate = (input: { vendorId: string; liveId: string }) => resolveViewerProfileModeration(db, {
      ...input, admissionToken, chatSessionToken, ipAddress: "203.0.113.7", now: NOW,
    });

    await expect(saveLiveViewerProfile(db, { ...scope, admissionToken, profileToken: null, nickname: "賣假貨的人", avatarSeed: "host-blue", moderate, now: NOW }))
      .rejects.toMatchObject({ code: "nickname_blocked" });
    // The caller's own registration name is not reserved against them.
    const { issuedProfileToken } = await saveLiveViewerProfile(db, { ...scope, admissionToken, profileToken: null, nickname: "王大明", avatarSeed: "host-blue", moderate, now: NOW });
    await post(scope, { chatSessionToken, admissionToken, profileToken: issuedProfileToken, body: "hello" });

    // A keyword rule added after the nickname was chosen hides it at display time.
    await db.blacklist.create({ data: { vendorId: vendor.id, identifier: "大明", identifierType: "keyword", reason: "synthetic" } });
    clearLiveChatBlacklistCache();
    const keywordHidden = await listViewerChatMessages(db, { ...scope, chatSessionToken: null, admissionToken, now: NOW });
    // The registration name is blocked too, so the default name shows.
    expect(keywordHidden.messages.map((message) => message.actor)).toEqual([{ name: "觀眾" }]);

    // A blacklisted email falls back to the registration name and blocks renaming.
    await db.blacklist.deleteMany({ where: { vendorId: vendor.id, identifierType: "keyword", identifier: "大明" } });
    await saveLiveViewerProfile(db, { ...scope, admissionToken, profileToken: issuedProfileToken, nickname: "阿明", avatarSeed: "host-blue", moderate, now: NOW });
    await db.blacklist.create({ data: { vendorId: vendor.id, identifier: submission.email, identifierType: "email", reason: "synthetic" } });
    clearLiveChatBlacklistCache();
    const identityHidden = await listViewerChatMessages(db, { ...scope, chatSessionToken: null, admissionToken, now: NOW });
    expect(identityHidden.messages.map((message) => message.actor)).toEqual([{ name: "王大明" }]);
    await expect(saveLiveViewerProfile(db, { ...scope, admissionToken, profileToken: issuedProfileToken, nickname: "阿明二", avatarSeed: "host-blue", moderate, now: NOW }))
      .rejects.toMatchObject({ code: "blocked" });
    clearLiveChatBlacklistCache();
  });

  it("refuses a viewer whose admission visitor id is blacklisted, without a registration", async () => {
    clearLiveChatBlacklistCache();
    const { vendor, live } = await vendorWithLive("visitor-block");
    const scope = { vendorId: vendor.id, liveId: live.id };
    const admissionToken = await admit(vendor.id, live.id);
    await db.blacklist.create({ data: { vendorId: vendor.id, identifier: hashLiveViewerToken(admissionToken), identifierType: "visitor_id", reason: "synthetic" } });
    const moderate = (input: { vendorId: string; liveId: string }) => resolveViewerProfileModeration(db, {
      ...input, admissionToken, chatSessionToken: null, ipAddress: null, now: NOW,
    });
    await expect(saveLiveViewerProfile(db, { ...scope, admissionToken, profileToken: null, nickname: "路人", avatarSeed: "host-blue", moderate, now: NOW }))
      .rejects.toMatchObject({ code: "blocked" });
    expect(await db.liveViewerProfile.count({ where: { liveId: live.id } })).toBe(0);
  });

  it("reserves names of recent chat authors without a nickname, for 7 days", async () => {
    const { vendor, form, live } = await vendorWithLive("recent-authors");
    const scope = { vendorId: vendor.id, liveId: live.id };
    const author = await verifiedViewer(form, live, "Chen Wei");
    const authorAdmission = await admit(vendor.id, live.id);
    await post(scope, { chatSessionToken: author.chatSessionToken, admissionToken: authorAdmission, profileToken: null, body: "hi" });

    await expect(save(scope, await admit(vendor.id, live.id), null, "chenwei")).rejects.toMatchObject({ code: "nickname_taken" });
    // Eight days later that name no longer counts as present in the room.
    await db.liveChatMessage.updateMany({ where: { liveId: live.id }, data: { createdAt: new Date(NOW.getTime() - 8 * 86_400_000) } });
    await expect(save(scope, await admit(vendor.id, live.id), null, "chenwei")).resolves.toBeTruthy();
  });

  it("lets a new viewer take the name of a profile idle for 7 days, and hides the idle one", async () => {
    const { vendor, form, live } = await vendorWithLive("release");
    const scope = { vendorId: vendor.id, liveId: live.id };
    const old = await verifiedViewer(form, live, "老觀眾");
    const oldAdmission = await admit(vendor.id, live.id);
    const { issuedProfileToken: oldToken } = await save(scope, oldAdmission, null, "小雨");
    await post(scope, { chatSessionToken: old.chatSessionToken, admissionToken: oldAdmission, profileToken: oldToken, body: "我是小雨" });

    // Still active: the name is held.
    await expect(save(scope, await admit(vendor.id, live.id), null, "小雨")).rejects.toMatchObject({ code: "nickname_taken" });

    await db.liveViewerProfile.updateMany({ where: { liveId: live.id }, data: { lastActiveAt: new Date(NOW.getTime() - 8 * 86_400_000) } });
    await expect(save(scope, await admit(vendor.id, live.id), null, "小 雨")).resolves.toBeTruthy();
    const rows = await db.liveViewerProfile.findMany({ where: { liveId: live.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => row.normalizedNickname).sort()).toEqual(["小雨", null].sort());

    // The idle viewer's old message no longer shows the nickname and never
    // turns into the registration name; its next visit is asked again with
    // the old name suggested.
    const listed = await listViewerChatMessages(db, { ...scope, chatSessionToken: null, admissionToken: await admit(vendor.id, live.id), now: NOW });
    expect(listed.messages.map((message) => message.actor)).toEqual([{ name: "觀眾" }]);
    await expect(readLiveViewerProfile(db, { ...scope, admissionToken: await admit(vendor.id, live.id), profileToken: oldToken, now: NOW }))
      .resolves.toEqual({ scope, profile: null, previousNickname: "小雨" });
    // Posting with the released profile uses the registration name.
    const reposted = await post(scope, { chatSessionToken: old.chatSessionToken, admissionToken: oldAdmission, profileToken: oldToken, body: "我回來了" });
    expect(reposted.message.actor).toEqual({ name: "老觀眾" });
  });

  it("lets one admission session create at most three profiles", async () => {
    const { vendor, live } = await vendorWithLive("probe");
    const scope = { vendorId: vendor.id, liveId: live.id };
    const admissionToken = await admit(vendor.id, live.id);
    for (const nickname of ["探一", "探二", "探三"]) await save(scope, admissionToken, null, nickname);
    await expect(save(scope, admissionToken, null, "探四")).rejects.toMatchObject({ code: "too_many_profiles" });
    expect(await db.liveViewerProfile.count({ where: { liveId: live.id } })).toBe(3);
  });

  it("deletes profiles 30 days after the live and its replay closed, keeping the messages", async () => {
    const { vendor, form, live } = await vendorWithLive("retention");
    const scope = { vendorId: vendor.id, liveId: live.id };
    const viewer = await verifiedViewer(form, live, "回放觀眾");
    const admissionToken = await admit(vendor.id, live.id);
    const { issuedProfileToken } = await save(scope, admissionToken, null, "回放暱稱");
    const posted = await post(scope, { chatSessionToken: viewer.chatSessionToken, admissionToken, profileToken: issuedProfileToken, body: "回放好看" });
    const ongoing = await vendorWithLive("retention-ongoing");
    await save({ vendorId: ongoing.vendor.id, liveId: ongoing.live.id }, await admit(ongoing.vendor.id, ongoing.live.id), null, "還在播");

    const later = new Date(NOW.getTime() + 40 * 86_400_000);
    await db.live.update({ where: { id: live.id }, data: { status: "ended", endedAt: new Date(NOW.getTime() + 86_400_000), replayEnabled: true, replayAvailableUntil: new Date(NOW.getTime() + 2 * 86_400_000) } });
    await db.liveViewerProfile.updateMany({ where: { vendorId: { in: [vendor.id, ongoing.vendor.id] } }, data: { lastActiveAt: NOW } });

    const result = await purgeExpiredData(db, { now: later, policy: dataRetentionPolicy({}) });
    expect(result.liveViewerProfilesDeleted).toBeGreaterThanOrEqual(1);
    expect(await db.liveViewerProfile.count({ where: { liveId: live.id } })).toBe(0);
    // A live that has not ended keeps its profiles.
    expect(await db.liveViewerProfile.count({ where: { liveId: ongoing.live.id } })).toBe(1);
    const message = await db.liveChatMessage.findUniqueOrThrow({ where: { id: posted.message.id } });
    expect(message).toMatchObject({ viewerProfileId: null, viewerProfileRemovedAt: later, authorName: "回放觀眾" });
    // The room shows "觀眾", not the registration name, for that message,
    // and its author name is not held as a present name either.
    const listed = await listViewerChatMessages(db, { ...scope, chatSessionToken: null, admissionToken: await admit(vendor.id, live.id), now: NOW });
    expect(listed.messages.map((m) => m.actor)).toEqual([{ name: "觀眾" }]);
    await expect(save(scope, await admit(vendor.id, live.id), null, "回放觀眾")).resolves.toBeTruthy();
  });

  it("settles a finished VOD's end from the runtime rules before the purge", async () => {
    const { vendor, live } = await vendorWithLive("retention-vod");
    const scope = { vendorId: vendor.id, liveId: live.id };
    await save(scope, await admit(vendor.id, live.id), null, "看完了");
    const video = await db.video.create({ data: { vendorId: vendor.id, title: "vod", videoUrl: "https://video.example.test/a.mp4", sourceType: "url", status: "ready", durationSec: 600 } });
    // Scheduled VOD that finished long ago; nobody loaded it afterwards, so endedAt was never written.
    await db.live.update({ where: { id: live.id }, data: { videoId: video.id, streamMode: "vod", status: "scheduled", scheduledAt: NOW, endedAt: null, replayEnabled: false } });

    const later = new Date(NOW.getTime() + 40 * 86_400_000);
    await purgeExpiredData(db, { now: later, policy: dataRetentionPolicy({}) });
    const settled = await db.live.findUniqueOrThrow({ where: { id: live.id } });
    expect(settled).toMatchObject({ status: "ended", endedAt: new Date(NOW.getTime() + 600_000) });
    expect(await db.liveViewerProfile.count({ where: { liveId: live.id } })).toBe(0);
  });

  it("deletes an evergreen live's profiles only after 180 idle days", async () => {
    const { vendor, live } = await vendorWithLive("retention-evergreen");
    const scope = { vendorId: vendor.id, liveId: live.id };
    await db.live.update({ where: { id: live.id }, data: { isEvergreen: true } });
    await save(scope, await admit(vendor.id, live.id), null, "常青觀眾");

    await purgeExpiredData(db, { now: new Date(NOW.getTime() + 179 * 86_400_000), policy: dataRetentionPolicy({}) });
    expect(await db.liveViewerProfile.count({ where: { liveId: live.id } })).toBe(1);
    await purgeExpiredData(db, { now: new Date(NOW.getTime() + 181 * 86_400_000), policy: dataRetentionPolicy({}) });
    expect(await db.liveViewerProfile.count({ where: { liveId: live.id } })).toBe(0);
  });
});
