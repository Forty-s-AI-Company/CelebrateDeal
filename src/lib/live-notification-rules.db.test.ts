import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { postLiveFollowupIdempotencyPrefix } from "@/lib/post-live-followup";
import { parseLiveNotificationRules, reconcileLiveNotificationRules } from "./live-notification-rules";

const createdVendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

async function createVendor(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const vendor = await getDb().vendor.create({
    data: {
      name: `${label} ${suffix}`,
      slug: `notification-rules-${label}-${suffix}`,
      email: `notification-rules-${label}-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  return vendor;
}

async function createFixture(label: string) {
  const db = getDb();
  const vendor = await createVendor(label);
  const [reminderA, reminderB, followup] = await Promise.all([
    db.messageTemplate.create({ data: { vendorId: vendor.id, name: "Reminder A", channel: "email", trigger: "live_reminder", subject: "Reminder", body: "Body", isActive: true } }),
    db.messageTemplate.create({ data: { vendorId: vendor.id, name: "Reminder B", channel: "email", trigger: "live_reminder", subject: "Reminder", body: "Body", isActive: true } }),
    db.messageTemplate.create({ data: { vendorId: vendor.id, name: "Followup", channel: "email", trigger: "post_live_followup", subject: "Followup", body: "Body", isActive: true } }),
  ]);
  const live = await db.live.create({
    data: { vendorId: vendor.id, title: `Live ${label}`, slug: `notification-rules-live-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, scheduledAt: new Date("2026-08-20T12:00:00.000Z") },
  });
  return { vendor, reminderA, reminderB, followup, live };
}

function mustParse(input: unknown) {
  const parsed = parseLiveNotificationRules(input);
  if (!parsed.success) throw new Error(`invalid fixture: ${parsed.reason}`);
  return parsed.data;
}

function delivery(id: string, vendorId: string, liveId: string, templateId: string, trigger: string, status: string, idempotencyKey: string) {
  return {
    id,
    vendorId,
    sourceTemplateId: templateId,
    sourceLiveId: liveId,
    trigger,
    payloadEncryptedEnvelope: "disposable-envelope",
    recipientHash: `hash-${id}`,
    recipientMaskedEmail: "t***@example.test",
    idempotencyKey,
    status,
    nextAttemptAt: new Date("2026-08-20T10:00:00.000Z"),
  };
}

