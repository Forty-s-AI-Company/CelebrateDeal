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
  | "successMessage"
  | "heroImageUrl"
  | "heroImageAssetId"
  | "backgroundImageUrl"
  | "backgroundImageAssetId"
  | "promoVideoId"
  | "themeColor"
  | "countdownMinutes"
  | "stickyText"
  | "bodyContent"
  | "notice"
  | "seoTitle"
  | "seoDescription"
  | "maxVisibleSessions"
  | "hideExpiredSessions"
  | "isActive";

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
  heroImageUrl: string | null;
  heroImageAssetId: string | null;
  backgroundImageUrl: string | null;
  backgroundImageAssetId: string | null;
  promoVideoId: string | null;
  themeColor: string | null;
  countdownMinutes: number | null;
  stickyText: string | null;
  bodyContent: string | null;
  notice: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  maxVisibleSessions: number;
  hideExpiredSessions: boolean;
  isActive: boolean;
};

type RegistrationFormInputResult =
  | { success: true; data: RegistrationFormInput }
  | { success: false; errors: RegistrationFormInputErrors };

function stringValue(
  formData: FormData,
  key: string,
  errors: RegistrationFormInputErrors,
  field: RegistrationFormInputField,
) {
  const values = formData.getAll(key);
  if (values.length === 0) return "";
  if (values.length !== 1 || typeof values[0] !== "string") {
    errors[field] = "欄位值必須是單一文字。";
    return "";
  }
  return values[0].trim();
}

function checkboxValue(
  formData: FormData,
  key: string,
  errors: RegistrationFormInputErrors,
  field: RegistrationFormInputField,
) {
  const values = formData.getAll(key);
  if (values.length === 0) return false;
  if (values.length === 1 && values[0] === "on") return true;
  errors[field] = "核取方塊值只允許單一 on。";
  return false;
}

function requiredBounded(
  value: string,
  label: string,
  maxLength: number,
  errors: RegistrationFormInputErrors,
  field: RegistrationFormInputField,
) {
  if (!value && !errors[field]) errors[field] = `請填寫${label}。`;
  else if (value.length > maxLength) errors[field] = `${label}不可超過 ${maxLength} 個字。`;
}

function optionalBounded(
  value: string,
  label: string,
  maxLength: number,
  errors: RegistrationFormInputErrors,
  field: RegistrationFormInputField,
) {
  if (value.length > maxLength) errors[field] = `${label}不可超過 ${maxLength} 個字。`;
  return value || null;
}

function boundedInteger(
  value: string,
  label: string,
  min: number,
  max: number,
  defaultValue: number | null,
  errors: RegistrationFormInputErrors,
  field: RegistrationFormInputField,
) {
  if (!value) return defaultValue;
  const parsed = /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    errors[field] = `${label}需為 ${min} 到 ${max} 的整數。`;
  }
  return parsed;
}

