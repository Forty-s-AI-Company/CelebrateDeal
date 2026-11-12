import { notFound } from "next/navigation";
import { EmailSequenceForm } from "@/components/email-sequence-form";
import { Badge, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  delayMinutesToDraft,
  EMAIL_SEQUENCE_STATUS_LABELS,
  ID_PATTERN,
  type EmailSequenceStatus,
} from "@/lib/email-sequence-rules";
import { requireFeatureOrNotFound } from "@/lib/feature-gates";

export default async function EditEmailSequencePage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  requireFeatureOrNotFound(vendor, "email_sequences");
  const { id } = await params;
  if (!ID_PATTERN.test(id)) notFound();
  const sequence = await getDb().emailSequence.findFirst({
    where: { id, vendorId: vendor.id },
    select: {
      id: true,
      name: true,
      liveId: true,
      status: true,
      version: true,
      activatedAt: true,
      steps: { orderBy: { delayMinutes: "asc" }, select: { id: true, delayMinutes: true, messageTemplateId: true, isActive: true } },
    },
  });
  if (!sequence) notFound();
  const status = (sequence.status in EMAIL_SEQUENCE_STATUS_LABELS ? sequence.status : "draft") as EmailSequenceStatus;
  return (
    <>
      <PageHeader
        title="編輯追銷序列"
        description={status === "active"
          ? "儲存後，進行中的人會照新的時間收下一封；已經過了的時間點不會補寄。"
          : "調整序列內容；啟用與暫停在序列列表操作。"}
        action={<Badge tone={status === "active" ? "green" : status === "paused" ? "orange" : "gray"}>{EMAIL_SEQUENCE_STATUS_LABELS[status]}</Badge>}
      />
      <EmailSequenceForm
        vendorId={vendor.id}
        sequence={{
          id: sequence.id,
          version: sequence.version,
          status,
          locked: Boolean(sequence.activatedAt),
        }}
        initialDraft={{
          name: sequence.name,
          liveId: sequence.liveId,
          steps: sequence.steps.map((step) => ({
            id: step.id,
            ...delayMinutesToDraft(step.delayMinutes),
            messageTemplateId: step.messageTemplateId,
            isActive: step.isActive,
          })),
        }}
      />
    </>
  );
}
