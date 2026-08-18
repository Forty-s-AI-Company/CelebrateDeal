import { describe, expect, it } from "vitest";

import { getRuntimeLivePublishReadiness, type RuntimeLivePublishCandidate } from "@/lib/live-runtime-readiness";

const validFields = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

function candidate(overrides: Partial<RuntimeLivePublishCandidate> = {}): RuntimeLivePublishCandidate {
  return {
    vendorId: "vendor-1",
    video: { vendorId: "vendor-1", sourceType: "url", status: "ready", cloudflareReadyToStream: false, cloudflareLiveInputUid: null, liveInputStatus: null },
    form: { vendorId: "vendor-1", isActive: true, fields: validFields },
    messageTemplate: { vendorId: "vendor-1", channel: "email", trigger: "registration_confirmed", isActive: true, subject: "報名 {{live_title}}", body: "{{name}} {{unsubscribe_url}}" },
    interactionScript: { vendorId: "vendor-1", status: "published" },
    products: [{ vendorId: "vendor-1", product: { vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true } }],
    ...overrides,
  };
}

describe("runtime live publish readiness", () => {
  it("accepts a complete same-vendor sales live", () => {
    expect(getRuntimeLivePublishReadiness(candidate()).ready).toBe(true);
  });

  it.each([
    ["media", { video: null }],
    ["form", { form: { vendorId: "vendor-1", isActive: false, fields: validFields } }],
    ["email", { messageTemplate: { vendorId: "vendor-1", channel: "email", trigger: "registration_confirmed", isActive: false, subject: "報名", body: "內容" } }],
    ["script", { interactionScript: { vendorId: "vendor-1", status: "draft" } }],
    ["product", { products: [{ vendorId: "vendor-1", product: { vendorId: "vendor-1", isActive: false, fulfillmentTypeConfirmed: true } }] }],
  ])("rejects stale %s resources", (_label, overrides) => {
    expect(getRuntimeLivePublishReadiness(candidate(overrides as Partial<RuntimeLivePublishCandidate>)).ready).toBe(false);
  });

  it("keeps a same-vendor content live independent from sales-only resources", () => {
    expect(getRuntimeLivePublishReadiness(candidate({ products: [], interactionScript: null })).ready).toBe(true);
  });
});
