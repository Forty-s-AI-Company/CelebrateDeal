export const REGISTRATION_FORM_FIELD_TYPES = ["text", "email", "tel", "number", "url"] as const;

export type RegistrationFormBuilderFieldType = (typeof REGISTRATION_FORM_FIELD_TYPES)[number];

export type RegistrationFormBuilderField = {
  key: string;
  label: string;
  type: RegistrationFormBuilderFieldType;
  required: boolean;
};

export const REGISTRATION_FORM_CORE_FIELD_KEYS = new Set(["name", "email"]);

export function defaultRegistrationFormBuilderFields(): RegistrationFormBuilderField[] {
  return [
    { key: "name", label: "姓名", type: "text", required: true },
    { key: "email", label: "Email", type: "email", required: true },
    { key: "phone", label: "手機", type: "tel", required: false },
  ];
}

export function nextRegistrationFormFieldKey(fields: RegistrationFormBuilderField[]) {
  const existingKeys = new Set(fields.map((field) => field.key));
  let sequence = 1;
  while (existingKeys.has(`field_${sequence}`)) sequence += 1;
  return `field_${sequence}`;
}

export function createRegistrationFormField(
  fields: RegistrationFormBuilderField[],
  type: RegistrationFormBuilderFieldType,
): RegistrationFormBuilderField {
  const key = nextRegistrationFormFieldKey(fields);
  const sequence = key.slice("field_".length);
  return {
    key,
    label: `自訂欄位 ${sequence}`,
    type,
    required: false,
  };
}

export function moveRegistrationFormField(
  fields: RegistrationFormBuilderField[],
  index: number,
  direction: -1 | 1,
) {
  const target = index + direction;
  if (index < 0 || index >= fields.length || target < 0 || target >= fields.length) return fields;

  const next = [...fields];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
