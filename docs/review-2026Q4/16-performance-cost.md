# 16 效能與成本審查（B-06）

> 基線 `review-baseline-2026Q4` = `78621ca3`。全程唯讀：沒有修改既有檔案、沒有 git 寫入、沒有讀 `.env*`、沒有連任何資料庫或外部服務、沒有 `next build`。審查者：B-06 子代理。
> **本檔的所有延遲與成本數字都是由程式碼推算出來的估計，不是實測值。** 推算用到的單價一律引用 `docs/market-2026Q4/research_notes/台灣直播導購 SaaS 市場研究 2026/c05_payments_integrations_unit_costs.md`（Vercel hnd1 區域費率、Cloudflare Stream 價目，存取日 2026-10-18），沒有憑記憶補價格。Next.js 行為依 `node_modules/next/dist/docs/`（16.3.8）。慣例面的發現見 `15-nextjs-conventions.md`。

## 0. 結論先講

1. **Dashboard 逾時的根因很可能不只是跨區延遲。** 一次商家頁面載入會重複執行 `getCurrentAuth()`（layout、page、`/api/dashboard/details` 各一次，沒有 `React.cache`），每次是深度 `include`（約 7～9 條 SQL）；`(app)/layout.tsx` 另外還有約 4 段依序執行的 10 餘條查詢。跨區 RTT 只是把這些「往返次數」放大（B06-01、B06-02）。
2. **Production 的函式區域與連線池設定完全不在 repo 內。** `vercel.json` 沒有 `regions`；hnd1 只在 staging 的 Vercel 專案設定裡改過（`CURRENT.md:13`）；`src/lib/db.ts` 是裸 `new PrismaClient()`；`DATABASE_URL` 的 `pgbouncer=true`／`connection_limit` 只存在於散文文件，preflight 不檢查（B06-03）。
3. **直播觀眾端是最大的容量與成本變數，市場研究的請求量假設低估約 9 倍。** 每位觀眾每分鐘約 53 次請求（聊天輪詢 3 秒、互動輪詢 2 秒、入場續期 30 秒、用量心跳 60 秒），約 3 條 SQL／秒／人；300 人約 265 req/s、約 900 SQL/s。研究文件假設 6 req/min／人（B06-05）。
4. **用量心跳在 Serializable 交易中掃整月帳本，且序列化衝突被當成「額度用完」回傳，客戶端會暫停播放。** 同時在線人數一多，會出現「假的額度耗盡」（B06-06）。這是本次最危險的規模風險，且在帳務領域，修改需 `engineer-hard` + `reviewer`。
5. **Cloudflare Stream 播放網址未簽章、也不會刪除影片。** 任何拿到 `videodelivery.net/<uid>/manifest/video.m3u8` 的人都能不經入場檢查、不計入商家額度地觀看，遞送分鐘（USD 1／1,000 分鐘）記在平台帳上；封存影片不會刪除 Stream 資產，儲存費（USD 5／1,000 分鐘容量）只增不減（B06-07、B06-08）。
6. 前端 bundle 的靜態判斷大致健康：`hls.js`、Puck、直播播放本體都懶載入；`lucide-react` 受 Next 預設保護。可改善的是根 layout 的 `AnnouncementCenter` 送給所有買家頁、`tus-js-client` 靜態載入（B06-13）。
7. 公開頁（lp、p、form、live）**全部是 dynamic**，只有政策頁是 ISR。不是全都能靜態化，但「已發布內容」可以跨請求快取，單頁每次瀏覽的 DB 讀取可從 6 次以上降到 1～2 次（第 6 節）。

## 1. 方法、假設與未覆蓋

- 讀 `docs/review-2026Q4/01-system-map.md`、`04-static-scan.md`、`19-observability-ci-supply-chain.md`、`docs/launch/CURRENT.md` 的 Dashboard 與區域段落、`docs/market-2026Q4` 成本研究。
- 查詢盤點：自寫唯讀腳本對 `src/` 的 351 個非測試 `findMany` 判斷是否帶 `take`（211 個沒有）、是否含 `include`（46 個，其中 29 個無 `take`；清單在附錄 A）；再逐一讀 dashboard、orders、affiliates、live viewer、student portal 與 lp 的實際查詢。
- 輪詢頻率：`grep` 所有 `setInterval`／`setTimeout` 輪詢，逐一讀對應 route。
- 單位換算：SQL 往返數是依程式碼計數（Prisma 預設 `relationLoadStrategy` 為 `query`，巢狀 `include` 依層級各發一條 SQL；沒有開 SQL log 驗證）。
- **未覆蓋**：沒有 `next build`（First Load JS、route 靜態／動態標記未量）；沒有 DB 查詢計畫（`EXPLAIN`）；沒有負載測試；沒有 Vercel／Supabase／Cloudflare 的實際設定與帳單；`CELEBRATEDEAL_MEDIA_ORIGIN` 的實際部署不明。
- 估算 RTT 時使用的「跨區約 150～200 ms／往返」是公開網路常識層級的假設（美東函式對東京 DB），**非實測**，只用來說明量級。

## 2. 查詢盤點（N+1、重查詢）

### 2.1 典型頁面的 SQL 往返（依程式碼計數）

