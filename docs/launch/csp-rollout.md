# CSP 正式啟用（F-156）

最後更新：2026-11-03（Asia/Taipei）

來源：`docs/review-2026Q4/10-findings-register.md` F-156、`23-remediation-backlog.md` 第 53 列（先記錄報告→補來源→移除 `unsafe-eval`→nonce；form-action 實測 PayUni 與 LINE）。

## 1. 現在的做法

| 項目 | 位置 | 內容 |
|---|---|---|
| 政策產生 | `src/lib/content-security-policy.ts` | 每個來源都註明對應功能；本文件第 3 節是同一張表 |
| 每次請求的 nonce | `src/proxy.ts` | 每份 HTML 產生 128 位元 nonce，寫入 request 的 `Content-Security-Policy`（Next.js 由此取 nonce 蓋在框架 script 上）與 `x-nonce`；用戶端送來的同名標頭一律覆寫 |
| 讀取 nonce | `src/app/layout.tsx`、`src/app/lp/[slug]/layout.tsx`、`src/components/csp-nonce.tsx` | root layout 讀 `x-nonce`（也因此所有頁面都是動態渲染，nonce 政策的必要條件），以 context 交給 `next/script`（Turnstile、GA4、Meta Pixel） |
| 回報 | `POST /api/security/csp-report` | 同時用 `report-uri` 與 `report-to`（`Reporting-Endpoints: csp-endpoint="/api/security/csp-report"`）。每 IP 每分鐘 120 次、body 64 KiB、每次最多 20 筆；只記 disposition、directive、blocked（關鍵字／scheme／origin）、source（同上）、文件路徑（無 query、ID 型區段換成 `:id`），每個相異違規寫一行 `csp_violation` log |
| 雙軌開關 | `CSP_ENFORCE` | 未設定／`false`＝只送 `Content-Security-Policy-Report-Only`；`true`＝送強制的 `Content-Security-Policy`，另送一份 Report-Only 預覽下一步（`<style>` 元素也要 nonce）。其他值 preflight FAIL，執行時視為未啟用 |
| 不經 proxy 的路徑 | `src/proxy.ts` 的 matcher | `/api/*`（JSON；PayUni 交接頁自帶 hash CSP）、`/_next/static`、`/_next/image`、`/monitoring`（Sentry tunnel）、`/sandbox/custom-code`（自帶 CSP）、課程證書 SVG（自帶 `sandbox` CSP，proxy 標頭會蓋掉它）、`/public` 的靜態檔（含簡報背景分割 worker 與 wasm） |

查 log：Vercel Logs 搜尋 `csp_violation`，依 `directive`＋`blocked`＋`documentPath` 分組；`disposition: "enforce"` 代表真的被擋。`source` 為 `chrome-extension` 等 scheme 的通常是使用者的瀏覽器擴充功能，可忽略。

## 2. 最終政策

`{N}` 是每次請求的 nonce。以下為 production（`NODE_ENV=production`）。

### 2.1 主站（`/lp/*` 以外的所有頁面）

```
default-src 'self';
script-src 'self' 'nonce-{N}' 'strict-dynamic' https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data:;
media-src 'self' blob: https://videodelivery.net https://*.videodelivery.net https://*.cloudflarestream.com https:;
frame-src 'self' https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com;
connect-src 'self' https://challenges.cloudflare.com https://videodelivery.net https://*.videodelivery.net https://*.cloudflarestream.com https://*.r2.cloudflarestorage.com;
worker-src 'self' blob:;
object-src 'none';
frame-ancestors 'none';
base-uri 'self';
form-action 'self' https://api.payuni.com.tw https://sandbox-api.payuni.com.tw;
report-uri /api/security/csp-report;
report-to csp-endpoint
```

### 2.2 公開一頁式網站（`/lp/*`，開發用 `/browser-qa/*` 相同）

主站政策再加上：

| directive | 追加 |
|---|---|
| `script-src` | `https://www.googletagmanager.com https://connect.facebook.net` |
| `style-src` | `https:` |
| `font-src` | `https:` |
| `connect-src` | `https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.facebook.com` |

`/lp/*` 另保留 `Cross-Origin-Opener-Policy: same-origin`（next.config.ts）。

### 2.3 `CSP_ENFORCE=true` 時

- `Content-Security-Policy`：上面的政策（強制）。
- `Content-Security-Policy-Report-Only`：同一政策再加 `style-src-elem 'self' 'nonce-{N}'`（`/lp` 另含 `https:`）與 `style-src-attr 'unsafe-inline'`，只回報、不阻擋，用來找出移除 style `'unsafe-inline'` 前還要處理的 `<style>` 元素。

