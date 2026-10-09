import { notFound } from "next/navigation";
import { LiveInstructorPrivateChat } from "@/components/live-instructor-private-chat";
import { PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { LiveChatError } from "@/lib/live-chat";
import { listPrivateInstructorConversations } from "@/lib/live-private-chat";

export default async function InstructorChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { auth, vendor } = await requireVendorManagerContext(`/lives/${id}/chat`);
  if (!auth.member) notFound();
  const db = getDb();
  let initialPage;
  try {
    initialPage = await listPrivateInstructorConversations(db, {
      vendorId: vendor.id, liveId: id, userId: auth.user.id, memberId: auth.member.id, sessionId: auth.session.id,
    });
  } catch (error) { if (error instanceof LiveChatError) notFound(); throw error; }
  const live = await db.live.findFirst({ where: { id, vendorId: vendor.id }, select: { title: true } });
  if (!live) notFound();
  return <>
    <PageHeader title="講師私訊" description={live.title} />
    <LiveInstructorPrivateChat vendorId={vendor.id} liveId={id} initialPage={initialPage} />
  </>;
}
