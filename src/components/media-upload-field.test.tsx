// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaUploadClientError } from "@/lib/media-upload-client";
import {
  MediaUploadField,
  cropAspectRatio,
  estimatedMinutesForDuration,
  formatVideoDimensions,
  mediaUploadPersistedValue,
  mediaUploadReducer,
  shouldAutoUploadThumbnail,
  type MediaUploadPhase,
  type MediaUploadState,
} from "./media-upload-field";

const mediaMocks = vi.hoisted(() => ({
  requestMediaJson: vi.fn(),
  uploadFileWithProgress: vi.fn(),
  /** Resolves the upload that is currently being sent. */
  finishUpload: () => undefined as void,
}));

// Only the network edge is replaced; validation, parsing and the component are the real ones.
vi.mock("@/lib/media-upload-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/media-upload-client")>(),
  requestMediaJson: mediaMocks.requestMediaJson,
  uploadFileWithProgress: mediaMocks.uploadFileWithProgress,
}));

const baseState: MediaUploadState = {
  phase: "idle",
  file: null,
  previewUrl: "",
  progress: 0,
  errorCode: "",
  remoteUrl: "https://media.example.test/existing.webp",
  assetId: "asset-1",
  resourceId: "",
  resumableUploadUrl: "",
  resumableUploadTicket: "",
};

describe("MediaUploadField", () => {
  it("renders an accessible image drop zone, provider-backed hidden fields, preview, and legacy URL fallback", () => {
    const markup = renderToStaticMarkup(
      <form>
        <input type="hidden" name="_csrf" value="csrf-test" />
        <MediaUploadField
          kind="image"
          label="商品圖片"
          description="直接上傳商品主圖。"
          defaultUrl="https://media.example.test/existing.webp"
          defaultAssetId="asset-1"
          urlInputName="imageUrl"
          assetIdInputName="imageAssetId"
          statusInputName="imageUploadPhase"
          allowExternalUrlFallback
        />
      </form>,
    );

    expect(markup).toContain("拖拉檔案到這裡，或點擊選檔");
    expect(markup).toContain('type="file"');
    expect(markup).toContain('<label for=');
    expect(markup).toContain('aria-labelledby=');
    expect(markup).toContain('name="imageUrl"');
    expect(markup).toContain('name="imageAssetId"');
    expect(markup).toContain('name="imageUploadPhase"');
    expect(markup.match(/name="imageUrl"/g)).toHaveLength(1);
    expect(markup).toContain("進階：使用既有圖片 URL");
    expect(markup).toContain("開始上傳");
    expect(markup).toContain('aria-busy="false"');
  });

  it("associates a server error with both image controls", () => {
    const markup = renderToStaticMarkup(
      <MediaUploadField
        kind="image"
        label="報名頁海報"
        description="直接上傳主視覺。"
        urlInputName="heroImageUrl"
        allowExternalUrlFallback
        invalid
        errorId="form-hero-media-error"
      />,
    );

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="form-hero-media-error"');
    expect(markup).toContain("description form-hero-media-error");
  });

  it("keeps a legacy image URL preview and hidden value without showing a URL input by default", () => {
    const markup = renderToStaticMarkup(
      <form>
        <MediaUploadField
          kind="image"
          label="商品圖片"
          description="直接上傳商品主圖。"
          defaultUrl="https://media.example.test/legacy.webp"
          urlInputName="imageUrl"
        />
      </form>,
    );

    expect(markup).toContain('name="imageUrl"');
    expect(markup).toContain('value="https://media.example.test/legacy.webp"');
    expect(markup.match(/name="imageUrl"/g)).toHaveLength(1);
    expect(markup).toContain("legacy.webp");
    expect(markup).not.toContain("進階：使用既有圖片 URL");
    expect(markup).not.toContain('type="url"');
  });

  it("previews a signed thumbnail but keeps submitting the stored URL (F-093)", () => {
    const stored = "https://videodelivery.net/a1b2c3d4e5f60718293a4b5c6d7e8f90/thumbnails/thumbnail.jpg";
    const signed = "https://videodelivery.net/aaa.bbb.ccc/thumbnails/thumbnail.jpg";
    const markup = renderToStaticMarkup(
      <form>
        <MediaUploadField
          kind="image"
          label="影片縮圖"
          description="縮圖"
          defaultUrl={stored}
          defaultPreviewUrl={signed}
          urlInputName="thumbnailUrl"
        />
      </form>,
    );

    expect(markup).toContain(`name="thumbnailUrl" value="${stored}"`);
    expect(markup).toContain(`src="${signed}"`);
    expect(markup).not.toContain(`src="${stored}"`);
  });

  it("renders video upload without a writable provider URL or UID", () => {
    const markup = renderToStaticMarkup(
      <form>
        <input name="title" defaultValue="新品介紹" />
        <MediaUploadField
          kind="video"
          label="影片檔案"
          description="直接上傳到 Stream。"
          defaultResourceId="video-1"
          resourceIdInputName="id"
          titleInputName="title"
          durationInputName="durationSec"
        />
      </form>,
    );

    expect(markup).toContain('name="id"');
    expect(markup).toContain('value="video-1"');
    expect(markup).toContain("最多 30 GB；大型檔案會自動分段續傳");
    expect(markup).not.toContain('name="cloudflareStreamUid"');
    expect(markup).not.toContain('name="uploadUrl"');
    expect(markup).not.toContain("進階：使用既有圖片 URL");
  });
});

