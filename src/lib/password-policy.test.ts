import { describe, expect, it } from "vitest";
import { COMMON_PASSWORDS } from "@/lib/password-policy-common";
import {
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGES,
  validateNewPassword,
} from "@/lib/password-policy";

describe("validateNewPassword", () => {
  it("uses 8 to 128 characters with no character-class rules", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it("rejects 7 characters and accepts an ordinary 8-character password", () => {
    expect(validateNewPassword("bluewha")).toEqual({ ok: false, reason: "short" });
    expect(validateNewPassword("bluewhal")).toEqual({ ok: true });
  });

  it("measures length after trimming the surrounding spaces", () => {
    expect(validateNewPassword("  bluewha  ")).toEqual({ ok: false, reason: "short" });
  });

  it("accepts 128 characters and rejects 129", () => {
    const sentence = "my cat naps by the window ";
    const atLimit = sentence.repeat(5).slice(0, PASSWORD_MAX_LENGTH);
    expect(atLimit).toHaveLength(128);
    expect(validateNewPassword(atLimit)).toEqual({ ok: true });
    expect(validateNewPassword(`${atLimit}x`)).toEqual({ ok: false, reason: "long" });
  });

  it("accepts a memorable sentence without digits, capitals or symbols", () => {
    expect(validateNewPassword("我家的貓每天睡午覺")).toEqual({ ok: true });
    expect(validateNewPassword("tea with grandma on sunday")).toEqual({ ok: true });
  });

  it.each(["password", "12345678", "qwertyui", "abc12345", "a12345678", "iloveyou", "woaini1314", "1qaz2wsx"])(
    "rejects the listed password %s",
    (password) => {
      expect(validateNewPassword(password)).toEqual({ ok: false, reason: "common" });
    },
  );

  it("matches the list regardless of case and surrounding spaces", () => {
    expect(validateNewPassword("PassWord123")).toEqual({ ok: false, reason: "common" });
    expect(validateNewPassword("  ILoveYou  ")).toEqual({ ok: false, reason: "common" });
  });

  it("rejects a listed word with only digits or symbols added at the end", () => {
    expect(validateNewPassword("Sunshine2026!")).toEqual({ ok: false, reason: "common" });
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

  it("rejects a password containing the e-mail name of at least four characters", () => {
    const email = "Mei.Lin@example.test";
    expect(validateNewPassword("mei.lin2026", { email })).toEqual({ ok: false, reason: "common" });
    expect(validateNewPassword("hello MEI.LIN friend", { email })).toEqual({ ok: false, reason: "common" });
    expect(validateNewPassword("tea with grandma", { email })).toEqual({ ok: true });
  });

  it("ignores an e-mail name shorter than four characters", () => {
    expect(validateNewPassword("amy loves tea", { email: "amy@example.test" })).toEqual({ ok: true });
    expect(validateNewPassword("amy loves tea", { email: null })).toEqual({ ok: true });
  });

  it("returns only a decision and a reason, never the password", () => {
    for (const password of ["tea with grandma", "Password123", "bluewha", "x".repeat(129)]) {
      const result = validateNewPassword(password);
      expect(Object.keys(result).sort()).toEqual(result.ok ? ["ok"] : ["ok", "reason"]);
      expect(JSON.stringify(result)).not.toContain(password.trim().toLowerCase());
    }
  });
});

describe("common password list", () => {
  it("is a few hundred unique, normalised entries that length alone would not reject", () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(200);
    expect(COMMON_PASSWORDS.length).toBeLessThanOrEqual(500);
    expect(new Set(COMMON_PASSWORDS).size).toBe(COMMON_PASSWORDS.length);
    for (const entry of COMMON_PASSWORDS) {
      expect(entry).toBe(entry.trim().toLowerCase());
      expect(entry.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(validateNewPassword(entry)).toEqual({ ok: false, reason: "common" });
    }
  });
});

describe("password policy copy", () => {
  it("states the rule in Traditional Chinese before and after submission", () => {
    expect(PASSWORD_HINT).toBe("至少 8 個字元，可以用一句好記的話。");
    expect(PASSWORD_POLICY_MESSAGES).toEqual({
      short: "密碼至少需要 8 個字元。",
      long: "密碼最多 128 個字元。",
      common: "這個密碼太常見，請換一個。",
    });
  });
});
