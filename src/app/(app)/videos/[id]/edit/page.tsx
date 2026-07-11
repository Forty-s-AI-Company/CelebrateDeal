import { notFound, redirect } from "next/navigation";
import { VideoForm } from "@/components/video-form";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canManageVideos } from "@/lib/vendor-capabilities";

export default async function EditVideoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; upload?: string }> }) {
  const [{ id }, query, auth] = await Promise.all([params, searchParams, requireAuth()]);
  if (!auth.vendor || !canManageVideos(auth.member?.role)) redirect("/videos?error=video_manager_required");
  const video = await getDb().video.findFirst({ where: { id, vendorId: auth.vendor.id } });
  if (!video) notFound();

  return (
    <>
      <PageHeader title="編輯影片" description="更新影片播放來源、縮圖與狀態。" />
      {query.upload ? <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-700">檔案已送出，Cloudflare webhook 完成後狀態會更新為 ready。</p> : null}
      {query.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">影片或縮圖 URL 必須是安全的 HTTPS 網址。</p> : null}
      <VideoForm video={video} />
    </>
  );
}
