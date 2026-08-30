import type { RegistrationForm } from "@prisma/client";
import { CsrfField } from "@/components/csrf-field";
import { FormBuilderClient, type FormBuilderValues, type FormPromoVideoOption } from "@/components/form-builder-client";
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
  heroImageUrl: null,
  heroImageAssetId: null,
  backgroundImageUrl: null,
  backgroundImageAssetId: null,
  promoVideoId: null,
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

function nullableString(value: string | null | undefined) {
  return value ?? null;
}

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
    heroImageUrl: nullableString(form.heroImageUrl),
    heroImageAssetId: nullableString(form.heroImageAssetId),
    backgroundImageUrl: nullableString(form.backgroundImageUrl),
    backgroundImageAssetId: nullableString(form.backgroundImageAssetId),
    promoVideoId: nullableString(form.promoVideoId),
    themeColor: nullableString(form.themeColor),
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
  promoVideos = [],
}: {
  form?: RegistrationForm;
  error?: string;
  draftScope: string;
  promoVideos?: FormPromoVideoOption[];
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
        promoVideos={promoVideos}
        initialUpdatedAt={form?.updatedAt.toISOString() ?? null}
        csrfField={<CsrfField />}
      />
    </Card>
  );
}
