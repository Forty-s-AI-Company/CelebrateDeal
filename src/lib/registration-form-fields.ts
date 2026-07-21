import { z } from "zod";

export const REGISTRATION_FORM_FIELD_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const REGISTRATION_FORM_RESERVED_FIELDS = new Set(["formId", "liveId", "referralCode", "redirectTo"]);

const RegistrationFormField = z.object({
  key: z.string().regex(REGISTRATION_FORM_FIELD_KEY),
  label: z.string().trim().min(1).max(160),
  type: z.enum(["text", "email", "tel", "number", "url"]).default("text"),
  required: z.boolean().default(false),
}).strict();

export const RegistrationFormFields = z.array(RegistrationFormField)
  .min(2)
  .max(32)
  .superRefine((fields, context) => {
    const keys = fields.map((field) => field.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "欄位 key 不可重複。" });
    }
    if (keys.some((key) => REGISTRATION_FORM_RESERVED_FIELDS.has(key))) {
      context.addIssue({ code: "custom", message: "欄位 key 使用了系統保留名稱。" });
    }
    const name = fields.find((field) => field.key === "name");
    const email = fields.find((field) => field.key === "email");
    if (!name?.required || name.type !== "text") {
      context.addIssue({ code: "custom", message: "必須包含 required text name 欄位。" });
    }
    if (!email?.required || email.type !== "email") {
      context.addIssue({ code: "custom", message: "必須包含 required email 欄位。" });
    }
  });

export type RegistrationFormFieldSpec = z.infer<typeof RegistrationFormField>;

export function parseRegistrationFormFields(value: unknown) {
  return RegistrationFormFields.safeParse(value);
}
