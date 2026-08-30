# G7-03 媒體上傳與 Live Studio checkpoint — 2026-08-08

## 結論

- 狀態：`PASS_LOCAL_DETERMINISTIC_EXTERNAL_ACCEPTANCE_PENDING`。
- 「圖片／影片媒體」由 provisional `4/10` 調整為 local-evidence candidate `8/10`；「直播 Studio」由 provisional `5/10` 調整為 local-evidence candidate `8/10`。
- 這兩個分數不是 Production acceptance。canonical total 維持 `73.5`、delta `0`；沒有 Browser、Cloudflare provider 與完整 release reconciliation 前不加分。
- 唯讀 reviewer 首輪發現 `0 P0 / 2 P1 / 2 P2`；修復後 closure re-review 確認四項全部 `CLOSED`，且新增 `P0/P1 = 0`。
- 本工作包已達可安全停下的本機 checkpoint；下一個最高產品價值工作為 `G7-04-COMMERCE-ORDER-AND-FULFILLMENT`，本輪未啟動。

## 實際完成的產品閉環

### 圖片與影片

- 新增 vendor-scoped `ImageAsset`，商品、直播與影片縮圖改以 asset ID 綁定，server 重新查詢當前 vendor 的 ready asset，不信任 client 偽造 URL。
- 圖片支援點擊選檔、拖拉、上傳進度、取消、重試、預覽、移除、成功／失敗 live status；URL 只保留 legacy／進階 fallback。
- R2 採 server 產生的隨機 object key、10 分鐘 presigned PUT、完成後 HEAD 驗證，再把 asset 標成 ready。支援 JPEG、PNG、WebP、GIF、AVIF，限制 15 MiB。
- Cloudflare Stream direct creator upload 由登入 vendor 推導 tenant，client 不可指定 vendor、provider UID 或 stream key；建立後保留本機 video ID，重試不重複建立 row。
- basic Stream upload 限制 200 MiB；超過時明確回傳需要 resumable upload，不假裝成功。目前尚未實作 tus。
- merchant API route 統一要求 same-origin、client header、CSRF、active owner/admin，並只使用 server-derived tenant。
- ImageAsset 關聯使用 `(vendorId, assetId) -> (vendorId, id)` composite foreign key，避免 legacy 或程式錯誤跨租戶綁定。

### Live Studio

- create/edit 統一為五步：基本資料、商品與轉換、媒體、直播與互動、預覽發布。
- 每一步使用 server-side `LiveStudioDraft` 自動儲存與明確儲存，不使用 localStorage；重新整理與 create validation redirect 後可恢復。
- draft 使用 optimistic revision、序列 queue 與變更 coalescing；衝突時鎖定並顯示可恢復錯誤，不覆寫較新的分頁。
- 同時建立第一份 edit draft 的 unique race 會把 Prisma P2002 映射成 `409 DRAFT_CONFLICT`，不再陷入 500 重試。
- 最終送出會比較目前 form payload 與最後成功保存版本；尚未同步時先阻止 submit、flush 最新 draft，只有保存成功才重新送出。衝突或保存失敗不發布。
- create 一律建立 draft；公開狀態轉換與儲存分離。processing/unready Stream video 在 selector、Live action、Video action 與 public playback 全鏈路 fail closed。

## Fresh deterministic evidence

- Vitest：`22 files / 312 tests PASS`，exit `0`。
  - UTC：`2026-08-08T02:23:15.8177522Z` 至 `2026-08-08T02:23:28.4212722Z`。
  - 精確 test inventory 保存於 machine receipt。
- G7-03 scoped ESLint：exit `0`。
  - UTC：`2026-08-08T02:17:39.9200378Z` 至 `2026-08-08T02:17:46.2250068Z`。
  - closure 新增的 `src/app/actions.test.ts` 再驗證：`2026-08-08T02:22:47.9044362Z` 至 `2026-08-08T02:22:54.6726901Z`，exit `0`。
  - 未新增 eslint disable，未降低既有規則。
- TypeScript：`npx tsc --noEmit`，exit `0`。
  - UTC：`2026-08-08T02:22:47.9381663Z` 至 `2026-08-08T02:22:58.1479064Z`。
- Prisma：`npx prisma validate` 與 `npx prisma generate`，exit `0`；Prisma config 明示略過 environment variable loading。
  - UTC：`2026-08-08T02:24:28.7389447Z` 至 `2026-08-08T02:24:35.6065801Z`。
