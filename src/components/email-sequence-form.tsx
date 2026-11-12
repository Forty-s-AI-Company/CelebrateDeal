import { CsrfField } from "@/components/csrf-field";
import {
  EmailSequenceFormClient,
  type EmailSequenceFormSequence,
} from "@/components/email-sequence-form-client";
import { Card } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatLiveStartAt } from "@/lib/email-delivery-format";
import type { EmailSequenceFormDraft } from "@/lib/email-sequence-rules";
import { hasUsableMessageTemplateContent } from "@/lib/message-template";

/** Loads only the current vendor's Lives and sequence templates for the form. */
export async function EmailSequenceForm({
  vendorId,
  sequence,
  initialDraft,
}: {
  vendorId: string;
  sequence?: EmailSequenceFormSequence;
  initialDraft: EmailSequenceFormDraft;
}) {
  const db = getDb();
  const [lives, templates] = await Promise.all([
    db.live.findMany({
      where: { vendorId },
      orderBy: [{ scheduledAt: "desc" }],
      take: 200,
      select: { id: true, title: true, scheduledAt: true },
    }),
    db.messageTemplate.findMany({
      where: { vendorId, channel: "email", trigger: "sequence_email" },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: 200,
      select: { id: true, name: true, subject: true, body: true, isActive: true },
    }),
  ]);
  return (
    <Card>
      <EmailSequenceFormClient
        csrfField={<CsrfField />}
        lives={lives.map((live) => ({ id: live.id, title: live.title, startLabel: formatLiveStartAt(live.scheduledAt) }))}
        templates={templates.map((template) => ({
          id: template.id,
          name: template.name,
          usable: template.isActive && hasUsableMessageTemplateContent(template),
        }))}
        sequence={sequence}
        initialDraft={initialDraft}
      />
    </Card>
  );
}
