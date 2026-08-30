import { VideoForm } from "@/components/video-form";
import { PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";

export default async function NewVideoPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireVendorManager();
  const query = await searchParams;
  return (
    <>
      <PageHeader title="新增影片" description="直接拖拉影片上傳到 Cloudflare Stream，可查看進度、取消與重試；外部 URL 僅保留為進階相容選項。" />
      <VideoForm error={query.error} />
    </>
  );
}
