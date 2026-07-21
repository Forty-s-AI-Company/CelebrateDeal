import { VideoForm } from "@/components/video-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function NewVideoPage() {
  await requireVendorManager();
  return (
    <>
      <PageHeader title="新增影片" description="支援外部影片 URL，MVP 先用 URL 管理，正式版可再接物件儲存與轉檔佇列。" />
      <VideoForm />
    </>
  );
}
