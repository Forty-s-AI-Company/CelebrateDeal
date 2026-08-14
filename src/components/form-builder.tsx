import type { RegistrationForm } from "@prisma/client";
import { CsrfField } from "@/components/csrf-field";
import { FormBuilderClient } from "@/components/form-builder-client";
import { Card } from "@/components/ui";
import { defaultRegistrationFormBuilderFields } from "@/lib/registration-form-builder";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";

export function FormBuilder({
  form,
  error,
  draftScope,
}: {
  form?: RegistrationForm;
  error?: string;
  draftScope: string;
}) {
  const defaultFields = defaultRegistrationFormBuilderFields();
  const parsedFields = parseRegistrationFormFields(form?.fields ?? defaultFields);

  return (
    <Card>
      <FormBuilderClient
        values={{
          id: form?.id,
          name: form?.name ?? "",
          slug: form?.slug ?? "",
          headline: form?.headline ?? "",
          description: form?.description ?? "",
          submitLabel: form?.submitLabel ?? "送出報名",
          successMessage: form?.successMessage ?? "已收到你的資料，開播前會再提醒你。",
          isActive: form?.isActive ?? true,
        }}
        initialFields={parsedFields.success ? parsedFields.data : defaultFields}
        legacyFieldsInvalid={Boolean(form && !parsedFields.success)}
        legacyRouteError={error}
        draftScope={draftScope}
        initialUpdatedAt={form?.updatedAt.toISOString() ?? null}
        csrfField={<CsrfField />}
      />
    </Card>
  );
}
