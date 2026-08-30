import type { MessageTemplate } from "@prisma/client";
import { CsrfField } from "@/components/csrf-field";
import { MessageTemplateFormClient } from "@/components/message-template-form-client";
import { Card } from "@/components/ui";
import type { MessageTemplateActionError, MessageTemplateFormTemplate } from "@/lib/message-template";

export function MessageTemplateForm({
  template,
  error,
}: {
  template?: MessageTemplate;
  error?: MessageTemplateActionError | null;
}) {
  return (
    <Card>
      <MessageTemplateFormClient
        template={template ? {
          id: template.id,
          name: template.name,
          channel: template.channel,
          trigger: template.trigger,
          subject: template.subject ?? "",
          body: template.body,
          isActive: template.isActive,
          updatedAt: template.updatedAt.toISOString(),
        } satisfies MessageTemplateFormTemplate : undefined}
        initialError={error}
        csrfField={<CsrfField />}
      />
    </Card>
  );
}
