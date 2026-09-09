import { describe, expect, it } from "vitest";
import { detectLocale, detectLocaleFromAcceptLanguage, detectLocaleFromCookie, messages, resolveLocale, SUPPORTED_LOCALES, t } from "./i18n";

describe("i18n", () => {
  it("keeps all supported dictionaries complete", () => {
    const keys = Object.keys(messages.en).sort();
    for (const locale of SUPPORTED_LOCALES) expect(Object.keys(messages[locale]).sort()).toEqual(keys);
  });
  it("detects cookie first and then Accept-Language", () => {
    expect(detectLocale({ cookie: "foo=bar; locale=ja", acceptLanguage: "en-US,en;q=0.9" })).toBe("ja");
    expect(detectLocale({ acceptLanguage: "en-US,en;q=0.9" })).toBe("en");
    expect(detectLocaleFromCookie("NEXT_LOCALE=zh-CN")).toBe("zh-CN");
  });
  it("normalizes and safely falls back", () => {
    expect(resolveLocale("zh_hant")).toBe("zh-TW");
    expect(detectLocaleFromAcceptLanguage("fr-FR,xx;q=0.8")).toBe("zh-TW");
    expect(t("unknown", "myCourses")).toBe(messages["zh-TW"].myCourses);
  });
});
