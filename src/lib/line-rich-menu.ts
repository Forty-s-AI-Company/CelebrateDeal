import { z } from "zod";

export const RICH_MENU_SIZES = {
  large: { width: 2500, height: 1686 },
  small: { width: 2500, height: 843 },
} as const;

const BoundsSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict();
const RichMenuUriSchema = z.string().trim().min(1).max(1000).refine((value) => {
  if (/^\{\{(?:live_url|consultation_url|portal_url|voucher_url)\}\}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:", "line:", "tel:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, "URI must use http, https, line or tel, or be an approved placeholder");
const label = z.string().trim().min(1).max(20);
const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uri"), label, uri: RichMenuUriSchema }).strict(),
  z.object({ type: z.literal("message"), label, text: z.string().trim().min(1).max(300) }).strict(),
  z.object({ type: z.literal("postback"), label, data: z.string().trim().min(1).max(300) }).strict(),
]);
export const LineRichMenuAreaSchema = z.object({ bounds: BoundsSchema, action: ActionSchema }).strict();
export const LineRichMenuSizeSchema = z.object({ width: z.literal(2500), height: z.union([z.literal(1686), z.literal(843)]) }).strict();
export const LineRichMenuSchema = z.object({
  size: LineRichMenuSizeSchema,
  selected: z.boolean(),
  name: z.string().trim().min(1).max(300),
  chatBarText: z.string().trim().min(1).max(14),
  areas: z.array(LineRichMenuAreaSchema).min(1).max(20),
}).strict().superRefine((menu, ctx) => {
  const overlaps = validateRichMenuAreas(menu.size, menu.areas);
  for (const index of overlaps) ctx.addIssue({ code: "custom", path: ["areas", index], message: "Rich menu areas overlap or exceed the image bounds" });
});
export type LineRichMenu = z.infer<typeof LineRichMenuSchema>;
export type LineRichMenuArea = z.infer<typeof LineRichMenuAreaSchema>;
export type LineRichMenuAction = z.infer<typeof ActionSchema>;
export type LineRichMenuTemplateType = "golden-6" | "minimal-4";

function validateRichMenuAreas(size: LineRichMenu["size"], areas: readonly LineRichMenuArea[]): number[] {
  const invalid = new Set<number>();
  for (let i = 0; i < areas.length; i += 1) {
    const a = areas[i]!.bounds;
    if (a.x + a.width > size.width || a.y + a.height > size.height) invalid.add(i);
    for (let j = i + 1; j < areas.length; j += 1) {
      const b = areas[j]!.bounds;
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) { invalid.add(i); invalid.add(j); }
    }
  }
  return [...invalid];
}

const action = (label: string, uri: string): LineRichMenuAction => ({ type: "uri", label, uri });
export function createRichMenuTemplate(type: LineRichMenuTemplateType): LineRichMenu {
  const isSix = type === "golden-6";
  const columns = isSix ? 3 : 2;
  const labels: Array<readonly [string, string]> = isSix ? [["進入直播", "{{live_url}}"], ["專屬優惠券", "{{voucher_url}}"], ["預約 1 對 1", "{{consultation_url}}"], ["學員會員中心", "{{portal_url}}"], ["課程大綱", "{{portal_url}}"], ["真人客服", "{{consultation_url}}"]] : [["立即上課", "{{live_url}}"], ["預約諮詢", "{{consultation_url}}"], ["專屬優惠", "{{voucher_url}}"], ["助教客服", "{{consultation_url}}"]];
  const width = Math.floor(2500 / columns);
  const height = 843;
  const menu: LineRichMenu = { size: { width: 2500, height: 1686 }, selected: true, name: isSix ? "銷講全鏈路 6 格黃金版型" : "極簡 4 格版型", chatBarText: "開啟選單", areas: labels.map(([label, uri], i) => ({ bounds: { x: (i % columns) * width, y: Math.floor(i / columns) * height, width: i % columns === columns - 1 ? 2500 - (columns - 1) * width : width, height }, action: action(label, uri) })) };
  return menu;
}
