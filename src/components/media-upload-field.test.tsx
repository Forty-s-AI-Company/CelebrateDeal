import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaUploadField, mediaUploadReducer, type MediaUploadState } from "./media-upload-field";

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
    expect(markup).toContain("進階：使用既有圖片 URL");
    expect(markup).toContain("開始上傳");
    expect(markup).toContain('aria-busy="false"');
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

describe("mediaUploadReducer", () => {
  it("tracks progress and binds a completed image asset", () => {
    const uploading = mediaUploadReducer(baseState, { type: "progress", progress: 42 });
    const completed = mediaUploadReducer(uploading, { type: "image-success", assetId: "asset-2", publicUrl: "https://media.example.test/new.webp" });

    expect(completed).toMatchObject({ phase: "success", progress: 100, assetId: "asset-2", remoteUrl: "https://media.example.test/new.webp" });
  });

  it("removes an image reference but preserves the server-owned video resource id", () => {
    expect(mediaUploadReducer(baseState, { type: "remove", kind: "image" })).toMatchObject({ remoteUrl: "", assetId: "" });
    expect(mediaUploadReducer({ ...baseState, resourceId: "video-1" }, { type: "remove", kind: "video" }).resourceId).toBe("video-1");
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
