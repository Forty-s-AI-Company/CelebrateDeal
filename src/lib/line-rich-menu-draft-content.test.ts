import { describe,expect,it } from "vitest";
import { createRichMenuTemplate } from "./line-rich-menu";
import { parseRichMenuDraftContent,richMenuPublicationLocked,richMenuPublicationView,saveRichMenuDraftContent,type RichMenuPublicationRecord } from "./line-rich-menu-draft-content";
const publication:RichMenuPublicationRecord={attemptId:"a7a1b209-a253-4c55-a3b4-7bed4f458e47",status:"synced",fingerprint:"a".repeat(64),accountId:"synthetic-account",accountVersion:"b".repeat(64),sourceRevision:1,startedAt:"2026-10-16T01:00:00.000Z",expiresAt:"2026-10-16T01:02:00.000Z",stage:"confirm",remoteMenuId:`richmenu-${"c".repeat(32)}`,previousMenuId:null,previousDefaultKnown:true,confirmedAt:"2026-10-16T01:00:30.000Z",links:{live_url:"https://example.test/live/synthetic"}};
describe("Rich Menu draft compatibility and public state",()=>{
 it("reads old raw JSON and new publication records without changing the menu",()=>{
  const menu=createRichMenuTemplate("minimal-4");expect(parseRichMenuDraftContent(menu)).toEqual({version:1,menu,publication:null});
  expect(parseRichMenuDraftContent({version:1,menu,publication})).toEqual({version:1,menu,publication});
  expect(saveRichMenuDraftContent(menu,null)).toEqual(menu);
 });
 it("marks edits outdated and preserves history while withholding internal account/resource data",()=>{
  const saved=saveRichMenuDraftContent(createRichMenuTemplate("minimal-4"),publication);
  expect(parseRichMenuDraftContent(saved)?.publication?.status).toBe("outdated");
  const view=richMenuPublicationView(publication);expect(view).toEqual({status:"synced",confirmedAt:publication.confirmedAt,expiresAt:publication.expiresAt,links:publication.links});
  expect(JSON.stringify(view)).not.toContain(publication.accountVersion);expect(JSON.stringify(view)).not.toContain(publication.remoteMenuId);
 });
 it("locks unknown and running outcomes, and rejects malformed stored state instead of replacing it",()=>{
  expect(richMenuPublicationLocked({...publication,status:"uncertain"})).toBe(true);expect(richMenuPublicationLocked({...publication,status:"syncing"})).toBe(true);expect(richMenuPublicationLocked(publication)).toBe(false);
  expect(parseRichMenuDraftContent({version:1,menu:createRichMenuTemplate("minimal-4"),publication:{...publication,remoteMenuId:"foreign/unbounded"}})).toBeNull();
 });
});