### 2.4 開發模式（`next dev`）

`script-src` 加 `'unsafe-eval'`（React 開發模式用 eval 重建伺服器錯誤堆疊）；`connect-src` 加 `https://*.sentry.io`（開發時 Sentry 不走 `/monitoring` tunnel，直接送 ingest）。production 兩者都沒有。

### 2.5 自訂程式碼沙箱文件 `/sandbox/custom-code`

一頁式網站的「自訂程式碼」含 JS 時（#499），iframe 不再用 `srcdoc`：srcdoc 會繼承父頁的 nonce 政策，商家 inline script 無法執行；而讓主站 `script-src` 含 `'unsafe-inline'` 會讓整站失去 XSS 防護。改為載入這個同源文件，回應自帶政策：

```
sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox;
default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:;
img-src https: data:; font-src https:; media-src https:; frame-src https:;
connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none';
worker-src 'none'; manifest-src 'none'; frame-ancestors 'self'
```

- iframe 的 `sandbox` 屬性不變（後台 `allow-scripts`；公開頁另加兩個 popup 旗標），沒有 `allow-same-origin`，文件是不透明來源，碰不到平台 Cookie、DOM 與儲存。`sandbox` directive 讓直接開啟此網址時也是不透明來源。
- 文件只有一段啟動腳本：被嵌入時才向直接父頁送 ready，只接受父頁送來的第一份文件並 `document.write`。父頁只在 `event.source` 是自己的 iframe 時回應。
- 只有這個路徑的 `X-Frame-Options` 由全站 `DENY` 改為 `SAMEORIGIN`，且有 `frame-ancestors 'self'`；其他安全標頭不變。
- 沒有 JS 的自訂程式碼仍用 `srcdoc` 與 `sandbox=""`（不執行腳本），因此 `/lp` 保留 `style-src https:` 與 `font-src https:`。

## 3. 來源對應功能

| 來源 | directive | 功能 |
|---|---|---|
| `'self'` | 全部 | 平台自己的頁面、API、`/_next/static`、字型 `/fonts`、Sentry tunnel `/monitoring`、自訂程式碼沙箱文件 |
| `'nonce-{N}'` + `'strict-dynamic'` | script-src | Next.js 框架與頁面 chunk；由帶 nonce 的 script 動態載入的 chunk、Turnstile 內部載入、GA4／Meta Pixel 後續載入 |
| `https://challenges.cloudflare.com` | script-src、frame-src、connect-src | Cloudflare Turnstile（`/register`、重寄驗證信） |
| `'unsafe-inline'` | style-src | React `style` 屬性、第三方元件（如 Turnstile）可能注入的 `<style>`、商家頁面自訂 CSS（`<style data-funnel-custom-css>`）、static 自訂程式碼 srcdoc 內的 `<style>`（見第 4 節） |
| `data:`、`blob:`、`https:` | img-src | 商家上傳到 R2 的圖片（公開網域）、商家填寫的外部 https 圖片、上傳前預覽（blob:）、DiceBear 互動角色頭像、內嵌小圖（data:） |
| `data:` | font-src | 內嵌字型 |
| `blob:` | media-src | hls.js 以 MediaSource 播放 Stream（blob: URL） |
| `https://videodelivery.net`、`https://*.videodelivery.net`、`https://*.cloudflarestream.com` | media-src、connect-src | Cloudflare Stream 直播與回放的 manifest／segment（含 F-093 簽章網址，PR #538）、Stream 直接上傳與 tus 上傳（`upload.videodelivery.net`、`upload.cloudflarestream.com`） |
| `https:` | media-src | 商家填寫的外部 https 影片檔 |
| `https://*.r2.cloudflarestorage.com` | connect-src | 商品／品牌圖片與基本影片的 R2 presigned PUT 上傳 |
| `https://www.youtube-nocookie.com` | frame-src | 一頁式網站影片庫（YouTube 隱私強化模式）與舊版區塊的 YouTube 影片 |
| `https://player.vimeo.com` | frame-src | 舊版區塊的 Vimeo 影片（原政策漏列，本次補上） |
| `'self'`、`blob:` | worker-src | 講師後台背景分割 worker（`/presenter-segmentation/worker.js`）；hls.js transmux worker（blob:） |
| `https://api.payuni.com.tw`、`https://sandbox-api.payuni.com.tw` | form-action | PayUni UPP 結帳與綁卡表單 POST |
| `https://www.googletagmanager.com`、`https://connect.facebook.net` | script-src（僅 `/lp`） | 平台產生的 GA4 gtag.js 與 Meta Pixel（只有商家設定的 ID），CSP2 瀏覽器的退路 |
| GA4／Meta 收集網域 | connect-src（僅 `/lp`） | GA4 與 Meta Pixel 事件送出 |
| `https:` | style-src、font-src（僅 `/lp`） | static 自訂程式碼 srcdoc（繼承父頁政策）與頁面自訂 CSS 載入外部樣式與字型 |
| `https://*.sentry.io` | connect-src（僅開發） | 開發模式 Sentry SDK 直送 ingest |

