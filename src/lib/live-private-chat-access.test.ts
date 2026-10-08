import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFormSubmissionChatSessionToken } from "./form-submission-chat-session";
import { resolveVerifiedPrivateChatViewer } from "./live-chat";

const now = new Date("2026-10-07T00:00:00Z");
function fixture() {
  const input = {
    vendorId: "tenant-a", liveId: "live-a", admissionToken: "A".repeat(43),
    chatSessionToken: createFormSubmissionChatSessionToken({ submissionId: "viewer-a", now }),
    ipAddress: "203.0.113.5", now,
  };
  const db = {
    liveViewerSession: { findUnique: vi.fn().mockResolvedValue({ vendorId: input.vendorId, liveId: input.liveId, expiresAt: new Date(now.getTime() + 60_000) }) },
    formSubmission: { findFirst: vi.fn().mockResolvedValue({ id: "viewer-a", name: "王小明", email: "synthetic@example.test", phone: null, formId: "form-a", live: { formId: "form-a" } }) },
    blacklist: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { input, db };
}
beforeEach(() => vi.stubEnv("CSRF_SECRET", "private-chat-synthetic-key-longer-than-thirty-two-bytes"));
afterEach(() => vi.unstubAllEnvs());

it("returns only server-owned scoped identity, without contact or bearer data", async () => {
  const { db, input } = fixture();
  expect(await resolveVerifiedPrivateChatViewer(db as never, input)).toEqual({
    vendorId: "tenant-a", liveId: "live-a", submissionId: "viewer-a", displayName: "王小明",
  });
  expect(db.formSubmission.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
    id: "viewer-a", liveId: "live-a", verificationStatus: "VERIFIED",
    form: { vendorId: "tenant-a" }, live: { id: "live-a", vendorId: "tenant-a" },
  } }));
});
it.each(["tenant", "live", "expired"])("rejects %s admission before reading private identity", async kind => {
  const { db, input } = fixture();
  db.liveViewerSession.findUnique.mockResolvedValue({
    vendorId: kind === "tenant" ? "tenant-b" : input.vendorId,
    liveId: kind === "live" ? "live-b" : input.liveId,
    expiresAt: kind === "expired" ? now : new Date(now.getTime() + 60_000),
  });
  await expect(resolveVerifiedPrivateChatViewer(db as never, input)).rejects.toMatchObject({ code: "access_denied" });
  expect(db.formSubmission.findFirst).not.toHaveBeenCalled();
});
it("rejects unsigned viewer identity and revoked verification", async () => {
  const { db, input } = fixture();
  await expect(resolveVerifiedPrivateChatViewer(db as never, { ...input, chatSessionToken: "viewer-b" })).rejects.toMatchObject({ code: "access_denied" });
  expect(db.formSubmission.findFirst).not.toHaveBeenCalled();
  db.formSubmission.findFirst.mockResolvedValue(null);
  await expect(resolveVerifiedPrivateChatViewer(db as never, input)).rejects.toMatchObject({ code: "access_denied" });
});
it("rejects changed form binding and newly blacklisted viewers", async () => {
  const { db, input } = fixture();
  db.formSubmission.findFirst.mockResolvedValue({ id: "viewer-a", name: "王小明", email: "synthetic@example.test", phone: null, formId: "form-a", live: { formId: "form-b" } });
  await expect(resolveVerifiedPrivateChatViewer(db as never, input)).rejects.toMatchObject({ code: "access_denied" });
  db.formSubmission.findFirst.mockResolvedValue({ id: "viewer-a", name: "王小明", email: "synthetic@example.test", phone: null, formId: "form-a", live: { formId: "form-a" } });
  db.blacklist.findMany.mockResolvedValue([{ identifier: "synthetic@example.test", identifierType: "email" }]);
  await expect(resolveVerifiedPrivateChatViewer(db as never, input)).rejects.toMatchObject({ code: "blocked" });
});
