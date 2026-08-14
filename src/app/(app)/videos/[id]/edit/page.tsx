import { notFound } from "next/navigation";
import { VideoForm } from "@/components/video-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditVideoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const vendor = await requireVendorManager();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const video = await getDb().video.findFirst({ where: { id, vendorId: vendor.id } });
  if (!video) notFound();

  return (
    <>
      <PageHeader title="編輯影片" description="更新影片資訊、直接替換 Stream 檔案或上傳縮圖；provider mapping 仍由伺服器管理。" />
      <VideoForm video={video} error={query.error} />
    </>
  );
}