describe("live notification rule disposable PostgreSQL invariants", () => {
  it("persists the exact 3/3/8 tenant-owned rule limits and rejects cross-tenant templates", async () => {
    const db = getDb();
    const fixture = await createFixture("limits");
    const other = await createFixture("other-tenant");
    const rules = mustParse([
      ...[1, 60, 1440].map((offsetMinutes) => ({ id: "", trigger: "before_live", messageTemplateId: fixture.reminderA.id, offsetMinutes, sortOrder: 0, isActive: true })),
      ...[0, 10, 60].map((offsetMinutes) => ({ id: "", trigger: "during_live", messageTemplateId: fixture.reminderA.id, offsetMinutes, sortOrder: 0, isActive: true })),
      ...[0, 15, 60, 120, 1440, 2880, 4320, 10080].map((offsetMinutes) => ({ id: "", trigger: "post_live_followup", messageTemplateId: fixture.followup.id, offsetMinutes, sortOrder: 0, isActive: true })),
    ]);

    await db.$transaction((tx) => reconcileLiveNotificationRules(tx, { vendorId: fixture.vendor.id, liveId: fixture.live.id, rules }));
    await expect(db.liveNotificationRule.groupBy({
      by: ["trigger"],
      where: { vendorId: fixture.vendor.id, liveId: fixture.live.id },
      _count: { _all: true },
      orderBy: { trigger: "asc" },
    })).resolves.toEqual([
      { trigger: "before_live", _count: { _all: 3 } },
      { trigger: "during_live", _count: { _all: 3 } },
      { trigger: "post_live_followup", _count: { _all: 8 } },
    ]);

    const crossTenantRules = mustParse([{ id: "", trigger: "before_live", messageTemplateId: other.reminderA.id, offsetMinutes: 30, sortOrder: 0, isActive: true }]);
    await expect(db.$transaction((tx) => reconcileLiveNotificationRules(tx, {
      vendorId: fixture.vendor.id,
      liveId: fixture.live.id,
      rules: crossTenantRules,
    }))).rejects.toBeTruthy();
  }, 15_000);

  it("preserves unchanged identities and supersedes queued or failed snapshots for changed and removed rules", async () => {
    const db = getDb();
    const fixture = await createFixture("reconcile");
    const initial = mustParse([
      { id: "", trigger: "before_live", messageTemplateId: fixture.reminderA.id, offsetMinutes: 60, sortOrder: 0, isActive: true },
      { id: "", trigger: "during_live", messageTemplateId: fixture.reminderB.id, offsetMinutes: 10, sortOrder: 0, isActive: true },
      { id: "", trigger: "post_live_followup", messageTemplateId: fixture.followup.id, offsetMinutes: 15, sortOrder: 0, isActive: true },
      { id: "", trigger: "post_live_followup", messageTemplateId: fixture.followup.id, offsetMinutes: 30, sortOrder: 1, isActive: true },
    ]);
    await db.$transaction((tx) => reconcileLiveNotificationRules(tx, { vendorId: fixture.vendor.id, liveId: fixture.live.id, rules: initial }));
    const persisted = await db.liveNotificationRule.findMany({ where: { vendorId: fixture.vendor.id, liveId: fixture.live.id }, orderBy: { trigger: "asc" } });
    const before = persisted.find((rule) => rule.trigger === "before_live")!;
    const during = persisted.find((rule) => rule.trigger === "during_live")!;
    const post = persisted.find((rule) => rule.trigger === "post_live_followup" && rule.offsetMinutes === 15)!;
    const postSibling = persisted.find((rule) => rule.trigger === "post_live_followup" && rule.offsetMinutes === 30)!;
    await db.emailDelivery.createMany({ data: [
      delivery("delivery-before-sent", fixture.vendor.id, fixture.live.id, fixture.reminderA.id, "live_reminder", "sent", "before-sent"),
      delivery("delivery-during-queued", fixture.vendor.id, fixture.live.id, fixture.reminderB.id, "live_reminder", "queued", "during-queued"),
      delivery("delivery-post-failed", fixture.vendor.id, fixture.live.id, fixture.followup.id, "post_live_followup", "failed", `${postLiveFollowupIdempotencyPrefix(post.id)}failed`),
      delivery("delivery-post-sibling", fixture.vendor.id, fixture.live.id, fixture.followup.id, "post_live_followup", "queued", `${postLiveFollowupIdempotencyPrefix(postSibling.id)}queued`),
    ] });

    const next = mustParse([
      { id: before.id, trigger: "before_live", messageTemplateId: fixture.reminderA.id, offsetMinutes: 60, sortOrder: 0, isActive: true },
      { id: post.id, trigger: "post_live_followup", messageTemplateId: fixture.followup.id, offsetMinutes: 45, sortOrder: 0, isActive: true },
      { id: postSibling.id, trigger: "post_live_followup", messageTemplateId: fixture.followup.id, offsetMinutes: 30, sortOrder: 1, isActive: true },
    ]);
    await db.$transaction((tx) => reconcileLiveNotificationRules(tx, { vendorId: fixture.vendor.id, liveId: fixture.live.id, rules: next }));

    await expect(db.liveNotificationRule.findUniqueOrThrow({ where: { id: before.id } })).resolves.toMatchObject({ id: before.id, offsetMinutes: 60 });
    await expect(db.liveNotificationRule.findUniqueOrThrow({ where: { id: post.id } })).resolves.toMatchObject({ id: post.id, offsetMinutes: 45 });
    await expect(db.liveNotificationRule.findUniqueOrThrow({ where: { id: postSibling.id } })).resolves.toMatchObject({ id: postSibling.id, offsetMinutes: 30 });
    await expect(db.liveNotificationRule.findUnique({ where: { id: during.id } })).resolves.toBeNull();
    await expect(db.emailDelivery.findMany({
      where: { id: { in: ["delivery-before-sent", "delivery-during-queued", "delivery-post-failed", "delivery-post-sibling"] } },
      orderBy: { id: "asc" },
      select: { id: true, status: true, nextAttemptAt: true, claimedAt: true, lastErrorCode: true },
    })).resolves.toEqual([
      { id: "delivery-before-sent", status: "sent", nextAttemptAt: new Date("2026-08-20T10:00:00.000Z"), claimedAt: null, lastErrorCode: null },
      { id: "delivery-during-queued", status: "queued", nextAttemptAt: new Date("2026-08-20T10:00:00.000Z"), claimedAt: null, lastErrorCode: null },
      { id: "delivery-post-failed", status: "superseded", nextAttemptAt: null, claimedAt: null, lastErrorCode: "config_superseded" },
      { id: "delivery-post-sibling", status: "queued", nextAttemptAt: new Date("2026-08-20T10:00:00.000Z"), claimedAt: null, lastErrorCode: null },
    ]);
  });
});
