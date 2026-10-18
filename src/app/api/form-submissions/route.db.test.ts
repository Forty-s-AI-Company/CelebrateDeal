import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as emailDelivery from "@/lib/email-delivery";
import { getDb } from "@/lib/db";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => null),
}));
// Real funnel trust by default; individual tests substitute a trusted source
// for synthetic pages without seeding a full published Funnel and visit.
vi.mock("@/lib/funnel-runtime", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/funnel-runtime")>();
  return {
    ...original,
    funnelVisitorIdFromRequest: vi.fn(original.funnelVisitorIdFromRequest),
    resolveTrustedFunnelSubmission: vi.fn(original.resolveTrustedFunnelSubmission),
  };
});

import { funnelVisitorIdFromRequest, resolveTrustedFunnelSubmission } from "@/lib/funnel-runtime";
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

describe("form_registered automation on existing submissions", () => {
  async function funnelFixture(label: string) {
    const suffix = `wp05-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const db = getDb();
    const vendor = await db.vendor.create({ data: { name: "Synthetic Funnel", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-unused" } });
    createdVendorIds.push(vendor.id);
    const project = await db.salesProject.create({ data: { vendorId: vendor.id, name: "Synthetic", slug: suffix, mode: "live_course", primaryFlow: "live" } });
    const form = await db.registrationForm.create({ data: { vendorId: vendor.id, name: "Synthetic", slug: suffix, headline: "Synthetic", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } });
    const page = (name: string) => db.landingPage.create({ data: { vendorId: vendor.id, projectId: project.id, name, slug: `${suffix}-${name}`, draftContent: {} } });
    const [pageA, pageB] = [await page("a"), await page("b")];
    const rule = (name: string, funnelPageId: string | null) => db.automationRule.create({ data: { vendorId: vendor.id, name, trigger: "form_registered", funnelPageId, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: name }] } });
    const ruleA = await rule("funnel-a", pageA.id);
    const ruleB = await rule("funnel-b", pageB.id);
    vi.mocked(funnelVisitorIdFromRequest).mockReturnValue("synthetic-visitor-123456789012345678901234");
    vi.mocked(resolveTrustedFunnelSubmission).mockImplementation(async (input) => ({ vendorId: vendor.id, pageId: input.pageId, stepId: input.stepId, visitId: null as unknown as string }));
    const submit = (pageId: string) => POST(new Request("https://app.example.test/api/form-submissions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.test", "x-celebratedeal-client": "web" },
      body: JSON.stringify({ formId: form.id, landingPageId: pageId, funnelStepId: "opt_in", payload: { name: "Synthetic", email: `${suffix}@example.test` } }),
    }));
    const executions = async (ruleId: string) => db.automationExecutionLog.count({ where: { ruleId } });
    const actual = await vi.importActual<typeof import("@/lib/funnel-runtime")>("@/lib/funnel-runtime");
    const cleanup = async () => {
      vi.mocked(funnelVisitorIdFromRequest).mockImplementation(actual.funnelVisitorIdFromRequest);
      vi.mocked(resolveTrustedFunnelSubmission).mockImplementation(actual.resolveTrustedFunnelSubmission);
      // FunnelSubmission restricts deleting its FormSubmission; remove it before the vendor cascade.
      await db.funnelSubmission.deleteMany({ where: { vendorId: vendor.id } });
    };
    return { form, pageA, pageB, ruleA, ruleB, submit, executions, cleanup };
  }

  it("does not fire a funnel-B rule for a registration that came from funnel A", async () => {
    const fixture = await funnelFixture("ab");
    try {
      expect((await fixture.submit(fixture.pageA.id)).status).toBe(200);
      expect(await fixture.executions(fixture.ruleA.id)).toBe(1);
      expect(await fixture.executions(fixture.ruleB.id)).toBe(0);
      expect((await fixture.submit(fixture.pageB.id)).status).toBe(200);
      expect(await getDb().formSubmission.count({ where: { formId: fixture.form.id } })).toBe(1);
      expect(await fixture.executions(fixture.ruleA.id)).toBe(1);
      expect(await fixture.executions(fixture.ruleB.id)).toBe(0);
    } finally { await fixture.cleanup(); }
  });

  it("closes a 503-before-dispatch gap exactly once, scoped to the stored funnel", async () => {
    const fixture = await funnelFixture("gap");
    try {
      vi.spyOn(emailDelivery, "ensureFormSubmissionVerificationDelivery").mockRejectedValueOnce(new Error("synthetic queue unavailable"));
      expect((await fixture.submit(fixture.pageA.id)).status).toBe(503);
      expect(await fixture.executions(fixture.ruleA.id)).toBe(0);
      // The retry arrives through funnel B; only the stored funnel A scope applies.
      expect((await fixture.submit(fixture.pageB.id)).status).toBe(200);
      expect(await fixture.executions(fixture.ruleA.id)).toBe(1);
      expect(await fixture.executions(fixture.ruleB.id)).toBe(0);
      expect((await fixture.submit(fixture.pageA.id)).status).toBe(200);
      expect(await fixture.executions(fixture.ruleA.id)).toBe(1);
      expect(await getDb().formSubmission.count({ where: { formId: fixture.form.id } })).toBe(1);
    } finally { await fixture.cleanup(); }
  });
});

