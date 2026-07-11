import { redirect } from "next/navigation";
import { DirectVideoUpload } from "@/components/direct-video-upload";
import { VideoForm } from "@/components/video-form";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { canManageVideos } from "@/lib/vendor-capabilities";

export default async function NewVideoPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [params, auth] = await Promise.all([searchParams, requireAuth()]);
  if (!auth.vendor || !canManageVideos(auth.member?.role)) redirect("/videos?error=video_manager_required");
  return (
    <>
      <PageHeader title="新增影片" description="優先使用 Cloudflare Stream 直傳；外部 HTTPS URL 僅作相容性 fallback。" />
      {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">影片 URL 必須是安全的 HTTPS 網址。</p> : null}
      <div className="grid gap-6 xl:grid-cols-2"><DirectVideoUpload /><div><h2 className="mb-3 text-sm font-semibold text-slate-600">外部 URL fallback</h2><VideoForm /></div></div>
    </>
  );
}
