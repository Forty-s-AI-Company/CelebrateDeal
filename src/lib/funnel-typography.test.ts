import { describe, expect, it } from "vitest";

import { createEmptyPageDocument, parsePageDocument, serializePageDocument } from "@/lib/funnel-page-document";
import {
  FUNNEL_FONT_OPTIONS,
  funnelButtonDefaults,
  funnelContrastRatio,
  funnelHeadingSize,
  funnelTypographyDefaults,
  funnelTypographyKind,
  resolveFunnelFontStack,
  resolveFunnelTypography,
} from "@/lib/funnel-typography";

/** A PageDocument exactly as saved before R3 (no headingColor, free-form font). */
const LEGACY_DOCUMENT = {
  schemaVersion: 1,
  id: "legacy_saved_page",
  name: "舊版頁面",
  revision: 7,
  root: [{
    schemaVersion: 1, id: "s1", type: "section", props: {}, style: { padding: 56, backgroundColor: "#eff6ff" }, overrides: {}, visible: true, actions: [], attributes: {},
    children: [{
      schemaVersion: 1, id: "s1_row", type: "row", props: { maxWidth: 1120 }, style: {}, overrides: {}, visible: true, actions: [], attributes: {},
      children: [
        { schemaVersion: 1, id: "h", type: "headline", props: { text: "舊標題", level: "h1" }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} },
        { schemaVersion: 1, id: "t", type: "text", props: { text: "舊內文" }, style: { fontSize: 18 }, overrides: {}, visible: true, actions: [], attributes: {} },
      ],
    }],
  }],
  popups: [],
  settings: {
    typography: { bodyFont: "Noto Sans TC", headingFont: "system-ui", bodySize: 17, bodyLineHeight: 1.6, linkColor: "#2563eb", textColor: "#0f172a", alignment: "left" },
    language: "zh-TW",
    background: { color: "white", blur: 0 },
    seo: { title: "舊頁面", hideFromSearch: false },
    tracking: { status: "disabled", reason: "追蹤碼與自訂程式碼需經安全整合後才可啟用", upgradeRequired: false },
    affiliate: { status: "disabled", reason: "聯盟徽章尚未連接可驗證的方案資料", upgradeRequired: false },
  },
};

describe("頁面設定向下相容", () => {
  it("R3 之前儲存的文件解析結果不變，且不會被補上新欄位", () => {
    const parsed = parsePageDocument(structuredClone(LEGACY_DOCUMENT));
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(LEGACY_DOCUMENT);
    expect(parsed!.settings.typography).not.toHaveProperty("headingColor");
    expect(JSON.parse(serializePageDocument(parsed!))).toEqual(LEGACY_DOCUMENT);
  });

  it("空白設定仍套用原本的預設值，headingColor 為選填", () => {
    const empty = createEmptyPageDocument();
    expect(empty.settings.typography).toEqual({ bodyFont: "system-ui", headingFont: "system-ui", bodySize: 16, bodyLineHeight: 1.5, linkColor: "#2563eb", textColor: "#0f172a", alignment: "left" });
    const withHeading = parsePageDocument({ ...empty, settings: { ...empty.settings, typography: { ...empty.settings.typography, headingColor: "#1e3a8a" } } });
    expect(withHeading?.settings.typography.headingColor).toBe("#1e3a8a");
    expect(parsePageDocument({ ...empty, settings: { ...empty.settings, typography: { ...empty.settings.typography, headingColor: "red; background:url(x)" } } })).toBeNull();
  });
});

