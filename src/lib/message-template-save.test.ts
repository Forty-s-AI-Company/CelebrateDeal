import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    messageTemplate: { create: vi.fn(), update: vi.fn() },
    live: { findMany: vi.fn() },
    emailSequenceStep: { findFirst: vi.fn(async () => null) },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
      messageTemplate: { findFirst: vi.fn() },
    },
    writeAuditLog: vi.fn(),
    supersede: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/live-notification-delivery", () => ({ supersedeLiveNotificationDeliveriesForTemplate: mocks.supersede }));
vi.mock("@/lib/live-reminder-reconciliation", () => ({
  createLiveReminderReconciliationSnapshot: (input: unknown) => input,
  queueLiveReminderReconciliation: vi.fn(async () => ({ status: "queued" })),
}));

import { initialMessageTemplateActionState } from "@/lib/message-template";
import { saveMessageTemplate } from "./message-template-save";

const actor = { actorId: "user-1", actorLabel: "owner" };

function formData(values: Record<string, string> = {}) {
  const data = new FormData();
  const defaults = { name: "報名成功通知", channel: "email", trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} 你好", isActive: "on" };
  for (const [key, value] of Object.entries({ ...defaults, ...values })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.messageTemplate.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "template-created", ...data }));
  mocks.tx.live.findMany.mockResolvedValue([]);
});

describe("saveMessageTemplate", () => {
  it("creates the template for the given vendor, writes the audit log and returns the id", async () => {
    const result = await saveMessageTemplate({ vendorId: "vendor-1", auditActor: actor, previousState: initialMessageTemplateActionState, formData: formData() });

    expect(result).toEqual({
      ok: true,
      template: { id: "template-created", name: "報名成功通知", channel: "email", trigger: "registration_confirmed", subject: "{{live_title}} 報名成功", body: "{{name}} 你好", isActive: true },
      reconciliationStatuses: [],
    });
    expect(mocks.tx.messageTemplate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: "vendor-1" }) });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-1",
      actorId: "user-1",
      action: "message_template_created",
      targetId: "template-created",
    }));
    expect(mocks.supersede).not.toHaveBeenCalled();
  });

  it("returns the editor's invalid state without writing for unsupported variables", async () => {
    const result = await saveMessageTemplate({ vendorId: "vendor-1", auditActor: actor, previousState: initialMessageTemplateActionState, formData: formData({ body: "{{coupon_code}}" }) });

    expect(result).toMatchObject({ ok: false, state: { status: "error", error: "invalid_template", version: 1 } });
    expect(mocks.tx.messageTemplate.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("reports a version conflict for an update of a newer template", async () => {
    mocks.tx.messageTemplate.update.mockRejectedValue({ code: "P2025" });
    mocks.db.messageTemplate.findFirst.mockResolvedValue({ updatedAt: new Date("2026-08-10T02:00:00.000Z") });

    const result = await saveMessageTemplate({
      vendorId: "vendor-1",
      auditActor: actor,
      previousState: initialMessageTemplateActionState,
      formData: formData({ id: "template-1", expectedUpdatedAt: "2026-08-10T01:00:00.000Z" }),
    });

    expect(result).toMatchObject({ ok: false, state: { error: "conflict", expectedUpdatedAt: "2026-08-10T02:00:00.000Z" } });
    expect(mocks.db.messageTemplate.findFirst).toHaveBeenCalledWith({ where: { id: "template-1", vendorId: "vendor-1" }, select: { updatedAt: true } });
  });
});
