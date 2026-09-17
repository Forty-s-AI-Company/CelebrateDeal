import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  save: vi.fn(),
  saveSteps: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  duplicate: vi.fn(),
  rollback: vi.fn(),
  revalidatePath: vi.fn(),
}));

const errorTypes = vi.hoisted(() => ({
  Conflict: class Conflict extends Error {},
  Input: class Input extends Error {},
  Missing: class Missing extends Error {},
  Scope: class Scope extends Error {},
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.csrf }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/landing-page-service", () => ({
  createLandingPage: mocks.create,
  deleteLandingPage: mocks.delete,
  saveLandingPageDraft: mocks.save,
  saveLandingPageStepMetadata: mocks.saveSteps,
  publishLandingPage: mocks.publish,
  unpublishLandingPage: mocks.unpublish,
  duplicateLandingPage: mocks.duplicate,
  rollbackLandingPage: mocks.rollback,
  LandingPageConflictError: errorTypes.Conflict,
  LandingPageInputError: errorTypes.Input,
  LandingPageNotFoundError: errorTypes.Missing,
  LandingPageScopeError: errorTypes.Scope,
}));

import { landingPageAction } from "./landing-page-actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  data.set("_csrf", "synthetic");
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
}

const content = JSON.stringify({ schemaVersion: 1, data: { root: {}, content: [] } });
const idle = { status: "error" as const, message: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: "page-1", revision: 1 });
  mocks.delete.mockResolvedValue({ id: "page-1" });
  mocks.save.mockResolvedValue({ id: "page-1", revision: 2 });
  mocks.saveSteps.mockResolvedValue({ id: "page-1", revision: 3 });
  mocks.publish.mockResolvedValue({ id: "page-1", revision: 3, version: 1 });
  mocks.unpublish.mockResolvedValue({ id: "page-1", revision: 4 });
  mocks.duplicate.mockResolvedValue({ id: "page-copy", revision: 1 });
  mocks.rollback.mockResolvedValue({ id: "page-1", revision: 5 });
});

describe("landingPageAction", () => {
  it("checks CSRF before parsing or calling a page service", async () => {
    mocks.csrf.mockRejectedValueOnce(new Error("Invalid CSRF token."));

    await expect(landingPageAction(idle, form({ operation: "create", content }))).resolves.toMatchObject({ status: "error" });

    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("passes only the declared draft fields to the create service", async () => {
    const result = await landingPageAction(idle, form({
      operation: "create", name: "秋季說明會", slug: "fall-launch", formId: "form-1", liveId: "live-1", content,
    }));

    expect(mocks.create).toHaveBeenCalledWith({
      name: "秋季說明會", slug: "fall-launch", formId: "form-1", liveId: "live-1", content: JSON.parse(content),
    });
    expect(result).toEqual(expect.objectContaining({ status: "success", id: "page-1", revision: 1 }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/landing-pages");
  });

  it("requires a positive revision for draft updates", async () => {
    const result = await landingPageAction(idle, form({ operation: "save", id: "page-1", revision: "0", content }));

    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("版本資訊") });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("驗證並轉交 bounded Step metadata command", async () => {
    const mutation = { type: "rename", stepId: "opt_in", name: "新版名單頁" };
    const result = await landingPageAction(idle, form({ operation: "save_steps", id: "page-1", revision: "2", mutation: JSON.stringify(mutation) }));
    expect(mocks.saveSteps).toHaveBeenCalledWith({ id: "page-1", revision: 2, mutation });
    expect(result).toMatchObject({ status: "success", revision: 3 });
  });

  it("拒絕未宣告的 Step metadata command", async () => {
    const result = await landingPageAction(idle, form({ operation: "save_steps", id: "page-1", revision: "2", mutation: JSON.stringify({ type: "replace_canvas", content: {} }) }));
    expect(result).toMatchObject({ status: "error" });
    expect(mocks.saveSteps).not.toHaveBeenCalled();
  });

  it("maps a compare-and-swap conflict to recoverable feedback", async () => {
    mocks.publish.mockRejectedValueOnce(new errorTypes.Conflict());

    const result = await landingPageAction(idle, form({ operation: "publish", id: "page-1", revision: "2" }));

    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("較新的版本") });
  });

  it("does not parse a draft body for publication and forwards the expected revision", async () => {
    await landingPageAction(idle, form({ operation: "publish", id: "page-1", revision: "2", content: "not-json" }));

    expect(mocks.publish).toHaveBeenCalledWith("page-1", 2);
  });

  it("刪除前要求 revision，並只轉交受 scope 保護的識別資料", async () => {
    const result = await landingPageAction(idle, form({ operation: "delete", id: "page-1", revision: "2" }));
    expect(mocks.delete).toHaveBeenCalledWith("page-1", 2);
    expect(result).toMatchObject({ status: "success", id: "page-1", message: expect.stringContaining("已刪除") });
  });
});