| 場景 | 路徑 | SQL 往返估計 | 說明 |
|---|---|---|---|
| 商家後台任一頁硬載入（owner／admin） | `(app)/layout.tsx` + 該頁 | layout 約 12～14 條（其中 `getCurrentAuth` 7～9 條，後續 4 段依序） + 頁面自己的 auth 7～9 條 + 頁面查詢 | 見 B06-01／02 |
| Dashboard | `dashboard/page.tsx` → `DashboardKpis` + `/api/dashboard/details` | 上述 + KPI 6 條（兩段 `Promise.all`）+ details 約 16 條（12 個 count、3 個 findMany、另 1 個依序的 `sellable-live`）+ details route 自己的 auth 7～9 條 | 合計約 55 條以上、至少 12 段依序；details 走 client fetch，不阻擋殼層，這個設計是對的（見 `dashboard/dashboard-details-client.tsx:36-50`） |
| 訂單列表 | `orders/page.tsx:34-44` | auth + layout + 1 條（`take: 100`，`items` 限 3 筆） | 健康；沒有分頁 UI 但有上限 |
| 推廣夥伴列表 | `affiliates/page.tsx:10-14` | 1 條 `findMany`（無 `take`，含 `_count.clicks`）+ 1 條 `groupBy` | `groupBy` 的處理正確（無 N+1）；清單無上限 |
| 佣金結算 | `affiliates/commissions/page.tsx:30-45` | 3 條 `Promise.all`，無 `take`；`affiliateCommission` 與 `affiliatePayout` 都 `include: { affiliate: true }`（整列）；金額加總在 JS（`:48-49`） | 規模成長後記憶體與回應大小線性增加（B06-11） |
| 直播觀眾頁（首次載入） | `(viewer)/live/[slug]/page.tsx:15-47` | 1 個 `findFirst` 帶 6 個 `include`（vendor、video、form、messageTemplate、interactionScript.events.role、products.product） | Prisma 會拆成多條 SQL（約 8～10 條）；`vendor: true`、`video: true` 取整列。可改用 `select`。首次載入一次性，影響不大 |
| 學員入口 | `lib/student-portal.ts:66-95` | `Promise.all` 3 條，皆 `take: 100` 且用 `select` | 健康；session 是無狀態 token，不查 DB（`student-portal-auth.ts:349-352`） |
| 學員課程 | `lib/student-course-learning.ts:58-76` | 授權 2 條 + 課程單元 1 條 + 進度 1 條 | 健康；進度儲存是 Serializable 交易並有最多 6 次重試（`:116-118`）；每 15 秒一次（`course-player.tsx:146`），負載輕 |
| 客戶 CRM 詳情 | `lib/customer-crm.ts:197-220` | 2 條 + 8 條平行，皆無 `take` 且多數含 `include`；舊資料 fallback 還會多 2 條全量掃描 | 單一客戶的活動量成長時才會痛，且是商家端 |

結論：**沒有發現典型的迴圈內查詢（N+1）**。Prisma 的 `include`、`groupBy`、`_count` 都用得正確；主要問題是「重複的 auth」「殼層過重」「無上限清單」「串行 await」。

### 2.2 串行 await 的頁面

- `(app)/lives/new/page.tsx:65-122`：9 個獨立查詢一條一條 `await`（videos、products、forms、templates、scripts、affiliates、streamMemberships、streamQuotaPages、drafts）。相對地，同一個表單的編輯頁 `lives/[id]/edit/page.tsx:155` 已經用 `Promise.all`。
- `admin/billing/dashboard/page.tsx:41-98`：8 個串行查詢（平台管理員專用，影響低）。
- `(app)/layout.tsx:17-53`：見 B06-02。

### 2.3 輪詢造成的重複查詢

見第 4 節與 B06-05，這是量最大的重查詢來源。

## 3. 區域與連線池

| 項目 | repo 內現況 | 缺口 |
|---|---|---|
| 函式區域 | `vercel.json` 只有 `framework` 與 `git.deploymentEnabled.master=false`；`vercel.staging.json` 只有 `buildCommand` 與 `"crons": []`。`docs/launch/CURRENT.md:13` 記載「staging Functions 已由 iad1 調整至 hnd1」——是在 Vercel 專案設定做的 | **Production 的區域不在 repo、也沒有文件**。Next 的 `preferredRegion` 已棄用（`preferredRegion.md`），區域屬平台設定 |
| DB 區域 | staging Supabase 為 Tokyo（`CURRENT.md:13`、`docs/staging-backup-restore-drill-runbook.md:20`） | Production Supabase 區域無文件 |
| 連線池 | `src/lib/db.ts:9`：`new PrismaClient()`，無任何池參數；`docs/live-commerce-mvp-report.md:352` 記載 runtime 使用 Supabase transaction pooler 並加 `pgbouncer=true`；`docs/production-database-runbook.md:49` 建議使用 pooler | `connection_limit`、`pool_timeout` 沒有任何文件或檢查；Prisma 預設池大小 = CPU 數 × 2 + 1，每個 Vercel 實例各一份，高併發時會超過 pooler 的客戶端連線上限 |
| 偵錯可觀測性 | `scripts/preflight.ts` 與 `src/lib/env.ts` 沒有檢查 `VERCEL_REGION`、DB host、`pgbouncer`、`connection_limit` | 無法在部署前發現「函式在 iad1、DB 在 Tokyo」這類錯配 |
| 長時間函式 | 無 `maxDuration`（見 `19-…` B09-21） | Server Action 與長 route 的上限靠平台預設 |

## 4. 影音路徑與成本敏感點

### 4.1 流程

- **上傳**：`POST /api/media/videos/direct-upload`（≤200 MB，Cloudflare basic direct upload，`cloudflare-stream.ts:99-106`）與 `…/resumable-upload`（>200 MB 至 30 GB，tus，`:112-155`，分塊 50 MiB）；瀏覽器直接上傳到 Cloudflare，不經 Vercel。狀態以 webhook（`api/cloudflare/stream-webhook`）與 4 秒輪詢最多 15 次（`video-provider-status.tsx:6-7`）更新。
- **播放**：webhook 把網址固定寫成 `https://videodelivery.net/<uid>/manifest/video.m3u8`（`cloudflare-stream-webhook-handler.ts:47`），`/api/live-playback-source` 在觀眾入場後回傳（`live-playback-source.ts:65-69`）。Safari 走原生 HLS，其他瀏覽器動態 `import("hls.js")`（`live-playback.tsx:1684`、`promo-video-player.tsx:48`）。
- **圖片**：`POST /api/media/images/presign` 建立 `ImageAsset` 並簽 R2 PUT 預簽網址（`r2-images.ts:116-126`，10 分鐘有效、上限 15 MB），瀏覽器直傳 R2，再呼叫 `images/complete`。UI 一律先在 canvas 縮到寬 ≤1280（裁切）或 ≤1600（原比例）的 JPEG（`media-upload-field.tsx:215-248`），所以 UI 路徑不會傳大圖；API 本身仍接受 15 MB。
- **瀏覽器直播**（`sourceType = browser_live`）：WHIP／WHEP 經 `CELEBRATEDEAL_MEDIA_ORIGIN` 指向的媒體伺服器（驗證證據提到 MediaMTX），Vercel 只轉送 SDP（`api/live-media/route.ts`）。

### 4.2 每場直播的成本敏感點

單價來源：`c05_payments_integrations_unit_costs.md` L167-171、L203。

