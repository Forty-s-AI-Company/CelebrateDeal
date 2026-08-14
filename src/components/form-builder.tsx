import type { RegistrationForm } from "@prisma/client";
import { CsrfField } from "@/components/csrf-field";
import { FormBuilderClient, type FormBuilderValues } from "@/components/form-builder-client";
import { Card } from "@/components/ui";
import { defaultRegistrationFormBuilderFields } from "@/lib/registration-form-builder";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";

const NEW_FORM_VALUES: FormBuilderValues = {
  name: "",
  slug: "",
  headline: "",
  description: "",
  submitLabel: "送出報名",
  successMessage: "已收到你的資料，開播前會再提醒你。",
  themeColor: null,
  countdownMinutes: null,
  stickyText: null,
  bodyContent: null,
  notice: null,
  seoTitle: null,
  seoDescription: null,
  maxVisibleSessions: 0,
  hideExpiredSessions: true,
  isActive: true,
};

function formBuilderInitialValues(form?: RegistrationForm): FormBuilderValues {
  if (!form) return NEW_FORM_VALUES;
  return {
    id: form.id,
    name: form.name,
    slug: form.slug,
    headline: form.headline,
    description: form.description ?? "",
    submitLabel: form.submitLabel,
    successMessage: form.successMessage,
    themeColor: form.themeColor,
    countdownMinutes: form.countdownMinutes,
    stickyText: form.stickyText,
    bodyContent: form.bodyContent,
    notice: form.notice,
    seoTitle: form.seoTitle,
    seoDescription: form.seoDescription,
    maxVisibleSessions: form.maxVisibleSessions,
    hideExpiredSessions: form.hideExpiredSessions,
    isActive: form.isActive,
  };
}

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
        values={formBuilderInitialValues(form)}
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
