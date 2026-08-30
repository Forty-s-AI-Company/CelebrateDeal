import { describe, expect, it } from "vitest";
import { validateRegistrationFormAnswers } from "./registration-form-answers";

const fields = [
  { key: "name", label: "姓名", type: "text" as const, required: true },
  { key: "email", label: "Email", type: "email" as const, required: true },
  { key: "phone", label: "電話", type: "tel" as const, required: false },
  { key: "website", label: "網站", type: "url" as const, required: false },
  { key: "guests", label: "人數", type: "number" as const, required: false },
];

describe("registration form answer validation", () => {
  it("normalizes every configured answer type at the server boundary", () => {
    expect(validateRegistrationFormAnswers(fields, {
      name: "  王小明  ",
      email: " User@Example.Test ",
      phone: " +886 (912) 345-678 ",
      website: " https://example.test/path ",
      guests: " 2.5 ",
    })).toEqual({
      success: true,
      data: {
        name: "王小明",
        email: "user@example.test",
        phone: "+886912345678",
        website: "https://example.test/path",
        guests: "2.5",
      },
    });
  });

  it.each([
    ["missing required", { email: "user@example.test" }],
    ["unexpected answer", { name: "User", email: "user@example.test", password: "secret" }],
    ["invalid email", { name: "User", email: "not-email" }],
    ["invalid phone", { name: "User", email: "user@example.test", phone: "call-me" }],
    ["credentialed URL", { name: "User", email: "user@example.test", website: "https://user:pass@example.test" }],
    ["non-HTTP URL", { name: "User", email: "user@example.test", website: "javascript:alert(1)" }],
    ["non-decimal number", { name: "User", email: "user@example.test", guests: "0x10" }],
    ["non-finite number", { name: "User", email: "user@example.test", guests: "1e999" }],
  ])("rejects %s", (_name, answers) => {
    expect(validateRegistrationFormAnswers(fields, answers)).toEqual({ success: false });
  });

  it("allows omitted optional answers without manufacturing new values", () => {
    expect(validateRegistrationFormAnswers(fields, { name: "User", email: "user@example.test" })).toEqual({
      success: true,
      data: { name: "User", email: "user@example.test" },
    });
  });
});