| 項目 | 計價 | 程式如何計量／控制 | 風險 |
|---|---|---|---|
| Stream 遞送 | USD 1／1,000 分鐘（後付）；研究情境：300 人 × 60 分 × 4 場 ＝ 72,000 分 ≈ USD 72／月 | 商家額度由**客戶端心跳**自報（`/api/stream-usage`，每 60 秒，`live-playback.tsx:616-619`）累積 | 網址未簽章，繞過心跳即不計量（B06-07）；序列化衝突被誤報為額度用完（B06-06） |
| Stream 儲存 | USD 5／1,000 分鐘容量（預付區塊）；RTMP／SRT 直播錄影計入儲存 | `createLiveInput` 設 `recording.mode = "automatic"`（`cloudflare-stream.ts:173`）；封存只隱藏（`video-lifecycle-actions.tsx:35`「Cloudflare Stream 資源不會被刪除」）；全 repo 沒有 Stream 的 DELETE 呼叫 | 只增不減（B06-08） |
| Stream 進流與編碼 | 免費 | direct upload 不設 `requireSignedURLs`、`allowedOrigins` | 見 B06-07 |
| R2 | 儲存 + 操作費；egress 免費 | 預簽 PUT、`HeadObject` 驗證（`r2-images.ts:129-`）；UUID 物件鍵 | 未設 `Cache-Control`（`:118-122`），物件鍵不可變，可設長快取（B06-14） |
| Vercel 變動成本（hnd1） | Active CPU USD 0.202／小時、CDN Requests 2.60／百萬、Invocations 0.60／百萬、記憶體 0.0167／GB-小時 | 觀眾輪詢（見下） | 研究假設 432,000 次／月（≈6 req/min／人）；實際約 3.8M 次／月，變動成本 ≈ USD 25 而非 USD 2.8（B06-05） |
| 自架媒體伺服器（瀏覽器直播） | 主機＋頻寬，無 CDN | 每位觀眾 1 條 WHEP 連線，Vercel 還要每 20 秒處理一次心跳（`live-media-client.ts:60-65`） | 容量與營運責任不明（B06-09） |
| Sentry | 以事件／交易數計價 | `tracesSampleRate = 0.1`（`sentry.server.config.ts:15`、`instrumentation-client.ts:14`），對所有 route 一視同仁 | 輪詢 route 吃掉大量交易額度（B06-12） |

### 4.3 觀眾端請求量（逐項計數）

| 來源 | 間隔 | 每人每分鐘 | 每次 SQL | 程式 |
|---|---|---|---|---|
| 聊天輪詢 `/api/live-chat/messages` | 3 秒 | 20 | 4（入場 session、報名資格、blacklist 全量、訊息） | `live-chat-panel.tsx:9,197`；`live-chat.ts:416-472` |
| 互動輪詢 `/api/live-interactions` | 2 秒（`setTimeout` 串接） | 30 | 約 3（入場 + runs + spotlight，另對每個進行中的 run 再投影） | `live-advanced-interactions.tsx:182`；`api/live-interactions/route.ts:216-244` |
| 入場續期 `/api/live-admission` | 30 秒 | 2 | ≥2 | `live-playback.tsx:365` |
| 用量心跳 `/api/stream-usage` | 60 秒 | 1 | ≈6～8（入場檢查 + Serializable 交易） | `live-playback.tsx:616-619`；`stream-usage.ts:148` |
| 媒體心跳 `/api/live-media`（僅 browser_live） | 20 秒 | 3 | 約 10（`live.findFirst` 帶 5 個 include，見 B06-10） | `live-media-client.ts:60-65` |
| **合計（不含 browser_live）** | | **約 53 次／人／分** | **約 185 SQL／人／分** | |

`LiveDanmaku`（彈幕，2 秒輪詢）元件目前沒有被任何頁面掛載，未計入。

- 300 位同時在線：約 **265 req/s、約 900 SQL/s**（持續 60 分鐘）。
- 輪詢**沒有 `document.visibilityState` 閘門**（只有彈幕與講師私訊有，`live-instructor-private-chat.tsx:46`）。分頁在背景時行動版瀏覽器會節流，但桌面不會。
- 以研究文件同樣的單價與「0.05 秒 CPU／請求」假設重算 Vercel 變動成本：3.816M 請求／月 → Active CPU ≈ 53 小時 × 0.202 ＝ USD 10.7；記憶體 ≈ 106 GB-小時 × 0.0167 ＝ USD 1.8；CDN Requests ≈ 3.816 × 2.60 ＝ USD 9.9；Invocations ≈ 3.816 × 0.60 ＝ USD 2.3；合計 **約 USD 25／月（約 NT$775）**，是研究文件 USD 2.8 的 8.8 倍。仍小於 Stream 遞送（USD 72），但 DB 與 pooler 才是真正的瓶頸。

## 5. 前端 bundle 靜態判斷

`next build` 未執行，以下是靜態判斷，沒有 First Load JS 數字。

| 項目 | 判斷 | 證據 |
|---|---|---|
| `lucide-react` | 未整包引入。67 個檔案具名匯入；無 `import *`。Next 預設的 `optimizePackageImports` 清單包含 `lucide-react` | `15-…` 第 2 節；`optimizePackageImports.md` |
| `@puckeditor/core` | 只在編輯器頁載入：僅 `landing-page-editor.tsx` 與 `landing-page-puck-config.tsx` 匯入；`workspace-editor.tsx:10-13` 以 `next/dynamic`（`ssr: false`）載入編輯器 | `grep @puckeditor` |
| `hls.js`（543 KB min） | 動態 `import()`，且 Safari 不載入 | `live-playback.tsx:1684`、`promo-video-player.tsx:48` |
| 直播播放本體（`live-playback.tsx`，75.7 KB 原始碼，全站最大的 client 元件） | 經 `PersistentLivePlayback` 的 `next/dynamic` 載入；根 layout 的 provider 只含輕量 context | `persistent-live-playback.tsx:8-11` |
| `tus-js-client`（86 KB min） | **靜態** `import { Upload } from "tus-js-client"`（`media-upload-client.ts:1`），而且只在影片 >200 MB 時用到；`media-upload-field`（45 KB）被 7 個 client 元件匯入（商品、表單建立器、直播精靈、品牌設定…） | B06-13 |
| 根 layout 的 `AnnouncementCenter` | 14.8 KB 元件 + 11.6 KB `announcement-feed.ts`，隨根 layout 送給**所有頁面**，包含 lp、checkout、live 的買家；元件內只在特定路徑才自動彈出（`announcement-center.tsx:115-119`） | B06-13 |
| Sentry client | 每頁皆載入，並設定 tunnel `/monitoring`（每個前端事件多經過一次 Vercel 函式）；`tracesSampleRate 0.1` | `next.config.ts` 尾端；`instrumentation-client.ts` |
| 圖片 | `images.unoptimized: true`（`next.config.ts:31`，附決策註解：不保留可代理任意 HTTPS 主機的優化器）。`<img>` 10 處（lint 的 3 個警告在 `landing-page-puck-config.tsx:79,85,88`，皆為渲染商家自填網址的區塊） | 見 B06-14 |
| 字型 | 沒有 `next/font` 或外部字型，使用系統字型 | `src/app/layout.tsx` |
| 最大的 client 元件（原始碼位元組） | `live-playback` 75.7K、`live-stepper-form` 63.0K、`media-upload-field` 45.1K、`funnel-operations-panel` 43.8K、`interaction-roles-workbench` 39.4K、`funnel-page-document-renderer` 36.5K、`interaction-script-form` 35.7K、`form-builder-client` 31.4K | `find` + `wc -c`（僅商家後台與播放頁，公開漏斗頁的 `funnel-page-document-renderer` 是買家路徑上最大者） |

