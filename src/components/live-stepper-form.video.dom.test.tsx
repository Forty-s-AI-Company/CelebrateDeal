// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaUploadPhase } from "@/components/media-upload-field";
import { emptyLiveStudioDraft, LiveStudioDraftPayloadSchema, type LiveStudioDraftPayload } from "@/lib/live-studio-draft";
import { liveStudioStepIndex } from "@/lib/live-studio-steps";

const mocks = vi.hoisted(() => ({
  upsertLiveAction: vi.fn(async (formData: FormData) => { void formData; }),
  saveLiveStudioDraft: vi.fn(),
  createRegistrationFormQuickAction: vi.fn(),
  createMessageTemplateQuickAction: vi.fn(),
  createUrlVideoQuickAction: vi.fn(),
  /** The drawer's video upload field: its phase callback, as the real field calls it. */
  videoUpload: { onPhaseChange: null as null | ((phase: MediaUploadPhase, resourceId: string) => void) },
}));

vi.mock("@/app/actions", () => ({ upsertLiveAction: mocks.upsertLiveAction }));
vi.mock("@/app/actions/live-resource-quick-create", () => ({
  createRegistrationFormQuickAction: mocks.createRegistrationFormQuickAction,
  createMessageTemplateQuickAction: mocks.createMessageTemplateQuickAction,
  createUrlVideoQuickAction: mocks.createUrlVideoQuickAction,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/components/media-upload-field", () => ({
  MediaUploadField: (props: { kind: string; defaultUrl?: string; defaultAssetId?: string; onPhaseChange?: (phase: MediaUploadPhase, resourceId: string) => void }) => {
    if (props.kind === "video") {
      mocks.videoUpload.onPhaseChange = props.onPhaseChange ?? null;
      return <input type="file" name="videoFile" aria-label="影片檔" />;
    }
    return (
      <>
        <input type="hidden" name="heroImageUrl" value={props.defaultUrl ?? ""} readOnly />
        <input type="hidden" name="heroImageAssetId" value={props.defaultAssetId ?? ""} readOnly />
      </>
    );
  },
}));
vi.mock("@/lib/live-studio-draft-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/live-studio-draft-client")>(),
  saveLiveStudioDraft: mocks.saveLiveStudioDraft,
}));

import { LiveStepperForm } from "./live-stepper-form";
import { LIVE_PENDING_VIDEO_POLL_DELAYS_MS } from "./live-pending-videos";
import { serializeLiveStudioDraft } from "@/lib/live-studio-draft-client";

const existingVideo = { id: "video-existing", title: "既有講座錄影" };
const resources = {
  products: [],
  forms: [],
  templates: [],
  scripts: [],
  affiliates: [],
  streamMembers: [],
  streamPages: [],
  csrfToken: "test-fixture-csrf-token",
  timeZone: "Asia/Taipei",
};

let container: HTMLDivElement;
let root: Root;
let visibility: DocumentVisibilityState = "visible";
const fetchMock = vi.fn();

function studio(videos: Array<{ id: string; title: string }> = []) {
  return <LiveStepperForm {...resources} videos={videos} />;
}

