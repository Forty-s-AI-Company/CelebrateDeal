import { describe, expect, it } from "vitest";

import {
  countSellableLiveReadinessCandidates,
  isSellableLiveReadinessCandidate,
  publicLiveAvailabilityWhere,
  sellableLiveReadinessQuery,
  type SellableLiveReadinessCandidate,
} from "@/lib/sellable-live";

const validFields = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

function candidate(
  overrides: Partial<SellableLiveReadinessCandidate> = {},
): SellableLiveReadinessCandidate {
  const scheduledAt = new Date(Date.now() - 60_000);
  return {
    scheduledAt,
    status: "live",
    startedAt: scheduledAt,
    endedAt: null,
    replayAvailableUntil: null,
    replayEnabled: true,
    streamMode: "live",
    video: {
      durationSec: 600,
      sourceType: "url",
      status: "ready",
      cloudflareReadyToStream: false,
      cloudflareLiveInputUid: null,
      liveInputStatus: null,
    },
    form: { fields: validFields },
    messageTemplate: {
      subject: "{{name}}，你已報名 {{live_title}}",
      body: "由 {{vendor_name}} 寄送；取消通知：{{unsubscribe_url}}",
    },
    ...overrides,
  };
}

describe("sellable live readiness", () => {
  it("shares the buyer-visible status boundary", () => {
    expect(publicLiveAvailabilityWhere()).toEqual({
      OR: [
        { status: { in: ["scheduled", "live"] } },
        { status: "ended", replayEnabled: true },
      ],
    });
  });

  it("requires every resource to belong to the same vendor and be usable", () => {
    expect(sellableLiveReadinessQuery("vendor-1")).toEqual({
      where: {
        vendorId: "vendor-1",
        status: { in: ["scheduled", "live", "ended"] },
        video: {
          is: {
            vendorId: "vendor-1",
            OR: [
              { sourceType: "url", status: "ready" },
              { sourceType: "cloudflare_stream", status: "ready", cloudflareReadyToStream: true },
              {
                sourceType: "cloudflare_live",
                status: { not: "archived" },
                cloudflareLiveInputUid: { not: null },
                liveInputStatus: "created",
              },
            ],
          },
        },
        form: { is: { vendorId: "vendor-1", isActive: true } },
        messageTemplate: {
          is: {
            vendorId: "vendor-1",
            channel: "email",
            trigger: "registration_confirmed",
            isActive: true,
          },
        },
        interactionScript: { is: { vendorId: "vendor-1", status: "published" } },
        products: {
          some: {
            vendorId: "vendor-1",
            product: {
              is: {
                vendorId: "vendor-1",
                isActive: true,
                fulfillmentTypeConfirmed: true,
              },
            },
          },
        },
      },
      select: {
        scheduledAt: true,
        status: true,
        startedAt: true,
        endedAt: true,
        replayAvailableUntil: true,
        replayEnabled: true,
        streamMode: true,
        form: { select: { fields: true } },
        messageTemplate: { select: { subject: true, body: true } },
        video: {
          select: {
            durationSec: true,
            sourceType: true,
            status: true,
            cloudflareReadyToStream: true,
            cloudflareLiveInputUid: true,
            liveInputStatus: true,
          },
        },
      },
    });
  });

  it("does not count malformed forms or undeliverable registration email templates", () => {
    expect(countSellableLiveReadinessCandidates([
      candidate(),
      candidate({ video: null }),
      candidate({ video: { ...candidate().video!, status: "processing" } }),
      candidate({ form: { fields: [] } }),
      candidate({ messageTemplate: { subject: null, body: "內容" } }),
      candidate({ messageTemplate: { subject: "主旨", body: "{{unsupported}}" } }),
      candidate({ messageTemplate: { subject: "主旨", body: "   " } }),
    ])).toBe(1);
  });

  it("accepts each server-recognized ready media source", () => {
    expect(countSellableLiveReadinessCandidates([
      candidate(),
      candidate({
        video: {
          durationSec: 600,
          sourceType: "cloudflare_stream",
          status: "ready",
          cloudflareReadyToStream: true,
          cloudflareLiveInputUid: null,
          liveInputStatus: null,
        },
      }),
      candidate({
        video: {
          durationSec: 600,
          sourceType: "cloudflare_live",
          status: "processing",
          cloudflareReadyToStream: false,
          cloudflareLiveInputUid: "server-created-live-input",
          liveInputStatus: "created",
        },
      }),
    ])).toBe(3);
  });

  it.each([
    ["T 前", new Date("2026-08-18T07:59:59.999Z"), true],
    ["T", new Date("2026-08-18T08:00:00.000Z"), true],
    ["T+duration", new Date("2026-08-18T08:10:00.000Z"), true],
  ])("uses the canonical runtime state at %s", (_label, now, expected) => {
    const live = candidate({
      streamMode: "vod",
      status: "scheduled",
      scheduledAt: new Date("2026-08-18T08:00:00.000Z"),
      startedAt: null,
      video: { ...candidate().video!, durationSec: 600 },
    });

    expect(isSellableLiveReadinessCandidate(live, now)).toBe(expected);
  });

  it("treats waiting, playing, and replay as sellable readiness states", () => {
    const scheduledAt = new Date("2026-08-18T08:00:00.000Z");
    const completionAt = new Date("2026-08-18T08:10:00.000Z");
    expect(countSellableLiveReadinessCandidates([
      candidate({ streamMode: "vod", status: "scheduled", scheduledAt: new Date("2026-08-18T08:10:00.000Z") }),
      candidate({ streamMode: "vod", status: "scheduled", scheduledAt }),
      candidate({
        streamMode: "vod",
        status: "ended",
        scheduledAt,
        startedAt: scheduledAt,
        endedAt: completionAt,
        replayAvailableUntil: new Date("2026-08-18T09:00:00.000Z"),
      }),
    ], new Date("2026-08-18T08:05:00.000Z"))).toBe(2);
    expect(isSellableLiveReadinessCandidate(
      candidate({
        streamMode: "vod",
        status: "ended",
        scheduledAt,
        startedAt: scheduledAt,
        endedAt: completionAt,
        replayAvailableUntil: new Date("2026-08-18T09:00:00.000Z"),
      }),
      completionAt,
    )).toBe(true);
  });

  it("rejects an unknown mode, an invalid VOD duration, and a replay deadline at now", () => {
    const now = new Date("2026-08-18T08:10:00.000Z");
    const live = candidate({
      streamMode: "vod",
      status: "scheduled",
      scheduledAt: new Date("2026-08-18T08:00:00.000Z"),
      startedAt: null,
    });

    expect(isSellableLiveReadinessCandidate({ ...live, streamMode: "preview" }, now)).toBe(false);
    expect(isSellableLiveReadinessCandidate({ ...live, video: { ...live.video!, durationSec: 0 } }, now)).toBe(false);
    expect(isSellableLiveReadinessCandidate({ ...live, replayAvailableUntil: now }, now)).toBe(false);
  });

  it("allows a started live input at its startedAt", () => {
    const startedAt = new Date("2026-08-18T08:01:00.000Z");
    const live = candidate({
      streamMode: "live",
      status: "live",
      scheduledAt: new Date("2026-08-18T08:00:00.000Z"),
      startedAt,
    });

    expect(isSellableLiveReadinessCandidate(live, startedAt)).toBe(true);
  });
});