買家路徑（lp、form、checkout）上最重的是 `funnel-page-document-renderer.tsx`（36.5 KB）與根 layout 的共用件；它們都沒有懶載入，但屬於首屏必需，合理。

## 6. 快取策略：哪些公開頁可以靜態或 ISR

目前狀態：未啟用 `cacheComponents`、無 `'use cache'`／`unstable_cache`；只有 `policies`、`policies/[slug]` 是 ISR（`revalidate = 3600` + `generateStaticParams`）。其餘公開頁全部 dynamic。

| 公開頁 | 為何現在是 dynamic | 能否靜態／ISR | 建議 |
|---|---|---|---|
| `/lp/[slug]`、`/lp/[slug]/[stepPath]` | `force-dynamic`；讀 cookie（訪客 ID、報名重試草稿、CSRF）、A/B 分流、截止時間、每次瀏覽寫一筆 `FunnelVisit` | **整頁不能靜態**（每位訪客的 A/B 與草稿不同）；但「已發布內容」（`publishedVersion.content`、表單定義、商品視圖）每發布一次才變 | 以 `(pageId, publishedVersionId)` 為鍵快取內容與衍生資料（發布時失效）；訪客寫入改 `after()`；proxy 預檢改輕量投影。預期 DB 讀取由約 6 次降到 1～2 次（B06-04） |
| `/p/[slug]` | 讀 `searchParams` 與報名重試 cookie | 同 lp：內容可快取，整頁不可 | 同上，列入同一個設計 |
| `/form/[slug]` | 讀 `searchParams`（`submitted`、`liveId`、`registrationRetry`）；`getPublicRegistrationForm` 只用 React `cache`（單一請求內） | 表單定義與場次清單可跨請求快取（TTL 30～60 秒 + 發布／儲存時失效） | 加跨請求快取；其餘動態 |
| `/live/[slug]` | `serverNow`、執行階段狀態（`resolveLiveRuntime`）依時間變化；等待室／回放狀態必須即時 | 不適合靜態；資料讀取只有 1 個 `findFirst`，改 `select` 後成本很低 | 保持 dynamic；把成本花在輪詢（B06-05），不是首頁 |
| `/policies`、`/policies/[slug]` | 已 ISR | ✔ | 無須處理 |
| `/login`、`/register`、`/password-reset/*`、`/mfa/*` | 讀 cookie／`searchParams`（回呼訊息、CSRF） | 殼層可靜態，表單需要 CSRF，不值得 | 維持 |
| `/checkout/**` | 價格必須來自伺服器紀錄、每位買家不同 | 不可 | 維持（付款頁不應快取） |
| `/portal/**`、`/support/**`、`/affiliate-portal/**` | 需登入 | 不可 | 維持 |

快取機制的選擇（需 owner 決策，見 B05-10）：16.3.8 未啟用 `cacheComponents` 時，`unstable_cache` 仍可用，但 `unstable_cache.md` 標示已由 `use cache` 取代；採用 `use cache` 必須先啟用 `cacheComponents`，連帶移除 19 個 `dynamic` 與 2 個 `revalidate`（`migrating-to-cache-components.md` L76）。若短期只要降低 `/lp` 讀取量，建議先用 `unstable_cache` 包「依 `(pageId, publishedVersionId)` 讀內容」的單一函式並用 `revalidateTag` 在發布時失效，待 Cache Components 遷移時再改寫。

## 7. Findings

