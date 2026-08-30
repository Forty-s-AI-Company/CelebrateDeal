# G7-41 團隊範本 API 完整發布契約

- Work Package：`G7-41`
- 驗證時間：`2026-08-09T11:56:49.619Z`
- 模式：`PRELAUNCH_DEV_AUTONOMOUS`
- 結論：`LOCAL_FUNCTION_AND_REVIEW_PASS`
- Source aggregate SHA-256：`2b42d2335e4061b3a03d8200f51bc63f3fcd7a44b3660c7b55972728b484f0f0`

## 產品問題與實際修改

G7-40 已讓 UI 發布流程在同一個 transaction 寫入 immutable version、商品槽位、來源頁與 webinar，但 `POST /api/team-funnel/templates` 仍只接受文字內容與鎖定欄位。JSON client 或自動化整合無法完成 UI 已支援的完整發布，且舊 payload 若直接進入 service，省略 `productSlots` 會被解讀成空陣列，可能建立沒有商品槽位的新版本。

本 WP 完成以下修正：

- JSON API 支援 `productSlots`，只接受四個核准槽位、有效 product ID、最多四筆且 slot key 不可重複。
- JSON API 支援 `sourcePage.pageId`、安全 slug 與 nullable `webinarId`，並將完整 payload 交給既有 transaction service 重新執行 vendor、team、membership、商品可售與 webinar ownership 驗證。
- `productSlots` 改為必填。缺欄位會在任何寫入前回傳 `400 INVALID_REQUEST`；明確送 `[]` 才代表清空全部槽位，避免舊 client 收到 201 卻遺失商品。
- 空白 `offerLabel` 與 `webinarId` 正規化為 `null`，與現有 Server Action 表單語意一致。
- 更新既有 JSON route integration fixture，明確送出 `productSlots: []`。

沒有修改 Prisma schema、migration、domain transaction 或正式外部狀態。

## 驗證結果

| 驗證 | 結果 | 證據摘要 |
|---|---:|---|
| Route targeted tests | PASS | 1 file，10 tests passed，0 failed，0 skipped |
| Route＋service regression | PASS | 2 files，27 tests passed，0 failed，0 skipped |
| Required product slot contract | PASS | 缺 `productSlots` 回 400；`[]` 保留為明確清空語意 |
| Product slot validation | PASS | 重複 slot、未核准 slot、無效 ID 與超量 payload 均在 service 前拒絕 |
| Source page contract | PASS | page ID、slug、webinar ID 正規化後交由既有 tenant-scoped service 驗證 |
| Optional text normalization | PASS | 空白 offer label／webinar ID 轉為 null |
| Targeted ESLint | PASS | 3 scoped files，exit code 0，無輸出 |
| Full TypeScript typecheck | PASS | `tsc --noEmit --pretty false`，exit code 0 |
| Diff whitespace | PASS | exit code 0；只有 Git LF／CRLF working-copy warning |
| Independent reviewer round 1 | REMEDIATED | 發現省略 product slots 會靜默清空及空字串語意不一致 |
| Independent reviewer round 2 | PASS | no findings；原 findings 均已解決 |
| Browser／external provider | NOT_RUN | 這是同源 JSON API 契約，未操作 Bombmy、staging、PayUni、Production 或外部服務 |

## 執行命令與 exit code

```text
npx vitest run src/app/api/team-funnel/templates/route.test.ts
exit 0：10/10 passed

npx vitest run src/app/api/team-funnel/templates/route.test.ts src/lib/team-funnel-pages.test.ts
初次 exit 1：整合 fixture 未送新必填欄位，1 failed／26 passed
修正 fixture 後 exit 0：27/27 passed

npx eslint src/app/api/team-funnel/templates/route.ts src/app/api/team-funnel/templates/route.test.ts src/lib/team-funnel-pages.test.ts
exit 0：無輸出

npm run typecheck -- --pretty false
exit 0

git diff --check -- <scoped files>
exit 0
```

失敗的初次整合測試保留為真實結果，沒有標成 PASS，也沒有降低 assertion、增加 skip／exclude 或變更 coverage threshold。

## Source SHA-256

檔案以 UTF-8 讀取並將 CRLF 正規化為 LF；aggregate 依下列順序串接內容後計算。

```text
d113056124d222fb37c61e746805831b9627516193fa8adf756f76635c3936ac  src/app/api/team-funnel/templates/route.ts
5dc401e5c2567336b2aa7fad5f0fe62616c83bb248d4f4c314de8b9c20727195  src/app/api/team-funnel/templates/route.test.ts
0f93f5a2464f4031cf3f3f16fdba837f12f0f8db715d92b10ab94afc66f6ef6e  src/lib/team-funnel-pages.test.ts
```

## Ownership、安全與回滾

- route 與 route test 在本 WP 開始前無 scoped dirty status；`team-funnel-pages.test.ts` 已有 G7-40 相關變更，本次只把既有 route integration fixture 補上新必填欄位，沒有覆蓋其他 assertions。
- worktree 其他既有變更全部保留，沒有使用 reset、clean、stash、restore、checkout 或 rebase。
- 沒有讀取或輸出 `.env*`、Token、Cookie、Secret、正式客戶或付款資料。
- 沒有操作正式 DB、付款、退款、Email、Production deploy 或外部 mutation。
- 回滾範圍限於團隊範本 route schema、route tests 與一行 route integration fixture；domain transaction、schema 與資料不受影響。

## 分數資格

- 固定功能 `team_stream_operations` 可由 `9.0 → 9.1`，core `2.7 → 2.8`。加分來源是完整發布能力已同時提供 UI 與 JSON API，並防止缺欄位造成商品槽位遺失。
- canonical 總分維持 `74.0`；本地 API evidence 不代替 CAT04 PayUni Sandbox／staging，也不代替 CAT10 真人與外部 evidence。

## 尚未完成與下一個工作

- PayUni 獨立付款方式 setup 仍缺可核對的官方契約與授權 Sandbox evidence；不會猜測 provider 參數，也不修改已有其他 ownership 的付款檔案。
- CAT04、CAT10 保持 blocker，但不阻擋其他功能改善。
- 下一個自主工作回到 FUNC-CLOSURE，優先處理本機可完成且不與 dirty ownership 衝突的 P1 販售流程缺口。