### 3.1 不需要、本次移除的來源（原 Report-Only 有列）

| 原來源 | 原 directive | 為何不需要 |
|---|---|---|
| `'unsafe-inline'`、`'unsafe-eval'` | script-src | 改用 nonce；production 的 React／Next.js 不使用 eval |
| `https://*.sentry.io` | script-src | Sentry SDK 打包在 bundle 內，不從 sentry.io 載入 script；production 送出走 `/monitoring`（connect-src 只在開發保留） |
| `https://*.posthog.com`、`https://app.posthog.com` | script-src、connect-src | PostHog 只在伺服器端呼叫（`src/lib/product-analytics.ts`），瀏覽器不連線 |
| `https://api.cloudflare.com` | connect-src | Cloudflare API 只在伺服器端呼叫 |
| `https://*.payuni.com.tw`、`https://sandbox-api.payuni.com.tw` | connect-src | 瀏覽器不以 fetch 呼叫 PayUni；付款頁是表單導向（form-action 保留） |
| `https:` | `/lp` 的 script-src、frame-src | 原本是為了讓 script 模式的 srcdoc 繼承；改用沙箱文件後不需要 |

### 3.2 不需要列的服務

- **LINE Login／綁定**：`/api/auth/line/start` 以 fetch 取得授權網址後由 `location` 導向 `access.line.me`，屬頁面導覽，不受 form-action／connect-src 管；token 交換在伺服器端。目前沒有 LIFF SDK。
- **Resend、PayUni API、Cloudflare API、PostHog**：只在伺服器端。
- **Google Fonts**：未使用；字型自架在 `/fonts/funnel` 與 Next.js 輸出。
- **WebRTC（WHEP）直播**：信令走同源 `/api/live-media`，媒體走 RTCPeerConnection，不受 CSP 管。

## 4. 無法移除的 `unsafe-*`

| 值 | 位置 | 原因 | 下一步 |
|---|---|---|---|
| `'unsafe-inline'` | 主站與 `/lp` 的 `style-src` | React `style` 屬性遍布 UI（nonce 不涵蓋屬性）；第三方元件（如 Turnstile）可能注入 `<style>`；商家頁面自訂 CSS 是 inline `<style>`；static 自訂程式碼的 srcdoc 繼承父頁政策，內含 `<style>`。style-src 一旦加 nonce，瀏覽器就會忽略 `'unsafe-inline'` | `CSP_ENFORCE=true` 時的 Report-Only 預覽（`style-src-elem` 需 nonce、`style-src-attr` 仍允許）會列出所有未帶 nonce 的 `<style>` 元素，處理完再收緊 |
| `'unsafe-inline'` | `/sandbox/custom-code` 的 `script-src`、`style-src` | 商家 JS／CSS 原樣執行是此功能本身；只存在於不透明來源、無網路 API 的沙箱文件，不在主站政策 | — |
| `'unsafe-eval'` | 僅開發模式 `script-src` | React 開發模式需要；production 沒有 | — |

主站（含 `/lp`）`script-src` 已沒有 `'unsafe-inline'`、`'unsafe-eval'`、`https:` 或萬用字元。

## 5. 效能影響

nonce 必須每次請求產生，root layout 讀取 request 標頭後所有頁面改為動態渲染（`/policies` 原本的 ISR 也一樣），不再有靜態預先渲染或 CDN 快取的 HTML。API、靜態檔與 `_next/static` 不受影響。

## 6. 啟用步驟

1. **收集報告（目前）**：部署後不設 `CSP_ENFORCE`。觀察 Staging 與 Production 的 `csp_violation` log 至少一週，排除擴充功能雜訊；任何 `disposition: "report"` 且 `source` 是平台網域或 `blocked` 是平台需要的來源，就補進 `content-security-policy.ts` 並同步本文件。
2. **Staging 開強制**：Staging 設 `CSP_ENFORCE=true` 重新部署，preflight 應顯示 `CSP_ENFORCE: CSP 已啟用強制模式`。走完第 7 節清單，每頁打開 DevTools Console 確認沒有 `Refused to ...` 的 CSP 錯誤，並查 log 無 `disposition: "enforce"` 的平台來源違規。
3. **Production 開強制**：Staging 通過且 owner 同意後，Production 設 `CSP_ENFORCE=true` 重新部署，前 24 小時盯 `csp_violation` 的 `enforce` 筆數。

