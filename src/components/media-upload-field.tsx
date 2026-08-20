"use client";

import Image from "next/image";
import { useEffect, useId, useReducer, useRef, useState } from "react";
import { CheckCircle2, FileUp, LoaderCircle, RotateCcw, Trash2, X } from "lucide-react";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import {
  MediaUploadClientError,
  type MediaUploadKind,
  parseImageProvision,
  parseResumableVideoComplete,
  parseResumableVideoProvision,
  parseVideoProvision,
  requestMediaJson,
  uploadFileWithProgress,
  uploadResumableFileWithProgress,
  validateMediaFile,
  VIDEO_BASIC_UPLOAD_MAX_BYTES,
} from "@/lib/media-upload-client";

type UploadPhase = "idle" | "ready" | "provisioning" | "uploading" | "finalizing" | "success" | "error";
type CropAspect = "16:9" | "1:1" | "4:5" | "original";
type CropPan = { x: number; y: number };

const cropAspectOptions: Array<{ value: CropAspect; label: string }> = [
  { value: "16:9", label: "16:9" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "original", label: "原始比例" },
];

export type MediaUploadState = {
  phase: UploadPhase;
  file: File | null;
  previewUrl: string;
  progress: number;
  errorCode: string;
  remoteUrl: string;
  assetId: string;
  resourceId: string;
  resumableUploadUrl: string;
  resumableUploadTicket: string;
};

export type MediaUploadPersistedValue = {
  url: string;
  assetId: string;
  resourceId: string;
};

type UploadAction =
  | { type: "hydrate"; url: string; assetId: string; resourceId: string }
  | { type: "select"; file: File; previewUrl: string }
  | { type: "phase"; phase: UploadPhase }
  | { type: "progress"; progress: number }
  | { type: "error"; code: string }
  | { type: "image-success"; assetId: string; publicUrl: string }
  | { type: "video-provisioned"; resourceId: string; resumableUploadUrl?: string; resumableUploadTicket?: string }
  | { type: "video-success"; resourceId: string }
  | { type: "external-url"; value: string }
  | { type: "remove"; kind: MediaUploadKind };

export function mediaUploadReducer(state: MediaUploadState, action: UploadAction): MediaUploadState {
  switch (action.type) {
    case "hydrate":
      return {
        ...state,
        phase: "idle",
        file: null,
        previewUrl: "",
        progress: 0,
        errorCode: "",
        remoteUrl: action.url,
        assetId: action.assetId,
        resourceId: action.resourceId,
        resumableUploadUrl: "",
        resumableUploadTicket: "",
      };
    case "select":
      return {
        ...state,
        file: action.file,
        previewUrl: action.previewUrl,
        phase: "ready",
        progress: 0,
        errorCode: "",
        resumableUploadUrl: "",
        resumableUploadTicket: "",
      };
    case "phase":
      return { ...state, phase: action.phase, errorCode: "" };
    case "progress":
      return { ...state, progress: action.progress };
    case "error": {
      const resetResumableSession = ["provider_rejected", "invalid_upload_ticket", "video_upload_failed"]
        .includes(action.code);
      return {
        ...state,
        phase: "error",
        errorCode: action.code,
        // Provider 明確拒絕時丟棄舊 session；網路中斷或取消仍保留 offset 供續傳。
        resumableUploadUrl: resetResumableSession ? "" : state.resumableUploadUrl,
        resumableUploadTicket: resetResumableSession ? "" : state.resumableUploadTicket,
      };
    }
    case "image-success":
      return { ...state, phase: "success", progress: 100, assetId: action.assetId, remoteUrl: action.publicUrl };
    case "video-provisioned":
      return {
        ...state,
        resourceId: action.resourceId,
        resumableUploadUrl: action.resumableUploadUrl ?? "",
        resumableUploadTicket: action.resumableUploadTicket ?? "",
      };
    case "video-success":
      return {
        ...state,
        phase: "success",
        progress: 100,
        resourceId: action.resourceId,
        resumableUploadUrl: "",
        resumableUploadTicket: "",
      };
    case "external-url":
      return { ...state, remoteUrl: action.value, assetId: "", previewUrl: "", file: null, phase: "idle", errorCode: "" };
    case "remove":
      return {
        ...state,
        phase: "idle",
        file: null,
        previewUrl: "",
        progress: 0,
        errorCode: "",
        resumableUploadUrl: "",
        resumableUploadTicket: "",
        remoteUrl: action.kind === "image" ? "" : state.remoteUrl,
        assetId: action.kind === "image" ? "" : state.assetId,
      };
  }
}

type MediaUploadFieldProps = {
  kind: MediaUploadKind;
  label: string;
  description: string;
  defaultUrl?: string | null;
  defaultAssetId?: string | null;
  defaultResourceId?: string | null;
  allowExternalUrlFallback?: boolean;
  urlInputName?: string;
  assetIdInputName?: string;
  resourceIdInputName?: string;
  titleInputName?: string;
  durationInputName?: string;
  estimatedMinutesInputName?: string;
  onValueChange?: (value: MediaUploadPersistedValue) => void;
  statusInputName?: string;
  onBlockingChange?: (blocked: boolean) => void;
  invalid?: boolean;
  errorId?: string;
  hydrationKey?: number;
};

