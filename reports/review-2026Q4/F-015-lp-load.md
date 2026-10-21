# F-015／B05-04 `/lp/*` 公開漏斗頁量測

日期：2026-10-21。分支 `codex/beta-l1d-lineB-live`。原始輸出：`F-015-lp-load-before.json`、`F-015-lp-load-after.json`（同目錄）。

## 量測方式

- 腳本：`scripts/lp-load-probe.mjs`（`node --import tsx scripts/lp-load-probe.mjs --build`）。
- 環境：Windows 10、Node v22.23.1、`next build --webpack` 後 `next start`（production 模式）單一程序，資料庫為 loopback 5433 全新 `celebratedeal_e2e`（PostgreSQL，套用全部 migration）。伺服器只拿到合成環境變數，不繼承 shell 的任何 secret、Sentry、R2、Email 設定。
- 資料：腳本建立合成商家、已發布專案、報名表、一個 audience Funnel（`/lp/<funnel>`）與一個綁報名表的舊版頁（`/lp/<legacy>`），結束時刪除。
- DB 查詢數：`CELEBRATEDEAL_PRISMA_QUERY_LOG=stdout` 讓 Prisma 對每個 SQL 印一行 `prisma:query`（`src/lib/db.ts`，Vercel 上不生效、不印參數），腳本計算區間內行數 ÷ 請求數。
- 依序：暖身 20 次 → 每種網址各 30 次循序請求（查詢數、單次延遲）→ Funnel 首頁 2,000 次、併發 100 → 可用性契約狀態碼。
- 每個版本只跑一次；併發延遲受本機 CPU 影響，數字只用來比較前後，不代表正式環境容量。

## 結果

| 指標 | 改前（proxy 讀整份 content） | 改後（proxy 只查 slug→id 與發布狀態） | 變化 |
|---|---|---|---|
| Funnel 首頁：每請求 SQL 數 | 7 | 6 | −1 |
| 綁報名表的舊版頁：每請求 SQL 數 | 6 | 4 | −2（proxy 不再讀版本、不再 count 報名表） |
| 不存在的 slug：每請求 SQL 數 | 1 | 1 | 0 |
| Funnel 首頁循序 p50／p95（ms） | 23.0／32.6 | 24.0／30.8 | 持平（合成內容很小） |
| 併發 100、2,000 次：p50（ms） | 1,359.5 | 1,111.6 | −18% |
| 併發 100：p95（ms） | 1,635.6 | 1,432.5 | −12% |
| 併發 100：p99（ms） | 1,653.3 | 1,740.9 | +5%（單次量測的尾端雜訊） |
| 併發 100：吞吐（req/s） | 73.1 | 86.0 | +18% |
| 併發 100：非 200／連線失敗 | 0／0 | 0／0 | — |

中間另量了一版「proxy 不讀 content，但仍讀 publishedVersion 與 live」：Funnel 首頁 7、舊版頁 5 個 SQL，併發 p50 1,201.8 ms、p95 1,410.3 ms、83.1 req/s。Prisma 對巢狀關聯會逐層各發一條 SQL，所以只拿掉 `content` 欄位不會減少往返；改成單一 `findMany({ select: { id: true } })`（專案發布條件在同一句 WHERE）後才少一次往返。

合成 Funnel 的 content 很小，所以循序延遲看不出差異；真實漏斗的 content JSON 越大，proxy 少傳一份、少 parse 一次的效益越大。併發下的延遲主要是單一 Node 程序的 SSR CPU，不是資料庫。

## 可用性契約（HTTP 狀態）

| 情境 | 改前 | 改後 | 由誰回應 |
|---|---|---|---|
| 不存在的 slug | 404 | 404 | proxy（匿名靜態頁、`X-Robots-Tag: noindex`、`Cache-Control: no-store, max-age=0`） |
| 專案未發布 | 404 | 404 | proxy（同上） |
| 已發布 Funnel 首頁、舊版頁、HEAD | 200 | 200 | page |
| 不存在的 step path | 404（proxy） | 404 | page 的 `notFound()`：全站繁中 404 頁、`<meta name="robots" content="noindex">`、`Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` |
| 報名表停用 | 404（proxy） | 404 | page（同上） |
| Funnel operations 無效 | 404（proxy） | 404 | page（同上） |

`/lp` 沒有 `loading.tsx`，page 的 `notFound()` 在任何 Suspense 之前執行，實測仍是真正的 HTTP 404，不是串流後的 200。差別是這三種情況改由 page 回應：沒有 `X-Robots-Tag` header（改用 robots meta），回應內容的 RSC payload 會帶出使用者自己請求的網址路徑，但沒有任何商家原因字樣。`tests/e2e/public-url-availability.spec.ts` 已依此拆成兩組斷言。

## 程式變更

- `src/lib/public-landing-page-status.ts`：`publicLandingPageStatus(pathname)` 只做一次 `landingPage.findMany({ where: publicLandingPageCandidateWhere(slug), take: 2, select: { id: true } })`；版本與租戶一致性、綁定直播、step path、Funnel operations、報名表、content 有效性全部交給 page（`loadPublicLandingPage`、`resolvePublicFunnelRuntime` 原本就會檢查）。
- `src/proxy.ts`：不再傳 visitor id 給狀態檢查；訪客 cookie 注入不變。
- `src/lib/db.ts`：本機量測用的 query log 開關。
- `scripts/lp-load-probe.mjs`：本量測腳本。

## 未完成與後續

- 只在本機 Windows 單一程序量測，沒有在 Vercel／Supabase（跨區 RTT）實測。正式環境每少一次往返約可省一次東京 pooler RTT。
- page 本身仍會讀兩次同一份 content（`loadPublicLandingPage` 與 `resolvePublicFunnelRuntime`），以及寫一筆造訪紀錄；B05-04 建議 (3)「同一請求只完整讀一次 content」與 B06-04 的已發布內容快取尚未處理。
- 版本與租戶不一致、綁定直播非公開這兩種資料異常，改由 page 回 404（原本是 proxy 的匿名 404）。
