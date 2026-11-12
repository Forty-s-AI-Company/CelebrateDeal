import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorManagerContext: vi.fn(),
  writeAuditLog: vi.fn(),
  revalidatePath: vi.fn(),
  saveEmailSequence: vi.fn(),
  activateEmailSequence: vi.fn(),
  pauseEmailSequence: vi.fn(),
  deleteEmailSequence: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: runtime.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: runtime.requireVendorManagerContext }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: runtime.writeAuditLog }));
vi.mock("next/cache", () => ({ revalidatePath: runtime.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { path }); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("@/lib/email-sequences", () => ({
  saveEmailSequence: runtime.saveEmailSequence,
  activateEmailSequence: runtime.activateEmailSequence,
  pauseEmailSequence: runtime.pauseEmailSequence,
  deleteEmailSequence: runtime.deleteEmailSequence,
}));

import {
  activateEmailSequenceAction,
  deleteEmailSequenceAction,
  pauseEmailSequenceAction,
  saveEmailSequenceAction,
} from "./email-sequence-actions";
import { initialEmailSequenceActionState } from "@/lib/email-sequence-rules";

const grantedVendor = { id: "vendor-1", enabledFeatureModules: [], betaFeatureGrants: ["email_sequences"] };

function context(vendor: object = grantedVendor, role = "owner") {
  return { auth: { user: { id: "user-1" }, member: { role } }, vendor };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const validFields = {
  name: "報名後追銷",
  liveId: "live-1",
  stepCount: "2",
  "steps.0.delayValue": "1",
  "steps.0.delayUnit": "hours",
  "steps.0.messageTemplateId": "template-1",
  "steps.0.isActive": "on",
  "steps.1.delayValue": "3",
  "steps.1.delayUnit": "days",
  "steps.1.messageTemplateId": "template-2",
};

async function outcome(promise: Promise<unknown>) {
  try {
    return { value: await promise };
  } catch (error) {
    return { error: error as Error & { path?: string } };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.assertServerActionSecurity.mockResolvedValue(undefined);
  runtime.requireVendorManagerContext.mockResolvedValue(context());
  runtime.saveEmailSequence.mockResolvedValue({ ok: true, id: "seq-1", version: 1, created: true });
  runtime.activateEmailSequence.mockResolvedValue({ ok: true, status: "activated" });
  runtime.pauseEmailSequence.mockResolvedValue({ ok: true, status: "paused", cancelledRuns: 3 });
  runtime.deleteEmailSequence.mockResolvedValue({ ok: true });
});

describe("saveEmailSequenceAction", () => {
  it("checks CSRF and the manager guard before anything else", async () => {
    runtime.requireVendorManagerContext.mockRejectedValueOnce(Object.assign(new Error("NEXT_REDIRECT"), { path: "/dashboard?error=insufficient_role" }));
    const result = await outcome(saveEmailSequenceAction(initialEmailSequenceActionState, form(validFields)));
    expect(result.error?.path).toBe("/dashboard?error=insufficient_role");
    expect(runtime.assertServerActionSecurity).toHaveBeenCalledOnce();
    expect(runtime.saveEmailSequence).not.toHaveBeenCalled();
  });

  it("refuses while the email_sequences grant is closed, without writing", async () => {
    runtime.requireVendorManagerContext.mockResolvedValueOnce(context({ ...grantedVendor, betaFeatureGrants: [] }));
    const result = await outcome(saveEmailSequenceAction(initialEmailSequenceActionState, form(validFields)));
    expect(result.error).toMatchObject({ name: "FeatureDisabledError", code: "FEATURE_DISABLED", feature: "email_sequences" });
    expect(runtime.saveEmailSequence).not.toHaveBeenCalled();
  });

  it("converts hours and days to minutes and saves for the session's vendor only", async () => {
    const result = await outcome(saveEmailSequenceAction(initialEmailSequenceActionState, form({ ...validFields, vendorId: "vendor-2" })));
    expect(result.error?.path).toBe("/messages/sequences?notice=created");
    expect(runtime.saveEmailSequence).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      sequenceId: null,
      expectedVersion: null,
      data: {
        name: "報名後追銷",
        liveId: "live-1",
        steps: [
          { id: null, delayMinutes: 60, messageTemplateId: "template-1", isActive: true },
          { id: null, delayMinutes: 4_320, messageTemplateId: "template-2", isActive: false },
        ],
      },
    });
    expect(runtime.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ vendorId: "vendor-1", action: "email_sequence_created", targetId: "seq-1", actorId: "user-1" }));
    expect(runtime.revalidatePath).toHaveBeenCalledWith("/messages/sequences");
  });

  it("returns field errors and keeps the draft for invalid input", async () => {
    const state = await saveEmailSequenceAction(initialEmailSequenceActionState, form({
      ...validFields,
      name: "",
      "steps.0.delayValue": "30",
      "steps.0.delayUnit": "days",
      "steps.1.delayValue": "0",
      "steps.1.messageTemplateId": "",
    }));
    expect(state).toMatchObject({
      status: "error",
      errorVersion: 1,
      fieldErrors: {
        name: expect.any(String),
        "steps.1.delayValue": expect.any(String),
        "steps.1.messageTemplateId": expect.any(String),
      },
      draft: { name: "", liveId: "live-1" },
    });
    expect(state.fieldErrors["steps.0.delayValue"]).toBeUndefined();
    expect(state.draft?.steps).toHaveLength(2);
    expect(runtime.saveEmailSequence).not.toHaveBeenCalled();
  });

  it("rejects delays outside 1 hour to 90 days, duplicate delays and more than ten steps", async () => {
    const tooLong = await saveEmailSequenceAction(initialEmailSequenceActionState, form({ ...validFields, "steps.1.delayValue": "91" }));
    expect(tooLong.fieldErrors["steps.1.delayValue"]).toContain("90 天");
    const duplicate = await saveEmailSequenceAction(initialEmailSequenceActionState, form({ ...validFields, "steps.1.delayValue": "24", "steps.1.delayUnit": "hours", "steps.0.delayValue": "1", "steps.0.delayUnit": "days" }));
    expect(duplicate.fieldErrors["steps.1.delayValue"]).toContain("相同");
    const many: Record<string, string> = { name: "多", liveId: "live-1", stepCount: "11" };
    for (let index = 0; index < 11; index += 1) {
      many[`steps.${index}.delayValue`] = String(index + 1);
      many[`steps.${index}.delayUnit`] = "days";
      many[`steps.${index}.messageTemplateId`] = "template-1";
    }
    const tooMany = await saveEmailSequenceAction(initialEmailSequenceActionState, form(many));
    expect(tooMany.message).toContain("最多 10 封");
    expect(runtime.saveEmailSequence).not.toHaveBeenCalled();
  });

  it("reports an optimistic-lock conflict and keeps what the merchant typed", async () => {
    runtime.saveEmailSequence.mockResolvedValueOnce({ ok: false, code: "conflict" });
    const state = await saveEmailSequenceAction(
      { ...initialEmailSequenceActionState, expectedVersion: 4 },
      form({ ...validFields, sequenceId: "seq-1", expectedVersion: "4" }),
    );
    expect(runtime.saveEmailSequence).toHaveBeenCalledWith(expect.objectContaining({ sequenceId: "seq-1", expectedVersion: 4 }));
    expect(state).toMatchObject({ status: "error", expectedVersion: 4, message: expect.stringContaining("其他分頁"), draft: { name: "報名後追銷" } });
    expect(runtime.writeAuditLog).not.toHaveBeenCalled();
  });

  it("passes the service's ownership field errors through", async () => {
    runtime.saveEmailSequence.mockResolvedValueOnce({ ok: false, code: "invalid", message: "有幾個欄位需要修正，內容已保留。", fieldErrors: { liveId: "找不到這場直播，請重新選擇。" } });
    const state = await saveEmailSequenceAction(initialEmailSequenceActionState, form(validFields));
    expect(state.fieldErrors).toEqual({ liveId: "找不到這場直播，請重新選擇。" });
  });

  it("treats a malformed sequence id or missing version as not found", async () => {
    const state = await saveEmailSequenceAction(initialEmailSequenceActionState, form({ ...validFields, sequenceId: "../x", expectedVersion: "1" }));
    expect(state.message).toContain("找不到");
    const noVersion = await saveEmailSequenceAction(initialEmailSequenceActionState, form({ ...validFields, sequenceId: "seq-1" }));
    expect(noVersion.message).toContain("找不到");
    expect(runtime.saveEmailSequence).not.toHaveBeenCalled();
  });
});

