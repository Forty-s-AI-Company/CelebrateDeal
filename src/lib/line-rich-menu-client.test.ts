import { describe, expect, it, vi } from "vitest";
import { createRichMenuTemplate } from "./line-rich-menu";
import { LineFetchRichMenuClient } from "./line-rich-menu-client";

const id=`richmenu-${"a".repeat(32)}`;
function menu() {
  const result=createRichMenuTemplate("minimal-4");
  for(const area of result.areas) area.action={type:"uri",label:area.action.label,uri:"https://example.test/synthetic"};
  return result;
}
describe("fixed-host Rich Menu provider adapter", () => {
  it("uses the correct create, binary image, default and cleanup endpoints with redirects disabled", async () => {
    const fetchImpl=vi.fn().mockResolvedValueOnce(Response.json({richMenuId:id})).mockResolvedValueOnce(new Response(null,{status:200})).mockResolvedValueOnce(Response.json({richMenuId:id})).mockResolvedValue(new Response(null,{status:200}));
    const client=new LineFetchRichMenuClient("synthetic-offline-value",fetchImpl);
    expect(await client.create(menu())).toBe(id);
    await client.uploadImage(id,new Uint8Array([1,2,3]),"image/png");
    expect(await client.getDefault()).toBe(id);await client.setDefault(id);await client.setDefault(null);await client.delete(id);
    expect(fetchImpl.mock.calls.map(call=>call[0])).toEqual([
      "https://api.line.me/v2/bot/richmenu",`https://api-data.line.me/v2/bot/richmenu/${id}/content`,
      "https://api.line.me/v2/bot/user/all/richmenu",`https://api.line.me/v2/bot/user/all/richmenu/${id}`,
      "https://api.line.me/v2/bot/user/all/richmenu",`https://api.line.me/v2/bot/richmenu/${id}`,
    ]);
    expect(fetchImpl.mock.calls[1][1].body).toEqual(new Uint8Array([1,2,3]));
    expect(fetchImpl.mock.calls.every(call=>call[1].redirect==="error")).toBe(true);
    expect(fetchImpl.mock.calls[4][1].method).toBe("DELETE");
  });
  it("treats absent defaults and already-deleted owned artifacts as absent", async () => {
    const client=new LineFetchRichMenuClient("synthetic-offline-value",vi.fn().mockResolvedValue(new Response(null,{status:404})));
    expect(await client.getDefault()).toBeNull();await expect(client.delete(id)).resolves.toBeUndefined();
  });
  it("rejects unresolved placeholders and malformed remote references before any fetch", async () => {
    const fetchImpl=vi.fn();const client=new LineFetchRichMenuClient("synthetic-offline-value",fetchImpl);
    await expect(client.create(createRichMenuTemplate("minimal-4"))).rejects.toThrow("links must be resolved");
    await expect(client.setDefault("../../other-account")).rejects.toThrow("Invalid LINE rich menu reference");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("returns fixed failures without provider response bodies or network diagnostics", async () => {
    const client=new LineFetchRichMenuClient("synthetic-offline-value",vi.fn().mockResolvedValue(new Response("private-provider-detail",{status:500})));
    await expect(client.create(menu())).rejects.toThrow("LINE rich menu create failed.");
    const offline=new LineFetchRichMenuClient("synthetic-offline-value",vi.fn().mockRejectedValue(new Error("private-network-detail")));
    await expect(offline.getDefault()).rejects.toThrow("LINE rich menu read_default failed.");
    const malformed=new LineFetchRichMenuClient("synthetic-offline-value",vi.fn().mockResolvedValue(Response.json({richMenuId:"unexpected"})));
    await expect(malformed.create(menu())).rejects.toThrow("LINE rich menu create failed.");
  });
});