| ID | 嚴重度 | 檔案:行號 | 問題 | 為何重要（情境） | 重現／測試 | 建議修法與對應 docs | 估工 | 需 owner 決策 | 封測前必修 |
|---|---|---|---|---|---|---|---|---|---|
| B06-01 | MAJOR | `src/lib/auth.ts:183-230`（`include` 在 `:192-206`）、`:237-262`；`src/app/(app)/layout.tsx:10`；`src/app/(app)/dashboard/page.tsx:24`；`src/app/api/dashboard/details/route.ts` | `getCurrentAuth()` 沒有 `React.cache`，每次呼叫都查 `userSession` 並 `include` user → memberships → vendor → tracking、`mfaFactor`、`recoveryCodes`（整張復原碼表）、`session.vendor` → tracking。商家頁硬載入時 layout、page、`/api/dashboard/details` 各呼叫一次。依 Prisma 預設（`relationLoadStrategy: "query"`）每次約 7～9 條 SQL，且依 include 層級串行。每次還載入 MFA 密文與全部復原碼雜湊，但絕大多數頁面用不到。 | Dashboard 一次硬載入光 auth 就約 21～27 條 SQL；Dashboard 逾時的調查（`CURRENT.md:13`）把原因歸給跨區延遲，而「往返次數」才是放大器：同樣的 RTT，次數少一半，等待就少一半。同時是不必要的敏感資料搬運（MFA secret 密文、復原碼雜湊進入每個請求的記憶體）。 | 讀碼計數。建議用 Prisma query log（`log: ["query"]`）在本機合成資料量測一次硬載入 `/dashboard` 的 SQL 數作為基準。 | (1) `getCurrentAuth` 以 `cache()` 包成「每請求一次」（鍵：`allowUnverifiedMfa` 布林）。(2) 改用 `select`，MFA factor 只取 `id`／是否存在，復原碼完全移出這個查詢（只在 MFA 流程用）。(3) 評估 `relationLoadStrategy: "join"`（Prisma 6.19.3 預設 schema 沒有 `previewFeatures`，需確認是否要在 generator 開 `relationJoins`）。docs：`caching`「Data-level caching」概念；React `cache` 於 `lp/[slug]/page.tsx:19` 已有先例。 | S–M（0.5～1 天；動到 auth，需 `engineer-hard` + `reviewer`） | 否 | **是** |
| B06-02 | MAJOR | `src/app/(app)/layout.tsx:10-53` | 商家殼層（owner／admin）每次渲染做：`requireVendorContext`（B06-01）→ `vendorSubscription.findFirst`（`:17`，與後面的查詢沒有平行）→ `Promise.all[salesProject.findMany, userOnboardingPreference]`（`:22`）→ `onboardingTaskState.findMany`（`:28`，又一段）→ `Promise.all` 6 或 3 個 count（`:31`、`:47`）。約 4 段依序往返，10 餘條 SQL，`projects` 與 `states` 沒有 `take`。 | `loading.md`：「If the layout accesses uncached or runtime data … `loading.js` will not show a fallback for it … Navigation blocks until the layout finishes rendering.」所以 `(app)/loading.tsx` 完全遮不住這些時間：使用者在硬載入、`router.refresh()`、以及任何 `revalidatePath("/", "layout")`（14 處，見 B05-11）之後，都要先等整個殼層。onboarding 面板是輔助資訊，卻擋住所有頁面。 | 讀碼。 | (1) `subscription` 併入 `Promise.all`。(2) onboarding 計算改為 Suspense 內的獨立 server component 或像 Dashboard details 一樣 client 端延後取（`loading.md` 的建議：把 uncached data 從 layout 移到 page 或自己的 `<Suspense>`）。(3) onboarding 任務狀態只在需要時重算，結果可短 TTL 快取。docs：`loading.md`「Good to know」；`layout.md`「Interaction with loading.js」。 | M（1 天） | 否 | **是** |
| B06-03 | MAJOR | `vercel.json`（全檔）；`vercel.staging.json`；`src/lib/db.ts:8-12`；`scripts/preflight.ts`；`docs/launch/CURRENT.md:13` | Production 的函式區域、DB 區域、連線池設定都沒有在 repo 內，也沒有文件。hnd1 只在 staging 的 Vercel 專案設定改過；`new PrismaClient()` 無池參數；preflight 不檢查 `VERCEL_REGION`、DB host、`pgbouncer`、`connection_limit`。 | Production 若沿用 Vercel 預設區域（美東）而 Supabase 在 Tokyo，就會重現 staging 的 Dashboard 逾時；而且是「部署完才發現」，因為沒有任何檢查。連線池沒有上限設定時，聊天／互動輪詢（B06-05）在 Fluid 多實例擴張下容易耗盡 pooler 連線，錯誤表現為隨機 5xx，很難診斷。 | owner 在 Vercel 專案設定與 Supabase 專案頁確認。 | (1) 在 `vercel.json` 明文 `"regions": ["hnd1"]`（Vercel 的設定，Next docs 不涵蓋；`preferredRegion` 已棄用，見 `preferredRegion.md`）。(2) 在 `docs/launch/` 記錄 production 的函式與 DB 區域。(3) `DATABASE_URL` 使用 pooler 網址並明列 `pgbouncer=true&connection_limit=<N>`（N 由負載測試決定，起點可小，例如 3～5）。(4) preflight 加檢查：production 的 DB host 必須是 pooler、字串含 `pgbouncer=true`、`connection_limit`；啟動時記錄 `VERCEL_REGION`。 | S（程式）＋ owner 確認 | **是**（確認 production 區域、方案與 pooler） | **是** |
| B06-04 | MAJOR | `src/proxy.ts:37-47`；`src/lib/public-landing-page-status.ts:122-143`；`src/lib/landing-page-service.ts:613-680`；`src/lib/funnel-runtime.ts:100-134`；`src/app/lp/[slug]/page.tsx:51,55`；`src/app/lp/[slug]/[stepPath]/page.tsx:51` | 每次 `/lp` 瀏覽的 DB 成本：proxy 讀 `content`（1）→ `loadPublicLandingPage` 讀 `content`＋forms＋commerce＋consultation（≥3）→ `resolvePublicFunnelRuntime` 再讀一次 `content`（1）→ 同步 `await recordPublicFunnelVisit` 的 `INSERT`（`lp/[slug]/page.tsx:55`）。至少 6 次往返，其中 1 次寫入阻擋 TTFB，`content` 被讀取並解析 3 次。 | 廣告流量導入漏斗時，DB 被「同一份不變的已發布內容」重複讀取；寫入的訪客紀錄拖慢首位元組。這條路徑是封測階段最直接影響轉換率的頁面。 | 讀碼；`src/app/lp/[slug]/page.test.tsx`、`proxy.test.ts` 可作為改動後的回歸。 | (1) 發布版本內容以 `(pageId, publishedVersionId)` 為鍵跨請求快取（`unstable_cache` + `revalidateTag`，或遷移後 `use cache`），proxy 與 page 共用同一個快取函式。(2) `recordPublicFunnelVisit` 改用 `after()`（`after.md`：回應送出後執行，不阻擋），錯誤進 Sentry 即可。(3) proxy 改輕量預檢（見 B05-04）。注意：商業狀態「講真話」，訪客紀錄寫入失敗不得影響頁面，但也不能默默遺失——`after()` 內失敗要有 `captureOperationalError`。 | M（2～3 天） | 否 | 建議（有廣告流量就必修） |
| B06-05 | MAJOR | `src/components/live-chat-panel.tsx:9,197`；`src/components/live-advanced-interactions.tsx:182`；`src/lib/live-chat.ts:416-472`；`src/app/api/live-interactions/route.ts:216-244`；`docs/market-2026Q4/…/c05_payments_integrations_unit_costs.md:203` | 每位觀眾約 53 req/min、約 185 SQL/min（第 4.3 節）。聊天輪詢每次 4 條 SQL，其中 `activeBlacklists`（`live-chat.ts:328-337`）每次取回商家**全部**啟用中的 blacklist；互動輪詢每 2 秒一次，即使整場沒有任何互動也在跑；兩者都沒有 `visibilityState` 閘門，沒有 `since`／ETag（無變化也回完整 JSON）。市場研究的 Vercel 成本假設 6 req/min／人，實際是 9 倍。 | 300 人場次：約 265 req/s、約 900 SQL/s 持續一小時，全部走 Supabase pooler。小型 Supabase 方案（Micro／Small）撐不住；撐不住的症狀是聊天／互動更新延遲、`stream-usage` 心跳逾時（進而觸發 B06-06）、整站 5xx。Vercel 變動成本約 USD 25／月／商家（仍低），但 DB 是單點。 | 讀碼計數；負載測試前不要宣稱容量。建議先在 staging 用合成觀眾（例如 50／100／300）做一次 5 分鐘壓測，量 pooler 連線數、查詢 p95、5xx。 | 按效益排序：(1) 聊天與互動輪詢加 `document.visibilityState === "visible"` 閘門，背景分頁降到 15～30 秒。(2) 互動輪詢合併進聊天輪詢（單一 `/api/live-state?since=…`），沒有進行中互動時回 304／空 body；間隔放寬到 5 秒並加隨機抖動。(3) 入場驗證改用短效簽章 token（HMAC，帶 `exp`），輪詢路徑只驗章不查 DB；blacklist 以每場快取（TTL 10～15 秒）。(4) 長期評估 Supabase Realtime／SSE 推播取代輪詢（需 owner 決策）。(5) 更新 `docs/market-2026Q4` 的請求量假設。 | M（(1)(3) 約 2 天；(2) 約 3 天；(4) 另案） | **是**（目標同時在線人數、Supabase 方案） | **是**（若封測場次 >50 人同時在線） |
| B06-06 | MAJOR | `src/lib/stream-usage.ts:78-80`（衝突轉額度用完）、`:118-122`、`:148-152`（月帳本 `aggregate`）、`:389`（`isolationLevel: "Serializable"`）；`src/lib/stream-usage-client.ts:57-66`；`src/lib/stream-usage.test.ts:398`（"fails closed when serializable quota admission detects a concurrent write"） | 每位觀眾每 60 秒送一筆用量，伺服器在 **Serializable** 交易內對該商家整月 `streamUsageLedgerEntry` 做 `SUM`，再插入一筆。多位觀眾同時做這件事會造成 SSI 讀寫衝突（Prisma `P2034`），程式把它**轉成 `stream_minutes_exhausted`**（HTTP 429），客戶端把這個回應當作「額度用完」並暫停播放（`live-playback.tsx:641-647`）。沒有重試。 | 同場有幾十位觀眾時，心跳在同一個月帳本範圍上互相衝突是常態而不是例外；結果是：(a) 觀眾被誤報「播放額度已用完」而暫停；(b) 該分鐘的觀看秒數沒有入帳，商家額度與對帳（`StreamUsageReconciliation`）出現落差；(c) 衝突重試風暴放大 DB 負載。這是效能問題，也是帳務正確性問題。程式意圖是 fail closed（測試 `:398` 刻意如此），但 fail closed 不應該用「額度用完」這個對使用者有意義的錯誤碼。 | 讀碼推論；Postgres SSI 行為與 Prisma `P2034` 為已知機制，**尚未在 staging 實測**。建議用 B06-05 的合成觀眾壓測同時觀察 429 比率。 | (1) 把序列化衝突與真正的額度耗盡分開：衝突回 503／`retryable`，客戶端已有 `retryable_failure` 路徑與 500/1000/2000 ms 重試（`live-playback.tsx:526`）。(2) 根本解：不要在每次心跳掃整月帳本。以單列計數器（`VendorUsageLimit.streamMinutesUsed` 或新表）用單一 `UPDATE … SET used = used + n WHERE used + n <= limit` 原子遞增，帳本仍維持 append-only，由定期對帳作業驗證。(3) 這屬於帳務邊界：需 `engineer-hard` 實作與一次獨立 `reviewer`，並更新 `docs/codex-goal/PRISMA_INVARIANTS.md`（若新增表）。 | M–L（2～4 天含測試） | 否（技術決策） | **是**（若封測有 ≥20 人同時在線的場次） |
| B06-07 | MAJOR（成本＋存取控制） | `src/lib/cloudflare-stream.ts:99-106`（`direct_upload` 未設 `requireSignedURLs`）；`src/lib/cloudflare-stream-webhook-handler.ts:47,69`；`src/lib/live-playback-source.ts:65-69`；`src/app/api/stream-usage/route.ts:44-63` | Stream 影片網址固定為公開的 `https://videodelivery.net/<uid>/manifest/video.m3u8` 並存入 DB；入場檢查只管「`/api/live-playback-source` 回不回這個網址」，網址本身永久有效、無簽章、不限來源。用量計量靠客戶端心跳自報。 | 任何看過一次網址的人（含買家分享、瀏覽器開發者工具）可以不經入場、不報名、不計額度地無限觀看；Cloudflare 照分鐘向平台收費（USD 1／1,000 分鐘，`c05_…md:170`）。對付費回放與限時回放（`replayAvailableUntil`）來說，存取控制也形同虛設。 | 讀碼；需 owner 在 Cloudflare 後台確認既有影片是否已設 signed URLs。 | 使用 Stream 的 signed URL：建立資產時 `requireSignedURLs: true`，在 `/api/live-playback-source` 為已入場的觀眾簽發短效 token 並組出播放網址，設 `allowedOrigins`；既有影片需批次更新。同時讓 `stream-usage` 的計量以伺服器簽發的 token 為準。與 `12-tenant-auth.md` 的資產存取一併評估。 | M（2～3 天；動到播放與計量，需 `engineer-hard`） | **是**（是否要保護付費／限時內容） | 建議（若封測包含付費回放） |
| B06-08 | MINOR | `src/lib/cloudflare-stream.ts:173`（`recording.mode = "automatic"`）；`src/components/video-lifecycle-actions.tsx:35`；`src/app/actions/webinar-resource-actions.ts:210-225`；全 repo 無 Stream `DELETE` | 影片「封存」只改 DB 狀態，明確不刪 Stream 資產；Live Input 預設自動錄影，每場直播都會新增一份儲存。沒有保留期限、沒有清理作業。 | Stream 儲存以預付容量區塊計價（USD 5／1,000 分鐘，`c05_…md:170`）。研究情境每月新增 240 分鐘、12 個月累積 2,880 分鐘 ≈ 3 個區塊；多商家、多場次、含彩排與測試錄影時只增不減，且容量用完後「無法上傳或開始新的直播」（同檔 L170）。 | 讀碼。 | 定義保留政策（例如直播錄影 N 天後可刪除、封存超過 M 天自動刪除並先通知商家）；新增伺服器端刪除 job，刪除前檢查沒有直播／頁面引用；Live Input 提供「不錄影」選項。 | M | **是**（保留政策與商家溝通） | 否 |
| B06-09 | MAJOR（決策） | `src/app/api/live-media/route.ts:1-90`；`src/lib/live-media-provider.ts:3-12`；`src/lib/live-media-client.ts:60-65`；`src/app/api/cron/live-media/route.ts`；`docs/live-feature-handoffs/*-evidence.json` | 瀏覽器直播（WHIP／WHEP）依賴 `CELEBRATEDEAL_MEDIA_ORIGIN` 指向的自架媒體伺服器，驗證證據是 MediaMTX。launch 文件（`docs/launch/`）沒有任何關於它的部署、容量、頻寬或營運說明；清理作業 `/api/cron/live-media` 沒有被任何排程驅動（`19-…` B09-01）。 | 每位觀眾 1 條 WebRTC 連線直接從這台伺服器拉流，沒有 CDN；頻寬 ≈ 位元率 × 同時在線人數（例如 2 Mbps × 300 ≈ 600 Mbps），主機與流量費由平台吃，而且是單點。與 Stream（HLS 經 Cloudflare 全球網路、USD 1／1,000 分鐘）是完全不同的成本與容量結構。 | owner 確認封測是否使用 `browser_live`。 | 若封測不含瀏覽器直播：在 UI 隱藏或標示 beta，並在文件寫明未上線。若含：寫容量計畫（單機觀眾上限、頻寬、監控、容器重啟時的行為），排程 `cron/live-media`，或改走 Stream Live（RTMPS 推流 + HLS）。 | 依決策 | **是** | **是**（若在範圍內） |
| B06-10 | MINOR | `src/app/api/live-media/route.ts:55` | 每次媒體心跳（每位觀眾每 20 秒）都先執行 `db.live.findFirst({ include: { video, form, messageTemplate, interactionScript, products: { include: { product } } } })` 與 `getRuntimeLivePublishReadiness`，之後才進入只需 `updateMany` 的 heartbeat 分支。 | 300 位 browser_live 觀眾 ≈ 15 次／秒的重型查詢，只為了更新一個 `expiresAt`。 | 讀碼。 | 把 `heartbeat` 與 `stop` 分支移到 `findFirst` 之前（只需 `liveMediaSession.updateMany` 與必要的狀態檢查）；`offer` 保留完整檢查。 | S | 否 | 否（隨 B06-09） |
| B06-11 | MINOR | 附錄 A 的 29 處；重點：`src/app/(app)/affiliates/commissions/page.tsx:30-45`（`:48-49` 在 JS 加總）；`src/app/(app)/lives/page.tsx:9-13`；`src/app/(app)/affiliates/page.tsx:10-14`；`src/lib/customer-crm.ts:197-220`；`src/app/(app)/lives/new/page.tsx:65-122`（9 個串行）；`src/app/(app)/dashboard/dashboard-details.tsx:102`；`src/app/admin/billing/dashboard/page.tsx:41-98` | 351 個非測試 `findMany` 中 211 個沒有 `take`；其中 29 個還帶 `include`。佣金頁把整張表（含 affiliate 整列）載入後在 JS 加總；直播列表對每場直播取 `video: true`、`form: true`、`products: true` 整列；`lives/new` 把 9 張清單串行載入並全部序列化到 client 元件 props（`LiveStepperForm`）。 | 目前小租戶無感；單一商家累積數千筆佣金／數百場直播後，這些頁面的 DB、記憶體與 RSC payload 會線性成長，且都在 layout（B06-02）之後。 | 掃描腳本結果；清單在附錄 A。 | 金額加總改用 `aggregate`／`groupBy`；列表加 `take` 與游標分頁（`affiliates/policy/page.tsx:18` 已有 `take: 26` 的游標範例）；`include` 改 `select`；`lives/new` 改 `Promise.all`，下拉清單設合理上限並提供搜尋。 | M（各頁 S，合計 2～3 天） | 否 | 否 |
| B06-12 | MINOR | `sentry.server.config.ts:15`；`sentry.edge.config.ts:16`；`src/instrumentation-client.ts:14` | `tracesSampleRate: 0.1` 對全部 route 一視同仁，沒有 `tracesSampler`。 | 300 人場次 265 req/s × 10% ≈ 26 筆交易／秒，一小時約 9.5 萬筆，幾乎全是輪詢；會快速耗盡 Sentry 交易額度，也讓真正需要追蹤的結帳、付款 trace 被稀釋。 | 讀碼。 | 改用 `tracesSampler`：`/api/live-*`、`/api/stream-usage`、`/api/analytics` 取樣 0～0.01，付款／結帳／webhook 取樣高（甚至 1.0）。docs 無關（Sentry 設定）。 | S | 否 | 建議 |
| B06-13 | MINOR | `src/app/layout.tsx:2,27`；`src/components/announcement-center.tsx:115-119`；`src/lib/announcement-feed.ts`；`src/lib/media-upload-client.ts:1`；`src/lib/media-upload-limits.ts` | (1) 根 layout 對所有頁面（含 lp、checkout、live 的買家）載入 `AnnouncementCenter`（14.8 KB）與整份公告資料（11.6 KB），而元件實際只在少數路徑自動彈出。(2) `tus-js-client`（86 KB min）靜態匯入，卻只在影片 >200 MB 時使用，且 `media-upload-field` 被 7 個 client 元件匯入。 | 增加買家頁的 JS 解析成本，行動網路下直接影響 LCP／TBT；沒有 `next build` 的 First Load JS 可佐證，所以只列為 MINOR，建議 B 階段實測。 | 靜態判斷；建議 `next build` 後以 Turbopack Bundle Analyzer 驗證（`package-bundling.md`「Next.js Bundle Analyzer (Experimental)」）。 | (1) 把 `AnnouncementCenter` 移到 `(app)` 與 `login` 的 layout，或以 `next/dynamic` 載入；(2) `tus-js-client` 改在 resumable 分支內 `await import()`（`lazy-loading.md`「Loading external libraries」類似模式，`hls.js` 已有範例）。 | S | 否 | 否 |
| B06-14 | NIT／INFO | `next.config.ts:31`；`src/lib/r2-images.ts:6,118-122`；`src/components/landing-pages/landing-page-puck-config.tsx:79,85,88` | (1) `images.unoptimized: true` 是刻意決策（避免 Image Optimizer 變成開放代理）；代價是所有圖片原樣送出。UI 上傳已縮到 ≤1280／1600 寬 JPEG，所以 UI 來源的圖片大小可控；商家貼的外部網址則完全無法控制。(2) R2 `PutObjectCommand` 沒有 `CacheControl`，但物件鍵是 UUID（不可變）。(3) 縮圖一律輸出 JPEG q0.92，PNG／GIF 的透明度會遺失。 | (1) Vercel Image Optimization 在 hnd1 為 USD 0.0661／千次轉換（`c05_…md:174`），關閉優化器在成本上是合理取捨。(2) 沒有長快取時，瀏覽器每次回訪都重新驗證。(3) 商家 logo／去背素材會變白底。 | 讀碼。 | (1) 保持現狀；若 LCP 成為問題，在 R2 前面用 Cloudflare 的圖片轉換而不是 Vercel。(2) 簽 PUT 時加 `CacheControl: "public, max-age=31536000, immutable"`（客戶端需帶同一標頭）。(3) 保留 PNG／WebP 輸出，僅對相片類使用 JPEG。 | S | 否 | 否 |