describe("activate / pause / delete actions", () => {
  it.each([
    ["activate", activateEmailSequenceAction, "activateEmailSequence", "/messages/sequences?notice=activated", "email_sequence_activated"],
    ["pause", pauseEmailSequenceAction, "pauseEmailSequence", "/messages/sequences?notice=paused", "email_sequence_paused"],
    ["delete", deleteEmailSequenceAction, "deleteEmailSequence", "/messages/sequences?notice=deleted", "email_sequence_deleted"],
  ] as const)("%s binds the sequence to the session's vendor and the submitted version", async (_label, action, service, path, audit) => {
    const result = await outcome(action(form({ sequenceId: "seq-1", expectedVersion: "2", vendorId: "vendor-2" })));
    expect(result.error?.path).toBe(path);
    expect(runtime[service]).toHaveBeenCalledWith({ vendorId: "vendor-1", sequenceId: "seq-1", expectedVersion: 2 });
    expect(runtime.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ vendorId: "vendor-1", action: audit, targetId: "seq-1" }));
  });

  it("redirects service failures to a bounded error code", async () => {
    runtime.activateEmailSequence.mockResolvedValueOnce({ ok: false, code: "active_limit" });
    expect((await outcome(activateEmailSequenceAction(form({ sequenceId: "seq-1", expectedVersion: "1" })))).error?.path).toBe("/messages/sequences?error=active_limit");
    runtime.activateEmailSequence.mockResolvedValueOnce({ ok: false, code: "not_ready", message: "x" });
    expect((await outcome(activateEmailSequenceAction(form({ sequenceId: "seq-1", expectedVersion: "1" })))).error?.path).toBe("/messages/sequences?error=not_ready");
    runtime.pauseEmailSequence.mockResolvedValueOnce({ ok: false, code: "conflict" });
    expect((await outcome(pauseEmailSequenceAction(form({ sequenceId: "seq-1", expectedVersion: "1" })))).error?.path).toBe("/messages/sequences?error=conflict");
    expect(runtime.writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects malformed input and a closed grant before calling the service", async () => {
    expect((await outcome(deleteEmailSequenceAction(form({ sequenceId: "a b", expectedVersion: "1" })))).error?.path).toBe("/messages/sequences?error=not_found");
    expect((await outcome(deleteEmailSequenceAction(form({ sequenceId: "seq-1" })))).error?.path).toBe("/messages/sequences?error=not_found");
    runtime.requireVendorManagerContext.mockResolvedValueOnce(context({ ...grantedVendor, betaFeatureGrants: [] }));
    expect((await outcome(activateEmailSequenceAction(form({ sequenceId: "seq-1", expectedVersion: "1" })))).error).toMatchObject({ code: "FEATURE_DISABLED" });
    expect(runtime.deleteEmailSequence).not.toHaveBeenCalled();
    expect(runtime.activateEmailSequence).not.toHaveBeenCalled();
  });
});
