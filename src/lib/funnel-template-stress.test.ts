import { describe, expect, it } from "vitest";
import { parsePageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { FUNNEL_TEMPLATE_GALLERY, previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import { STRESS_EN_SPEAKER_NAME, STRESS_LONG_TOKEN, STRESS_TESTIMONIAL_TEXT, STRESS_ZH_SPEAKER_NAME, stressFunnelDocument } from "./funnel-template-stress";

const node = (id: string, type: FunnelNode["type"], props: Record<string, unknown>, children?: FunnelNode[]): FunnelNode => ({ schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}) } as FunnelNode);
function doc(root: FunnelNode[]): PageDocument {
  const parsed = parsePageDocument({ schemaVersion: 1, id: "stress", name: "t", revision: 0, root, popups: [], settings: {} });
  if (!parsed) throw new Error("fixture invalid");
  return parsed;
}
const flat = (nodes: FunnelNode[]): FunnelNode[] => nodes.flatMap((item) => [item, ...(item.children ? flat(item.children) : [])]);

describe("stressFunnelDocument", () => {
  const original = doc([node("sec", "section", {}, [node("row1", "row", {}, [node("box", "content_box", {}, [
    node("h", "headline", { text: "報名免費講座" }),
    node("t1", "text", { text: "第一段文字" }),
    node("t2", "text", { text: "第二段文字" }),
    node("b", "button", { label: "立即報名" }),
    node("sp", "speaker_profiles", { items: [{ name: "王小明", title: "講師" }, { name: "李小華" }, { name: "張三" }] }),
    node("il", "icon_list", { items: [{ title: "a", text: "b" }] }),
    node("ag", "agenda_timeline", { items: [{ time: "19:00", title: "開場" }, { time: "19:30", title: "主題" }] }),
    node("st", "stats", { items: [{ value: "100", label: "x" }, { value: "5", label: "y" }, { value: "7", label: "z" }] }),
    node("tw", "testimonial_wall", { items: [{ name: "A", text: "好" }, { name: "B", text: "棒" }] }),
    node("zz", "horizontal_line", { weird: 1 }),
  ])])])]);
  const stressed = stressFunnelDocument(original);
  const byId = (id: string) => flat(stressed.root).find((item) => item.id === id)!;

  it("keeps ids, structure and validity", () => {
    expect(flat(stressed.root).map((item) => [item.id, item.type])).toEqual(flat(original.root).map((item) => [item.id, item.type]));
    expect(parsePageDocument(stressed)).not.toBeNull();
  });

  it("lengthens headline and button by 1.5x", () => {
    expect(byId("h").props.text).toBe("報名免費講座報名免");
    expect(String(byId("b").props.label).length).toBe(6);
  });

  it("inserts the 60 char token only in the first text node", () => {
    expect(STRESS_LONG_TOKEN).toHaveLength(60);
    expect(STRESS_LONG_TOKEN).not.toMatch(/\s/u);
    expect(String(byId("t1").props.text)).toContain(STRESS_LONG_TOKEN);
    expect(String(byId("t2").props.text)).not.toContain(STRESS_LONG_TOKEN);
  });

  it("alternates speaker names", () => {
    expect(STRESS_ZH_SPEAKER_NAME).toHaveLength(12);
    expect((byId("sp").props.items as Array<{ name: string }>).map((item) => item.name)).toEqual([STRESS_ZH_SPEAKER_NAME, STRESS_EN_SPEAKER_NAME, STRESS_ZH_SPEAKER_NAME]);
  });

  it("pads lists to 8, rewrites stats and testimonials", () => {
    expect(byId("il").props.items).toHaveLength(8);
    expect(byId("ag").props.items).toHaveLength(8);
    const stats = byId("st").props.items as Array<Record<string, unknown>>;
    expect(stats[0]).toMatchObject({ value: "1280000", prefix: "NT$" });
    expect(stats[1]).toMatchObject({ value: "12345", suffix: "+" });
    expect(stats[2]).toMatchObject({ value: "7" });
    expect(STRESS_TESTIMONIAL_TEXT).toHaveLength(300);
    expect((byId("tw").props.items as Array<{ text: string }>).every((item) => item.text === STRESS_TESTIMONIAL_TEXT)).toBe(true);
  });

  it("leaves unknown nodes untouched and does not mutate the input", () => {
    expect(byId("zz").props).toEqual({ weird: 1 });
    expect(flat(original.root).find((item) => item.id === "h")!.props.text).toBe("報名免費講座");
  });

  it("produces valid documents for every gallery template", () => {
    for (const item of FUNNEL_TEMPLATE_GALLERY) {
      const result = stressFunnelDocument(previewFunnelTemplate(item.id));
      expect(parsePageDocument(result), item.id).not.toBeNull();
    }
  });
});
