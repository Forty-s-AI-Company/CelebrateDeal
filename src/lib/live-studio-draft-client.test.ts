import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyLiveStudioDraft } from "./live-studio-draft";
import { LiveStudioDraftClientError, liveStudioDraftFromFormData, saveLiveStudioDraft } from "./live-studio-draft-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("serializeLiveStudioDraft", () => {
  it("serializes only the bounded product-facing fields", () => {
    const form = formData([
      ["studioPreset", "COMMERCE"],
      ["title", "新品直播"],
      ["slug", "new-products"],
      ["productIds", "product-1"],
      ["productIds", "product-2"],
      ["messageTemplateId", "registration-template-1"],
      ["liveReminderTemplateId", "reminder-template-1"],
      ["liveReminderOffsetMinutes", "30"],
      ["notificationRules", JSON.stringify([{
        id: "rule-1",
        trigger: "before_live",
        messageTemplateId: "reminder-template-1",
        offsetMinutes: 60,
        sortOrder: 0,
        isActive: true,
      }])],
      ["streamMode", "vod"],
      ["affiliateMode", "enabled"],
      ["maxConcurrentViewers", "500"],
      ["stopWhenCreditsBelow", "300"],
      ["usageAttributionMode", "PROMOTER"],
      ["quotaPayerScope", "VENDOR"],
      ["splitOwnerBps", "3000"],
      ["splitPromoterBps", "7000"],
      ["replayEnabled", "on"],
      ["replayAvailableUntil", "2026-08-21T20:00"],
      ["cloudflareLiveInputUid", "forged-provider-uid"],
    ]);

    const draft = liveStudioDraftFromFormData(form, 7);

    expect(draft).toMatchObject({
      studioPreset: "COMMERCE",
      title: "新品直播",
      productIds: ["product-1", "product-2"],
      messageTemplateId: "registration-template-1",
      liveReminderTemplateId: "reminder-template-1",
      liveReminderOffsetMinutes: "30",
      notificationRules: [expect.objectContaining({ id: "rule-1", trigger: "before_live", offsetMinutes: 60 })],
      replayEnabled: true,
      replayAvailableUntil: "2026-08-21T20:00",
      flowVersion: 2,
      activeStep: 7,
    });
    expect(draft).not.toHaveProperty("cloudflareLiveInputUid");
  });

  it("keeps CUSTOM for legacy forms that predate the purpose starter", () => {
    const draft = liveStudioDraftFromFormData(formData([
      ["streamMode", "vod"],
      ["affiliateMode", "enabled"],
      ["maxConcurrentViewers", "500"],
      ["stopWhenCreditsBelow", "300"],
      ["usageAttributionMode", "PROMOTER"],
      ["quotaPayerScope", "VENDOR"],
      ["splitOwnerBps", "3000"],
      ["splitPromoterBps", "7000"],
    ]), 0);

    expect(draft.studioPreset).toBe("CUSTOM");
  });

  it("keeps the safe reminder default when a legacy form has no offset", () => {
    const draft = liveStudioDraftFromFormData(formData([
      ["title", "舊版草稿"],
      ["streamMode", "vod"],
      ["affiliateMode", "enabled"],
      ["maxConcurrentViewers", "500"],
      ["stopWhenCreditsBelow", "300"],
      ["usageAttributionMode", "PROMOTER"],
      ["quotaPayerScope", "VENDOR"],
      ["splitOwnerBps", "3000"],
      ["splitPromoterBps", "7000"],
    ]), 1);

    expect(draft.liveReminderTemplateId).toBe("");
    expect(draft.liveReminderOffsetMinutes).toBe("60");
    expect(draft.notificationRules).toEqual([]);
    expect(draft.replayAvailableUntil).toBe("");
  });

  it("clears the submitted replay deadline when replay is disabled", () => {
    const draft = liveStudioDraftFromFormData(formData([
      ["streamMode", "vod"],
      ["affiliateMode", "enabled"],
      ["maxConcurrentViewers", "500"],
      ["stopWhenCreditsBelow", "300"],
      ["usageAttributionMode", "PROMOTER"],
      ["quotaPayerScope", "VENDOR"],
      ["splitOwnerBps", "3000"],
      ["splitPromoterBps", "7000"],
      ["replayAvailableUntil", "2026-08-21T20:00"],
    ]), 4);

    expect(draft.replayEnabled).toBe(false);
    expect(draft.replayAvailableUntil).toBe("");
  });
});

describe("saveLiveStudioDraft", () => {
  it("sends a CSRF-bound same-origin optimistic revision and validates the response", async () => {
    const payload = { ...emptyLiveStudioDraft(), replayAvailableUntil: "2026-08-21T20:00" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "draft-1",
      revision: 2,
      payload,
      updatedAt: "2026-08-08T01:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveLiveStudioDraft({ csrfToken: "csrf-test", draftId: "draft-1", liveId: "live-1", revision: 1, payload })).resolves.toMatchObject({ id: "draft-1", revision: 2 });
    expect(fetchMock).toHaveBeenCalledWith("/api/live-studio/drafts", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: expect.objectContaining({ "x-csrf-token": "csrf-test", "x-celebratedeal-client": "web" }),
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      draftId: "draft-1",
      liveId: "live-1",
      revision: 1,
      payload: { flowVersion: 2, activeStep: 0, replayAvailableUntil: "2026-08-21T20:00" },
    });
  });

  it("surfaces optimistic conflicts without leaking arbitrary response details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "DRAFT_CONFLICT" }, detail: "database-secret" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    })));

    await expect(saveLiveStudioDraft({ csrfToken: "csrf-test", draftId: "draft-1", liveId: "", revision: 1, payload: emptyLiveStudioDraft() })).rejects.toEqual(expect.objectContaining({ code: "draft_conflict" }));
  });

  it("rejects malformed success envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "draft-1", revision: 0, payload: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    await expect(saveLiveStudioDraft({ csrfToken: "csrf-test", draftId: "", liveId: "", revision: null, payload: emptyLiveStudioDraft() })).rejects.toBeInstanceOf(LiveStudioDraftClientError);
  });
});

function formData(entries: Array<[string, string]>) {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
}