function control<T extends Element = HTMLInputElement>(selector: string, scope: ParentNode = container) {
  const element = scope.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

function button(label: string, scope: ParentNode = container) {
  const match = Array.from(scope.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`missing button ${label}`);
  return match;
}

function dialog() {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

function videoSelect() {
  return control<HTMLSelectElement>('select[name="videoId"]');
}

function pendingRow() {
  return container.querySelector<HTMLElement>("[data-pending-video]");
}

function announcement() {
  return container.querySelector("[data-live-resource-status]")?.textContent ?? "";
}

async function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => { input.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await act(async () => { await Promise.resolve(); });
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await settle();
}

async function uploadPhase(phase: MediaUploadPhase, resourceId: string) {
  await act(async () => { mocks.videoUpload.onPhaseChange?.(phase, resourceId); });
  await settle();
}

function statusResponse(status: string, cloudflareReadyToStream: boolean) {
  return new Response(JSON.stringify({
    video: { resourceId: "video-uploaded", status, cloudflareReadyToStream, durationSec: 0, estimatedMinutes: 0, thumbnailUrl: null, videoUrl: null },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

/** Opens the drawer, names the video and runs a whole upload until the file reached Cloudflare. */
async function uploadVideo(title = "週五講座錄影", id = "video-uploaded") {
  await act(async () => { button("上傳影片或貼上影片網址").click(); });
  await type(control('[name="title"]', dialog()!), title);
  await uploadPhase("ready", "");
  await uploadPhase("provisioning", "");
  await uploadPhase("uploading", id);
  await uploadPhase("success", id);
}

/** Creates an external URL video through the drawer; the action answers that it can play at once. */
async function createUrlVideo(id: string, title: string) {
  await act(async () => { button("上傳影片或貼上影片網址").click(); });
  const drawerForm = control<HTMLFormElement>("form", dialog()!);
  control<HTMLDetailsElement>("details", dialog()!).open = true;
  await type(control('[name="title"]', drawerForm), title);
  await type(control('[name="videoUrl"]', drawerForm), "https://media.example.test/live.mp4");
  mocks.createUrlVideoQuickAction.mockResolvedValueOnce({ status: "success", option: { id, title }, ready: true });
  await act(async () => { drawerForm.requestSubmit(); });
  await settle();
}

/** Status answers per video id: ready once the id is in the set, otherwise still processing. */
function answerStatusFor(readyIds: Set<string>) {
  fetchMock.mockImplementation(async (url: string) => {
    const id = new URL(String(url), "http://localhost").searchParams.get("id") ?? "";
    return readyIds.has(id) ? statusResponse("ready", true) : statusResponse("processing", false);
  });
}

function pendingRowOf(id: string) {
  return container.querySelector<HTMLElement>(`[data-pending-video="${id}"]`);
}

function beforeUnloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocks.videoUpload.onPhaseChange = null;
  window.history.replaceState({}, "", "/lives/new");
  mocks.saveLiveStudioDraft.mockImplementation(async (input: { draftId: string; revision: number | null; payload: LiveStudioDraftPayload }) => ({
    id: input.draftId || "draft-created",
    revision: (input.revision ?? 0) + 1,
    payload: input.payload,
    updatedAt: "2026-11-11T08:05:00.000Z",
    slugTaken: false,
    slugCheckFailed: false,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LiveStepperForm 影片抽屜", () => {
  it("keeps the drawer's upload out of the studio form, then waits for processing and selects the video once it can play", async () => {
    await act(async () => { root.render(studio()); });
    const studioForm = control<HTMLFormElement>("form");
    expect(container.textContent).toContain("目前沒有可播放的影片，可以在這裡直接上傳。");
    expect(container.textContent).not.toContain("新增影片或即時直播");
    const fullEditor = control<HTMLAnchorElement>('a[href="/videos/new"]');
    expect(fullEditor.target).toBe("_blank");

    await act(async () => { button("上傳影片或貼上影片網址").click(); });
    const drawer = dialog()!;
    expect(drawer).not.toBeNull();
    expect(studioForm.contains(drawer)).toBe(false);
    const drawerForm = control<HTMLFormElement>("form", drawer);
    // What the upload field reads from its own form: the CSRF token and the title.
    expect(control('[name="_csrf"]', drawerForm).value).toBe("test-fixture-csrf-token");
    await type(control('[name="title"]', drawerForm), "週五講座錄影");
    expect(document.activeElement).toBe(control('[name="title"]', drawerForm));

    await uploadPhase("ready", "");
    await uploadPhase("provisioning", "");
    // The upload field writes the file's length into the drawer form the way the real one does.
    const duration = control('[name="durationSec"]', drawerForm);
    duration.value = "125";
    await act(async () => {
      duration.dispatchEvent(new Event("input", { bubbles: true }));
      duration.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await uploadPhase("uploading", "video-uploaded");

    // While the file is sent the drawer cannot close and says why.
    expect(control<HTMLButtonElement>('button[aria-label="關閉"]', drawer).disabled).toBe(true);
    expect(button("取消", drawer).disabled).toBe(true);
    expect(drawer.textContent).toContain("上傳中無法關閉");
    await act(async () => { drawer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialog()).not.toBeNull();

    const studioData = new FormData(studioForm);
    expect(studioData.has("durationSec")).toBe(false);
    expect(studioData.has("videoUrl")).toBe(false);
    expect([...studioData.values()]).not.toContain("週五講座錄影");
    await advance(1_000);
    expect(mocks.saveLiveStudioDraft).not.toHaveBeenCalled();
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(statusResponse("processing", false)).mockResolvedValueOnce(statusResponse("ready", true));
    await uploadPhase("success", "video-uploaded");

    expect(dialog()).toBeNull();
    expect(pendingRow()?.textContent).toBe("處理中的影片：「週五講座錄影」，轉檔完成後會自動選取。");
    expect(container.textContent).toContain("可以先繼續其他步驟");
    expect(announcement()).toContain("已上傳，正在轉檔");
    // Not playable yet: not an option, so it cannot be selected or counted as ready.
    expect(Array.from(videoSelect().options).map((option) => option.value)).toEqual([""]);
    expect(container.textContent).toContain("待完成 · 可播放的影片或即時直播");

    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[0]!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/media/videos/status?id=video-uploaded");
    expect(videoSelect().value).toBe("");

    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[1]!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(videoSelect().value).toBe("video-uploaded");
    expect(Array.from(videoSelect().options).map((option) => option.value)).toEqual(["", "video-uploaded"]);
    expect(pendingRow()?.textContent).toContain("已可播放，已自動選為這場直播的影片");
    expect(announcement()).toBe("影片「週五講座錄影」已可播放，已自動選為這場直播的影片。");
    expect(container.querySelector('[data-live-resource-status][role="status"]')).not.toBeNull();
    expect(container.textContent).toContain("已完成 · 可播放的影片或即時直播");
    expect(serializeLiveStudioDraft(studioForm, liveStudioStepIndex("content")).videoId).toBe("video-uploaded");

    await advance(1_000);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ videoId: "video-uploaded" }) }));
    // Settled: no more status checks.
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();
  });

  it("only adds the ready video when the merchant picked another one meanwhile", async () => {
    await act(async () => { root.render(studio([existingVideo])); });
    fetchMock.mockResolvedValue(statusResponse("ready", true));
    await uploadVideo();

    const select = videoSelect();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, existingVideo.id);
    await act(async () => { select.dispatchEvent(new Event("change", { bubbles: true })); });
    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[0]!);

    expect(select.value).toBe(existingVideo.id);
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "video-uploaded", existingVideo.id]);
    expect(pendingRow()?.textContent).toContain("你已選了其他影片，所以沒有自動切換");
    expect(announcement()).toContain("目前仍保留你選的影片");
  });

  it("keeps the URL video the merchant created while an earlier upload was still processing", async () => {
    await act(async () => { root.render(studio()); });
    const readyIds = new Set<string>();
    answerStatusFor(readyIds);
    await uploadVideo("上傳的錄影", "video-A");
    await createUrlVideo("video-url", "外部錄影");
    expect(videoSelect().value).toBe("video-url");

    readyIds.add("video-A");
    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[0]!);

    // A is only added to the options and says so; the choice made through the drawer stays.
    expect(videoSelect().value).toBe("video-url");
    expect(Array.from(videoSelect().options).map((option) => option.value).sort()).toEqual(["", "video-A", "video-url"]);
    expect(pendingRowOf("video-A")?.textContent).toContain("已可播放並加入選單；你已選了其他影片，所以沒有自動切換");
    expect(announcement()).toContain("目前仍保留你選的影片");
    expect(serializeLiveStudioDraft(control<HTMLFormElement>("form"), liveStudioStepIndex("content")).videoId).toBe("video-url");
  });

  it("selects only the newest upload when two uploads are processing", async () => {
    await act(async () => { root.render(studio()); });
    const readyIds = new Set<string>();
    answerStatusFor(readyIds);
    await uploadVideo("第一支", "video-A");
    await uploadVideo("第二支", "video-B");

    // The older upload finishes first: a newer upload exists, so it is not selected.
    readyIds.add("video-A");
    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[0]!);
    expect(videoSelect().value).toBe("");
    expect(Array.from(videoSelect().options).map((option) => option.value)).toEqual(["", "video-A"]);
    expect(pendingRowOf("video-A")?.textContent).toContain("你之後又新增了其他影片，所以沒有自動切換");
    expect(pendingRowOf("video-B")?.textContent).toContain("處理中的影片");

    // The newest one is selected when it is ready, because the select still holds what it held at its upload.
    readyIds.add("video-B");
    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[1]!);
    expect(videoSelect().value).toBe("video-B");
    expect(pendingRowOf("video-B")?.textContent).toContain("已自動選為這場直播的影片");
    expect(pendingRowOf("video-A")?.textContent).toContain("你之後又新增了其他影片");
  });

  it("does not let an older upload replace the newest one when both become ready at the same check", async () => {
    await act(async () => { root.render(studio()); });
    answerStatusFor(new Set(["video-A", "video-B"]));
    await uploadVideo("第一支", "video-A");
    await uploadVideo("第二支", "video-B");
    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[0]!);
    expect(videoSelect().value).toBe("video-B");
    expect(pendingRowOf("video-A")?.textContent).toContain("你之後又新增了其他影片");
    expect(pendingRowOf("video-B")?.textContent).toContain("已自動選為這場直播的影片");
  });

  it("does not select a ready video while the studio is submitting and says so", async () => {
    await act(async () => { root.render(studio()); });
    const readyIds = new Set<string>();
    answerStatusFor(readyIds);
    await uploadVideo("週五講座錄影", "video-A");
    control<HTMLFormElement>("form").setAttribute("aria-busy", "true");
    readyIds.add("video-A");
    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[0]!);

    expect(videoSelect().value).toBe("");
    expect(Array.from(videoSelect().options).map((option) => option.value)).toEqual(["", "video-A"]);
    const text = pendingRowOf("video-A")?.textContent ?? "";
    expect(text).toContain("精靈正在送出");
    expect(text).toContain("送出完成後");
    expect(text).not.toContain("你已選了其他影片");
    expect(announcement()).toContain("精靈正在送出");
    expect(announcement()).not.toContain("目前仍保留你選的影片");
  });

  it("tells the merchant that the pending list disappears when the studio is reloaded", async () => {
    await act(async () => { root.render(studio()); });
    answerStatusFor(new Set());
    await uploadVideo();
    expect(container.querySelector("[data-live-pending-videos]")?.textContent).toContain("重新整理或重新載入精靈後這份清單會消失，屆時請從影片下拉手動選取。");
  });

  it("asks the browser to confirm leaving only while a file is being sent", async () => {
    await act(async () => { root.render(studio()); });
    await act(async () => { button("上傳影片或貼上影片網址").click(); });
    await type(control('[name="title"]', dialog()!), "週五講座錄影");
    expect(beforeUnloadPrevented()).toBe(false);

    for (const phase of ["provisioning", "uploading", "finalizing"] as const) {
      await uploadPhase(phase, "video-uploaded");
      expect(beforeUnloadPrevented()).toBe(true);
    }
    // Paused or failed: leaving is safe again; a retry asks again.
    await uploadPhase("error", "video-uploaded");
    expect(beforeUnloadPrevented()).toBe(false);
    await uploadPhase("uploading", "video-uploaded");
    expect(beforeUnloadPrevented()).toBe(true);
    // The file arrived: the row keeps processing at Cloudflare without the page.
    await uploadPhase("success", "video-uploaded");
    expect(beforeUnloadPrevented()).toBe(false);
  });

  it("removes the leave warning when the drawer unmounts during an upload", async () => {
    await act(async () => { root.render(studio()); });
    await act(async () => { button("上傳影片或貼上影片網址").click(); });
    await uploadPhase("uploading", "video-uploaded");
    expect(beforeUnloadPrevented()).toBe(true);
    await act(async () => { root.render(<></>); });
    expect(beforeUnloadPrevented()).toBe(false);
  });

  it("keeps holding the studio while another upload is in flight when a background video becomes ready", async () => {
    // A slug is set so nothing autofills: the studio starts with no unsaved edits of its own.
    const payload = LiveStudioDraftPayloadSchema.parse({ ...emptyLiveStudioDraft(), title: "週五講座", slug: "weekly-talk", activeStep: liveStudioStepIndex("content") });
    const envelope = { id: "draft-edit", revision: 4, payload, updatedAt: "2026-11-11T08:00:00.000Z" };
    const edit = (revision: number) => <LiveStepperForm {...resources} videos={[]} initialDraft={{ ...envelope, revision }} liveId="live-1" currentStatus="scheduled" />;
    await act(async () => { root.render(edit(4)); });
    const studioForm = control<HTMLFormElement>("form");
    const readyIds = new Set<string>();
    answerStatusFor(readyIds);

    await uploadVideo("第一支", "video-A");
    // A second file is being sent in a new drawer while A is still processing.
    await act(async () => { button("上傳影片或貼上影片網址").click(); });
    await uploadPhase("provisioning", "");
    await uploadPhase("uploading", "video-B");

    // A becomes ready in the background (selected, saved) while B is still being sent.
    readyIds.add("video-A");
    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[0]!);
    expect(videoSelect().value).toBe("video-A");
    await advance(2_000);
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalled();

    // The draft is saved and a newer revision arrives: the studio still counts the running upload as unsaved work.
    await act(async () => { root.render(edit(9)); });
    expect(control<HTMLFormElement>("form")).toBe(studioForm);
    expect(dialog()).not.toBeNull();
  });

  it("offers 重新檢查 after the last scheduled check and starts again from it", async () => {
    await act(async () => { root.render(studio()); });
    fetchMock.mockImplementation(async () => statusResponse("processing", false));
    await uploadVideo();

    for (const delay of LIVE_PENDING_VIDEO_POLL_DELAYS_MS) await advance(delay);
    expect(fetchMock).toHaveBeenCalledTimes(LIVE_PENDING_VIDEO_POLL_DELAYS_MS.length);
    expect(pendingRow()?.textContent).toContain("已暫停自動檢查");
    const retry = control<HTMLButtonElement>("button", pendingRow()!);
    expect(retry.textContent).toContain("重新檢查");
    await advance(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(LIVE_PENDING_VIDEO_POLL_DELAYS_MS.length);

    fetchMock.mockImplementation(async () => statusResponse("ready", true));
    await act(async () => { retry.click(); });
    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[0]!);
    expect(fetchMock).toHaveBeenCalledTimes(LIVE_PENDING_VIDEO_POLL_DELAYS_MS.length + 1);
    expect(videoSelect().value).toBe("video-uploaded");
  });

  it("does not check while the page is hidden and checks once it is shown again", async () => {
    await act(async () => { root.render(studio()); });
    fetchMock.mockImplementation(async () => statusResponse("ready", true));
    await uploadVideo();
    visibility = "hidden";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });

    await advance(15 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(videoSelect().value).toBe("");

    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(videoSelect().value).toBe("video-uploaded");
  });

  it("shows a failed transcode with a link to the video list and never selects it", async () => {
    await act(async () => { root.render(studio()); });
    fetchMock.mockImplementation(async () => statusResponse("error", false));
    await uploadVideo();
    await advance(LIVE_PENDING_VIDEO_POLL_DELAYS_MS[0]!);

    expect(pendingRow()?.textContent).toContain("轉檔失敗，無法播放");
    const link = control<HTMLAnchorElement>('a[href="/videos"]', pendingRow()!);
    expect(link.target).toBe("_blank");
    expect(announcement()).toContain("轉檔失敗");
    expect(Array.from(videoSelect().options).map((option) => option.value)).toEqual([""]);
    await advance(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the drawer to closable when the upload is paused, without leaving the studio holding a create", async () => {
    await act(async () => { root.render(studio()); });
    await act(async () => { button("上傳影片或貼上影片網址").click(); });
    await type(control('[name="title"]', dialog()!), "週五講座錄影");
    await uploadPhase("uploading", "video-uploaded");
    expect(control<HTMLButtonElement>('button[aria-label="關閉"]', dialog()!).disabled).toBe(true);
    await uploadPhase("error", "video-uploaded");

    expect(control<HTMLButtonElement>('button[aria-label="關閉"]', dialog()!).disabled).toBe(false);
    await act(async () => { button("取消", dialog()!).click(); });
    expect(dialog()).toBeNull();
    expect(pendingRow()).toBeNull();
  });

  it("creates an external URL video in the drawer and selects it at once", async () => {
    await act(async () => { root.render(studio()); });
    const studioForm = control<HTMLFormElement>("form");
    const trigger = button("上傳影片或貼上影片網址");
    trigger.focus();
    await act(async () => { trigger.click(); });
    const drawer = dialog()!;
    const drawerForm = control<HTMLFormElement>("form", drawer);

    // Enter in the title while the URL section is closed creates nothing.
    await act(async () => { drawerForm.requestSubmit(); });
    expect(mocks.createUrlVideoQuickAction).not.toHaveBeenCalled();

    control<HTMLDetailsElement>("details", drawer).open = true;
    await type(control('[name="title"]', drawerForm), "外部講座錄影");
    await type(control('[name="videoUrl"]', drawerForm), "javascript:alert(1)");
    await act(async () => { drawerForm.requestSubmit(); });
    await settle();
    expect(mocks.createUrlVideoQuickAction).not.toHaveBeenCalled();
    expect(control('[name="videoUrl"]', drawerForm).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(control('[name="videoUrl"]', drawerForm));

    await type(control('[name="videoUrl"]', drawerForm), "https://media.example.test/live.mp4");
    expect(new FormData(studioForm).has("videoUrl")).toBe(false);
    mocks.createUrlVideoQuickAction.mockResolvedValueOnce({ status: "success", option: { id: "video-url", title: "外部講座錄影" }, ready: true });
    await act(async () => { drawerForm.requestSubmit(); });
    await settle();
    await advance(1_000);

    const sent = mocks.createUrlVideoQuickAction.mock.calls[0]![0] as FormData;
    expect(sent.get("_csrf")).toBe("test-fixture-csrf-token");
    expect(sent.get("videoUrl")).toBe("https://media.example.test/live.mp4");
    expect(dialog()).toBeNull();
    expect(videoSelect().value).toBe("video-url");
    expect(document.activeElement).toBe(videoSelect());
    expect(announcement()).toBe("已建立並選取影片「外部講座錄影」。");
    expect(pendingRow()).toBeNull();
    expect(serializeLiveStudioDraft(studioForm, liveStudioStepIndex("content")).videoId).toBe("video-url");
    expect(mocks.saveLiveStudioDraft).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ videoId: "video-url" }) }));
    expect(mocks.upsertLiveAction).not.toHaveBeenCalled();
  });

  it("does not remount the studio for a newer draft revision while a file is being sent", async () => {
    // A slug is set so nothing autofills: the studio starts with no unsaved edits of its own.
    const payload = LiveStudioDraftPayloadSchema.parse({ ...emptyLiveStudioDraft(), title: "週五講座", slug: "weekly-talk", activeStep: liveStudioStepIndex("content") });
    const envelope = { id: "draft-edit", revision: 4, payload, updatedAt: "2026-11-11T08:00:00.000Z" };
    const edit = (revision: number) => <LiveStepperForm {...resources} videos={[]} initialDraft={{ ...envelope, revision }} liveId="live-1" currentStatus="scheduled" />;
    await act(async () => { root.render(edit(4)); });
    const studioForm = control<HTMLFormElement>("form");
    await act(async () => { button("上傳影片或貼上影片網址").click(); });
    expect(control('[name="title"]', dialog()!).value).toBe("週五講座");
    await uploadPhase("uploading", "video-uploaded");

    await act(async () => { root.render(edit(6)); });
    expect(control<HTMLFormElement>("form")).toBe(studioForm);
    expect(dialog()).not.toBeNull();
  });

  it("never opens while the studio submits", async () => {
    await act(async () => { root.render(studio()); });
    control<HTMLFormElement>("form").setAttribute("aria-busy", "true");
    await act(async () => { button("上傳影片或貼上影片網址").click(); });
    expect(dialog()).toBeNull();
  });
});
