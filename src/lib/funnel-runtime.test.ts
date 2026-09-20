import { describe, expect, it, vi } from "vitest";
import { createFunnelFlow } from "@/lib/funnel-flow";
import { defaultFunnelOperations } from "@/lib/funnel-operations";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";
import {
  assignFunnelExperiment,
  decidePublicFunnelRuntime,
  funnelVisitorIdFromRequest,
  isFunnelDeadlineExpired,
  recordPublicFunnelVisit,
  recordTrustedFunnelSubmission,
  resolveFunnelDeadline,
  resolveFunnelVisitorId,
  resolvePublicFunnelRuntime,
  resolveTrustedFunnelSubmission,
} from "./funnel-runtime";

const visitorId = "visitor-12345678901234567890";
const flow = createFunnelFlow({ id: "funnel_1", name: "Funnel", goal: "audience", domain: "offer" })!;
const steps = flow.steps;

describe("public Funnel runtime", () => {
  it("reads the proxy-issued Funnel visitor from the actual request cookie", () => {
    const request = new Request("https://app.example.test/api/form-submissions", {
      headers: { cookie: `unrelated=value; celebratedeal_funnel_visitor=${visitorId}` },
    });
    expect(funnelVisitorIdFromRequest(request)).toBe(visitorId);
    expect(funnelVisitorIdFromRequest(new Request("https://app.example.test/api/form-submissions"))).toBeNull();
    expect(funnelVisitorIdFromRequest(new Request("https://app.example.test/api/form-submissions", { headers: { cookie: "celebratedeal_funnel_visitor=short" } }))).toBeNull();
    expect(funnelVisitorIdFromRequest(new Request("https://app.example.test/api/form-submissions", { headers: { cookie: "celebratedeal_funnel_visitor=%E0%A4%A" } }))).toBeNull();
  });

  it("assigns a visitor to the same A/B arm deterministically", () => {
    const experiment = {
      id: "experiment_1", status: "running" as const,
      controlStepId: "opt_in", variantStepId: "opt_in_thank_you",
      controlWeight: 50, variantWeight: 50, winner: null,
    };
    expect(assignFunnelExperiment("page_1", experiment, visitorId)).toEqual(assignFunnelExperiment("page_1", experiment, visitorId));
    expect(assignFunnelExperiment("page_1", experiment, visitorId)).toMatchObject({ id: "experiment_1", arm: expect.stringMatching(/^(control|variant)$/u) });
    expect(assignFunnelExperiment("page_1", { ...experiment, controlWeight: 100, variantWeight: 0 }, visitorId)).toEqual({ id: "experiment_1", arm: "control" });
    expect(assignFunnelExperiment("page_1", { ...experiment, controlWeight: 0, variantWeight: 100 }, visitorId)).toEqual({ id: "experiment_1", arm: "variant" });
  });

  it("fails closed for invalid visitors and resolves winner assignments", () => {
    expect(resolveFunnelVisitorId("invalid", () => "created-visitor" as never)).toBe("created-visitor");
    expect(resolveFunnelVisitorId(visitorId, () => "unexpected" as never)).toBe(visitorId);
    expect(assignFunnelExperiment("page_1", null, visitorId)).toBeNull();
    expect(assignFunnelExperiment("page_1", { id: "experiment_1", status: "winner", controlStepId: "opt_in", variantStepId: "opt_in_thank_you", controlWeight: 50, variantWeight: 50, winner: "variant" }, "invalid")).toBeNull();
    expect(assignFunnelExperiment("page_1", { id: "experiment_1", status: "winner", controlStepId: "opt_in", variantStepId: "opt_in_thank_you", controlWeight: 50, variantWeight: 50, winner: "variant" }, visitorId)).toEqual({ id: "experiment_1", arm: "variant" });
    expect(assignFunnelExperiment("page_1", { id: "experiment_1", status: "stopped", controlStepId: "opt_in", variantStepId: "opt_in_thank_you", controlWeight: 50, variantWeight: 50, winner: null }, visitorId)).toBeNull();
    expect(assignFunnelExperiment("page_1", { id: "experiment_1", status: "winner", controlStepId: "opt_in", variantStepId: "opt_in_thank_you", controlWeight: 50, variantWeight: 50, winner: null }, visitorId)).toBeNull();
  });

  it("covers unavailable, variant and missing-rendered-step decisions", () => {
    const experiment = {
      id: "experiment_1", status: "winner" as const,
      controlStepId: "opt_in", variantStepId: "opt_in_thank_you",
      controlWeight: 50, variantWeight: 50, winner: "variant" as const,
    };
    expect(decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "missing", steps, operations: defaultFunnelOperations(), visitorId })).toEqual({ status: "unavailable" });
    expect(decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", steps, operations: null, visitorId })).toEqual({ status: "unavailable" });
    expect(decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", steps, operations: defaultFunnelOperations(), visitorId: "invalid" })).toEqual({ status: "unavailable" });
    expect(decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", steps, operations: { ...defaultFunnelOperations(), experiment }, visitorId })).toMatchObject({ status: "render", renderedStepId: "opt_in_thank_you", experiment: { id: "experiment_1", arm: "variant" } });
    const controlExperiment = { ...experiment, status: "running" as const, controlWeight: 100, variantWeight: 0, winner: null };
    expect(decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", steps, operations: { ...defaultFunnelOperations(), experiment: controlExperiment }, visitorId })).toMatchObject({ status: "render", renderedStepId: "opt_in", experiment: { id: "experiment_1", arm: "control" } });
    expect(decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", steps: steps.filter((step) => step.id !== "opt_in_thank_you"), operations: { ...defaultFunnelOperations(), experiment }, visitorId })).toEqual({ status: "unavailable" });
  });

  it("enforces an absolute deadline exactly at its boundary", () => {
    const operations = defaultFunnelOperations();
    operations.deadline = {
      enabled: true,
      timezone: "Asia/Taipei",
      expiresAt: "2026-09-17T10:00:00+08:00",
      behavior: "closed",
      redirectPath: "",
    };
    const before = decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", steps, operations, visitorId, now: new Date("2026-09-17T01:59:59.999Z") });
    const atBoundary = decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", steps, operations, visitorId, now: new Date("2026-09-17T02:00:00.000Z") });
    expect(before.status).toBe("render");
    expect(atBoundary).toEqual({ status: "closed" });
  });

  it("keeps a valid redirect target accessible after expiry", () => {
    const operations = defaultFunnelOperations();
    operations.deadline = {
      enabled: true,
      timezone: "Asia/Taipei",
      expiresAt: "2026-09-17T10:00:00+08:00",
      behavior: "redirect",
      redirectPath: "thank-you",
    };
    expect(decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", steps, operations, visitorId, now: new Date("2026-09-17T02:00:00.000Z") })).toEqual({ status: "redirect", path: "thank-you" });
    expect(decidePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in_thank_you", steps, operations, visitorId, now: new Date("2026-09-17T02:00:00.000Z") }).status).toBe("render");
  });

  it("fails closed for malformed deadlines and handles redirect boundaries", () => {
    const base = defaultFunnelOperations();
    expect(resolveFunnelDeadline({ steps, requestedStepId: "missing", operations: base })).toEqual({ status: "unavailable" });
    expect(resolveFunnelDeadline({ steps, requestedStepId: "opt_in", operations: null })).toEqual({ status: "unavailable" });
    expect(resolveFunnelDeadline({ steps, requestedStepId: "opt_in", operations: { ...base, deadline: { ...base.deadline, enabled: true, expiresAt: "not-a-date" } } })).toEqual({ status: "unavailable" });
    expect(resolveFunnelDeadline({ steps, requestedStepId: "opt_in", operations: { ...base, deadline: { ...base.deadline, enabled: true, expiresAt: null } } })).toEqual({ status: "unavailable" });
    expect(resolveFunnelDeadline({ steps, requestedStepId: "opt_in", operations: { ...base, deadline: { ...base.deadline, enabled: false, expiresAt: null } }, now: new Date("2026-09-17T02:00:00.000Z") }).status).toBe("render");
    expect(resolveFunnelDeadline({ steps, requestedStepId: "opt_in", operations: { ...base, deadline: { ...base.deadline, enabled: true, expiresAt: "2027-09-17T10:00:00+08:00" } } } ).status).toBe("render");
    const missingTarget = { ...base, deadline: { ...base.deadline, enabled: true, expiresAt: "2026-09-17T10:00:00+08:00", behavior: "redirect" as const, redirectPath: "missing" } };
    expect(resolveFunnelDeadline({ steps, requestedStepId: "opt_in", operations: missingTarget, now: new Date("2026-09-17T02:00:00.000Z") })).toEqual({ status: "closed" });
    const sameTarget = { ...missingTarget, deadline: { ...missingTarget.deadline, redirectPath: "opt-in" } };
    expect(resolveFunnelDeadline({ steps, requestedStepId: "opt_in", operations: sameTarget, now: new Date("2026-09-17T02:00:00.000Z") }).status).toBe("render");
    expect(isFunnelDeadlineExpired(null)).toBe(false);
    expect(isFunnelDeadlineExpired(base, new Date("2026-09-17T02:00:00.000Z"))).toBe(false);
    expect(isFunnelDeadlineExpired({ ...base, deadline: { ...base.deadline, enabled: true, expiresAt: "2026-09-17T10:00:00+08:00" } }, new Date("2026-09-17T02:00:00.000Z"))).toBe(true);
    expect(isFunnelDeadlineExpired({ ...base, deadline: { ...base.deadline, enabled: true, expiresAt: "not-a-date" } }, new Date("2026-09-17T02:00:00.000Z"))).toBe(false);
  });

  it("captures an attribution source only after the published page, form and visitor visit all match", async () => {
    const content = createFunnelStepPages(flow)!;
    const database = {
      landingPage: {
        findFirst: async () => ({
          id: "page_1", vendorId: "vendor_1", operations: defaultFunnelOperations(),
          publishedVersion: { content, formId: "form_1", liveId: null },
        }),
      },
      funnelVisit: {
        findFirst: async () => ({ id: "visit_1" }),
      },
    };
    await expect(resolveTrustedFunnelSubmission({
      pageId: "page_1", stepId: "opt_in", formId: "form_1", liveId: null, visitorId, database: database as never,
    })).resolves.toEqual({ vendorId: "vendor_1", pageId: "page_1", stepId: "opt_in", visitId: "visit_1" });
    await expect(resolveTrustedFunnelSubmission({
      pageId: "page_1", stepId: "opt_in", formId: "other_form", liveId: null, visitorId, database: database as never,
    })).resolves.toBeNull();
    await expect(resolveTrustedFunnelSubmission({
      pageId: "page_1", stepId: "opt_in", formId: "form_1", liveId: null, visitorId,
      database: { ...database, funnelVisit: { findFirst: async () => null } } as never,
    })).resolves.toBeNull();
  });

  it("re-reads published snapshots and records pseudonymous delivery events idempotently", async () => {
    const content = createFunnelStepPages(flow)!;
    const visitCreate = vi.fn().mockResolvedValue({ id: "visit-1" });
    const submissionUpsert = vi.fn().mockResolvedValue({ id: "submission-1" });
    const database = {
      landingPage: { findFirst: vi.fn().mockResolvedValue({ id: "page_1", vendorId: "vendor_1", operations: defaultFunnelOperations(), publishedVersion: { content, formId: "form_1", liveId: null } }) },
      funnelVisit: { create: visitCreate, findFirst: vi.fn().mockResolvedValue({ id: "visit-1" }) },
      funnelSubmission: { upsert: submissionUpsert },
    };
    await expect(resolvePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", visitorId, database: database as never })).resolves.toMatchObject({ decision: { status: "render" } });
    await expect(resolvePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", visitorId, database: { ...database, landingPage: { findFirst: vi.fn().mockResolvedValue(null) } } as never })).resolves.toBeNull();
    await expect(resolvePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", visitorId, database: { ...database, landingPage: { findFirst: vi.fn().mockResolvedValue({ ...await database.landingPage.findFirst(), publishedVersion: null }) } } as never })).resolves.toBeNull();
    await expect(resolvePublicFunnelRuntime({ pageId: "page_1", requestedStepId: "opt_in", visitorId, database: { ...database, landingPage: { findFirst: vi.fn().mockResolvedValue({ ...await database.landingPage.findFirst(), publishedVersion: { content: { invalid: true }, formId: null, liveId: null } }) } } as never })).resolves.toBeNull();
    await expect(recordPublicFunnelVisit({ pageId: "page_1", vendorId: "vendor_1", stepId: "opt_in", logicalStepId: "opt_in", visitorId: "invalid", experiment: null, database: database as never })).resolves.toBeNull();
    await expect(recordPublicFunnelVisit({ pageId: "page_1", vendorId: "vendor_1", stepId: "opt_in", logicalStepId: "opt_in", visitorId, experiment: { id: "experiment_1", arm: "control" }, database: database as never })).resolves.toEqual({ id: "visit-1" });
    await expect(recordPublicFunnelVisit({ pageId: "page_1", vendorId: "vendor_1", stepId: "opt_in", logicalStepId: "opt_in", visitorId, experiment: null, database: database as never })).resolves.toEqual({ id: "visit-1" });
    await expect(recordTrustedFunnelSubmission({ vendorId: "vendor_1", pageId: "page_1", stepId: "opt_in", submissionId: "submission-1", visitId: null, database: database as never })).resolves.toEqual({ id: "submission-1" });
    await expect(recordTrustedFunnelSubmission({ vendorId: "vendor_1", pageId: "page_1", stepId: "opt_in", submissionId: "submission-2", visitId: "visit-1", database: database as never })).resolves.toEqual({ id: "submission-1" });
    expect(visitCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ visitorId, experimentId: "experiment_1", arm: "control" }) }));
    expect(submissionUpsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.not.objectContaining({ visitId: expect.anything() }) }));
  });

  it("rejects submissions after the persisted deadline", async () => {
    const operations = defaultFunnelOperations();
    operations.deadline = { enabled: true, timezone: "Asia/Taipei", expiresAt: "2026-09-17T10:00:00+08:00", behavior: "closed", redirectPath: "" };
    const database = {
      landingPage: { findFirst: vi.fn().mockResolvedValue({ id: "page_1", vendorId: "vendor_1", operations, publishedVersion: { content: createFunnelStepPages(flow), formId: "form_1", liveId: null } }) },
      funnelVisit: { findFirst: vi.fn() },
    };
    await expect(resolveTrustedFunnelSubmission({ pageId: "page_1", stepId: "opt_in", formId: "form_1", liveId: null, visitorId, now: new Date("2026-09-17T02:00:00.000Z"), database: database as never })).resolves.toBeNull();
    expect(database.funnelVisit.findFirst).not.toHaveBeenCalled();
  });
});
