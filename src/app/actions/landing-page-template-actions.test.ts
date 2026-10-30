import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn(), create: vi.fn(), apply: vi.fn(), document: vi.fn(), platformDocument: vi.fn(), stepPreview: vi.fn(), stepInstantiate: vi.fn(), csrf: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.csrf }));
vi.mock("@/lib/landing-page-template-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/landing-page-template-service")>()),
  saveLandingPageTemplateFromStep: mocks.save,
  createLandingPageFromTemplate: mocks.create,
  applyLandingPageTemplateToStep: mocks.apply,
  getLandingPageTemplateDocument: mocks.document,
  getLandingPagePlatformTemplateDocument: mocks.platformDocument,
  getLandingPageStepTemplatePreview: mocks.stepPreview,
  instantiateLandingPageStepTemplate: mocks.stepInstantiate,
}));

import { LandingPageTemplateInputError, LandingPageTemplateNotFoundError } from "@/lib/landing-page-template-service";
import {
  applyLandingPageTemplateAction,
  createLandingPageFromTemplateAction,
  readLandingPageTemplateDocumentAction,
  instantiateStepTemplateAction,
  readPlatformTemplateDocumentAction,
  readStepTemplatePreviewAction,
  saveLandingPageTemplateAction,
} from "./landing-page-template-actions";

const idle = { status: "idle" as const, message: "" };
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};
const prismaError = (code: string) => Object.assign(new Error(`synthetic ${code}`), { code });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue(undefined);
});

describe("landing page template action errors", () => {
  it("reports a transaction timeout (P2028) as busy, with nothing changed", async () => {
    mocks.save.mockRejectedValue(prismaError("P2028"));
    expect(await saveLandingPageTemplateAction(idle, form({ pageId: "p", stepId: "s", name: "範本" }))).toEqual({ status: "error", message: "系統忙碌中，這次沒有任何變更，請稍後再試。" });
  });

  it("reports a taken URL (P2002) when creating", async () => {
    mocks.create.mockRejectedValue(prismaError("P2002"));
    expect(await createLandingPageFromTemplateAction(idle, form({ templateKind: "platform", templateId: "custom-terms", name: "n", slug: "s", goal: "custom" }))).toMatchObject({ status: "error", message: expect.stringContaining("網址已被使用") });
  });

  it("explains the size limit (the shared 512 KiB draft limit) when the result would be too large", async () => {
    mocks.apply.mockRejectedValue(new LandingPageTemplateInputError("content_too_large"));
    expect(await applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: "t", pageId: "p", stepId: "s", revision: "3" }))).toMatchObject({ status: "error", message: expect.stringContaining("512 KiB") });
  });

  it("rethrows anything it does not recognise (for example a role redirect)", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    mocks.apply.mockRejectedValue(redirect);
    await expect(applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: "t", pageId: "p", stepId: "s", revision: "3" }))).rejects.toBe(redirect);
    mocks.document.mockRejectedValue(redirect);
    await expect(readLandingPageTemplateDocumentAction("t")).rejects.toBe(redirect);
  });

  it("checks CSRF before touching the service and refuses a missing template reference", async () => {
    mocks.csrf.mockRejectedValueOnce(new Error("csrf_rejected"));
    await expect(applyLandingPageTemplateAction(idle, form({ templateKind: "mine", templateId: "t" }))).rejects.toThrow("csrf_rejected");
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(await applyLandingPageTemplateAction(idle, form({ templateKind: "other", templateId: "t" }))).toMatchObject({ status: "error", message: "請先選擇要使用的範本。" });
    expect(await createLandingPageFromTemplateAction(idle, form({ templateKind: "mine" }))).toMatchObject({ status: "error" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("maps a missing own template for the preview", async () => {
    mocks.document.mockRejectedValue(new LandingPageTemplateNotFoundError());
    expect(await readLandingPageTemplateDocumentAction("t")).toEqual({ ok: false, message: "找不到這個範本，或你沒有使用它的權限。" });
  });

  it("returns a platform template's document for the preview and maps an unknown or non-library id", async () => {
    mocks.platformDocument.mockResolvedValueOnce({ id: "doc" });
    expect(await readPlatformTemplateDocumentAction("webinar-ai-minimal")).toEqual({ ok: true, document: { id: "doc" } });
    mocks.platformDocument.mockRejectedValueOnce(new LandingPageTemplateNotFoundError());
    expect(await readPlatformTemplateDocumentAction("nope")).toEqual({ ok: false, message: "找不到這個範本，或你沒有使用它的權限。" });
  });
});

describe("step template picker actions", () => {
  const request = { goal: "audience", stepType: "opt_in_page", templateId: "t" };

  it("returns the preview and applied documents", async () => {
    mocks.stepPreview.mockResolvedValueOnce({ id: "preview" });
    expect(await readStepTemplatePreviewAction(request)).toEqual({ ok: true, document: { id: "preview" } });
    expect(mocks.stepPreview).toHaveBeenCalledWith(request);
    mocks.stepInstantiate.mockResolvedValueOnce({ id: "applied" });
    expect(await instantiateStepTemplateAction({ ...request, pageId: "p" })).toEqual({ ok: true, document: { id: "applied" } });
    expect(mocks.stepInstantiate).toHaveBeenCalledWith({ ...request, pageId: "p" });
  });

  it("maps a refused template to a message and never throws a raw error to the browser", async () => {
    mocks.stepPreview.mockRejectedValueOnce(new LandingPageTemplateNotFoundError());
    expect(await readStepTemplatePreviewAction(request)).toEqual({ ok: false, message: "找不到這個範本，或你沒有使用它的權限。" });
    mocks.stepInstantiate.mockRejectedValueOnce(new LandingPageTemplateNotFoundError());
    expect(await instantiateStepTemplateAction({ ...request, pageId: "p" })).toEqual({ ok: false, message: "找不到這個範本，或你沒有使用它的權限。" });
  });
});