### 回滾

把 `CSP_ENFORCE` 從該環境移除（或設 `false`）後重新部署。Report-Only 與回報照常，不影響其他安全標頭。若問題出在某個來源，修正 `content-security-policy.ts` 後重新部署即可，不需要關閉回報。

## 7. Staging 強制模式實測清單

每一項都在 DevTools Console 確認沒有 CSP 錯誤（`Refused to load`／`Refused to execute`／`Refused to frame`／`Refused to connect`），並記錄頁面與結果。

| # | 流程 | 要看的來源 |
|---|---|---|
| 1 | 首頁、`/login`、`/register`（含 Turnstile 顯示與通過）、`/verify-email` 重寄（Turnstile）、`/password-reset` | nonce script、`challenges.cloudflare.com` script／frame／connect |
| 2 | 商家後台主要頁面切換（dashboard、商品、直播、影片、一頁式網站列表與編輯器）、Server Action 送出 | 動態 chunk（strict-dynamic）、表單 |
| 3 | 圖片上傳（商品／品牌圖片，R2 presigned PUT）與影片上傳（Stream 直接上傳、tus 大檔） | `*.r2.cloudflarestorage.com`、`upload.videodelivery.net`／`upload.cloudflarestream.com` |
| 4 | 結帳：一頁式網站或商品頁 → PayUni Sandbox 付款頁 → 付款完成回跳 `/checkout/result`；方案升級 `/billing/plans` → PayUni 交接頁；綁卡（payment methods） | form-action PayUni 兩個網域、交接頁自帶 CSP、回跳頁 |
| 5 | LINE 綁定（商家帳號）、LINE 登入（買家支援）、LINE 註冊 → `access.line.me` → callback 回站 | 導向不被擋；回站頁正常 |
| 6 | 直播觀看：公開觀看頁（HLS 與 WHEP 兩種）、聊天與互動輪詢 | `videodelivery.net`／`*.cloudflarestream.com` media／connect、hls.js blob: 與 worker |
| 7 | Stream 回放與簽章網址（F-093）、影片預覽頁、promo 影片 | 同上 |
| 8 | 講師後台 `/lives/{id}/presenter` 開啟背景分割 | `worker-src 'self'`、worker 內 wasm（worker 不經 proxy，無 nonce 政策） |
| 9 | 一頁式網站公開頁 `/lp/{slug}`：影片庫 YouTube、舊版區塊 YouTube／Vimeo、報名表、倒數、彈窗 | `youtube-nocookie.com`、`player.vimeo.com` |
| 10 | 一頁式網站「自訂程式碼」：含 JS 的區塊在公開頁與後台預覽都會執行並自動調整高度、外部 https script 可載入、按鈕開新分頁（無 opener）；沒有 JS 的區塊照常顯示；`FUNNEL_CUSTOM_CODE_DISABLED=1` 時不執行 | `/sandbox/custom-code` 回應帶 sandbox CSP 與 `X-Frame-Options: SAMEORIGIN`；沙箱內 fetch 被擋屬預期 |
| 11 | 追蹤整合：設定 GA4 Measurement ID 與 Meta Pixel ID 的一頁式網站，GA4 DebugView／Meta Pixel Helper 看到事件 | `googletagmanager.com`、`connect.facebook.net`、GA／Meta connect |
| 12 | 頁面自訂 CSS 的一頁式網站 | style `'unsafe-inline'`（強制模式不擋；Report-Only 預覽會回報，屬預期） |
| 13 | 學員入口 `/portal/{vendor}`：登入、課程、社群、證書下載（SVG 自帶 CSP） | 證書不帶 proxy 政策 |
| 14 | 後台 admin（財務、帳務、對帳）與 MFA 驗證頁 | nonce script |
| 15 | Sentry：在 Staging 觸發一次前端錯誤，確認經 `/monitoring` 送達 | `'self'` |
| 16 | `/api/security/csp-report`：刻意在 Console 執行 `eval("1")`，log 出現 `csp_violation`、`blocked: "eval"`、`disposition: "enforce"` | 回報管線 |

本機 `next start` 已驗證的範圍見 PR 說明（首頁、登入頁、註冊頁與自訂程式碼沙箱）；外部服務（PayUni、LINE、Stream、Turnstile、GA／Meta）只能在 Staging 驗證。