export function parseRegistrationFormInput(formData: FormData): RegistrationFormInputResult {
  const errors: RegistrationFormInputErrors = {};
  const id = stringValue(formData, "id", errors, "root") || null;
  const name = stringValue(formData, "name", errors, "name");
  const rawSlug = stringValue(formData, "slug", errors, "slug");
  const slug = toSlug(rawSlug);
  const headline = stringValue(formData, "headline", errors, "headline");
  const description = stringValue(formData, "description", errors, "description") || null;
  const submitLabel = stringValue(formData, "submitLabel", errors, "submitLabel");
  const successMessage = stringValue(formData, "successMessage", errors, "successMessage");
  const heroImageUrl = optionalBounded(
    stringValue(formData, "heroImageUrl", errors, "heroImageUrl"),
    "主視覺圖片網址",
    2_048,
    errors,
    "heroImageUrl",
  );
  const heroImageAssetId = optionalBounded(
    stringValue(formData, "heroImageAssetId", errors, "heroImageAssetId"),
    "主視覺圖片素材 ID",
    128,
    errors,
    "heroImageAssetId",
  );
  const backgroundImageUrl = optionalBounded(
    stringValue(formData, "backgroundImageUrl", errors, "backgroundImageUrl"),
    "背景圖片網址",
    2_048,
    errors,
    "backgroundImageUrl",
  );
  const backgroundImageAssetId = optionalBounded(
    stringValue(formData, "backgroundImageAssetId", errors, "backgroundImageAssetId"),
    "背景圖片素材 ID",
    128,
    errors,
    "backgroundImageAssetId",
  );
  const promoVideoId = optionalBounded(
    stringValue(formData, "promoVideoId", errors, "promoVideoId"),
    "宣傳影片 ID",
    128,
    errors,
    "promoVideoId",
  );
  const themeColor = stringValue(formData, "themeColor", errors, "themeColor") || null;
  const countdownMinutes = boundedInteger(
    stringValue(formData, "countdownMinutes", errors, "countdownMinutes"),
    "倒數分鐘",
    0,
    10_080,
    null,
    errors,
    "countdownMinutes",
  );
  const stickyText = optionalBounded(stringValue(formData, "stickyText", errors, "stickyText"), "置頂文字", 300, errors, "stickyText");
  const bodyContent = optionalBounded(stringValue(formData, "bodyContent", errors, "bodyContent"), "內文", 10_000, errors, "bodyContent");
  const notice = optionalBounded(stringValue(formData, "notice", errors, "notice"), "注意事項", 1_000, errors, "notice");
  const seoTitle = optionalBounded(stringValue(formData, "seoTitle", errors, "seoTitle"), "SEO 標題", 200, errors, "seoTitle");
  const seoDescription = optionalBounded(stringValue(formData, "seoDescription", errors, "seoDescription"), "SEO 說明", 500, errors, "seoDescription");
  const maxVisibleSessions = boundedInteger(
    stringValue(formData, "maxVisibleSessions", errors, "maxVisibleSessions"),
    "可顯示場次",
    0,
    99,
    0,
    errors,
    "maxVisibleSessions",
  );

  if (themeColor && !/^#[\da-fA-F]{6}$/.test(themeColor)) {
    errors.themeColor = "主題色需使用 #RRGGBB 格式。";
  }

  if (id && id.length > 128) errors.root = "找不到要編輯的表單，請返回列表後重試。";
  requiredBounded(name, "表單名稱", 120, errors, "name");
  requiredBounded(rawSlug, "公開網址", 80, errors, "slug");
  if (rawSlug && !slug) errors.slug = "公開網址至少要包含一個中文字、英文字母或數字。";
  requiredBounded(headline, "公開標題", 200, errors, "headline");
  if (description && description.length > 5_000) errors.description = "說明文字不可超過 5,000 個字。";
  requiredBounded(submitLabel, "送出按鈕文字", 80, errors, "submitLabel");
  requiredBounded(successMessage, "成功訊息", 500, errors, "successMessage");

  const rawFields = stringValue(formData, "fields", errors, "fields");
  let decodedFields: unknown;
  if (!errors.fields && (!rawFields || rawFields.length > 64_000)) {
    errors.fields = "報名欄位資料不完整，請重新整理後再試一次。";
  } else if (!errors.fields) {
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

  const hideExpiredSessions = checkboxValue(formData, "hideExpiredSessions", errors, "hideExpiredSessions");
  const isActive = checkboxValue(formData, "isActive", errors, "isActive");

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
      heroImageUrl,
      heroImageAssetId,
      backgroundImageUrl,
      backgroundImageAssetId,
      promoVideoId,
      themeColor,
      countdownMinutes,
      stickyText,
      bodyContent,
      notice,
      seoTitle,
      seoDescription,
      maxVisibleSessions: maxVisibleSessions ?? 0,
      hideExpiredSessions,
      isActive,
    },
  };
}
