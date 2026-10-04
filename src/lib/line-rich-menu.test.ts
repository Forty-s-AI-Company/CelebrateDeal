import { describe, expect, it } from "vitest";
import { createRichMenuTemplate, LineRichMenuSchema } from "./line-rich-menu";

describe("LINE draft menu contract recovered from PR #210", () => {
  it.each(["golden-6", "minimal-4"] as const)("builds a complete non-overlapping %s template", (type) => {
    const menu = createRichMenuTemplate(type);
    expect(LineRichMenuSchema.parse(menu)).toEqual(menu);
    expect(menu.areas).toHaveLength(type === "golden-6" ? 6 : 4);
    expect(menu.areas.reduce((sum, { bounds }) => sum + bounds.width * bounds.height, 0)).toBe(2500 * 1686);
  });
  it("rejects overlaps and out-of-bounds areas", () => {
    const menu = createRichMenuTemplate("minimal-4");
    menu.areas[1]!.bounds.x = 0;
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(false);
    menu.areas[1]!.bounds.x = 1250;
    menu.areas[0]!.bounds.width = 2600;
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(false);
  });
  it.each(["javascript:alert(1)", "data:text/html,test", "ftp://example.test", "https://user:pass@example.test", "{{unknown}}", "", "  "])("rejects unsafe or unknown URI %s", (uri) => {
    const menu = createRichMenuTemplate("minimal-4");
    menu.areas[0]!.action = { type: "uri", label: "連結", uri };
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(false);
  });
  it.each(["https://example.test", "http://example.test", "line://app/123", "tel:+88612345678", "{{live_url}}", "{{portal_url}}", "{{consultation_url}}", "{{voucher_url}}"])("accepts supported URI %s", (uri) => {
    const menu = createRichMenuTemplate("minimal-4");
    menu.areas[0]!.action = { type: "uri", label: "連結", uri };
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(true);
  });
  it("validates the payload belonging to each action type and rejects extraneous fields", () => {
    const menu = createRichMenuTemplate("minimal-4");
    menu.areas[0]!.action = { type: "message", label: "訊息", text: "你好" };
    menu.areas[1]!.action = { type: "postback", label: "服務", data: "request=help" };
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(true);
    expect(LineRichMenuSchema.safeParse({ ...menu, areas: [{ ...menu.areas[0], action: { ...menu.areas[0]!.action, uri: "https://example.test" } }] }).success).toBe(false);
    expect(LineRichMenuSchema.safeParse({ ...menu, areas: [{ ...menu.areas[0], action: { type: "uri", label: "無網址" } }] }).success).toBe(false);
  });
  it("bounds text, coordinates, area count and canvas dimensions", () => {
    const menu = createRichMenuTemplate("minimal-4");
    for (const patch of [{ name: " " }, { name: "x".repeat(301) }, { chatBarText: "x".repeat(15) }, { areas: [] }, { areas: Array(21).fill(menu.areas[0]) }, { size: { width: 100, height: 843 } }]) {
      expect(LineRichMenuSchema.safeParse({ ...menu, ...patch }).success).toBe(false);
    }
    for (const bounds of [{ x: -1 }, { y: 0.5 }, { width: 0 }, { height: 0 }]) {
      expect(LineRichMenuSchema.safeParse({ ...menu, areas: [{ ...menu.areas[0], bounds: { ...menu.areas[0]!.bounds, ...bounds } }] }).success).toBe(false);
    }
    menu.areas[0]!.action.label = "x".repeat(21);
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(false);
  });
});
