import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => null),
}));

import { POST } from "@/app/api/form-submissions/route";

const createdVendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({
    where: { id: { in: createdVendorIds.splice(0) } },
  });
});
function submissionRequest(formId: string, email: string) {
  return new Request("https://app.example.test/api/form-submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
    },
    body: JSON.stringify({
      formId,
      payload: {
        name: "Concurrent Lead",
        email,
      },
    }),
  });
}

describe("form submission database invariants", () => {
  it("persists exactly one row for two concurrent equivalent submissions", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const vendor = await getDb().vendor.create({
      data: {
        name: `Concurrent Form Vendor ${suffix}`,
        slug: `concurrent-form-vendor-${suffix}`,
        email: `concurrent-form-vendor-${suffix}@example.test`,
        passwordHash: "test-only",
      },
    });
    createdVendorIds.push(vendor.id);

    const form = await getDb().registrationForm.create({
      data: {
        vendorId: vendor.id,
        name: `Concurrent Form ${suffix}`,
        slug: `concurrent-form-${suffix}`,
        headline: "Register",
        fields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
      },
    });
    const email = `concurrent-lead-${suffix}@example.test`;

    const responses = await Promise.all([
      POST(submissionRequest(form.id, email)),
      POST(submissionRequest(form.id, email)),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(bodies).toEqual([
      { ok: true, verificationRequired: true },
      { ok: true, verificationRequired: true },
    ]);
    expect(await getDb().formSubmission.count({
      where: {
        formId: form.id,
        liveId: null,
        email,
      },
    })).toBe(1);
  });
});