## 8. 建議排序

1. **封測前（工程）**：B06-01（auth 快取＋瘦身）、B06-02（layout 平行化與延後）、B06-03（區域＋連線池＋preflight）。這三件做完，Dashboard 類頁面的往返次數預期減半以上，也補上 production 的區域缺口。
2. **封測前（若有直播場次）**：B06-05(1)(3)（輪詢閘門＋簽章入場）、B06-06（用量計量改單列計數器；帳務領域，`engineer-hard` + `reviewer`）、B06-12。先用合成觀眾壓測（50／100／300）決定規模目標。
3. **需 owner 決策**：B06-03（production 區域與 Supabase 方案）、B06-07（付費回放是否要簽章保護）、B06-08（Stream 保留政策）、B06-09（封測是否使用 browser_live）。
4. **隨公開漏斗設計**：B06-04 與 `15-…` B05-04（內容快取＋`after()`＋輕量預檢）。
5. 其餘 MINOR／NIT 排入一般 backlog。

## 附錄 A：沒有 `take` 且含 `include` 的 `findMany`（29 處）

`src/app/(app)/affiliates/commissions/page.tsx:30,35`、`src/app/(app)/affiliates/page.tsx:10`、`src/app/(app)/billing/electronic-invoices/export/route.ts:12`、`src/app/(app)/billing/electronic-invoices/page.tsx:13`、`src/app/(app)/billing/payouts/page.tsx:17`、`src/app/(app)/billing/settlements/page.tsx:16`、`src/app/(app)/lives/page.tsx:9`、`src/app/(app)/partner-pages/page.tsx:74`、`src/app/(app)/settings/security/page.tsx:101`、`src/app/(app)/settings/team/page.tsx:48,62`、`src/app/(app)/support-cases/[id]/page.tsx:136`、`src/app/(app)/team-templates/new/page.tsx:11`、`src/app/(app)/team-templates/page.tsx:16`、`src/app/(app)/team-templates/[id]/edit/page.tsx:11`、`src/app/actions.ts:1884`、`src/app/admin/billing/course-payouts/page.tsx:22`、`src/app/admin/billing/payouts/page.tsx:26`、`src/app/admin/billing/platform-referral-payouts/page.tsx:23`、`src/app/admin/billing/settlements/page.tsx:49`、`src/lib/customer-crm.ts:197,198,204,205,214,218,219,220`。