describe("video metadata and thumbnail crop helpers", () => {
  it("calculates provider usage minutes from the actual duration", () => {
    expect(estimatedMinutesForDuration(0)).toBe(0);
    expect(estimatedMinutesForDuration(1)).toBe(1);
    expect(estimatedMinutesForDuration(61)).toBe(2);
    expect(estimatedMinutesForDuration(Number.NaN)).toBe(0);
  });

  it("keeps the selected crop ratio independent from the source video ratio", () => {
    expect(cropAspectRatio("16:9", 1)).toBeCloseTo(16 / 9);
    expect(cropAspectRatio("1:1", 16 / 9)).toBe(1);
    expect(cropAspectRatio("4:5", 16 / 9)).toBeCloseTo(4 / 5);
    expect(cropAspectRatio("original", 4 / 3)).toBeCloseTo(4 / 3);
  });

  it("formats dimensions for the local preview status", () => {
    expect(formatVideoDimensions(1920, 1080)).toBe("1920 × 1080");
    expect(formatVideoDimensions(0, 0)).toBe("讀取影片尺寸中");
  });

  it("marks captured video frames for the automatic image upload flow", () => {
    expect(shouldAutoUploadThumbnail({ autoUpload: true })).toBe(true);
    expect(shouldAutoUploadThumbnail({ autoUpload: false })).toBe(false);
    expect(shouldAutoUploadThumbnail({ file: "frame.jpg" })).toBe(false);
    expect(shouldAutoUploadThumbnail(null)).toBe(false);
  });
});

