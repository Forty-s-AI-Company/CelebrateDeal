import { describe, expect, it } from "vitest";
import { createFunnelFlow } from "@/lib/funnel-flow";
import { defaultFunnelOperations } from "@/lib/funnel-operations";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";
import { assignFunnelExperiment, decidePublicFunnelRuntime, funnelVisitorIdFromRequest, resolveTrustedFunnelSubmission } from "./funnel-runtime";

const visitorId = "visitor-12345678901234567890";
const flow = createFunnelFlow({ id: "funnel_1", name: "Funnel", goal: "audience", domain: "offer" })!;
const steps = flow.steps;

describe("public Funnel runtime", () => {
  it("reads the proxy-issued Funnel visitor from the actual request cookie", () => {
    const request = new Request("https://app.example.test/api/form-submissions", {
      headers: { cookie: `unrelated=value; celebratedeal_funnel_visitor=${visitorId}` },
    });
    expect(funnelVisitorIdFromRequest(request)).toBe(visitorId);
  });

  it("assigns a visitor to the same A/B arm deterministically", () => {
    const experiment = {
      id: "experiment_1", status: "running" as const,
      controlStepId: "opt_in", variantStepId: "opt_in_thank_you",
      controlWeight: 50, variantWeight: 50, winner: null,
    };
    expect(assignFunnelExperiment("page_1", experiment, visitorId)).toEqual(assignFunnelExperiment("page_1", experiment, visitorId));
    expect(assignFunnelExperiment("page_1", experiment, visitorId)).toMatchObject({ id: "experiment_1", arm: expect.stringMatching(/^(control|variant)$/u) });
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
});
