# G7-02 互動角色／虛擬使用者 checkpoint — 2026-08-08

## 結論

- 狀態：`PASS_LOCAL_DETERMINISTIC_BROWSER_TOOL_BLOCKED`。
- 固定功能 inventory 的「互動角色／虛擬使用者」由 provisional `6/10` 調整為 local-evidence candidate `8/10`；不是 Production acceptance。
- canonical total 維持 `73.5`、delta `0`。Chrome desktop/mobile 尚未通過，不把工具阻擋冒充畫面 PASS。
- 唯讀 reviewer 首輪發現 `0 P0 / 2 P1 / 2 P2`；修復後 re-review 確認四項全部 `CLOSED`，且沒有新的 P0/P1。
- 下一個最高產品價值工作：`G7-03-MEDIA-UPLOAD-AND-LIVE-STUDIO`。

## 實際完成的產品閉環

- 互動角色：官方角色／AI 主持人／系統助手／客服助手、角色庫匯入、名稱、向量頭像、標籤、語氣、啟停、建立／編輯／刪除。
- 修正女性或既有自訂頭像在編輯時被預設男性頭像覆蓋；切換角色類型只在仍使用舊預設標籤時自動換標籤，不覆蓋商家自訂文字。
- 角色與腳本頁在 route identity 改變時用 stable key 重建 client state，避免切換角色／腳本後沿用上一筆未送出的狀態。
- 事件時間軸完整支援 `chat_message`、`reminder`、`product_spotlight`、`cta_switch`；商品與 CTA 不再只是隱藏欄位。
- 草稿儲存與發布分離；建立／編輯 Live 只能新綁 `published` 腳本。legacy draft binding 會在編輯頁警告並於下一次儲存解除，公開頁直接忽略。
- server-side 驗證事件類型、時間、訊息、商品、CTA label、安全 HTTP(S) URL、角色／商品同 vendor 且 active；超量與錯誤時間回到可修正的 `invalid_event`，不再丟未整理 500。
- 複製舊腳本前重新 normalize 並查同 vendor active role/product；不安全 CTA、跨租戶或失效 reference 不會被複製。
- 公開 Live 同時檢查 script `vendorId`、`published` 與 role `vendorId`。不合格資料 fail closed，不會把其他商家的角色名稱、標籤或頭像序列化到前台。
- 前台持續標示「商家預設腳本／預設腳本／腳本推薦」，並明說不代表即時真人留言、真實購買或觀看人數；沒有事件時也明確顯示沒有腳本，不暗示稍後一定出現。
- 角色、腳本、複製、刪除與解除 Live 綁定 audit 現在保存真實 `actorId` 與 member role，不再只有 hard-coded `vendor_manager`。
- 儲存、發布、匯入、複製、刪除與解除綁定提供 pending、disabled、防重送、`aria-busy`、live status；破壞性刪除有明確確認。

## Fresh deterministic evidence

- Vitest：19 files、312 tests PASS、0 failed、0 skipped；exit `0`。
  - UTC：`2026-08-08T01:10:04.6280530Z` 至 `2026-08-08T01:10:18.0945565Z`。
  - 覆蓋角色 normalization、avatar gender、事件 payload、safe CTA、role/script lifecycle、tenant refs、published-only Live、public fail-closed、透明揭露、pending／confirm、頁面 recovery 與 auth audit actor。
- ESLint：19 個相關 production files；exit `0`。
  - UTC：`2026-08-08T01:10:31.0644640Z` 至 `2026-08-08T01:10:38.8747838Z`。
  - 未使用 eslint disable；事件編輯器、播放器與 validator 以函式拆分通過既有 complexity／max-lines 門檻。
- TypeScript：`npx tsc --noEmit`；exit `0`。
  - UTC：`2026-08-08T01:10:45.6167762Z` 至 `2026-08-08T01:10:52.9036972Z`。
- `git diff --check`：exit `0`。
  - UTC：`2026-08-08T01:11:30.4453860Z` 至 `2026-08-08T01:11:30.6548084Z`。
- Machine receipt：`.ai-team/reports/g7-02-interaction-roles-20260808.json`。

## Chrome evidence（不可冒充 PASS）

- 執行者：Codex Terra High；未使用 Sol。
- 安全 loopback：`http://localhost:31023/interaction-roles/new`。
- 結果：`TOOL_BLOCKED`。Chrome page takeover 連續兩次逾時後停止，沒有第三次重試、沒有切換其他 browser、沒有改用 web search。
- 未驗證：desktop/mobile viewport、角色表單互動、腳本事件 UI、公開 Live 實際畫面。
- 未執行任何表單送出、資料建立／刪除、Bombmy 修改、Cookie／Token 讀取或外部 mutation。

## Reviewer findings 與修復

1. `P1` legacy cross-vendor role/script public disclosure：公開頁 script vendor/published 與 role vendor 雙重 fail closed；duplicate 同 vendor active refs；`CLOSED`。
2. `P1` draft script 可由 Live edit 綁到公開頁：edit query、server action、public page 三層 published-only；`CLOSED`。
3. `P2` invalid time／oversized batch throw 500：改為 recoverable `invalid_event` redirect；`CLOSED`。
4. `P2` audit 無法識別真人 operator：新增 manager context，保存 actor ID 與實際 member role；`CLOSED`。