- Disposable PostgreSQL：36 migrations 的 validate/deploy/status 全部 `PASS`，最後一筆為 `20260808094500_g7_03_live_studio_drafts`；container 與 temp root cleanup 都 `PASS`。
  - 收據：`.ai-team/reports/prisma-loopback-disposable-migration-receipt.json`。
  - 收據 SHA-256：`B8F7761C8EEA372E6106D4C32796995FFA061EACC7336F87ED33FB70A432D285`。
  - receipt verification：`2026-08-08T02:24:28.7521111Z` 至 `2026-08-08T02:24:28.8386470Z`，exit `0`。
- `git diff --check`：exit `0`。
  - UTC：`2026-08-08T02:22:47.9284607Z` 至 `2026-08-08T02:22:48.2447064Z`。
- Machine receipt：`.ai-team/reports/g7-03-media-live-studio-20260808.json`；SHA-256 `18E673DC42E45DE1EE2061C9DF1847CD3009CC12C6E7FE5A61630D8657851521`。

## Reviewer findings 與 closure

1. `P1` 首次 edit-draft autosave unique race 可能變成 500：P2002 映射為可恢復 `409 DRAFT_CONFLICT`；`CLOSED`。
2. `P1` provisioned／processing Stream video 可能被儲存、綁定或播放：共用 ready selector 與 action/playback fail-closed；`CLOSED`。
3. `P2` 快速 final submit 可能早於最新 autosave：submit-before-latest-draft guard 會先 flush，失敗或衝突不送出；`CLOSED`。
4. `P2` ImageAsset 只有 application tenant check：schema 與 migration 新增 tenant-scoped composite FK；`CLOSED`。

Closure reviewer 是唯讀審查，沒有把自己的判斷冒充測試 PASS。它指出的最後測試缺口已補成 `upsertLiveAction` 專例，確認 Live lookup 只接受 ready external URL、ready Stream 或已建立的 Live Input；最終 combined matrix 已包含該測試。

## 執行中曾出現、但已如實修正的失敗

- 初次 TypeScript 因既有 test fixture 缺少新增欄位而失敗；補齊 fixture 後通過，未弱化型別。
- 初次 scoped lint 命中 complexity／max-lines／ref 規則；拆分函式後通過，未加 disable。
- UI refactor 後曾有 3 個舊 step index assertion 失敗；改為穩定的可見步驟驗證後通過，沒有縮減功能 assertion。
- reviewer-fix 第一輪為 `227/228`，原因是 test mock 回傳空 payload；只修正 mock contract，production assertion 未放寬。

## External／Browser evidence（不可冒充 PASS）

- 本工作包沒有操作 Chrome、Bombmy、Cloudflare account、staging、Sandbox 或 Production；Browser／desktop／mobile／RWD／Axe／keyboard／慢網路 acceptance 均為 `NOT_RUN`。
- 沒有重試先前 G7-02 已逾時的同一 Chrome takeover 路徑，也沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal no-go endpoint／probe／命令。
- R2 browser direct PUT 仍需在實際 bucket 設定允許 CelebrateDeal origin 的 CORS；本機程式不能替外部 Cloudflare 帳號宣告已完成。
- Cloudflare R2 presigned PUT／HEAD 與 Stream basic direct upload 尚需 sandbox/provider 實傳證據；200 MiB 以上 tus upload 尚未實作。
- 這些項目目前不要求使用者立刻手動處理，可在進入 external acceptance 工作包時提供最小權限設定與證據格式。

官方約束參考：

- R2 presigned URL：https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2 CORS：https://developers.cloudflare.com/r2/buckets/cors/
- Stream direct creator uploads：https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/

## Source digests（SHA-256）

