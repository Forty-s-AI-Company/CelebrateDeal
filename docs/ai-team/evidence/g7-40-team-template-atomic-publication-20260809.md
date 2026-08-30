# G7-40 團隊範本原子發布證據

- Work Package：`G7-40`
- 驗證時間：`2026-08-09T11:31:54.9104719Z`
- 模式：`PRELAUNCH_DEV_AUTONOMOUS`
- Source aggregate SHA-256：`0b6421ccfccc25f533bf31e7b895f907ea008e8fef150903ada20105dd5b0d08`
- 結論：`LOCAL_FUNCTION_AND_REVIEW_PASS`

## 產品問題與修正

團隊範本建立／發布原本先寫入 immutable version，再逐筆建立商品槽位，最後更新來源頁。後段任一步驟失敗時，可能留下缺少商品或未更新來源頁的半完成版本，重新送出又可能遇到版本衝突。

本次調整包含：

- 建立原始頁時，template、version、field locks、商品槽位、webinar binding 與 source page 由同一個 Prisma transaction 寫入。
- 發布新版本時，商品驗證、webinar ownership、來源頁 ownership、immutable version、template 狀態與來源頁更新都在同一個 Serializable transaction。
- source page 必須同時符合 vendor、team、promoter membership、content owner membership 與 template lineage，夥伴副本不能冒充原始來源頁。
- 商品槽位只接受同 vendor、啟用且已確認 fulfillment type 的商品；既有 external checkout URL 與 partner override 解析也採相同 fail-closed 規則。
- `P2034` serialization conflict 與明確指向 `templateId + version` 的 `P2002` 最多重試三次，每次重新讀取 latest version；其他 unique conflict 不盲目重試。
- Server Action 改為一次呼叫 domain service，不再於 transaction 外逐筆新增槽位或更新來源頁。
- 既有 JSON API payload 保持相容；新欄位目前由產品 Server Action 使用，API 未宣稱支援未暴露的 payload。

本 WP 沒有修改 Prisma schema 或 migration。

## 驗證結果

| 驗證 | 結果 | 證據摘要 |
|---|---:|---|
| Team funnel targeted regression | PASS | 6 files，73 tests passed，0 failed，0 skipped |
| Atomic create／publish | PASS | nested product slots、webinar、source page 與 version 由單一 transaction 管理 |
| Source page ownership | PASS | preflight 與 update 都要求 promoter 與 content owner 為 actor |
| Sellable product gate | PASS | inactive、foreign tenant、unconfirmed fulfillment 與缺少商品均 fail closed |
| Concurrent publish recovery | PASS | P2034、version-key P2002 可有限重試；第三次仍衝突時回傳 stable conflict |
| Legacy JSON API compatibility | PASS | templates／pages route 舊 payload tests 通過 |
| Targeted ESLint | PASS | 7 files，exit code 0，無輸出 |
| Full TypeScript typecheck | PASS | `tsc --noEmit`，exit code 0 |
| Prisma schema validation | PASS | `prisma/schema.prisma` valid；未載入環境變數 |
| Diff whitespace | PASS | exit code 0；只有 Git LF／CRLF working-copy warning |
| Independent reviewer | RESOLVED | 初審 3 個 P1 已修正；複核無剩餘 P0／P1 或 checkpoint blocker |
| Chrome staging CAT06 matrix | NOT_RUN | Chrome control 端未連線，沒有取得 Browser evidence |
| Local Axe E2E | NOT_RUN | 既有 31023 埠被本專案 Next 程序占用；改用 31024 後 webServer 120 秒逾時，Axe tests 未啟動 |

## 執行命令

