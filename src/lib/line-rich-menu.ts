import { z } from "zod";

export const LINE_RICH_MENU_API = "https://api.line.me/v2/bot";
export const LINE_RICH_MENU_DATA_API = "https://api-data.line.me/v2/bot";
export const RICH_MENU_SIZES = {
  large: { width: 2500, height: 1686 },
  small: { width: 2500, height: 843 },
} as const;

const BoundsSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).strict();
const RichMenuUriSchema = z.string().max(1000).refine((value) => {
  if (/^\{\{(?:live_url|consultation_url|portal_url|voucher_url)\}\}$/.test(value)) return true;
  try { return ["http:", "https:", "line:", "tel:"].includes(new URL(value).protocol); } catch { return false; }
}, "URI must use http, https, line or tel, or be an approved placeholder");
const ActionSchema = z.object({
  type: z.enum(["uri", "message", "postback"]),
  label: z.string().min(1).max(20),
  uri: RichMenuUriSchema.optional(),
  text: z.string().min(1).max(300).optional(),
  data: z.string().min(1).max(300).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.type === "uri" && !value.uri) ctx.addIssue({ code: "custom", path: ["uri"], message: "URI action requires uri" });
  if (value.type === "message" && !value.text) ctx.addIssue({ code: "custom", path: ["text"], message: "Message action requires text" });
  if (value.type === "postback" && !value.data) ctx.addIssue({ code: "custom", path: ["data"], message: "Postback action requires data" });
});
export const LineRichMenuAreaSchema = z.object({ bounds: BoundsSchema, action: ActionSchema }).strict();
export const LineRichMenuSizeSchema = z.object({ width: z.literal(2500), height: z.union([z.literal(1686), z.literal(843)]) }).strict();
export const LineRichMenuSchema = z.object({
  size: LineRichMenuSizeSchema,
  selected: z.boolean(),
  name: z.string().min(1).max(300),
  chatBarText: z.string().min(1).max(14),
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

export function replaceRichMenuPlaceholders(menu: LineRichMenu, urls: { live_url: string; consultation_url: string; portal_url: string; voucher_url: string }): LineRichMenu {
  const validUrls = Object.values(urls);
  if (validUrls.some((url) => !z.string().url().safeParse(url).success)) throw new TypeError("Rich menu URLs must be absolute URLs");
  const replace = (value: string): string => value.replace(/\{\{(live_url|consultation_url|portal_url|voucher_url)\}\}/g, (_, key: keyof typeof urls) => urls[key]);
  return LineRichMenuSchema.parse({ ...menu, areas: menu.areas.map((area) => ({ ...area, action: { ...area.action, ...(area.action.uri ? { uri: replace(area.action.uri) } : {}), ...(area.action.text ? { text: replace(area.action.text) } : {}), ...(area.action.data ? { data: replace(area.action.data) } : {}) } })) });
}

const action = (label: string, uri: string): LineRichMenuAction => ({ type: "uri", label, uri });
export function createRichMenuTemplate(type: LineRichMenuTemplateType, urls?: Partial<{ live_url: string; consultation_url: string; portal_url: string; voucher_url: string }>): LineRichMenu {
  const isSix = type === "golden-6";
  const columns = isSix ? 3 : 2;
  const labels: Array<readonly [string, string]> = isSix ? [["進入直播", "{{live_url}}"], ["專屬優惠券", "{{voucher_url}}"], ["預約 1 對 1", "{{consultation_url}}"], ["學員會員中心", "{{portal_url}}"], ["課程大綱", "{{portal_url}}"], ["真人客服", "{{consultation_url}}"]] : [["立即上課", "{{live_url}}"], ["預約諮詢", "{{consultation_url}}"], ["專屬優惠", "{{voucher_url}}"], ["助教客服", "{{consultation_url}}"]];
  const width = Math.floor(2500 / columns);
  const height = Math.floor(1686 / (isSix ? 2 : 2));
  const menu: LineRichMenu = { size: { width: 2500, height: 1686 }, selected: true, name: isSix ? "銷講全鏈路 6 格黃金版型" : "極簡 4 格版型", chatBarText: "開啟選單", areas: labels.map(([label, uri], i) => ({ bounds: { x: (i % columns) * width, y: Math.floor(i / columns) * height, width: i % columns === columns - 1 ? 2500 - (columns - 1) * width : width, height }, action: action(label, uri) })) };
  if (urls && Object.keys(urls).length === 4) return replaceRichMenuPlaceholders(menu, urls as { live_url: string; consultation_url: string; portal_url: string; voucher_url: string });
  return menu;
}

/** Generates a deterministic SVG buffer; LINE accepts PNG/JPEG for upload, while callers may rasterize this safely. */
export function generateRichMenuSvg(menu: LineRichMenu): Buffer {
  const colors = ["#111827", "#1e3a8a", "#7c2d12", "#14532d", "#581c87", "#164e63"];
  const rects = menu.areas.map((area, i) => `<rect x="${area.bounds.x}" y="${area.bounds.y}" width="${area.bounds.width}" height="${area.bounds.height}" fill="${colors[i % colors.length]}" stroke="#f8fafc" stroke-width="8"/><text x="${area.bounds.x + area.bounds.width / 2}" y="${area.bounds.y + area.bounds.height / 2}" fill="#fff" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="72">${escapeXml(area.action.label)}</text>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${menu.size.width}" height="${menu.size.height}" viewBox="0 0 ${menu.size.width} ${menu.size.height}"><rect width="100%" height="100%" fill="#030712"/>${rects}</svg>`);
}
function escapeXml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char); }

