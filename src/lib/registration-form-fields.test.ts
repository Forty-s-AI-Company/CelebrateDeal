import { describe, expect, it } from "vitest";
import { parseRegistrationFormFields } from "./registration-form-fields";

const requiredFields = [
  { key: "name", label: "姓名", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
];

describe("registration form field contract", () => {
  it("accepts the required contact fields and bounded supported custom fields", () => {
    const result = parseRegistrationFormFields([
      ...requiredFields,
      { key: "phone", label: "手機", type: "tel", required: false },
    ]);

    expect(result.success).toBe(true);
  });

  it.each([
    { name: "missing required email", fields: requiredFields.slice(0, 1) },
    { name: "duplicate key", fields: [...requiredFields, requiredFields[0]] },
    { name: "reserved key", fields: [...requiredFields, { key: "redirectTo", label: "Redirect", type: "text", required: false }] },
    { name: "unsupported password input", fields: [...requiredFields, { key: "secret", label: "密碼", type: "password", required: false }] },
  ])("rejects $name", ({ fields }) => {
    expect(parseRegistrationFormFields(fields).success).toBe(false);
  });
});
