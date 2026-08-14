"use client";

import Image from "next/image";
import { useEffect, useId, useReducer, useRef } from "react";
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
}: UploadRuntime & {
  videoId: string;
  title: string;
  maxDurationSeconds: number;
  resumableUploadUrl: string;
  resumableUploadTicket: string;
  onProvisioned: (videoId: string, resumableUploadUrl?: string, resumableUploadTicket?: string) => void;
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
    video_upload_setup_failed: "暫時無法建立 Stream 上傳，請稍後重試。",
    video_resumable_upload_setup_failed: "暫時無法建立大型影片續傳，請稍後重試。",
    video_upload_complete_failed: "影片已傳送，但 Stream 完成確認失敗；請按重試繼續確認。",
    video_upload_failed: "Stream 無法處理這個影片；舊影片未被替換，請重新選擇檔案。",
    video_upload_not_complete: "Stream 尚在確認最後一段資料，請稍後按重試繼續確認。",
  };
  return messages[code] ?? (allowExternalUrlFallback ? "上傳未完成，請重試或改用進階 URL。" : "上傳未完成，請重試。");
}

function FilePreview({ kind, url, fileName }: { kind: MediaUploadKind; url: string; fileName: string }) {
  if (!url) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-slate-950">
      {kind === "image" ? (
        <Image src={url} alt={fileName || "已選圖片預覽"} width={960} height={540} unoptimized className="max-h-64 w-full object-contain" />
      ) : (
        <video src={url} aria-label={`${fileName || "已選影片"}預覽`} controls className="max-h-72 w-full" />
      )}
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

export function MediaUploadField(props: MediaUploadFieldProps) {
  const onValueChange = props.onValueChange;
  const onBlockingChange = props.onBlockingChange;
  const [state, dispatch] = useReducer(mediaUploadReducer, props, initialState);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
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

  function selectFile(file: File | undefined) {
    if (!file || isBusy) return;
    const validation = validateMediaFile(props.kind, file);
    if (validation) {
      dispatch({ type: "error", code: validation });
      return;
    }
    // 先同步通知父表單，避免 React effect 尚未執行時使用者立即送出表單。
    onBlockingChange?.(true);
    dispatch({ type: "select", file, previewUrl: URL.createObjectURL(file) });
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
        const result = await uploadImage(runtime);
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
        });
        dispatch({ type: "video-success", resourceId: result.videoId });
      }
    } catch (error) {
      dispatch({ type: "error", code: error instanceof MediaUploadClientError ? error.code : "request_failed" });
    } finally {
      requestRef.current = null;
    }
  }

  function removeSelection() {
    requestRef.current?.abort();
    if (inputRef.current) inputRef.current.value = "";
    onBlockingChange?.(false);
    dispatch({ type: "remove", kind: props.kind });
  }

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
          selectFile(event.dataTransfer.files[0]);
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
        onChange={(event) => selectFile(event.target.files?.[0])}
      />
      <FilePreview kind={props.kind} url={previewUrl} fileName={state.file?.name ?? ""} />
      {state.file ? <p className="truncate text-xs font-medium text-slate-700">已選擇：{state.file.name}</p> : null}
      {isBusy || state.progress > 0 ? (
        <div className="grid gap-1" role="status" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full bg-primary transition-all" style={{ width: `${state.progress}%` }} /></div>
          <p className="flex items-center gap-2 text-xs text-slate-600"><LoaderCircle size={14} className={isBusy ? "animate-spin" : ""} aria-hidden="true" />{isBusy ? `上傳中 ${state.progress}%` : `已上傳 ${state.progress}%`}</p>
        </div>
      ) : null}
      {state.phase === "success" ? <p role="status" className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} aria-hidden="true" />上傳完成，儲存表單後即會套用。</p> : null}
      {state.errorCode ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{uploadErrorMessage(props.kind, state.errorCode, props.allowExternalUrlFallback === true)}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={startUpload} disabled={!state.file || isBusy} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {state.phase === "error" ? <RotateCcw size={16} aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />}{state.phase === "error" ? "重試上傳" : "開始上傳"}
        </button>
        {isBusy ? <button type="button" onClick={() => requestRef.current?.abort()} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700"><X size={16} aria-hidden="true" />暫停上傳</button> : null}
        {(state.file || (props.kind === "image" && state.remoteUrl)) ? <button type="button" onClick={removeSelection} disabled={isBusy} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"><Trash2 size={16} aria-hidden="true" />移除</button> : null}
      </div>
      <ExternalImageUrlFallback
        enabled={props.kind === "image" && props.allowExternalUrlFallback === true}
        inputName={props.urlInputName}
        value={state.assetId ? "" : state.remoteUrl}
        onChange={(value) => dispatch({ type: "external-url", value })}
        invalid={props.invalid}
        errorId={props.errorId}
      />
    </div>
  );
}
