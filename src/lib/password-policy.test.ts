import { describe, expect, it } from "vitest";
import { COMMON_PASSWORDS, COMMON_PASSWORD_BASES } from "@/lib/password-policy-common";
import {
  ADMIN_PASSWORD_HINT,
  ADMIN_PASSWORD_MIN_LENGTH,
  PASSWORD_HINT,
  PASSWORD_INPUT_LIMIT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGES,
  passwordHint,
  passwordMinLength,
  passwordPolicyErrorCode,
  validateNewPassword,
} from "@/lib/password-policy";

const admin = { platformRole: "platform_admin" };

describe("validateNewPassword length", () => {
  it("uses 8 to 128 characters for everyone and 12 for a platform administrator", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(ADMIN_PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    expect(passwordMinLength("platform_admin")).toBe(12);
    expect(passwordMinLength("none")).toBe(8);
    expect(passwordMinLength(null)).toBe(8);
  });

  it("rejects 7 characters and accepts an ordinary 8-character password", () => {
    expect(validateNewPassword("bluewha")).toEqual({ ok: false, reason: "short", minLength: 8 });
    expect(validateNewPassword("bluewhal")).toEqual({ ok: true });
  });

  it("rejects 11 characters and accepts 12 for a platform administrator", () => {
    expect(validateNewPassword("bluewhale12", admin)).toEqual({ ok: false, reason: "short", minLength: 12 });
    expect(validateNewPassword("bluewhale123", admin)).toEqual({ ok: true });
    expect(validateNewPassword("bluewhal", admin)).toEqual({ ok: false, reason: "short", minLength: 12 });
  });

  it("measures length after trimming the surrounding spaces", () => {
    expect(validateNewPassword("  bluewha  ")).toEqual({ ok: false, reason: "short", minLength: 8 });
  });

  it("counts characters rather than UTF-16 code units", () => {
    expect(validateNewPassword("😀🎉🐱🌸")).toEqual({ ok: false, reason: "short", minLength: 8 });
    expect(validateNewPassword("😀🎉🐱🌸🍵📚🎈🌙")).toEqual({ ok: true });
  });

  it("accepts 128 characters and rejects 129, including emoji counted as one each", () => {
    const sentence = "my cat naps by the window ";
    const atLimit = sentence.repeat(5).slice(0, PASSWORD_MAX_LENGTH);
    expect(atLimit).toHaveLength(128);
    expect(validateNewPassword(atLimit)).toEqual({ ok: true });
    expect(validateNewPassword(`${atLimit}x`)).toEqual({ ok: false, reason: "long" });
    const emoji = "😀🎉🐱🌸🍵📚🎈🌙".repeat(16);
    expect(emoji.length).toBe(256);
    expect(validateNewPassword(emoji)).toEqual({ ok: true });
    expect(validateNewPassword(`${emoji}x`)).toEqual({ ok: false, reason: "long" });
    expect(validateNewPassword("x".repeat(PASSWORD_INPUT_LIMIT + 1))).toEqual({ ok: false, reason: "long" });
  });
});

describe("validateNewPassword common passwords", () => {
  it.each(["Tiger7rain", "k8Xp2mQz", "blue-house-9", "coffee42cup", "mango2street", "sunny day 7", "tea with grandma", "我家的貓每天睡午覺"])(
    "accepts the ordinary password %s",
    (password) => {
      expect(validateNewPassword(password)).toEqual({ ok: true });
    },
  );

  it.each(["password", "12345678", "qwertyui", "abc12345", "a12345678", "iloveyou", "woaini1314", "1qaz2wsx"])(
    "rejects the listed password %s",
    (password) => {
      expect(validateNewPassword(password)).toEqual({ ok: false, reason: "common" });
    },
  );

  it("matches the list regardless of case, surrounding spaces and full-width forms", () => {
    expect(validateNewPassword("PassWord123")).toEqual({ ok: false, reason: "common" });
    expect(validateNewPassword("  ILoveYou  ")).toEqual({ ok: false, reason: "common" });
    expect(validateNewPassword("ｐａｓｓｗｏｒｄ")).toEqual({ ok: false, reason: "common" });
  });

  it.each(["aaaaaaaa", "zzzzzzzzzzzz", "00000000", "abababab", "123123123", "passpass"])(
    "rejects one repeated short unit: %s",
    (password) => {
      expect(validateNewPassword(password)).toEqual({ ok: false, reason: "common" });
    },
  );

  it.each(["23456789", "98765432", "34567890", "1234567890", "abcdefghij", "qwertyuiop", "lkjhgfdsa"])(
    "rejects a straight sequence: %s",
    (password) => {
      expect(validateNewPassword(password)).toEqual({ ok: false, reason: "common" });
    },
  );

  it.each(["12345678!", "123456789!", "1234567890a", "11111111a", "88888888a", "aaaaaaa1", "qwertyuiop1", "zxcvbnm,", "abc123456789"])(
    "rejects a repeat or run with a few characters added: %s",
    (password) => {
      expect(validateNewPassword(password)).toEqual({ ok: false, reason: "common" });
    },
  );

  it.each(["qwerty2026", "dragon2026", "monkey2026!", "letmein2026", "admin2026!", "hello2026", "2026password", "Sunshine2026!", "iloveyou520"])(
    "rejects a common word with digits or symbols around it: %s",
    (password) => {
      expect(validateNewPassword(password)).toEqual({ ok: false, reason: "common" });
    },
  );
});