```text
npx vitest run src/lib/team-funnel-pages.test.ts src/lib/team-funnel-product-slots.test.ts src/lib/team-funnel-public-page.test.ts src/app/actions/team-funnel-template-actions.test.ts src/app/api/team-funnel/templates/route.test.ts src/app/api/team-funnel/pages/route.test.ts
npx eslint src/lib/team-funnel-pages.ts src/lib/team-funnel-pages.test.ts src/lib/team-funnel-product-slots.ts src/lib/team-funnel-product-slots.test.ts src/lib/team-funnel-public-page.test.ts src/app/actions/team-funnel-template-actions.ts src/app/actions/team-funnel-template-actions.test.ts
npm run typecheck
npx prisma validate
git diff --check -- <7 scoped files>
```

上述功能回歸、lint、typecheck、Prisma validate 與 diff check 皆為 exit code `0`。Chrome／Axe 失敗路徑未列為 PASS，也未重跑 FIN-08AA、WP-196、WP-197 的 endpoint、probe 或失敗命令。

## Source SHA-256

下列檔案依原順序讀取為 UTF-8、將 CRLF 正規化為 LF；個別 SHA-256 取各檔內容，aggregate SHA-256 取正規化內容依序串接後計算。

```text
0b3f780e1940022265f3d427baf0d612a9ecf58e12fb0b8e58ea0e809373e1d8  src/lib/team-funnel-pages.ts
ed988970cc7c3553bcaddc5ca0a6ee14e3b7cd69b985f96bc7270f6c896f906b  src/lib/team-funnel-pages.test.ts
87308b9abfbff2f6d951fd60d1b0945cafebfdd9e52bc27cd493aadf8ac4c5a5  src/lib/team-funnel-product-slots.ts
94a9449687daebd8e815c026c2616443410d1e18843c33dc0f28e398f143b908  src/lib/team-funnel-product-slots.test.ts
996e93743d445c220bdc1afd41294b27ec6548540da89567db6193997431199d  src/lib/team-funnel-public-page.test.ts
ef027e77cb06af6b043a93ee57c52d96231e69cee3251705ae7ea5b2b8a2b03e  src/app/actions/team-funnel-template-actions.ts
afd260f2debc2b93ec29c75660337c4d2e5a03fc93a4fdf811bdb49f6b08d5b5  src/app/actions/team-funnel-template-actions.test.ts
```

## Ownership、安全與回滾

- `team-funnel-pages.ts`、`team-funnel-pages.test.ts`、`team-funnel-template-actions.ts` 與 `team-funnel-public-page.test.ts` 在本 WP 開始前無 scoped dirty status。
- `team-funnel-product-slots.ts`、`team-funnel-product-slots.test.ts` 與 `team-funnel-template-actions.test.ts` 在本 WP 前已有其他本機變更；本次保留既有內容並只加入 atomic publication、fulfillment gate 與對應 assertions。
- 沒有讀取或輸出 `.env*`、Token、Cookie、Secret、正式客戶或付款資料。
- 沒有操作正式 DB、付款、退款、Email、Production、staging mutation 或外部服務。
- 沒有降低 assertion／coverage threshold、增加 skip／exclude 或縮減 inventory。
- 回滾範圍只涵蓋 team funnel 建立／發布 orchestration、商品解析 gate 與對應 tests；不涉及 schema、migration、資料清除或外部狀態。

## 分數資格

- `team_stream_operations` 可由 `8.9 → 9.0`，recovery `1.8 → 1.9`。
- canonical 維持 `74.0`；本機 transaction 與 tests 不代替 CAT04 Sandbox 或 CAT10 真人／外部證據。

## 尚未完成與人工待辦

- CAT04 仍需 fresh staging／PayUni Sandbox provider 與 reconciliation evidence。
- CAT10 仍需真人完成法律、隱私、退款、財務、客服 SLA 與 release acceptance，並取得外部監控 delivery evidence。
- CAT06 已有 canonical 7 分；若要再提升，需要 Chrome 恢復連線後執行 staging desktop／mobile、RWD、Axe、keyboard、錯誤與慢網路矩陣。
- 下一個可自動推進方向：繼續 FUNC-CLOSURE source review，挑選仍會影響商家操作或交易可靠性的最高價值 P1。
