import { z } from "zod";

// Browser-safe declarative schema. Payment identity and encrypted answers stay
// in the server-only commerce-custom-checkout module.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/u;
const fieldKey = z.string().regex(FIELD_KEY, "欄位 key 格式不正確。");
const fieldLabel = z.string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, "欄位標題為必填。").max(100, "欄位標題過長。"))
  .refine((value) => !CONTROL_CHARACTERS.test(value), "欄位標題包含不允許的控制字元。");
const option = z.string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, "選項不得空白。").max(100, "選項過長。"))
  .refine((value) => !CONTROL_CHARACTERS.test(value), "選項包含不允許的控制字元。");

const commonField = { key: fieldKey, label: fieldLabel, required: z.boolean() };

export const CustomCheckoutFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...commonField, type: z.literal("text") }).strict(),
  z.object({ ...commonField, type: z.literal("textarea") }).strict(),
  z.object({
    ...commonField,
    type: z.literal("select"),
    options: z.array(option).min(2, "下拉選單至少需要兩個選項。").max(20, "下拉選單選項過多。"),
  }).strict(),
  z.object({ ...commonField, type: z.literal("checkbox"), required: z.literal(true) }).strict(),
]);

export const CustomCheckoutFieldsSchema = z.array(CustomCheckoutFieldSchema)
  .max(10, "最多只能建立十個自訂結帳欄位。")
  .superRefine((fields, context) => {
    const keys = new Set<string>();
    fields.forEach((field, index) => {
      if (keys.has(field.key)) {
        context.addIssue({ code: "custom", path: [index, "key"], message: "欄位 key 必須唯一。" });
      }
      keys.add(field.key);
      if (field.type === "select" && new Set(field.options).size !== field.options.length) {
        context.addIssue({ code: "custom", path: [index, "options"], message: "下拉選單選項不可重複。" });
      }
    });
  });

export type CustomCheckoutField = z.infer<typeof CustomCheckoutFieldSchema>;
export type CustomCheckoutFields = z.infer<typeof CustomCheckoutFieldsSchema>;