describe("字型堆疊", () => {
  it("精選字型對應到系統字型堆疊，不下載 CJK 網路字型", () => {
    for (const option of FUNNEL_FONT_OPTIONS) {
      expect(resolveFunnelFontStack(option.value)).toBe(option.stack);
      expect(option.stack).not.toMatch(/url\(|https?:/u);
    }
    expect(resolveFunnelFontStack("system-ui")).toContain("Noto Sans TC");
  });

  it("舊文件的自訂字型照原樣保留，不安全的值退回系統字型", () => {
    expect(resolveFunnelFontStack("Noto Sans TC")).toBe("Noto Sans TC");
    expect(resolveFunnelFontStack("x; background: url(javascript:alert(1))")).toBe(FUNNEL_FONT_OPTIONS[0].stack);
    expect(resolveFunnelFontStack("")).toBe(FUNNEL_FONT_OPTIONS[0].stack);
  });
});

describe("字級層次與響應式", () => {
  const settings = createEmptyPageDocument().settings;
  const desktop = resolveFunnelTypography(settings, "desktop");
  const mobile = resolveFunnelTypography(settings, "mobile");

  it("H1–H4 字級遞減，桌機大於手機", () => {
    const levels = ["h1", "h2", "h3", "h4"] as const;
    const desktopSizes = levels.map((level) => funnelHeadingSize(level, desktop));
    const mobileSizes = levels.map((level) => funnelHeadingSize(level, mobile));
    expect(desktopSizes).toEqual([48, 36, 24, 20]);
    expect(mobileSizes).toEqual([32, 26, 20, 18]);
    for (let index = 1; index < levels.length; index += 1) expect(desktopSizes[index]!).toBeLessThan(desktopSizes[index - 1]!);
    levels.forEach((_, index) => expect(mobileSizes[index]!).toBeLessThanOrEqual(desktopSizes[index]!));
    expect(desktopSizes[0]! / desktop.baseSize).toBeGreaterThanOrEqual(2.5);
  });

  it("標題預設粗體、較緊的行高、使用標題字型與顏色", () => {
    const tokens = resolveFunnelTypography({ typography: { ...settings.typography, headingFont: "serif-tc", headingColor: "#1e3a8a" } }, "desktop");
    const h1 = funnelTypographyDefaults("h1", tokens);
    expect(h1).toMatchObject({ fontSize: "48px", fontWeight: 800, lineHeight: 1.2, color: "#1e3a8a", margin: 0 });
    expect(h1.fontFamily).toContain("Noto Serif TC");
    expect(funnelTypographyDefaults("h2", desktop).color).toBe(settings.typography.textColor);
  });

  it("內文、引言、小字、眉標與清單依頁面字級計算", () => {
    const tokens = resolveFunnelTypography({ typography: { ...settings.typography, bodySize: 18, bodyLineHeight: 1.8 } }, "desktop");
    expect(funnelTypographyDefaults("body", tokens)).toMatchObject({ fontSize: "18px", lineHeight: 1.8, fontWeight: 400 });
    expect(funnelTypographyDefaults("lead", tokens)).toMatchObject({ fontSize: "22.5px" });
    expect(funnelTypographyDefaults("small", tokens)).toMatchObject({ fontSize: "15.75px" });
    expect(funnelTypographyDefaults("eyebrow", tokens)).toMatchObject({ fontWeight: 700, textTransform: "uppercase", color: tokens.linkColor });
    expect(funnelTypographyDefaults("list", tokens)).toMatchObject({ fontSize: "18px", lineHeight: 1.8 });
    expect(funnelHeadingSize("h1", tokens)).toBe(54);
  });

  it("手機版內文最多 18px，頁面字級越大標題同步放大", () => {
    const large = { typography: { ...settings.typography, bodySize: 22 } };
    expect(resolveFunnelTypography(large, "mobile").baseSize).toBe(18);
    expect(resolveFunnelTypography(large, "desktop").baseSize).toBe(22);
    expect(funnelHeadingSize("h1", resolveFunnelTypography(large, "desktop"))).toBe(66);
  });

  it("按鈕預設至少 16px 粗體並有足夠點擊高度", () => {
    expect(funnelTypographyDefaults("button", resolveFunnelTypography({ typography: { ...settings.typography, bodySize: 14 } }, "desktop"))).toMatchObject({ fontSize: "16px", fontWeight: 700 });
    expect(Number(funnelButtonDefaults(desktop).minHeight)).toBeGreaterThanOrEqual(44);
    expect(Number(funnelButtonDefaults(mobile).minHeight)).toBeGreaterThanOrEqual(44);
    expect(funnelContrastRatio(String(funnelButtonDefaults(desktop).color), String(funnelButtonDefaults(desktop).backgroundColor))).toBeGreaterThanOrEqual(4.5);
  });

  it("節點依型別與 props 對應到字體角色", () => {
    expect(funnelTypographyKind({ type: "headline" }, { level: "h3" })).toBe("h3");
    expect(funnelTypographyKind({ type: "headline" }, { level: "bogus" })).toBe("h2");
    expect(funnelTypographyKind({ type: "text" }, {})).toBe("body");
    expect(funnelTypographyKind({ type: "text" }, { textStyle: "eyebrow" })).toBe("eyebrow");
    expect(funnelTypographyKind({ type: "bulleted_list" }, {})).toBe("list");
    expect(funnelTypographyKind({ type: "button" }, {})).toBe("button");
    expect(funnelTypographyKind({ type: "image" }, {})).toBeNull();
  });

  it("預設文字與標題顏色在白底達 WCAG AA", () => {
    expect(funnelContrastRatio(desktop.textColor, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(funnelContrastRatio(desktop.headingColor, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(funnelContrastRatio(desktop.linkColor, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(funnelContrastRatio("white", "black")).toBe(21);
    expect(funnelContrastRatio("transparent", "white")).toBeNull();
  });
});