describe("mediaUploadReducer", () => {
  it("hydrates restored draft media and clears stale completed upload state", () => {
    const restored = mediaUploadReducer(
      {
        ...baseState,
        phase: "success",
        file: { name: "old.webp" } as File,
        previewUrl: "blob:old",
      },
      {
        type: "hydrate",
        url: "https://media.example.test/draft.webp",
        assetId: "draft-asset",
        resourceId: "",
      },
    );

    expect(restored).toMatchObject({
      phase: "idle",
      file: null,
      previewUrl: "",
      remoteUrl: "https://media.example.test/draft.webp",
      assetId: "draft-asset",
    });
    expect(mediaUploadPersistedValue(restored)).toEqual({
      url: "https://media.example.test/draft.webp",
      assetId: "draft-asset",
      resourceId: "",
    });
  });

  it("tracks progress and binds a completed image asset", () => {
    const uploading = mediaUploadReducer(baseState, { type: "progress", progress: 42 });
    const completed = mediaUploadReducer(uploading, { type: "image-success", assetId: "asset-2", publicUrl: "https://media.example.test/new.webp" });

    expect(completed).toMatchObject({ phase: "success", progress: 100, assetId: "asset-2", remoteUrl: "https://media.example.test/new.webp" });
    const persisted = mediaUploadPersistedValue(completed);
    expect(persisted).toEqual({
      url: "https://media.example.test/new.webp",
      assetId: "asset-2",
      resourceId: "",
    });
    expect(Object.keys(persisted)).toEqual(["url", "assetId", "resourceId"]);
  });

  it("removes an image reference but preserves the server-owned video resource id", () => {
    const removedImage = mediaUploadReducer(baseState, { type: "remove", kind: "image" });
    expect(removedImage).toMatchObject({ remoteUrl: "", assetId: "" });
    expect(mediaUploadPersistedValue(removedImage)).toEqual({ url: "", assetId: "", resourceId: "" });

    const removedVideo = mediaUploadReducer({ ...baseState, resourceId: "video-1" }, { type: "remove", kind: "video" });
    expect(removedVideo.resourceId).toBe("video-1");
    expect(mediaUploadPersistedValue(removedVideo)).toEqual({
      url: baseState.remoteUrl,
      assetId: baseState.assetId,
      resourceId: "video-1",
    });
  });

  it("switches from a provider asset to one external URL without retaining stale upload state", () => {
    const changed = mediaUploadReducer(
      { ...baseState, phase: "error", errorCode: "network_error" },
      { type: "external-url", value: "https://media.example.test/migrated.webp" },
    );

    expect(changed).toMatchObject({
      phase: "idle",
      errorCode: "",
      remoteUrl: "https://media.example.test/migrated.webp",
      assetId: "",
      previewUrl: "",
      file: null,
    });
    expect(mediaUploadPersistedValue(changed)).toEqual({
      url: "https://media.example.test/migrated.webp",
      assetId: "",
      resourceId: "",
    });
  });

  it("keeps a provisioned Stream row id available for a safe retry after upload failure", () => {
    const provisioned = mediaUploadReducer(baseState, {
      type: "video-provisioned",
      resourceId: "video-retry-1",
      resumableUploadUrl: "https://upload.videodelivery.net/tus/retry-1",
      resumableUploadTicket: "opaque-ticket-that-is-long-enough",
    });
    const failed = mediaUploadReducer(provisioned, { type: "error", code: "network_error" });

    expect(failed).toMatchObject({
      phase: "error",
      resourceId: "video-retry-1",
      resumableUploadUrl: "https://upload.videodelivery.net/tus/retry-1",
      resumableUploadTicket: "opaque-ticket-that-is-long-enough",
      errorCode: "network_error",
    });
  });

  it("keeps a resumable session for cancellation but discards a provider-rejected session", () => {
    const resumable = {
      ...baseState,
      resourceId: "video-retry-1",
      resumableUploadUrl: "https://upload.videodelivery.net/tus/retry-1",
      resumableUploadTicket: "opaque-ticket-that-is-long-enough",
    };

    expect(mediaUploadReducer(resumable, { type: "error", code: "cancelled" }).resumableUploadUrl)
      .toBe("https://upload.videodelivery.net/tus/retry-1");
    expect(mediaUploadReducer(resumable, { type: "error", code: "provider_rejected" }).resumableUploadUrl)
      .toBe("");
    expect(mediaUploadReducer(resumable, { type: "error", code: "provider_rejected" }).resumableUploadTicket)
      .toBe("");
    expect(mediaUploadReducer(resumable, { type: "error", code: "video_upload_failed" }).resumableUploadTicket)
      .toBe("");
  });
});