export function mediaUploadPersistedValue(state: MediaUploadState): MediaUploadPersistedValue {
  return {
    url: state.remoteUrl,
    assetId: state.assetId,
    resourceId: state.resourceId,
  };
}

function initialState(props: MediaUploadFieldProps): MediaUploadState {
  return {
    phase: "idle",
    file: null,
    previewUrl: "",
    progress: 0,
    errorCode: "",
    remoteUrl: props.defaultUrl ?? "",
    assetId: props.defaultAssetId ?? "",
    resourceId: props.defaultResourceId ?? "",
    resumableUploadUrl: "",
    resumableUploadTicket: "",
  };
}

function formInputValue(container: HTMLElement | null, name: string) {
  const input = container?.closest("form")?.elements.namedItem(name);
  return input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value.trim() : "";
}

function boundedDuration(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(6 * 60 * 60, Math.max(60, parsed)) : 60 * 60;
}

export function estimatedMinutesForDuration(durationSec: number) {
  return Number.isFinite(durationSec) && durationSec > 0 ? Math.ceil(durationSec / 60) : 0;
}

export function shouldAutoUploadThumbnail(value: unknown) {
  return Boolean(value && typeof value === "object" && "autoUpload" in value && value.autoUpload === true);
}

export function formatVideoDimensions(width: number, height: number) {
  return width > 0 && height > 0 ? `${width} × ${height}` : "讀取影片尺寸中";
}

export function cropAspectRatio(aspect: CropAspect, originalRatio: number) {
  if (aspect === "1:1") return 1;
  if (aspect === "4:5") return 4 / 5;
  if (aspect === "16:9") return 16 / 9;
  return originalRatio > 0 ? originalRatio : 16 / 9;
}

async function createCroppedImageFile(
  file: File,
  crop: { aspect: CropAspect; zoom: number; pan: CropPan },
) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new MediaUploadClientError("invalid_image_upload"));
      image.src = sourceUrl;
    });
    const originalRatio = source.naturalWidth / source.naturalHeight;
    const ratio = cropAspectRatio(crop.aspect, originalRatio);
    const outputWidth = crop.aspect === "original" ? Math.min(1600, source.naturalWidth) : 1280;
    const outputHeight = Math.max(1, Math.round(outputWidth / ratio));
    const scale = Math.max(outputWidth / source.naturalWidth, outputHeight / source.naturalHeight) * Math.max(1, crop.zoom);
    const renderedWidth = source.naturalWidth * scale;
    const renderedHeight = source.naturalHeight * scale;
    const left = (outputWidth - renderedWidth) / 2 + (crop.pan.x / 100) * outputWidth;
    const top = (outputHeight - renderedHeight) / 2 + (crop.pan.y / 100) * outputHeight;
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new MediaUploadClientError("invalid_image_upload");
    context.drawImage(source, left, top, renderedWidth, renderedHeight);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new MediaUploadClientError("invalid_image_upload")), "image/jpeg", 0.92);
    });
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "thumbnail"}-thumbnail.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function uploadImage({ file, csrfToken, signal, onProgress }: UploadRuntime) {
  const provision = parseImageProvision(await requestMediaJson({
    path: "/api/media/images/presign",
    csrfToken,
    payload: { fileName: file.name, mimeType: file.type, sizeBytes: file.size },
    signal,
  }));
  await uploadFileWithProgress({
    url: provision.uploadUrl,
    method: "PUT",
    file,
    headers: provision.headers,
    signal,
    onProgress,
  });
  await requestMediaJson({
    path: "/api/media/images/complete",
    csrfToken,
    payload: { assetId: provision.assetId },
    signal,
  });
  return provision;
}

type UploadRuntime = {
  file: File;
  csrfToken: string;
  signal: AbortSignal;
  onProgress: (progress: number) => void;
};

async function uploadVideo({
  file,
  csrfToken,
  signal,
  onProgress,
  videoId,
  title,
  maxDurationSeconds,
  resumableUploadUrl,
  resumableUploadTicket,
  onProvisioned,
  onFinalizing,
}: UploadRuntime & {
  videoId: string;
  title: string;
  maxDurationSeconds: number;
  resumableUploadUrl: string;
  resumableUploadTicket: string;
  onProvisioned: (videoId: string, resumableUploadUrl?: string, resumableUploadTicket?: string) => void;
  onFinalizing: () => void;
}) {
  const hasResumableSession = Boolean(resumableUploadUrl && resumableUploadTicket && videoId);
  const useResumable = file.size > VIDEO_BASIC_UPLOAD_MAX_BYTES || hasResumableSession;
  if (useResumable) {
    const provision = hasResumableSession
      ? { videoId, uploadUrl: resumableUploadUrl, uploadTicket: resumableUploadTicket }
      : parseResumableVideoProvision(await requestMediaJson({
        path: "/api/media/videos/resumable-upload",
        csrfToken,
        payload: {
          ...(videoId ? { videoId } : {}),
          title,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          maxDurationSeconds,
        },
        signal,
      }));
    onProvisioned(provision.videoId, provision.uploadUrl, provision.uploadTicket);
    await uploadResumableFileWithProgress({
      url: provision.uploadUrl,
      file,
      videoId: provision.videoId,
      signal,
      onProgress,
    });
    onFinalizing();
    const completed = parseResumableVideoComplete(await requestMediaJson({
      path: "/api/media/videos/resumable-upload/complete",
      csrfToken,
      payload: { uploadTicket: provision.uploadTicket },
      signal,
    }));
    return { ...provision, videoId: completed.videoId };
  }

  const provision = parseVideoProvision(await requestMediaJson({
    path: "/api/media/videos/direct-upload",
    csrfToken,
    payload: {
      ...(videoId ? { videoId } : {}),
      title,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      maxDurationSeconds,
    },
    signal,
  }));
  onProvisioned(provision.videoId);
  await uploadFileWithProgress({
    url: provision.uploadUrl,
    method: "POST",
    file,
    signal,
    onProgress,
  });
  return provision;
}

