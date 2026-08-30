import { describe, expect, it } from "vitest";
import {
  createRegistrationFormField,
  defaultRegistrationFormBuilderFields,
  moveRegistrationFormField,
  nextRegistrationFormFieldKey,
} from "./registration-form-builder";

describe("registration form builder state", () => {
  it("creates a fresh default field array for every editor", () => {
    const first = defaultRegistrationFormBuilderFields();
    const second = defaultRegistrationFormBuilderFields();
    first[0]!.label = "已修改";

    expect(second[0]!.label).toBe("姓名");
    expect(second.map((field) => field.key)).toEqual(["name", "email", "phone"]);
  });

  it("allocates stable collision-free custom keys", () => {
    const fields = [
      ...defaultRegistrationFormBuilderFields(),
      { key: "field_1", label: "公司", type: "text" as const, required: false },
      { key: "field_3", label: "職稱", type: "text" as const, required: false },
    ];

    expect(nextRegistrationFormFieldKey(fields)).toBe("field_2");
    expect(createRegistrationFormField(fields, "url")).toEqual({
      key: "field_2",
      label: "自訂欄位 2",
      type: "url",
      required: false,
    });
  });

  it("moves fields within bounds without mutating the previous state", () => {
    const fields = defaultRegistrationFormBuilderFields();
    const moved = moveRegistrationFormField(fields, 2, -1);

    expect(moved.map((field) => field.key)).toEqual(["name", "phone", "email"]);
    expect(fields.map((field) => field.key)).toEqual(["name", "email", "phone"]);
    expect(moveRegistrationFormField(fields, 0, -1)).toBe(fields);
  });
});
