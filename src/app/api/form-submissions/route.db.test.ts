import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as emailDelivery from "@/lib/email-delivery";
import { getDb } from "@/lib/db";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => null),
}));

import { POST } from "@/app/api/form-submissions/route";

const createdVendorIds: string[] = [];

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "form-submission-db-test-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
});

afterEach(async () => {
  await getDb().vendor.deleteMany({
    where: { id: { in: createdVendorIds.splice(0) } },
  });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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

it("retains native fields after a queue 503 and resubmits without a duplicate registration", async () => {
  const suffix = `wp05-retry-${Date.now()}`;
  const vendor = await getDb().vendor.create({ data: { name: "Synthetic Retry", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-unused" } });
  createdVendorIds.push(vendor.id);
  const form = await getDb().registrationForm.create({ data: { vendorId: vendor.id, name: "Synthetic Retry", slug: suffix, headline: "Synthetic Retry", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } });
  const rule = await getDb().automationRule.create({ data: { vendorId: vendor.id, name: "Synthetic registration tag", trigger: "form_registered", condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "wp05-synthetic" }] } });
  const sourcePath = `/form/${form.slug}`;
  const native = (cookie?: string) => new Request("https://app.example.test/api/form-submissions", {
    method: "POST",
    headers: { origin: "https://app.example.test", "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams({ formId: form.id, name: "Synthetic", email: `${suffix}@example.test`, __registrationReturnPath: sourcePath, redirectTo: sourcePath }),
  });
  vi.spyOn(emailDelivery, "ensureFormSubmissionVerificationDelivery").mockRejectedValueOnce(new Error("synthetic queue unavailable"));
  const failed = await POST(native());
  expect(failed.status).toBe(303);
  expect(failed.headers.get("location")).toBe(`https://app.example.test${sourcePath}?registrationRetry=503`);
  expect(await getDb().formSubmission.count({ where: { formId: form.id } })).toBe(1);
  const drafts = await getDb().registrationFormRetryDraft.findMany({ where: { formId: form.id } });
  expect(drafts).toHaveLength(1);
  // The draft is bound to the form's tenant and stores no plaintext answer.
  expect(drafts[0].vendorId).toBe(vendor.id);
  expect(drafts[0].encryptedPayload).not.toContain(suffix);
  const draft = failed.cookies.get("__Host-celebratedeal_registration_retry");
  expect(draft).toBeDefined();
  const success = await POST(native(`${draft!.name}=${draft!.value}`));
  expect(success.status).toBe(303);
  expect(success.headers.get("location")).toBe(`https://app.example.test${sourcePath}?submitted=verification_required`);
  expect(await getDb().formSubmission.count({ where: { formId: form.id } })).toBe(1);
  expect(await getDb().registrationFormRetryDraft.count({ where: { formId: form.id } })).toBe(0);
  expect(await getDb().emailDelivery.count({ where: { vendorId: vendor.id, status: "sent" } })).toBe(0);
  // The 503 attempt never reached automation; the retry dispatched it, and a
  // later duplicate submission converges on the same durable execution key.
  expect(await getDb().automationExecutionLog.count({ where: { ruleId: rule.id } })).toBe(1);
  const again = await POST(native());
  expect(again.status).toBe(303);
  expect(await getDb().formSubmission.count({ where: { formId: form.id } })).toBe(1);
  expect(await getDb().automationExecutionLog.count({ where: { ruleId: rule.id } })).toBe(1);
});

it("deletes retry drafts with their form's tenant", async () => {
  const suffix = `wp05-cascade-${Date.now()}`;
  const vendor = await getDb().vendor.create({ data: { name: "Synthetic Cascade", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-unused" } });
  const form = await getDb().registrationForm.create({ data: { vendorId: vendor.id, name: "Synthetic Cascade", slug: suffix, headline: "Synthetic Cascade", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } });
  const response = await POST(new Request("https://app.example.test/api/form-submissions", {
    method: "POST",
    headers: { origin: "https://app.example.test", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ formId: form.id, name: "Synthetic", email: "not-an-email", __registrationReturnPath: `/form/${form.slug}` }),
  }));
  expect(response.headers.get("location")).toBe(`https://app.example.test/form/${form.slug}?registrationRetry=400`);
  expect(await getDb().registrationFormRetryDraft.count({ where: { formId: form.id } })).toBe(1);
  await getDb().vendor.delete({ where: { id: vendor.id } });
  expect(await getDb().registrationFormRetryDraft.count({ where: { formId: form.id } })).toBe(0);
});