Reviewer 是唯讀分析，未執行測試，因此不列為 test PASS。

## Source digests（SHA-256）

| 檔案 | SHA-256 |
| --- | --- |
| `src/lib/auth.ts` | `3F837AC738A7D990326E671ED234D43209C360725E1FFBECC86296329AC2F721` |
| `src/lib/auth.test.ts` | `29FF8834986172A00BF72C305498391E2BF7438D0EE7E1C56EDF97A298395638` |
| `src/lib/interaction-role.ts` | `45B0A7BFF35573209BBF75D309C8692D04F4E163D47F133AD2D7227754EF2F60` |
| `src/lib/interaction-role.test.ts` | `92687493EF567E65F4A5D4EFE4B0BC438CC7434C9451C5EF0BFB131D11A23702` |
| `src/lib/interaction-event.ts` | `D820D7C64288BB5A65F842644ECA1E3301E543032D3E4BA3EB5C5FD5094846D3` |
| `src/lib/interaction-event.test.ts` | `26925E37EFD6677119B78E60FEB747CD8974A0685296943091328CFFBC903484` |
| `src/components/form-submit-button.tsx` | `2EFE332D42831A4CA34D84DA03576EA1FB8FFB786208893D53E3B1AA8490734A` |
| `src/components/interaction-roles-workbench.tsx` | `A87D1ADF75580D30DBD5BF7FCAFADE3F39E49F3FACD2C7805EED3884C9C6E5AE` |
| `src/components/interaction-script-form.tsx` | `DE8CEA9FAAE80A52C3BBBEDEA11FA79E0461261D9F721CF205C96EDBD7D5E3E9` |
| `src/components/live-playback.tsx` | `234E5DE4CC1AB06C0BA11ED3DB31986868763936829263DCDB4CD3A9BEC2CBA7` |
| `src/app/actions.ts` | `3C38E053012828E3F75C3C3F0808A2C25EAB69171FF4B09E1475CD883A95C976` |
| `src/app/actions.test.ts` | `CC89887B1F1AF29AC19EF296DD2CF84F2D5340CCF90F1250442CEE5B0C8E5B45` |
| `src/app/live/[slug]/page.tsx` | `9577B3E103C6D48B778CFCF1B19A4A20F60B9F10E0BB3B570BAB3C9471B96C26` |
| `src/app/live/[slug]/page.test.tsx` | `B05D3F2EC0D6D9FC9E93D12E7515B2685AA1CF3C0A9BA431787C174E8225D7A2` |
| `src/app/(app)/lives/[id]/edit/page.tsx` | `FB5C99F7BE3161F93B94D5F9E85FBF9557E0E2A2BC4B61C84DCC9291B4ED7EB8` |
| `src/app/(app)/lives/[id]/edit/page.test.tsx` | `BD6F9FCC34068BEF8EA63D27E6AE766A8D74BE131B2ED6B30D910567A2E2DC43` |
| `src/app/(app)/interaction-roles/page.tsx` | `8A9EFF8AE098FB2D676E04EFF5D9F20B97DB7B2B258409145792B5A4E07F4D74` |
| `src/app/(app)/interaction-roles/new/page.tsx` | `82262BF5BE98EDACE4C9D9994FEFAAA00638E35D7DC1E30D5297A0D59E2583E7` |
| `src/app/(app)/interaction-roles/[id]/edit/page.tsx` | `AAC637081CBFE8B8CBDB839E5FFE7C2BE53D308F41908916CB16E7ED6A497AD4` |
| `src/app/(app)/interaction-scripts/page.tsx` | `F054353C94C9EAC7D857E484537078E6754233F81AB0E933931EA1908E7D886B` |
| `src/app/(app)/interaction-scripts/new/page.tsx` | `D1760173EBD26C1E1F4FCE54BDA6BAC16EB6218995440191889CC2C90451696C` |
| `src/app/(app)/interaction-scripts/[id]/edit/page.tsx` | `E34EA3A7DD761A2748D3374F174767F035741F1C439B8BD825D6C6106160240F` |

## Ownership、未執行與人工 blocker

- 起始 dirty worktree 屬使用者／既有 WP，全部 `PRESERVE_ONLY`。加入本 WP evidence 與 sidecar 後，checkpoint 時 469 dirty entries、292 untracked、staged `0`；未 stage、commit、push、merge 或 deploy。
- 本 WP 無 schema 變更，因此未執行 DB migration／disposable PostgreSQL；沒有 DB PASS 宣稱。
- 未執行 production build、global coverage、staging、Sandbox 或 Production；coverage 保持既有門檻且未用它阻擋功能閉環。
- Chrome desktop/mobile acceptance 需待可工作的 Terra High Chrome connection 再做；目前不是需要使用者立刻手動處理的 blocker。
- `impeccable` 的 `PRODUCT.md` 初始化需要真人確認品牌 personality 與 anti-reference；AI 未代填。這不阻擋既有 design system 下的功能閉環。

## 回滾範圍

- 只反向套用本文件列出的 G7-02 精確 hunks，並移除本 WP 新增的 interaction role helper/test、Live edit test、receipt 與 evidence。
- 禁止用 reset／restore／checkout 覆蓋 `actions.ts`、public Live、角色／腳本元件內既有 dirty hunks。
- 沒有 DB、Chrome、Bombmy、外部服務或 Production mutation 需要回滾。
