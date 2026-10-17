import { LineRichMenuSchema, type LineRichMenu } from "@/lib/line-rich-menu";

export interface LineRichMenuClient {
  create(menu: LineRichMenu): Promise<string>;
  uploadImage(id: string, bytes: Uint8Array, contentType: "image/png" | "image/jpeg"): Promise<void>;
  getDefault(): Promise<string | null>;
  setDefault(id: string | null): Promise<void>;
  delete(id: string): Promise<void>;
}

type Stage = "create" | "upload" | "read_default" | "set_default" | "delete";
export class LineRichMenuError extends Error {
  constructor(readonly stage: Stage, readonly status?: number) { super(`LINE rich menu ${stage} failed.`);this.name = "LineRichMenuError"; }
}
const idPattern = /^richmenu-[a-f0-9]{32}$/u;
function checkedId(id: string) {
  if (!idPattern.test(id)) throw new TypeError("Invalid LINE rich menu reference.");
  return id;
}

/** Official fixed hosts only; injectable fetch is for owned offline/Sandbox tests. */
export class LineFetchRichMenuClient implements LineRichMenuClient {
  constructor(private readonly providerValue: string, private readonly fetchImpl: typeof fetch = fetch) {
    if (!providerValue.trim()) throw new TypeError("LINE provider configuration is required.");
  }

  private async request(stage: Stage, host: "api.line.me" | "api-data.line.me", path: string, method: string, body?: BodyInit, contentType?: string) {
    try {
      return await this.fetchImpl(`https://${host}/v2/bot/${path}`, {
        method, headers: { Authorization: `Bearer ${this.providerValue}`, ...(contentType ? { "Content-Type": contentType } : {}) },
        body, signal: AbortSignal.timeout(10_000), redirect: "error",
      });
    } catch { throw new LineRichMenuError(stage); }
  }

  async create(input: LineRichMenu) {
    const menu = LineRichMenuSchema.parse(input);
    if (menu.areas.some(area => area.action.type === "uri" && /\{\{|\}\}/u.test(area.action.uri))) throw new TypeError("Rich menu links must be resolved.");
    const response = await this.request("create", "api.line.me", "richmenu", "POST", JSON.stringify(menu), "application/json");
    if (!response.ok) throw new LineRichMenuError("create", response.status);
    try { const result: unknown = await response.json();if (result && typeof result === "object" && "richMenuId" in result && typeof result.richMenuId === "string") return checkedId(result.richMenuId); }
    catch { /* Never expose a provider response or parsing diagnostics. */ }
    throw new LineRichMenuError("create");
  }

  async uploadImage(id: string, bytes: Uint8Array, contentType: "image/png" | "image/jpeg") {
    const response = await this.request("upload", "api-data.line.me", `richmenu/${checkedId(id)}/content`, "POST", new Uint8Array(bytes), contentType);
    if (!response.ok) throw new LineRichMenuError("upload", response.status);
  }

  async getDefault() {
    const response = await this.request("read_default", "api.line.me", "user/all/richmenu", "GET");
    if (response.status === 404) return null;
    if (!response.ok) throw new LineRichMenuError("read_default", response.status);
    try { const result: unknown = await response.json();if (result && typeof result === "object" && "richMenuId" in result && typeof result.richMenuId === "string") return checkedId(result.richMenuId); }
    catch { /* Fixed failure below; do not forward remote content. */ }
    throw new LineRichMenuError("read_default");
  }

  async setDefault(id: string | null) {
    const path = id === null ? "user/all/richmenu" : `user/all/richmenu/${checkedId(id)}`;
    const response = await this.request("set_default", "api.line.me", path, id === null ? "DELETE" : "POST");
    if (!response.ok) throw new LineRichMenuError("set_default", response.status);
  }

  async delete(id: string) {
    const response = await this.request("delete", "api.line.me", `richmenu/${checkedId(id)}`, "DELETE");
    if (!response.ok && response.status !== 404) throw new LineRichMenuError("delete", response.status);
  }
}
