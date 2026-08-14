import { describe, expect, it } from "vitest";

import {
  countSellableLiveReadinessCandidates,
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
  return {
    video: {
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
        ...publicLiveAvailabilityWhere(),
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
        form: { select: { fields: true } },
        messageTemplate: { select: { subject: true, body: true } },
        video: {
          select: {
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
          sourceType: "cloudflare_stream",
          status: "ready",
          cloudflareReadyToStream: true,
          cloudflareLiveInputUid: null,
          liveInputStatus: null,
        },
      }),
      candidate({
        video: {
          sourceType: "cloudflare_live",
          status: "processing",
          cloudflareReadyToStream: false,
          cloudflareLiveInputUid: "server-created-live-input",
          liveInputStatus: "created",
        },
      }),
    ])).toBe(3);
  });
});