export interface LineRichMenuFetchOptions { fetchImpl?: typeof fetch; endpoint?: string; dataEndpoint?: string; }
function requestOptions(options?: LineRichMenuFetchOptions): { fetchImpl: typeof fetch; endpoint: string } { return { fetchImpl: options?.fetchImpl ?? fetch, endpoint: options?.endpoint ?? LINE_RICH_MENU_API }; }
async function lineRequest<T>(accessToken: string, path: string, init: RequestInit, options?: LineRichMenuFetchOptions): Promise<T> {
  if (!accessToken.trim()) throw new TypeError("LINE access token is required");
  const { fetchImpl, endpoint } = requestOptions(options);
  const response = await fetchImpl(`${endpoint}${path}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`LINE Rich Menu API request failed (HTTP ${response.status})`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export async function createLineRichMenu(accessToken: string, menuData: LineRichMenu, options?: LineRichMenuFetchOptions): Promise<{ richMenuId: string }> { return lineRequest(accessToken, "/richmenu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(LineRichMenuSchema.parse(menuData)) }, options); }
export async function uploadLineRichMenuImage(accessToken: string, richMenuId: string, imageBuffer: Buffer, contentType = "image/png", options?: LineRichMenuFetchOptions): Promise<void> {
  if (!["image/png", "image/jpeg"].includes(contentType) || imageBuffer.byteLength > 1024 * 1024) throw new TypeError("LINE rich menu image must be a PNG/JPEG up to 1 MB");
  const body = imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength) as ArrayBuffer;
  await lineRequest(accessToken, `/richmenu/${encodeURIComponent(richMenuId)}/content`, { method: "POST", headers: { "Content-Type": contentType }, body }, { ...options, endpoint: options?.dataEndpoint ?? (options?.endpoint ? options.endpoint : LINE_RICH_MENU_DATA_API) });
}
export async function setDefaultLineRichMenu(accessToken: string, richMenuId: string, options?: LineRichMenuFetchOptions): Promise<void> { await lineRequest(accessToken, `/user/all/richmenu/${encodeURIComponent(richMenuId)}`, { method: "POST" }, options); }
export async function clearDefaultLineRichMenu(accessToken: string, options?: LineRichMenuFetchOptions): Promise<void> { await lineRequest(accessToken, "/user/all/richmenu", { method: "DELETE" }, options); }
export async function linkUserLineRichMenu(accessToken: string, lineUserId: string, richMenuId: string, options?: LineRichMenuFetchOptions): Promise<void> { await lineRequest(accessToken, `/user/${encodeURIComponent(lineUserId)}/richmenu/${encodeURIComponent(richMenuId)}`, { method: "POST" }, options); }
export async function deleteLineRichMenu(accessToken: string, richMenuId: string, options?: LineRichMenuFetchOptions): Promise<void> { await lineRequest(accessToken, `/richmenu/${encodeURIComponent(richMenuId)}`, { method: "DELETE" }, options); }
export async function listLineRichMenus(accessToken: string, options?: LineRichMenuFetchOptions): Promise<{ richmenus: Array<Record<string, unknown>> }> { return lineRequest(accessToken, "/richmenu/list", { method: "GET" }, options); }

export class MockLineRichMenuAdapter {
  readonly calls: Array<{ method: string; path: string; body?: unknown }> = [];
  private readonly menus = new Map<string, LineRichMenu>();
  private sequence = 0;
  async create(menu: LineRichMenu): Promise<{ richMenuId: string }> { const id = `mock-richmenu-${++this.sequence}`; this.menus.set(id, menu); this.calls.push({ method: "POST", path: "/richmenu", body: menu }); return { richMenuId: id }; }
  async upload(id: string, image: Buffer): Promise<void> { if (!this.menus.has(id)) throw new Error("Rich menu not found"); this.calls.push({ method: "POST", path: `/richmenu/${id}/content`, body: image }); }
  async setDefault(id: string): Promise<void> { if (!this.menus.has(id)) throw new Error("Rich menu not found"); this.calls.push({ method: "POST", path: `/user/all/richmenu/${id}` }); }
  async linkUser(userId: string, id: string): Promise<void> { if (!this.menus.has(id)) throw new Error("Rich menu not found"); this.calls.push({ method: "POST", path: `/user/${userId}/richmenu/${id}` }); }
  async delete(id: string): Promise<void> { this.menus.delete(id); this.calls.push({ method: "DELETE", path: `/richmenu/${id}` }); }
  list(): Array<{ richMenuId: string; name: string }> { return [...this.menus].map(([richMenuId, menu]) => ({ richMenuId, name: menu.name })); }
}
