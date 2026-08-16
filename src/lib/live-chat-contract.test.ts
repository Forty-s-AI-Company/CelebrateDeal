import { describe, expect, it } from "vitest";

import {
  isEligibleScheduledRole,
  normalizeScheduledRole,
  normalizeScheduledRuntimeMessage,
  type RuntimeChatMessage,
  type ScheduledRoleSource,
  type ViewerRuntimeMessage,
} from "./live-chat-contract";

function role(overrides: Partial<ScheduledRoleSource> = {}): ScheduledRoleSource {
  return {
    vendorId: "vendor-1",
    name: "直播小編",
    avatarUrl: "https://cdn.example.test/avatar.png",
    label: "官方角色",
    roleType: "official",
    isActive: true,
    isScheduled: true,
    ...overrides,
  };
}

function event(overrides: Partial<{ id: string; eventType: string; triggerSec: number; message: string | null }> = {}) {
  return {
    id: "event-1",
    eventType: "chat_message",
    triggerSec: 15,
    message: "  歡迎來到直播  ",
    ...overrides,
  };
}

describe("live chat runtime contract", () => {
  it("builds an official scheduled DTO without exposing database identity", () => {
    const dto = normalizeScheduledRuntimeMessage({
      vendorId: "vendor-1",
      event: event(),
      role: role({ roleType: "ai_host" }),
    });

    expect(dto).toEqual({
      id: "event-1",
      source: "scheduled",
      triggerSec: 15,
      body: "歡迎來到直播",
      actor: {
        name: "直播小編",
        avatarUrl: "https://cdn.example.test/avatar.png",
        label: "官方角色",
        presentationRole: "official",
      },
    });
    expect(dto).not.toHaveProperty("roleId");
    expect(dto).not.toHaveProperty("submissionId");
    expect(dto).not.toHaveProperty("email");
    expect(dto).not.toHaveProperty("phone");
    expect(dto).not.toHaveProperty("roleType");
  });

  it("keeps an audience role visually distinct while fixing source to scheduled", () => {
    const dto = normalizeScheduledRuntimeMessage({
      vendorId: "vendor-1",
      event: event({ eventType: "reminder" }),
      role: role({ roleType: "audience", label: "一般觀眾" }),
    });

    expect(dto?.source).toBe("scheduled");
    expect(dto?.actor).toEqual(expect.objectContaining({
      label: "一般觀眾",
      presentationRole: "audience",
    }));
  });

  it.each([
    ["missing role", null, "vendor-1"],
    ["cross-tenant role", role({ vendorId: "vendor-2" }), "vendor-1"],
    ["inactive role", role({ isActive: false }), "vendor-1"],
    ["non-scheduled role", role({ isScheduled: false }), "vendor-1"],
    ["unknown legacy role", role({ roleType: "legacy-invalid" }), "vendor-1"],
  ])("fails closed for %s", (_label, sourceRole, vendorId) => {
    expect(isEligibleScheduledRole(sourceRole, vendorId)).toBe(false);
    expect(normalizeScheduledRuntimeMessage({ vendorId, event: event(), role: sourceRole })).toBeNull();
  });

  it("rejects malformed scheduled events instead of emitting an unsafe DTO", () => {
    expect(normalizeScheduledRuntimeMessage({
      vendorId: "vendor-1",
      event: event({ id: "", message: "訊息" }),
      role: role(),
    })).toBeNull();
    expect(normalizeScheduledRuntimeMessage({
      vendorId: "vendor-1",
      event: event({ triggerSec: -1 }),
      role: role(),
    })).toBeNull();
    expect(normalizeScheduledRuntimeMessage({
      vendorId: "vendor-1",
      event: event({ eventType: "product_spotlight" }),
      role: role(),
    })).toBeNull();
  });

  it("keeps the viewer union free of submission and contact fields", () => {
    const viewer: ViewerRuntimeMessage = {
      id: "message-1",
      source: "viewer",
      createdAt: "2026-08-15T10:00:00.000Z",
      body: "我想了解更多",
      actor: { name: "小明" },
    };
    const messages: RuntimeChatMessage[] = [viewer];

    expect(messages[0]).not.toHaveProperty("submissionId");
    expect(messages[0]).not.toHaveProperty("formSubmissionId");
    expect(messages[0]).not.toHaveProperty("email");
    expect(messages[0]).not.toHaveProperty("phone");
  });

  it("normalizes a safe role presentation without returning the source role id", () => {
    const source = { ...role(), roleId: "role-secret", email: "private@example.test" } as ScheduledRoleSource;
    const presentation = normalizeScheduledRole(source, "vendor-1");

    expect(presentation).toEqual(expect.objectContaining({ presentationRole: "official" }));
    expect(presentation).not.toHaveProperty("roleId");
    expect(presentation).not.toHaveProperty("email");
  });
});
