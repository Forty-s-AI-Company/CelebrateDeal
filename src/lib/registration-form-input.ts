import { toSlug } from "@/lib/format";
import {
  parseRegistrationFormFields,
  type RegistrationFormFieldSpec,
} from "@/lib/registration-form-fields";

export type RegistrationFormInputField =
  | "root"
  | "name"
  | "slug"
  | "headline"
  | "description"
  | "fields"
  | "submitLabel"
  | "successMessage";

export type RegistrationFormInputErrors = Partial<Record<RegistrationFormInputField, string>>;

export type RegistrationFormInput = {
  id: string | null;
  name: string;
  slug: string;
  headline: string;
  description: string | null;
  fields: RegistrationFormFieldSpec[];
  submitLabel: string;
  successMessage: string;
  isActive: boolean;
};

type RegistrationFormInputResult =
  | { success: true; data: RegistrationFormInput }
  | { success: false; errors: RegistrationFormInputErrors };

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requiredBounded(
  value: string,
  label: string,
  maxLength: number,
  errors: RegistrationFormInputErrors,
  field: RegistrationFormInputField,
) {
  if (!value) errors[field] = `請填寫${label}。`;
  else if (value.length > maxLength) errors[field] = `${label}不可超過 ${maxLength} 個字。`;
}

export function parseRegistrationFormInput(formData: FormData): RegistrationFormInputResult {
  const errors: RegistrationFormInputErrors = {};
  const id = stringValue(formData, "id") || null;
  const name = stringValue(formData, "name");
  const rawSlug = stringValue(formData, "slug");
  const slug = toSlug(rawSlug);
  const headline = stringValue(formData, "headline");
  const description = stringValue(formData, "description") || null;
  const submitLabel = stringValue(formData, "submitLabel");
  const successMessage = stringValue(formData, "successMessage");

  if (id && id.length > 128) errors.root = "找不到要編輯的表單，請返回列表後重試。";
  requiredBounded(name, "表單名稱", 120, errors, "name");
  requiredBounded(rawSlug, "公開網址", 80, errors, "slug");
  if (rawSlug && !slug) errors.slug = "公開網址至少要包含一個中文字、英文字母或數字。";
  requiredBounded(headline, "公開標題", 200, errors, "headline");
  if (description && description.length > 5_000) errors.description = "說明文字不可超過 5,000 個字。";
  requiredBounded(submitLabel, "送出按鈕文字", 80, errors, "submitLabel");
  requiredBounded(successMessage, "成功訊息", 500, errors, "successMessage");

  const rawFields = stringValue(formData, "fields");
  let decodedFields: unknown;
  if (!rawFields || rawFields.length > 64_000) {
    errors.fields = "報名欄位資料不完整，請重新整理後再試一次。";
  } else {
    try {
      decodedFields = JSON.parse(rawFields);
    } catch {
      errors.fields = "報名欄位資料無法解析，請重新整理後再試一次。";
    }
  }

  const parsedFields = decodedFields === undefined ? null : parseRegistrationFormFields(decodedFields);
  if (parsedFields && !parsedFields.success) {
    errors.fields = "請保留必填的姓名與 Email，並確認欄位數量、類型與名稱皆有效。";
  }

  if (Object.keys(errors).length > 0 || !parsedFields?.success) return { success: false, errors };

  return {
    success: true,
    data: {
      id,
      name,
      slug,
      headline,
      description,
      fields: parsedFields.data,
      submitLabel,
      successMessage,
      isActive: formData.get("isActive") === "on",
    },
  };
}

