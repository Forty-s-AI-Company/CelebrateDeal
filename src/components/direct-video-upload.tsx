"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { Card } from "@/components/ui";

const MAX_BASIC_UPLOAD_BYTES = 200 * 1024 * 1024;
const clientHeaders = { "Content-Type": "application/json", "X-CelebrateDeal-Client": "web" };

export function DirectVideoUpload() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "creating" | "uploading" | "error">("idle");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ uploadURL: string; videoId: string } | null>(null);

  async function uploadFile(upload: { uploadURL: string; videoId: string }, file: File) {
    setState("uploading");
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(upload.uploadURL, { method: "POST", body });
    if (!response.ok) {
      setPending(upload);
      setError("檔案上傳未完成，請保留此頁並重試。若檔案超過 200 MB，請改用支援 tus 的上傳流程。");
      setState("error");
      return;
    }
    router.push(`/videos/${upload.videoId}/edit?upload=processing`);
    router.refresh();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = fileRef.current?.files?.[0];
    if (!file || !file.type.startsWith("video/")) {
      setError("請選擇影片檔案。");
      setState("error");
      return;
    }
    if (file.size > MAX_BASIC_UPLOAD_BYTES) {
      setError("目前瀏覽器直傳支援 200 MB 以內檔案；大型影片請使用後續 tus 上傳工具。");
      setState("error");
      return;
    }
    setError("");
    if (pending) {
      await uploadFile(pending, file);
      return;
    }
    setState("creating");
    const response = await fetch("/api/videos/direct-upload", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({
        title: String(form.get("title") ?? ""),
        maxDurationSeconds: Number(form.get("maxDurationSeconds") ?? 3600),
      }),
    });
    const result = await response.json() as { videoId?: string; uploadURL?: string; error?: string };
    if (!response.ok || !result.videoId || !result.uploadURL) {
      setError(result.error ?? "無法建立 Cloudflare 上傳網址。");
      setState("error");
      return;
    }
    const upload = { videoId: result.videoId, uploadURL: result.uploadURL };
    setPending(upload);
    await uploadFile(upload, file);
  }

  return (
    <Card>
      <form onSubmit={submit} className="grid gap-4">
        <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-700"><UploadCloud size={19} /></span><div><h2 className="font-semibold text-slate-950">Cloudflare Stream 上傳</h2><p className="mt-1 text-sm text-slate-500">建立一次性直傳網址，檔案不經過應用伺服器。</p></div></div>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">影片名稱<input name="title" required maxLength={160} className="h-10 rounded-md border border-border px-3" /></label>
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">影片檔案<input ref={fileRef} type="file" accept="video/*" required className="h-10 rounded-md border border-border bg-white px-3 py-2 text-sm" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">最長秒數<input name="maxDurationSeconds" type="number" min={60} max={21600} defaultValue={3600} required className="h-10 rounded-md border border-border px-3" /></label>
        </div>
        {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <button disabled={state === "creating" || state === "uploading"} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"><UploadCloud size={16} />{state === "creating" ? "建立上傳..." : state === "uploading" ? "上傳中..." : pending ? "重試上傳" : "上傳至 Stream"}</button>
      </form>
    </Card>
  );
}
