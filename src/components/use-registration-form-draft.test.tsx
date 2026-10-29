// @vitest-environment happy-dom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registrationFormDraftStorageKey,
  serializeRegistrationFormDraft,
  type RegistrationFormDraftValues,
} from "@/lib/registration-form-draft";
import { useRegistrationFormDraft } from "./use-registration-form-draft";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fields = [
  { key: "name", label: "姓名", type: "text" as const, required: true },
  { key: "email", label: "Email", type: "email" as const, required: true },
];
const baseValues: RegistrationFormDraftValues = {
  name: "活動報名",
  slug: "summer",
  headline: "立即報名",
  description: "活動說明",
  submitLabel: "送出",
  successMessage: "完成",
  heroImageUrl: null,
  heroImageAssetId: null,
  backgroundImageUrl: null,
  backgroundImageAssetId: null,
  promoVideoId: null,
  themeColor: "#12aBc9",
  countdownMinutes: 120,
  stickyText: "直播限定",
  bodyContent: "活動內文",
  notice: "注意事項",
  seoTitle: "SEO 標題",
  seoDescription: "SEO 說明",
  maxVisibleSessions: 3,
  hideExpiredSessions: false,
  isActive: true,
};
const draftValues = { ...baseValues, name: "未歸屬時的草稿" } as RegistrationFormDraftValues;

const PROJECT_SCOPE = "vendor-1:project:project-1";
const projectKey = registrationFormDraftStorageKey(PROJECT_SCOPE);
const vendorKey = registrationFormDraftStorageKey("vendor-1");
const serialize = (values: RegistrationFormDraftValues) => serializeRegistrationFormDraft({ baseUpdatedAt: null, values, fields });

type Api = { draft: ReturnType<typeof useRegistrationFormDraft>; edit: (name: string) => void };
let api: Api;

function Harness() {
  const [values, setValues] = useState(baseValues);
  const draft = useRegistrationFormDraft({
    draftScope: PROJECT_SCOPE,
    fallbackDraftScope: "vendor-1",
    initialUpdatedAt: null,
    initialValues: baseValues,
    initialFields: fields,
    values,
    fields,
    pending: false,
    onRestore: (restored) => setValues(restored.values),
  });
  useEffect(() => {
    api = { draft, edit: (name) => setValues((current) => ({ ...current, name }) as RegistrationFormDraftValues) };
  });
  return null;
}

let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

async function mount() {
  await act(async () => { root.render(<Harness />); });
}
async function flushAutosave() {
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
}

describe("useRegistrationFormDraft vendor-level fallback", () => {
  it("offers the vendor-level draft when the project key is empty", async () => {
    window.localStorage.setItem(vendorKey, serialize(draftValues));
    await mount();
    expect(api.draft.candidate?.values.name).toBe("未歸屬時的草稿");
    expect(api.draft.fromVendorScope).toBe(true);
  });

  it("(a) restore then edit writes the project key and deletes the vendor key", async () => {
    window.localStorage.setItem(vendorKey, serialize(draftValues));
    await mount();
    await act(async () => { api.draft.restoreDraft(); });
    await flushAutosave();
    expect(window.localStorage.getItem(projectKey)).toBeNull();
    expect(window.localStorage.getItem(vendorKey)).not.toBeNull();
    await act(async () => { api.edit("編輯後"); });
    await flushAutosave();
    expect(JSON.parse(window.localStorage.getItem(projectKey) ?? "null").values.name).toBe("編輯後");
    expect(window.localStorage.getItem(vendorKey)).toBeNull();
  });

  it("(b) restore without editing keeps the vendor key", async () => {
    window.localStorage.setItem(vendorKey, serialize(draftValues));
    await mount();
    await act(async () => { api.draft.restoreDraft(); });
    await flushAutosave();
    expect(window.localStorage.getItem(vendorKey)).not.toBeNull();
    expect(window.localStorage.getItem(projectKey)).toBeNull();
  });

  it("(c) discarding the fallback draft removes both keys", async () => {
    window.localStorage.setItem(vendorKey, serialize(draftValues));
    await mount();
    await act(async () => { api.draft.discardDraft(); });
    expect(window.localStorage.getItem(vendorKey)).toBeNull();
    expect(window.localStorage.getItem(projectKey)).toBeNull();
  });

  it("(d) a project-scoped draft wins and leaves the vendor draft untouched and hidden", async () => {
    window.localStorage.setItem(projectKey, serialize({ ...baseValues, name: "專案草稿" } as RegistrationFormDraftValues));
    window.localStorage.setItem(vendorKey, serialize(draftValues));
    await mount();
    expect(api.draft.candidate?.values.name).toBe("專案草稿");
    expect(api.draft.fromVendorScope).toBe(false);
    await act(async () => { api.draft.discardDraft(); });
    expect(window.localStorage.getItem(projectKey)).toBeNull();
    expect(window.localStorage.getItem(vendorKey)).not.toBeNull();
  });

  it("does not migrate again when another tab already removed the vendor draft", async () => {
    window.localStorage.setItem(vendorKey, serialize(draftValues));
    await mount();
    await act(async () => { api.draft.restoreDraft(); });
    await act(async () => {
      window.localStorage.removeItem(vendorKey);
      window.dispatchEvent(new Event("storage"));
    });
    await act(async () => { api.edit("編輯後"); });
    await flushAutosave();
    expect(window.localStorage.getItem(vendorKey)).toBeNull();
    expect(window.localStorage.getItem(projectKey)).not.toBeNull();
  });
});
