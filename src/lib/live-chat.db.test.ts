import { afterEach, describe, expect, it } from "vitest";
import { classifyLocalTestDatabase } from "../../scripts/local-database-safety";
import { getDb } from "@/lib/db";
import { createFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";
import { buildViewerChatMessageId, createViewerChatMessage } from "@/lib/live-chat";
import { hashLiveViewerToken } from "@/lib/live-quota-admission";

const enabled = process.env.RT01_D2_DISPOSABLE_DB === "true";
const databaseIsDisposable = (() => {
  const value = process.env.DATABASE_URL;
  if (!classifyLocalTestDatabase(value).safe || !value) return false;
  try {
    const databaseName = decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ""));
    return /^celebratedeal_(?:test|e2e|ci)$/iu.test(databaseName);
  } catch {
    return false;
  }
})();
const createdVendorIds: string[] = [];

afterEach(async () => {
  if (!enabled || !databaseIsDisposable || createdVendorIds.length === 0) return;
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

describe.skipIf(!enabled || !databaseIsDisposable)("RT-01 D2 disposable database contract", () => {
  it("converges concurrent domain posts to one server-owned viewer row", async () => {
    const db = getDb();
    const now = new Date("2026-08-17T00:00:00.000Z");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const vendor = await db.vendor.create({
      data: {
        name: `RT01 D2 ${suffix}`,
        slug: `rt01-d2-${suffix}`,
        email: `rt01-d2-${suffix}@example.test`,
        passwordHash: "disposable-test-only",
      },
    });
    createdVendorIds.push(vendor.id);
    const form = await db.registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: "RT01 D2 form",
        slug: `rt01-d2-form-${suffix}`,
        headline: "RT01 D2",
        fields: [],
      },
    });
    const live = await db.live.create({
      data: {
        vendorId: vendor.id,
        formId: form.id,
        title: "RT01 D2 live",
        slug: `rt01-d2-live-${suffix}`,
        scheduledAt: now,
      },
    });
    const submission = await db.formSubmission.create({
      data: {
        formId: form.id,
        liveId: live.id,
        name: "Disposable Viewer",
        email: `viewer-${suffix}@example.test`,
        verificationStatus: "VERIFIED",
      },
    });
    const admissionToken = "A".repeat(43);
    await db.liveViewerSession.create({
      data: {
        vendorId: vendor.id,
        liveId: live.id,
        tokenHash: hashLiveViewerToken(admissionToken),
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + 90_000),
      },
    });
    const chatSessionToken = createFormSubmissionChatSessionToken({ submissionId: submission.id, now: new Date(now.getTime() - 1_000) });
    const input = {
      vendorId: vendor.id,
      liveId: live.id,
      clientMessageId: "123e4567-e89b-12d3-a456-426614174000",
      body: "disposable message",
      chatSessionToken,
      admissionToken,
      ipAddress: "203.0.113.7",
      now,
    };
    const id = buildViewerChatMessageId({
      vendorId: vendor.id,
      liveId: live.id,
      submissionId: submission.id,
      clientMessageId: input.clientMessageId,
    });

    const results = await Promise.all([
      createViewerChatMessage(db, input),
      createViewerChatMessage(db, input),
    ]);
    const rows = await db.liveChatMessage.findMany({ where: { id } });

    expect(results.map((result) => result.message.id)).toEqual([id, id]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      source: "viewer",
      roleId: null,
      formSubmissionId: submission.id,
      isSimulated: false,
      status: "visible",
    });
  });
});
