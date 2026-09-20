import { describe, expect, it } from "vitest";
import {
  currentWarmup,
  projectWarmup,
  ScriptedCommandSchema,
  ScriptedStateSchema,
} from "./scripted-roles-contract";

describe("scripted roles contract", () => {
  it("accepts strict scripted state and commands", () => {
    expect(
      ScriptedStateSchema.parse({
        scriptId: "script-1",
        enabled: true,
        scheduled: false,
        manual: null,
      }),
    ).toMatchObject({ scriptId: "script-1", enabled: true });

    expect(
      ScriptedCommandSchema.parse({
        action: "send",
        liveId: "live-1",
        eventId: "event-1",
        requestId: "123e4567-e89b-12d3-a456-426614174000",
      }),
    ).toMatchObject({ action: "send", liveId: "live-1" });
    expect(() => ScriptedCommandSchema.parse({ action: "stop", liveId: "live-1", extra: true })).toThrow();
  });

  it("projects only active scheduled text events within the vendor", () => {
    expect(
      projectWarmup(
        {
          id: "event-1",
          triggerSec: 10,
          eventType: "chat_message",
          message: "  Hello  ",
          role: {
            vendorId: "vendor-1",
            name: "Host",
            avatarUrl:
              "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=host-blue&backgroundType=gradientLinear&radius=18",
            isActive: true,
            isScheduled: true,
          },
        },
        "vendor-1",
      ),
    ).toEqual({
      id: "event-1",
      triggerSec: 10,
      value: "Hello",
      displayName: "Host",
      avatarUrl:
        "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=host-blue&backgroundType=gradientLinear&radius=18",
    });

    expect(
      projectWarmup(
        {
          id: "event-2",
          triggerSec: 10,
          eventType: "purchase",
          message: "Paid",
          role: {
            vendorId: "vendor-1",
            name: "Host",
            avatarUrl: null,
            isActive: true,
            isScheduled: true,
          },
        },
        "vendor-1",
      ),
    ).toBeNull();
  });

  it("selects one event in the current warmup window", () => {
    const events = [
      { id: "later", triggerSec: 10, value: "later", displayName: "Host", avatarUrl: null },
      { id: "earlier", triggerSec: 9, value: "earlier", displayName: "Host", avatarUrl: null },
    ];
    expect(currentWarmup(events, 10.5)?.id).toBe("later");
    expect(currentWarmup(events, null)).toBeNull();
  });
});
