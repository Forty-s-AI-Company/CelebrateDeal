import { describe, expect, it, vi } from "vitest";
import {
  MockLineRichMenuAdapter,
  LineRichMenuSchema,
  createLineRichMenu,
  clearDefaultLineRichMenu,
  createRichMenuTemplate,
  deleteLineRichMenu,
  generateRichMenuSvg,
  linkUserLineRichMenu,
  listLineRichMenus,
  replaceRichMenuPlaceholders,
  setDefaultLineRichMenu,
  uploadLineRichMenuImage,
} from "./line-rich-menu";

const urls = { live_url: "https://example.com/live", consultation_url: "https://example.com/book", portal_url: "https://example.com/portal", voucher_url: "https://example.com/voucher" };

describe("LINE Rich Menu schema and templates", () => {
  it("creates valid, non-overlapping 6 and 4 grid templates", () => {
    for (const type of ["golden-6", "minimal-4"] as const) {
      const menu = createRichMenuTemplate(type);
      expect(LineRichMenuSchema.safeParse(menu).success).toBe(true);
      expect(menu.areas).toHaveLength(type === "golden-6" ? 6 : 4);
    }
  });

  it("rejects overlapping or out-of-bounds areas", () => {
    const menu = createRichMenuTemplate("minimal-4");
    menu.areas[1].bounds.x = 0;
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(false);
    menu.areas[1].bounds.x = 1250;
    menu.areas[0].bounds.width = 2600;
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(false);
  });

  it("replaces all approved URL placeholders", () => {
    const menu = replaceRichMenuPlaceholders(createRichMenuTemplate("golden-6"), urls);
    expect(menu.areas.map((area) => area.action.uri)).toEqual(expect.arrayContaining(Object.values(urls)));
  });

  it("generates deterministic escaped SVG artwork", () => {
    const menu = createRichMenuTemplate("minimal-4");
    const a = generateRichMenuSvg(menu);
    const b = generateRichMenuSvg(menu);
    expect(a.equals(b)).toBe(true);
    expect(a.toString()).toContain('width="2500"');
  });
});

describe("LINE Rich Menu API", () => {
  it("calls the documented endpoints without using the real endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/richmenu")) return new Response(JSON.stringify({ richMenuId: "rm_1" }), { status: 200 });
      if (url.endsWith("/richmenu/list")) return new Response(JSON.stringify({ richmenus: [] }), { status: 200 });
      return new Response(null, { status: 204 });
    });
    const options = { fetchImpl, endpoint: "https://mock.line.test/v2/bot" };
    const menu = createRichMenuTemplate("minimal-4");
    expect(await createLineRichMenu("token", menu, options)).toEqual({ richMenuId: "rm_1" });
    await uploadLineRichMenuImage("token", "rm_1", Buffer.from("png"), "image/png", options);
    await setDefaultLineRichMenu("token", "rm_1", options);
    await clearDefaultLineRichMenu("token", options);
    await linkUserLineRichMenu("token", "U1", "rm_1", options);
    expect(await listLineRichMenus("token", options)).toEqual({ richmenus: [] });
    await deleteLineRichMenu("token", "rm_1", options);
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(fetchImpl).toHaveBeenCalledWith("https://mock.line.test/v2/bot/user/U1/richmenu/rm_1", expect.objectContaining({ method: "POST" }));
  });

  it("rejects unsafe URI schemes and provider labels over 20 characters", () => {
    const menu = createRichMenuTemplate("minimal-4");
    menu.areas[0]!.action.uri = "javascript:alert(1)";
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(false);
    menu.areas[0]!.action.uri = "https://example.com";
    menu.areas[0]!.action.label = "x".repeat(21);
    expect(LineRichMenuSchema.safeParse(menu).success).toBe(false);
  });

  it("uses LINE's data endpoint for image uploads and rejects unsupported images", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await uploadLineRichMenuImage("token", "rm_1", Buffer.from("png"), "image/png", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith("https://api-data.line.me/v2/bot/richmenu/rm_1/content", expect.anything());
    await expect(uploadLineRichMenuImage("token", "rm_1", Buffer.from("svg"), "image/svg+xml", { fetchImpl })).rejects.toThrow("PNG/JPEG");
  });
});

describe("deterministic mock adapter", () => {
  it("stores menus and records lifecycle calls without network", async () => {
    const adapter = new MockLineRichMenuAdapter();
    const { richMenuId } = await adapter.create(createRichMenuTemplate("minimal-4"));
    await adapter.upload(richMenuId, Buffer.from("image"));
    await adapter.setDefault(richMenuId);
    await adapter.linkUser("U1", richMenuId);
    expect(adapter.list()).toHaveLength(1);
    await adapter.delete(richMenuId);
    expect(adapter.list()).toHaveLength(0);
    expect(adapter.calls.map((call) => call.method)).toEqual(["POST", "POST", "POST", "POST", "DELETE"]);
  });
});
