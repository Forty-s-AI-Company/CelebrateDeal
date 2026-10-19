import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { realViewerMessageWhere } from "@/lib/live-chat-analytics";

const vendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

describe("live chat analytics on a disposable database", () => {
  it("counts only the real viewer message when a virtual-user message exists in the same live", async () => {
    const db = getDb();
    const suffix = randomUUID();
    const vendor = await db.vendor.create({ data: { name: "Chat analytics fixture", slug: suffix, email: `${suffix}@example.test`, passwordHash: "disposable-only" } });
    vendorIds.push(vendor.id);
    const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Fixture", slug: suffix, headline: "Fixture", fields: [] } });
    const live = await db.live.create({ data: { vendorId: vendor.id, formId: form.id, title: "Fixture", slug: suffix, scheduledAt: new Date(), status: "live" } });
    const submission = await db.formSubmission.create({ data: { formId: form.id, liveId: live.id, name: "Synthetic viewer", email: `${randomUUID()}@example.test` } });
    const role = await db.interactionRole.create({ data: { vendorId: vendor.id, name: "虛擬使用者", label: "", isScheduled: true } });

    await db.liveChatMessage.create({ data: { vendorId: vendor.id, liveId: live.id, formSubmissionId: submission.id, authorName: "真實觀眾", body: "真人留言", source: "viewer", isSimulated: false } });
    await db.liveChatMessage.create({ data: { vendorId: vendor.id, liveId: live.id, roleId: role.id, authorName: role.name, body: "腳本留言", source: "scheduled", isSimulated: true } });

    const counted = await db.liveChatMessage.count({ where: realViewerMessageWhere({ vendorId: vendor.id, liveId: live.id }) });
    expect(counted).toBe(1);
  });
});
