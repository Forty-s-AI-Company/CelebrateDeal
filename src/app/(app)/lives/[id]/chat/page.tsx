import { notFound } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getSalesProjectScope } from "@/lib/sales-project-scope";
import { InstructorChatPanel } from "@/components/instructor-chat-panel";
import { PageHeader } from "@/components/ui";

export default async function PrivateChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await getSalesProjectScope(auth.user.id, vendor.id);
  const { id } = await params;
  const live = await getDb().live.findFirst({ where: { id, vendorId: vendor.id, ...(scope.projectId ? { projectId: scope.projectId } : {}) }, select: { id: true, title: true } });
  if (!live) notFound();
  return <><PageHeader title="私密聊天室" description={`${live.title}：選擇觀眾後，只有該觀眾能看見你的回覆。`} />
    <InstructorChatPanel key={`${vendor.id}:${live.id}`} liveId={live.id} /></>;
}
