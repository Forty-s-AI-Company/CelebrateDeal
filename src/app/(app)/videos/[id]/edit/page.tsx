import { notFound } from "next/navigation";
import { VideoForm } from "@/components/video-form";
import { PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditVideoPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendor();
  const { id } = await params;
  const video = await getDb().video.findFirst({ where: { id, vendorId: vendor.id } });
  if (!video) notFound();

  return (
    <>
      <PageHeader title="編輯影片" description="更新影片播放來源、縮圖與狀態。" />
      <VideoForm video={video} />
    </>
  );
}