function uploadErrorMessage(kind: MediaUploadKind, code: string, allowExternalUrlFallback: boolean) {
  const imageStorageHint = allowExternalUrlFallback ? "可先使用進階 URL。" : "請稍後重試。";
  const messages: Record<string, string> = {
    cancelled: "已暫停上傳，檔案與續傳進度仍保留，可再次重試。",
    configuration: kind === "image" ? `R2 圖片儲存尚未完成設定，${imageStorageHint}` : "Cloudflare Stream 尚未完成設定。",
    empty_file: "這個檔案沒有內容，請重新選擇。",
    image_too_large: "圖片不可超過 15 MB。",
    image_object_mismatch: "R2 驗證到的圖片大小或格式不一致，請重新選擇並上傳。",
    image_upload_setup_failed: "暫時無法建立圖片上傳，請稍後重試。",
    image_verification_failed: "圖片已傳送，但 R2 完成驗證失敗，請重試。",
    invalid_complete_request: "圖片完成驗證資料不完整，請重新上傳。",
    invalid_image_upload: "圖片名稱、格式或大小不符合上傳限制。",
    invalid_video_upload: "影片名稱、格式、大小或預估長度不符合限制。",
    frame_capture_failed: "目前畫面擷取失敗，請先播放或移動時間軸後再試。",
    media_storage_unavailable: `R2 圖片儲存尚未完成設定，${imageStorageHint}`,
    invalid_response: "上傳服務回傳格式不完整，請稍後重試。",
    missing_csrf: "頁面驗證已失效，請重新整理後再試。",
    missing_title: "請先填寫影片名稱，再開始上傳。",
    network_error: "網路連線中斷，請確認連線後重試。",
    provider_rejected: "媒體服務拒絕檔案，請確認格式或重新選擇。",
    request_failed: "暫時無法建立上傳，請稍後重試。",
    invalid_resumable_video_upload: "大型影片名稱、格式、大小或預估長度不符合限制。",
    invalid_resumable_upload_complete: "大型影片完成資料不完整，請重試。",
    invalid_upload_ticket: "大型影片上傳工作已失效，請重新選擇檔案後再試。",
    timeout: "上傳等候過久，請檢查網路後重試。",
    unsupported_image_type: "圖片僅支援 JPEG、PNG、WebP、GIF 或 AVIF。",
    unsupported_video_type: "不支援這個影片格式，建議使用 MP4、MOV 或 WebM。",
    video_too_large: "影片不可超過 30 GB。",
    video_not_found: "找不到目前商家的影片，請重新整理後再試。",
    video_archived: "這支影片已封存，請先恢復影片後再替換檔案。",
    video_upload_setup_failed: "暫時無法建立 Stream 上傳，請稍後重試。",
    video_resumable_upload_setup_failed: "暫時無法建立大型影片續傳，請稍後重試。",
    video_upload_complete_failed: "影片已傳送，但 Stream 完成確認失敗；請按重試繼續確認。",
    video_upload_failed: "Stream 無法處理這個影片；舊影片未被替換，請重新選擇檔案。",
    video_upload_not_complete: "Stream 尚在確認最後一段資料，請稍後按重試繼續確認。",
  };
  return messages[code] ?? (allowExternalUrlFallback ? "上傳未完成，請重試或改用進階 URL。" : "上傳未完成，請重試。");
}

function FilePreview({ kind, url, fileName }: { kind: MediaUploadKind; url: string; fileName: string }) {
  if (!url || kind !== "image") return null;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-slate-950">
      <Image src={url} alt={fileName || "已選圖片預覽"} width={960} height={540} unoptimized className="max-h-64 w-full object-contain" />
    </div>
  );
}

