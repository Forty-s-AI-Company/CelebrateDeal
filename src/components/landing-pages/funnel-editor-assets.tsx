"use client";

import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import { ImageUp, LoaderCircle } from "lucide-react";
import { MediaUploadClientError, parseImageProvision, requestMediaJson, uploadFileWithProgress, validateMediaFile } from "@/lib/media-upload-client";

/**
 * Image uploads from the page editor use the same signed R2 flow as the rest
 * of the merchant workspace (presign → PUT → complete). The CSRF token comes
 * from the workspace page; without a provider (tests, harnesses, thumbnails)
 * the upload button is simply not shown and URL fields keep working.
 */
const FunnelEditorAssetsContext = createContext<{ csrfToken: string } | null>(null);

export function FunnelEditorAssetsProvider({ csrfToken, children }: { csrfToken: string; children: ReactNode }) {
  return <FunnelEditorAssetsContext.Provider value={csrfToken ? { csrfToken } : null}>{children}</FunnelEditorAssetsContext.Provider>;
}

const MESSAGES: Readonly<Record<string, string>> = {
  empty_file: "檔案是空的，請重新選擇。",
  image_too_large: "圖片超過 15 MB，請壓縮後再上傳。",
  unsupported_image_type: "只支援 JPG、PNG、WebP、GIF 或 AVIF 圖片。",
  media_storage_unavailable: "圖片儲存空間暫時無法使用，請改填圖片網址。",
};

function uploadErrorMessage(error: unknown): string {
  const code = error instanceof MediaUploadClientError ? error.code : "";
  return MESSAGES[code] ?? "上傳失敗，請稍後再試，或改填圖片網址。";
}

/** "上傳圖片" button: uploads one image and hands back its public HTTPS URL. */
export function FunnelImageUploadButton({ label, disabled, onUploaded }: { label: string; disabled?: boolean; onUploaded: (url: string) => void }) {
  const context = useContext(FunnelEditorAssetsContext);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ phase: "idle" | "uploading" | "error"; message: string }>({ phase: "idle", message: "" });
  if (!context) return null;
  const upload = async (file: File) => {
    const invalid = validateMediaFile("image", file);
    if (invalid) { setState({ phase: "error", message: MESSAGES[invalid] ?? MESSAGES.unsupported_image_type! }); if (input.current) input.current.value = ""; return; }
    try {
      setState({ phase: "uploading", message: "上傳中…" });
      const provision = parseImageProvision(await requestMediaJson({ path: "/api/media/images/presign", csrfToken: context.csrfToken, payload: { fileName: file.name, mimeType: file.type, sizeBytes: file.size } }));
      await uploadFileWithProgress({ url: provision.uploadUrl, method: "PUT", file, headers: provision.headers, onProgress: () => undefined });
      await requestMediaJson({ path: "/api/media/images/complete", csrfToken: context.csrfToken, payload: { assetId: provision.assetId } });
      onUploaded(provision.publicUrl);
      setState({ phase: "idle", message: "已上傳" });
    } catch (error) {
      setState({ phase: "error", message: uploadErrorMessage(error) });
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  const busy = state.phase === "uploading";
  return <span className="inline-flex flex-wrap items-center gap-2">
    <input ref={input} id={inputId} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="sr-only" disabled={disabled || busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }} />
    <button type="button" disabled={disabled || busy} aria-label={`上傳${label}`} onClick={() => input.current?.click()} className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50">
      {busy ? <LoaderCircle size={14} aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ImageUp size={14} aria-hidden />}上傳圖片
    </button>
    {state.message ? <span role={state.phase === "error" ? "alert" : "status"} className={`text-xs ${state.phase === "error" ? "text-red-700" : "text-slate-600"}`}>{state.message}</span> : null}
  </span>;
}