describe("MediaUploadField video upload (real component)", () => {
  const defaultSuccess = "檔案已送達 Cloudflare Stream，正在處理，尚未可播放；儲存表單後會套用。";
  let host: HTMLDivElement;
  let root: Root;
  let phases: Array<[MediaUploadPhase, string]>;
  let thumbnailEvents: Event[];

  beforeEach(() => {
    vi.clearAllMocks();
    phases = [];
    thumbnailEvents = [];
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    URL.createObjectURL = vi.fn(() => "blob:video-preview");
    URL.revokeObjectURL = vi.fn();
    // A canvas that can "capture" a frame, so the default case really dispatches.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["frame"], { type: "image/jpeg" })));
    mediaMocks.requestMediaJson.mockResolvedValue({ videoId: "video-1", uploadUrl: "https://upload.videodelivery.net/one-time", method: "POST" });
    mediaMocks.uploadFileWithProgress.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new MediaUploadClientError("cancelled")));
      mediaMocks.finishUpload = () => resolve();
    }));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.restoreAllMocks();
  });

  async function renderField(extra: { allowFrameCapture?: boolean; successMessage?: string } = {}) {
    await act(async () => {
      root.render(
        <form>
          <input type="hidden" name="_csrf" value="csrf-test" />
          <input name="title" defaultValue="新品介紹" />
          <input name="durationSec" defaultValue="0" />
          <input name="estimatedMinutes" defaultValue="0" />
          <MediaUploadField
            kind="video"
            label="影片檔案"
            description="直接上傳到 Stream。"
            titleInputName="title"
            durationInputName="durationSec"
            estimatedMinutesInputName="estimatedMinutes"
            onPhaseChange={(phase, resourceId) => phases.push([phase, resourceId])}
            {...extra}
          />
        </form>,
      );
    });
    host.querySelector("form")!.addEventListener("video-thumbnail-selected", (event) => thumbnailEvents.push(event));
  }

  async function chooseFile() {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["video"], "clip.mp4", { type: "video/mp4" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  }

  /** The preview video reports its length and size, then finishes seeking to the default frame. */
  async function loadVideoMetadata() {
    const video = host.querySelector("video")!;
    Object.defineProperty(video, "duration", { configurable: true, value: 90 });
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1280 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 720 });
    await act(async () => { video.dispatchEvent(new Event("loadedmetadata")); });
    await act(async () => { video.dispatchEvent(new Event("seeked")); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  function actionButton(label: string) {
    return Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(label));
  }

  it("offers 使用目前畫面作為縮圖 and the original success message by default", async () => {
    await renderField();
    await chooseFile();
    await loadVideoMetadata();

    expect(actionButton("使用目前畫面作為縮圖")).toBeDefined();
    expect(host.querySelector('input[type="range"]')?.getAttribute("aria-label")).toBe("選取影片縮圖畫面");
    // The default frame is captured on its own once the preview has seeked.
    expect(thumbnailEvents).toHaveLength(1);
    expect((thumbnailEvents[0] as CustomEvent).detail).toMatchObject({ autoUpload: true });

    await act(async () => { actionButton("開始上傳")!.click(); });
    await act(async () => { mediaMocks.finishUpload(); });
    expect(host.textContent).toContain(defaultSuccess);
  });

  it("shows no capture button, picks no frame and uses neutral wording when allowFrameCapture is false", async () => {
    await renderField({ allowFrameCapture: false, successMessage: "檔案已送達，正在轉檔。" });
    await chooseFile();
    await loadVideoMetadata();

    expect(actionButton("使用目前畫面作為縮圖")).toBeUndefined();
    expect(host.textContent).not.toContain("使用目前畫面作為縮圖");
    expect(thumbnailEvents).toHaveLength(0);
    // The slider still scrubs the preview, but does not claim to pick a thumbnail.
    expect(host.querySelector('input[type="range"]')?.getAttribute("aria-label")).toBe("預覽播放位置");

    await act(async () => { actionButton("開始上傳")!.click(); });
    await act(async () => { mediaMocks.finishUpload(); });
    expect(host.textContent).toContain("檔案已送達，正在轉檔。");
    expect(host.textContent).not.toContain(defaultSuccess);
    expect(thumbnailEvents).toHaveLength(0);
  });

  it("reports the phases of an upload, a pause, a retry and the success through onPhaseChange", async () => {
    await renderField();
    await chooseFile();
    expect(phases).toEqual([["ready", ""]]);

    await act(async () => { actionButton("開始上傳")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(phases.map(([phase]) => phase)).toEqual(["ready", "uploading", "uploading"]);
    expect(phases.at(-1)).toEqual(["uploading", "video-1"]);

    await act(async () => { actionButton("暫停上傳")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(phases.at(-1)).toEqual(["error", "video-1"]);

    // 重試 reuses the provisioned row.
    await act(async () => { actionButton("重試上傳")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(phases.at(-1)).toEqual(["uploading", "video-1"]);
    expect(mediaMocks.requestMediaJson).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ videoId: "video-1" }) }));

    await act(async () => { mediaMocks.finishUpload(); });
    await act(async () => { await Promise.resolve(); });
    expect(phases.at(-1)).toEqual(["success", "video-1"]);
    // Never the same pair twice in a row.
    for (let index = 1; index < phases.length; index += 1) expect(phases[index]).not.toEqual(phases[index - 1]);
  });
});
