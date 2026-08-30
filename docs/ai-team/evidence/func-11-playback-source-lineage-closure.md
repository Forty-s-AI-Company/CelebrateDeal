# FUNC-11：B 頁跳轉共享直播頁的來源歸因修正

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_LOCAL_FUNCTIONAL_FIX`

## 發現與修正

code review 的 P1 缺口是：合作夥伴 B 頁原本只產生 `/live/{liveSlug}`，瀏覽器進入共享直播頁後，affiliate click API 看到的 Referer 可能已經是共享直播頁，因而失去 B 頁的來源 lineage。

本輪完成以下修正：

- B 頁由伺服器產生帶 `sourcePage`，並在有有效 affiliate 時帶 `ref` 的播放 URL。
- `LivePlayback` 將 `sourcePage` 傳至 affiliate-click endpoint；只有來源頁、沒有 referral code 的 click 也能被記錄。
- API 仍要求 `referralCode` 或 `sourcePage` 至少一項；來源頁只作 lookup clue，最後仍由 vendor、live、公開分享狀態與 active membership 的資料庫關聯驗證。
- 未知 referral code 仍可保留 legacy click，但不會變成 verified ownership 或 sticky attribution cookie。

## Deterministic evidence

| 驗證 | 實際結果 |
| --- | --- |
| playback／attribution cohort | 4 files，50 passed，0 failed，0 skipped |
| form-submissions compatibility | 1 file，13 passed，0 failed，0 skipped |
| ESLint | PASS |
| TypeScript | PASS |
| global coverage gate | 本輪未重跑；既有 `FAIL_REMAINING_SOURCE_INVENTORY` 保持原樣，沒有降低 threshold、exclude、skip 或 assertion |

測試命令：

```text
npx vitest run "src/lib/team-funnel-public-page.test.ts" "src/lib/team-funnel-attribution.test.ts" "src/app/api/affiliate-clicks/route.test.ts" "src/components/live-playback.test.tsx"
npx vitest run "src/app/api/form-submissions/route.test.ts"
```

## 分數與上線邊界

CAT01 維持 7.5、CAT04 維持 6.0、總分維持 73.5。這是本機產品功能修正，不是 staging／PayUni Sandbox／Production evidence；沒有執行 migration、外部付款、正式退款或外部服務操作。FIN-08AA、WP-196、WP-197 均未重試，Goal 仍為 `IN_PROGRESS`。

## 可追溯檔案

- `.ai-team/reports/func11-playback-source-lineage-closure.json`
- `src/lib/team-funnel-public-page.ts`
- `src/lib/team-funnel-attribution.ts`
- `src/app/api/affiliate-clicks/route.ts`
- `src/components/live-playback.tsx`
- `src/lib/team-funnel-public-page.test.ts`
- `src/lib/team-funnel-attribution.test.ts`
- `src/app/api/affiliate-clicks/route.test.ts`
- `src/components/live-playback.test.tsx`

回滾範圍限於上述 source／test hunks 與對應文件；本輪未讀取 `.env*`、credential、cookie、正式資料或付款資料。