註：腳本以「呼叫區塊內是否出現 `take`」判斷，巢狀 `take`（例如 `include` 內的 `items.take`）也算有界，所以實際上列表主體無界的比例可能略高；`distinct` 查詢（例如 `lives/[id]/analytics/page.tsx:29-37`）回傳列數與觀眾數相關，也未計入。

## 附錄 B：輪詢清單

| 元件 | 間隔 | 端點 | 可見性閘門 |
|---|---|---|---|
| `live-chat-panel.tsx:9,197` | 3 秒 | `/api/live-chat/messages` | 無 |
| `live-advanced-interactions.tsx:182` | 2 秒 | `/api/live-interactions` | 無 |
| `live-playback.tsx:365` | 30 秒 | `/api/live-admission` | 無 |
| `live-playback.tsx`（用量） | 60 秒累積 | `/api/stream-usage` | 隨播放狀態 |
| `live-media-client.ts:60-65` | 20 秒 | `/api/live-media` | 無 |
| `live-danmaku.tsx`（未被任何頁面掛載） | 2 秒 | `/api/live-danmaku` | 有 |
| `live-instructor-private-chat.tsx:46`（講師端） | 15 秒 | `/api/live-chat/private` | 有 |
| `instructor-interaction-cards.tsx:25`（講師端） | 3 秒 | `/api/live-interactions/cards` | 無 |
| `live-interaction-studio.tsx:45`（講師端） | 2 秒 | Server Action `getLivePollStudioSnapshotAction`（見註） | 無 |
| `video-provider-status.tsx:6-7` | 4 秒 × 最多 15 次 | `/api/media/videos/status` | 無（有上限） |

註：講師端 `live-interaction-studio.tsx:45` 以 **Server Action** 每 2 秒輪詢。`server-actions.md`「Sequential dispatch on the client」說明 Next.js 在單一 client 內一次只派送一個 Server Action，後續的會排隊；因此輪詢中的 action 會讓講師按下「開始互動」「抽獎」等操作多等一個往返。建議改成 route handler（GET）輪詢，與觀眾端一致（同段落建議：非 mutation 請求用 Route Handler）。僅影響講師端，MINOR。