| 檔案 | SHA-256 |
| --- | --- |
| `package.json` | `2A44BB54E0D05FC2CD84BFCEFED8EC9EA8496CE9B47AE8AC59882EEE68FE7555` |
| `package-lock.json` | `2B8AC9FD9573DBA5C9BE6E8FFA331CF7747F3D98091E72548EA2E1F2263F44CA` |
| `prisma/schema.prisma` | `366579064DCDF1D433AD1CA5955AA4DD8929ABC221C2E6E86D3510FA5DE3FFED` |
| `prisma/migrations/20260808080000_g7_03_media_assets/migration.sql` | `11F01D139C18D69E1F5E7CEEC7B4645BEAF6660791CAA1820E567DB9E3DCBE4C` |
| `prisma/migrations/20260808094500_g7_03_live_studio_drafts/migration.sql` | `1F67F3D3EFC4B7DEF1AACE97954FB5428210B923467623E57F8158A5FCF527FC` |
| `scripts/g7-media-schema-contract.test.ts` | `9A341704E9976EB067E5DF5F5D667680DA3D01336EFB4EA5C726BDD67E5892E3` |
| `src/lib/merchant-api-security.ts` | `A0DB85201862A2C40F944A8C6081C4F4BFCCA92B6AB776912D4A92A586E8CFDF` |
| `src/lib/r2-images.ts` | `CB5471D3EF68BEBDBF60B1AA89C7632FCD9F8E9B834C1A7C6DF8B533A232B6A3` |
| `src/lib/media-upload-client.ts` | `BBDF2AD03F7D18CCD43EFC14701E19A8C702A2E1AB8787ABA066204BB9512DE0` |
| `src/lib/image-assets.ts` | `497924823CC6CEFFAC05A565C179D986AEA510E2F6AEABDF6AACED7ABAF916E0` |
| `src/lib/live-studio-draft.ts` | `293463F339E293D85BFEE2BC7B0B5D027BA96BF8BE61CFBFDFCF403CCE6C5C4D` |
| `src/lib/live-studio-draft-client.ts` | `3E2F0A0B7D01EE7ED6A1C24B05F3D3F12F613F8B050BACE40A46E2DF090D69E3` |
| `src/lib/live-video-readiness.ts` | `6BA5CF7B45957B0C467A8EAA1F4941502B79DA6FEF8422793BB52AC6086E65F5` |
| `src/lib/live-playback-source.ts` | `5FA4BA63CE4D37CBBDD5D83A735B265655757B5FD30449E49E7E53254C82F297` |
| `src/components/media-upload-field.tsx` | `4B0A0773B61B81208C79A2C51343FFCFE5A68CACBBE323F74BC02EF6073E58E9` |
| `src/components/use-live-studio-draft.ts` | `37BB160539FF955636FAF3169C49E15E7B14A58454F5C3E78C0FAB975DAA3EBC` |
| `src/components/live-stepper-form.tsx` | `69414CD0DFAEE8F01FB4DE4907B40ADE2799C76228CBD994118EB4F076C61964` |
| `src/components/video-form.tsx` | `3815FD5EB6C8A8616C422A3B711CEBB8F0D2FD1A754C90C89E64517E3CCC0815` |
| `src/app/api/media/images/presign/route.ts` | `D60D052C45A4FCF0AF3D1B01A318CDA710BE3E154DC9AC6FCA4BEA5FE088ACBF` |
| `src/app/api/media/images/complete/route.ts` | `D1BC33D6AB90846A84551223BE3389AA8365504ED256D510D73BCC02A1C23F3F` |
| `src/app/api/media/videos/direct-upload/route.ts` | `406177F29C79E5585C41030F7865B649DF9FA12DFD18A651939D3B88B6459314` |
| `src/app/api/live-studio/drafts/route.ts` | `674F8AFECE7964D1708C29ACDE09893933F96CF0FB4F84C6206A9C1985E67CF7` |
| `src/app/(app)/lives/new/page.tsx` | `EE483D4303D02D19954466B1C94136DD1292780C2970CDBD5F4A62D7D579D4DE` |
| `src/app/(app)/lives/[id]/edit/page.tsx` | `6F0EAB4A3CB7258D769444EAC76DDBE805D9DA24F94FEBC705BDB4220517A730` |
| `src/app/actions.ts` | `7098CC015C7826E83FCB11D1EE902829ED5ADAC8728F71828CFEA42FB82EE8C2` |
| `src/app/actions.test.ts` | `8309457C73E65BC9926AF449881BC3278A7B29772CC12C61913FD9E5CE8ED0C7` |

## Ownership、未執行與回滾

- 起始 HEAD：`1a8a4bb3acad8aabef30a7d9fbe4dc1488d6a758`。所有既有 dirty worktree 變更皆為 `PRESERVE_ONLY`。
- sidecar 建立後的 final checkpoint：480 dirty entries、183 tracked modified、297 untracked、staged `0`。
- 未 stage、commit、push、merge、deploy；未讀取 `.env*`、Cookie、Token、credential、正式客戶或付款資料。
- 未執行 global coverage、Production build、staging 或外部 provider mutation；coverage 門檻未降低，也未加 skip／exclude。
- 回滾只能反向套用本文件列出的 G7-03 精確 hunks，並精確移除兩筆 G7-03 migration、media/live draft 新檔、receipt、evidence 與 sidecar。禁止 reset／restore／checkout 覆蓋共用 `schema.prisma`、`actions.ts`、表單與既有 dirty hunks。
- Disposable PostgreSQL 使用 loopback-only、無 persistent volume，container 與 temp root 已清理；沒有正式 DB 或外部 provider mutation 需要回滾。