function VideoPreview({
  url,
  fileName,
  videoRef,
  duration,
  currentTime,
  onLoadedMetadata,
  onTimeUpdate,
  onSeek,
  onCapture,
  captureDisabled,
}: {
  url: string;
  fileName: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  duration: number;
  currentTime: number;
  onLoadedMetadata: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onTimeUpdate: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onSeek: (value: number) => void;
  onCapture: () => void;
  captureDisabled: boolean;
}) {
  if (!url) return null;
  return (
    <div className="grid gap-3 overflow-hidden rounded-lg border border-border bg-slate-950 p-2">
      <video
        ref={videoRef}
        src={url}
        aria-label={`${fileName || "已選影片"}本機預覽`}
        controls
        preload="metadata"
        className="max-h-72 w-full"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
      />
      {duration > 0 ? (
        <div className="grid gap-2 px-1 pb-1 text-white">
          <label htmlFor={`${fileName}-timeline`} className="text-xs font-medium">時間軸：{formatSeconds(currentTime)} / {formatSeconds(duration)}</label>
          <input
            id={`${fileName}-timeline`}
            type="range"
            min="0"
            max={duration}
            step="0.1"
            value={Math.min(duration, currentTime)}
            onChange={(event) => onSeek(Number(event.target.value))}
            aria-label="選取影片縮圖畫面"
          />
          <button
            type="button"
            onClick={onCapture}
            disabled={captureDisabled}
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-white px-3 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            使用目前畫面作為縮圖
          </button>
        </div>
      ) : (
        <p className="px-1 pb-1 text-xs text-slate-200" role="status" aria-live="polite">正在讀取影片時長與尺寸…</p>
      )}
    </div>
  );
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function ImageCropPreview({
  url,
  fileName,
  aspect,
  zoom,
  pan,
  onPanChange,
  onImageSize,
  imageSize,
}: {
  url: string;
  fileName: string;
  aspect: CropAspect;
  zoom: number;
  pan: CropPan;
  onPanChange: (pan: CropPan) => void;
  onImageSize: (size: { width: number; height: number }) => void;
  imageSize: { width: number; height: number };
}) {
  const dragRef = useRef<{ pointerId: number; x: number; y: number; pan: CropPan } | null>(null);
  const ratio = cropAspectRatio(aspect, imageSize.width / imageSize.height);
  const imageRatio = imageSize.width / imageSize.height;
  const imageWidth = Math.max(100, (imageRatio / ratio) * 100);
  const imageHeight = Math.max(100, (ratio / imageRatio) * 100);

  return (
    <div className="grid gap-2">
      <div
        className="relative touch-none overflow-hidden rounded-lg border-2 border-dashed border-primary bg-slate-950"
        style={{ aspectRatio: String(ratio) }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onPanChange({
            x: Math.max(-50, Math.min(50, drag.pan.x + ((event.clientX - drag.x) / rect.width) * 100)),
            y: Math.max(-50, Math.min(50, drag.pan.y + ((event.clientY - drag.y) / rect.height) * 100)),
          });
        }}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
        aria-label="拖曳調整縮圖裁切位置"
      >
        {/* Blob URL 是本機 canvas 裁切預覽，沒有可交給 next/image 的遠端最佳化來源。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`${fileName || "已選圖片"}裁切預覽`}
          onLoad={(event) => {
            const nextSize = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight };
            onImageSize(nextSize);
          }}
          className="absolute left-1/2 top-1/2 max-w-none select-none"
          style={{
            width: `${imageWidth}%`,
            height: `${imageHeight}%`,
            transform: `translate(calc(-50% + ${pan.x}%), calc(-50% + ${pan.y}%)) scale(${zoom})`,
          }}
          draggable={false}
        />
        <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/70" aria-hidden="true" />
      </div>
      <p className="text-xs text-slate-500">拖曳畫面調整位置；縮放與裁切只會影響縮圖。</p>
    </div>
  );
}

function ExternalImageUrlFallback({
  enabled,
  inputName,
  value,
  onChange,
  invalid,
  errorId,
}: {
  enabled: boolean;
  inputName?: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  errorId?: string;
}) {
  if (!enabled || !inputName) return null;

  return (
    <details className="rounded-lg border border-border bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">進階：使用既有圖片 URL</summary>
      <label className="mt-3 grid gap-1.5 text-sm font-medium text-slate-700">圖片 URL
        <input type="url" inputMode="url" autoComplete="url" spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} className="h-11 rounded-md border border-border px-3" placeholder="https://..." />
      </label>
      <p className="mt-2 text-xs text-slate-500">URL 僅保留給既有 CDN 或搬遷資料；一般使用請直接上傳。</p>
    </details>
  );
}

function MediaUploadPreview({
  props,
  state,
  previewUrl,
  videoRef,
  videoMetadata,
  videoCurrentTime,
  cropAspect,
  cropZoom,
  cropPan,
  imageSize,
  isBusy,
  isCapturingFrame,
  onLoadedMetadata,
  onTimeUpdate,
  onSeek,
  onCapture,
  onCropAspectChange,
  onCropZoomChange,
  onCropPanChange,
  onImageSizeChange,
}: Pick<MediaUploadFieldViewProps, "props" | "state" | "previewUrl" | "videoRef" | "videoMetadata" | "videoCurrentTime" | "cropAspect" | "cropZoom" | "cropPan" | "imageSize" | "isBusy" | "isCapturingFrame" | "onLoadedMetadata" | "onTimeUpdate" | "onSeek" | "onCapture" | "onCropAspectChange" | "onCropZoomChange" | "onCropPanChange" | "onImageSizeChange">) {
  if (props.kind === "video") {
    return (
      <VideoPreview
        url={previewUrl}
        fileName={state.file?.name ?? ""}
        videoRef={videoRef}
        duration={videoMetadata.duration}
        currentTime={videoCurrentTime}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onSeek={onSeek}
        onCapture={onCapture}
        captureDisabled={isBusy || isCapturingFrame}
      />
    );
  }
  if (!state.file || !previewUrl) return <FilePreview kind={props.kind} url={previewUrl} fileName={state.file?.name ?? ""} />;
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-white p-3">
      <ImageCropPreview
        url={previewUrl}
        fileName={state.file.name}
        aspect={cropAspect}
        zoom={cropZoom}
        pan={cropPan}
        onPanChange={onCropPanChange}
        onImageSize={onImageSizeChange}
        imageSize={imageSize}
      />
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold text-slate-800">縮圖比例</legend>
        <div className="flex flex-wrap gap-2">
          {cropAspectOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={cropAspect === option.value}
              onClick={() => onCropAspectChange(option.value)}
              className="min-h-10 rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700 aria-pressed:border-primary aria-pressed:bg-blue-50 aria-pressed:text-primary"
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        縮放：{cropZoom.toFixed(1)}×
        <input
          type="range"
          min="1"
          max="3"
          step="0.1"
          value={cropZoom}
          onChange={(event) => onCropZoomChange(Number(event.target.value))}
          aria-label="縮放縮圖"
        />
      </label>
      <p className="text-xs text-slate-500" role="status">目前圖片尺寸：{formatVideoDimensions(imageSize.width, imageSize.height)}</p>
    </div>
  );
}

function MediaUploadStatus({
  props,
  state,
  isBusy,
  videoMetadata,
}: Pick<MediaUploadFieldViewProps, "props" | "state" | "isBusy" | "videoMetadata">) {
  return (
    <>
      {state.file ? <p className="truncate text-xs font-medium text-slate-700">已選擇：{state.file.name}</p> : null}
      {props.kind === "video" && state.file ? (
        <div className="grid gap-1 rounded-md border border-blue-100 bg-white px-3 py-2 text-xs text-slate-600" role="status" aria-live="polite">
          <span>本機影片預覽：尚未送出</span>
          <span>影片尺寸：{formatVideoDimensions(videoMetadata.width, videoMetadata.height)}</span>
          <span>估算用量：{estimatedMinutesForDuration(videoMetadata.duration)} 分鐘</span>
        </div>
      ) : null}
      {isBusy || state.progress > 0 ? (
        <div className="grid gap-1" role="status" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full bg-primary transition-all" style={{ width: `${state.progress}%` }} /></div>
          <p className="flex items-center gap-2 text-xs text-slate-600"><LoaderCircle size={14} className={isBusy ? "animate-spin" : ""} aria-hidden="true" />{isBusy ? `上傳中 ${state.progress}%` : `已上傳 ${state.progress}%`}</p>
        </div>
      ) : null}
      {state.phase === "success" ? <p role="status" className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} aria-hidden="true" />{props.kind === "video" ? "檔案已送達 Cloudflare Stream，正在處理，尚未可播放；儲存表單後會套用。" : "縮圖上傳完成，儲存表單後即會套用。"}</p> : null}
      {state.errorCode ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{uploadErrorMessage(props.kind, state.errorCode, props.allowExternalUrlFallback === true)}</p> : null}
    </>
  );
}

function MediaUploadActions({
  props,
  state,
  isBusy,
  onStartUpload,
  onCancelUpload,
  onRemoveSelection,
}: Pick<MediaUploadFieldViewProps, "props" | "state" | "isBusy" | "onStartUpload" | "onCancelUpload" | "onRemoveSelection">) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={onStartUpload} disabled={!state.file || isBusy} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
        {state.phase === "error" ? <RotateCcw size={16} aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />}{state.phase === "error" ? "重試上傳" : "開始上傳"}
      </button>
      {isBusy ? <button type="button" onClick={onCancelUpload} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700"><X size={16} aria-hidden="true" />暫停上傳</button> : null}
      {(state.file || (props.kind === "image" && state.remoteUrl)) ? <button type="button" onClick={onRemoveSelection} disabled={isBusy} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"><Trash2 size={16} aria-hidden="true" />移除</button> : null}
    </div>
  );
}

type MediaUploadFieldViewProps = {
  props: MediaUploadFieldProps;
  state: MediaUploadState;
  isBusy: boolean;
  previewUrl: string;
  inputId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  videoMetadata: { duration: number; width: number; height: number };
  videoCurrentTime: number;
  cropAspect: CropAspect;
  cropZoom: number;
  cropPan: CropPan;
  imageSize: { width: number; height: number };
  isCapturingFrame: boolean;
  onSelectFile: (file: File | undefined) => void;
  onLoadedMetadata: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onTimeUpdate: (event: React.SyntheticEvent<HTMLVideoElement>) => void;
  onSeek: (value: number) => void;
  onCapture: () => void;
  onStartUpload: () => void;
  onCancelUpload: () => void;
  onRemoveSelection: () => void;
  onCropAspectChange: (aspect: CropAspect) => void;
  onCropZoomChange: (zoom: number) => void;
  onCropPanChange: (pan: CropPan) => void;
  onImageSizeChange: (size: { width: number; height: number }) => void;
  onExternalUrlChange: (value: string) => void;
};

function MediaUploadFieldView({
  props,
  state,
  isBusy,
  previewUrl,
  inputId,
  inputRef,
  videoRef,
  containerRef,
  videoMetadata,
  videoCurrentTime,
  cropAspect,
  cropZoom,
  cropPan,
  imageSize,
  isCapturingFrame,
  onSelectFile,
  onLoadedMetadata,
  onTimeUpdate,
  onSeek,
  onCapture,
  onStartUpload,
  onCancelUpload,
  onRemoveSelection,
  onCropAspectChange,
  onCropZoomChange,
  onCropPanChange,
  onImageSizeChange,
  onExternalUrlChange,
}: MediaUploadFieldViewProps) {
  return (
    <div ref={containerRef} className="grid gap-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4" aria-busy={isBusy}>
      {props.urlInputName ? <input type="hidden" name={props.urlInputName} value={state.remoteUrl} readOnly /> : null}
      {props.assetIdInputName ? <input type="hidden" name={props.assetIdInputName} value={state.assetId} readOnly /> : null}
      {props.resourceIdInputName ? <input type="hidden" name={props.resourceIdInputName} value={state.resourceId} readOnly /> : null}
      {props.statusInputName ? <input type="hidden" name={props.statusInputName} value={state.phase} readOnly /> : null}
      <div>
        <label htmlFor={inputId} id={`${inputId}-label`} className="text-sm font-bold text-slate-900">{props.label}</label>
        <p id={`${inputId}-description`} className="mt-1 text-xs leading-5 text-slate-600">{props.description}</p>
      </div>
      <div
        role="button"
        tabIndex={isBusy ? -1 : 0}
        aria-disabled={isBusy}
        aria-labelledby={`${inputId}-label`}
        aria-describedby={[`${inputId}-description`, props.errorId].filter(Boolean).join(" ")}
        onClick={() => !isBusy && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!isBusy && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onSelectFile(event.dataTransfer.files[0]);
        }}
        className="grid min-h-36 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-blue-200 bg-white px-4 py-6 text-center outline-none transition hover:border-primary focus:ring-2 focus:ring-primary"
      >
        <span className="grid gap-2 place-items-center">
          <FileUp className="text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold text-slate-800">拖拉檔案到這裡，或點擊選檔</span>
          <span className="text-xs text-slate-500">{props.kind === "image" ? "JPEG / PNG / WebP / GIF / AVIF，最多 15 MB" : "MP4 / MOV / WebM 等影片，最多 30 GB；大型檔案會自動分段續傳"}</span>
        </span>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={props.kind === "image" ? "image/jpeg,image/png,image/webp,image/gif,image/avif" : "video/*"}
        className="sr-only"
        disabled={isBusy}
        aria-invalid={props.invalid}
        aria-describedby={[`${inputId}-description`, props.errorId].filter(Boolean).join(" ")}
        onChange={(event) => onSelectFile(event.target.files?.[0])}
      />
      <MediaUploadPreview
        props={props}
        state={state}
        previewUrl={previewUrl}
        videoRef={videoRef}
        videoMetadata={videoMetadata}
        videoCurrentTime={videoCurrentTime}
        cropAspect={cropAspect}
        cropZoom={cropZoom}
        cropPan={cropPan}
        imageSize={imageSize}
        isBusy={isBusy}
        isCapturingFrame={isCapturingFrame}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onSeek={onSeek}
        onCapture={onCapture}
        onCropAspectChange={onCropAspectChange}
        onCropZoomChange={onCropZoomChange}
        onCropPanChange={onCropPanChange}
        onImageSizeChange={onImageSizeChange}
      />
      <MediaUploadStatus props={props} state={state} isBusy={isBusy} videoMetadata={videoMetadata} />
      <MediaUploadActions
        props={props}
        state={state}
        isBusy={isBusy}
        onStartUpload={onStartUpload}
        onCancelUpload={onCancelUpload}
        onRemoveSelection={onRemoveSelection}
      />
      <ExternalImageUrlFallback
        enabled={props.kind === "image" && props.allowExternalUrlFallback === true}
        inputName={props.urlInputName}
        value={state.assetId ? "" : state.remoteUrl}
        onChange={onExternalUrlChange}
        invalid={props.invalid}
        errorId={props.errorId}
      />
    </div>
  );
}

export function MediaUploadField(props: MediaUploadFieldProps) {
  const onValueChange = props.onValueChange;
  const onBlockingChange = props.onBlockingChange;
  const [state, dispatch] = useReducer(mediaUploadReducer, props, initialState);
  const [videoMetadata, setVideoMetadata] = useState({ duration: 0, width: 0, height: 0 });
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [cropAspect, setCropAspect] = useState<CropAspect>("16:9");
  const [cropZoom, setCropZoom] = useState(1);
  const [cropPan, setCropPan] = useState<CropPan>({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 16, height: 9 });
  const [isCapturingFrame, setIsCapturingFrame] = useState(false);
  const autoThumbnailCapturedRef = useRef(false);
  const autoThumbnailUploadPendingRef = useRef(false);
  const startUploadRef = useRef<() => Promise<void>>(async () => undefined);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const persistedValueRef = useRef(mediaUploadPersistedValue(state));
  const hydrationKeyRef = useRef(props.hydrationKey);
  const isBusy = ["provisioning", "uploading", "finalizing"].includes(state.phase);
  const blocksFormSubmit = Boolean(state.file) && state.phase !== "success";
  const previewUrl = state.previewUrl || (props.kind === "image" ? state.remoteUrl : "");

  useEffect(() => () => {
    if (state.previewUrl.startsWith("blob:")) URL.revokeObjectURL(state.previewUrl);
  }, [state.previewUrl]);

  useEffect(() => {
    const persistedValue = mediaUploadPersistedValue(state);
    const previousValue = persistedValueRef.current;
    if (
      previousValue.url === persistedValue.url
      && previousValue.assetId === persistedValue.assetId
      && previousValue.resourceId === persistedValue.resourceId
    ) return;
    persistedValueRef.current = persistedValue;
    onValueChange?.(persistedValue);
  }, [onValueChange, state]);

  useEffect(() => {
    onBlockingChange?.(blocksFormSubmit);
  }, [blocksFormSubmit, onBlockingChange]);

  useEffect(() => {
    if (hydrationKeyRef.current === props.hydrationKey) return;
    hydrationKeyRef.current = props.hydrationKey;
    const next = {
      url: props.defaultUrl ?? "",
      assetId: props.defaultAssetId ?? "",
      resourceId: props.defaultResourceId ?? "",
    };
    const hasPendingLocalFile = Boolean(state.file) && state.phase !== "success";
    if (isBusy || hasPendingLocalFile) return;
    if (state.remoteUrl === next.url && state.assetId === next.assetId && state.resourceId === next.resourceId) return;

    // 草稿恢復或父層重設時同步持久化值，但不覆蓋正在選檔或上傳中的工作。
    persistedValueRef.current = next;
    dispatch({ type: "hydrate", ...next });
  }, [isBusy, props.defaultAssetId, props.defaultResourceId, props.defaultUrl, props.hydrationKey, state.assetId, state.file, state.phase, state.remoteUrl, state.resourceId]);

  useEffect(() => {
    if (props.kind !== "image") return;
    const form = containerRef.current?.closest("form");
    if (!form) return;
    const handleVideoThumbnail = (event: Event) => {
      const detail = (event as CustomEvent<{ file?: unknown; autoUpload?: boolean }>).detail;
      if (detail?.file instanceof File) selectFile(detail.file, shouldAutoUploadThumbnail(detail));
    };
    form.addEventListener("video-thumbnail-selected", handleVideoThumbnail);
    return () => form.removeEventListener("video-thumbnail-selected", handleVideoThumbnail);
  });

  useEffect(() => {
    if (props.kind !== "image" || !autoThumbnailUploadPendingRef.current || state.phase !== "ready" || !state.file) return;
    autoThumbnailUploadPendingRef.current = false;
    void startUploadRef.current();
  }, [props.kind, state.file, state.phase]);

  function selectFile(file: File | undefined, autoUpload = false) {
    if (!file || isBusy) return;
    const validation = validateMediaFile(props.kind, file);
    if (validation) {
      dispatch({ type: "error", code: validation });
      return;
    }
    // 先同步通知父表單，避免 React effect 尚未執行時使用者立即送出表單。
    onBlockingChange?.(true);
    autoThumbnailUploadPendingRef.current = autoUpload;
    if (props.kind === "video") autoThumbnailCapturedRef.current = false;
    if (props.kind === "image") {
      setCropZoom(1);
      setCropPan({ x: 0, y: 0 });
    }
    dispatch({ type: "select", file, previewUrl: URL.createObjectURL(file) });
  }

  function updateFormInput(name: string | undefined, value: string) {
    if (!name) return;
    const form = containerRef.current?.closest("form");
    const input = form?.elements.namedItem(name);
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function handleVideoMetadata(event: React.SyntheticEvent<HTMLVideoElement>) {
    const element = event.currentTarget;
    const duration = Number.isFinite(element.duration) ? Math.ceil(element.duration) : 0;
    const metadata = { duration, width: element.videoWidth, height: element.videoHeight };
    setVideoMetadata(metadata);
    updateFormInput(props.durationInputName, String(duration));
    updateFormInput(props.estimatedMinutesInputName, String(estimatedMinutesForDuration(duration)));
    if (duration > 0) {
      const defaultFrameTime = Math.min(1, duration / 2);
      if (!autoThumbnailCapturedRef.current) {
        autoThumbnailCapturedRef.current = true;
        element.addEventListener("seeked", () => { void captureCurrentFrame(); }, { once: true });
      }
      element.currentTime = defaultFrameTime;
      setVideoCurrentTime(defaultFrameTime);
    }
  }

  function handleVideoTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>) {
    setVideoCurrentTime(event.currentTarget.currentTime);
  }

  function seekVideo(value: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = value;
    setVideoCurrentTime(value);
  }

  async function captureCurrentFrame() {
    const video = videoRef.current;
    if (!video || !state.file || !video.videoWidth || !video.videoHeight || isCapturingFrame) return;
    setIsCapturingFrame(true);
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas_unavailable");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("frame_capture_failed");
      const fileName = `${state.file.name.replace(/\.[^.]+$/, "") || "video"}-frame.jpg`;
      containerRef.current?.closest("form")?.dispatchEvent(new CustomEvent("video-thumbnail-selected", {
        bubbles: true,
        detail: { file: new File([blob], fileName, { type: "image/jpeg" }), autoUpload: true },
      }));
    } catch {
      dispatch({ type: "error", code: "frame_capture_failed" });
    } finally {
      setIsCapturingFrame(false);
    }
  }

  async function startUpload() {
    if (!state.file || isBusy) return;
    const csrfToken = formInputValue(containerRef.current, CSRF_FIELD_NAME);
    if (!csrfToken) {
      dispatch({ type: "error", code: "missing_csrf" });
      return;
    }
    const title = formInputValue(containerRef.current, props.titleInputName ?? "title");
    if (props.kind === "video" && !title) {
      dispatch({ type: "error", code: "missing_title" });
      return;
    }
    const request = new AbortController();
    requestRef.current = request;
    dispatch({ type: "phase", phase: "provisioning" });
    try {
      const runtime = { file: state.file, csrfToken, signal: request.signal, onProgress: (progress: number) => dispatch({ type: "progress", progress }) };
      dispatch({ type: "phase", phase: "uploading" });
      if (props.kind === "image") {
        const croppedFile = await createCroppedImageFile(state.file, {
          aspect: cropAspect,
          zoom: cropZoom,
          pan: cropPan,
        });
        const result = await uploadImage({ ...runtime, file: croppedFile });
        dispatch({ type: "phase", phase: "finalizing" });
        dispatch({ type: "image-success", assetId: result.assetId, publicUrl: result.publicUrl });
      } else {
        const duration = formInputValue(containerRef.current, props.durationInputName ?? "durationSec");
        const result = await uploadVideo({
          ...runtime,
          videoId: state.resourceId,
          title,
          maxDurationSeconds: boundedDuration(duration),
          resumableUploadUrl: state.resumableUploadUrl,
          resumableUploadTicket: state.resumableUploadTicket,
          onProvisioned: (resourceId, resumableUrl, uploadTicket) => dispatch({
            type: "video-provisioned",
            resourceId,
            resumableUploadUrl: resumableUrl,
            resumableUploadTicket: uploadTicket,
          }),
          onFinalizing: () => dispatch({ type: "phase", phase: "finalizing" }),
        });
        dispatch({ type: "video-success", resourceId: result.videoId });
      }
    } catch (error) {
      dispatch({ type: "error", code: error instanceof MediaUploadClientError ? error.code : "request_failed" });
    } finally {
      requestRef.current = null;
    }
  }

  startUploadRef.current = startUpload;

  function removeSelection() {
    requestRef.current?.abort();
    if (inputRef.current) inputRef.current.value = "";
    onBlockingChange?.(false);
    dispatch({ type: "remove", kind: props.kind });
    if (props.kind === "video") {
      autoThumbnailCapturedRef.current = false;
      setVideoMetadata({ duration: 0, width: 0, height: 0 });
      setVideoCurrentTime(0);
    } else {
      setCropZoom(1);
      setCropPan({ x: 0, y: 0 });
    }
  }

  return (
    <MediaUploadFieldView
      props={props}
      state={state}
      isBusy={isBusy}
      previewUrl={previewUrl}
      inputId={inputId}
      inputRef={inputRef}
      videoRef={videoRef}
      containerRef={containerRef}
      videoMetadata={videoMetadata}
      videoCurrentTime={videoCurrentTime}
      cropAspect={cropAspect}
      cropZoom={cropZoom}
      cropPan={cropPan}
      imageSize={imageSize}
      isCapturingFrame={isCapturingFrame}
      onSelectFile={selectFile}
      onLoadedMetadata={handleVideoMetadata}
      onTimeUpdate={handleVideoTimeUpdate}
      onSeek={seekVideo}
      onCapture={captureCurrentFrame}
      onStartUpload={startUpload}
      onCancelUpload={() => requestRef.current?.abort()}
      onRemoveSelection={removeSelection}
      onCropAspectChange={setCropAspect}
      onCropZoomChange={setCropZoom}
      onCropPanChange={setCropPan}
      onImageSizeChange={setImageSize}
      onExternalUrlChange={(value) => dispatch({ type: "external-url", value })}
    />
  );
}