describe("validateNewPassword personal information", () => {
  it("rejects a password containing the e-mail name of at least four characters as personal", () => {
    const email = "Mei.Lin@example.test";
    expect(validateNewPassword("mei.lin2026", { email })).toEqual({ ok: false, reason: "personal" });
    expect(validateNewPassword("hello MEI.LIN friend", { email })).toEqual({ ok: false, reason: "personal" });
    expect(validateNewPassword("tea with grandma", { email })).toEqual({ ok: true });
  });

  it("ignores dots, dashes, underscores and a +tag in the e-mail name", () => {
    expect(validateNewPassword("meilin2026", { email: "mei.lin@example.test" })).toEqual({ ok: false, reason: "personal" });
    expect(validateNewPassword("mei_lin_loves_tea", { email: "meilin+shop@example.test" })).toEqual({ ok: false, reason: "personal" });
    expect(validateNewPassword("shop opens at nine", { email: "meilin+shop@example.test" })).toEqual({ ok: true });
  });

  it.each(["info@example.test", "sales@example.test", "service@example.test", "support@example.test", "contact@example.test", "hello@example.test"])(
    "does not apply the rule to the shared mailbox %s",
    (email) => {
      expect(validateNewPassword("infoline sales service support contact hello 9", { email })).toEqual({ ok: true });
    },
  );

  it("ignores an e-mail name shorter than four characters", () => {
    expect(validateNewPassword("amy loves tea", { email: "amy@example.test" })).toEqual({ ok: true });
    expect(validateNewPassword("amy loves tea", { email: null })).toEqual({ ok: true });
  });

  it("returns only a decision and a reason, never the password", () => {
    for (const password of ["tea with grandma", "Password123", "bluewha", "x".repeat(129)]) {
      const result = validateNewPassword(password);
      expect(Object.keys(result).every((key) => ["ok", "reason", "minLength"].includes(key))).toBe(true);
      expect(JSON.stringify(result)).not.toContain(password.trim().toLowerCase());
    }
  });
});

describe("common password lists", () => {
  it("keeps a few hundred unique, normalised entries that length alone would not reject", () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(200);
    expect(COMMON_PASSWORDS.length).toBeLessThanOrEqual(500);
    expect(new Set(COMMON_PASSWORDS).size).toBe(COMMON_PASSWORDS.length);
    for (const entry of COMMON_PASSWORDS) {
      expect(entry).toBe(entry.trim().toLowerCase());
      expect(entry.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(validateNewPassword(entry)).toEqual({ ok: false, reason: "common" });
    }
  });

  it("keeps short base words letter-only so a padded form like base2026! is caught", () => {
    expect(new Set(COMMON_PASSWORD_BASES).size).toBe(COMMON_PASSWORD_BASES.length);
    for (const base of COMMON_PASSWORD_BASES) {
      expect(base).toMatch(/^[a-z]+$/u);
      expect(validateNewPassword(`${base}2026!`)).toEqual({ ok: false, reason: "common" });
    }
  });
});

describe("password policy copy", () => {
  it("states the rule in Traditional Chinese before and after submission", () => {
    expect(PASSWORD_HINT).toBe("至少 8 個字元，可以用一句好記的話。");
    expect(ADMIN_PASSWORD_HINT).toBe("平台管理員至少 12 個字元，可以用一句好記的話。");
    expect(PASSWORD_POLICY_MESSAGES).toEqual({
      short: "密碼至少需要 8 個字元。",
      admin_short: "管理員密碼至少需要 12 個字元。",
      long: "密碼最多 128 個字元。",
      common: "這個密碼太常見，請換一個。",
      personal: "密碼不要包含你的 Email 帳號名稱。",
    });
  });

  it("picks the field hint by platform role", () => {
    expect(passwordHint("platform_admin")).toBe(ADMIN_PASSWORD_HINT);
    expect(passwordHint("none")).toBe(PASSWORD_HINT);
    expect(passwordHint(undefined)).toBe(PASSWORD_HINT);
  });

  it("maps an administrator's short password to its own error code", () => {
    expect(passwordPolicyErrorCode({ ok: false, reason: "short", minLength: 12 })).toBe("admin_short");
    expect(passwordPolicyErrorCode({ ok: false, reason: "short", minLength: 8 })).toBe("short");
    expect(passwordPolicyErrorCode({ ok: false, reason: "personal" })).toBe("personal");
  });
});
