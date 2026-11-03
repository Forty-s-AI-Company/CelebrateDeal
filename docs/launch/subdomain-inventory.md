# 子網域與主機名盤點（F-157：HSTS `includeSubDomains`）

- 日期：2026-11-03
- 依據來源：`next.config.ts`（`Strict-Transport-Security: max-age=63072000; includeSubDomains`，沒有 `preload`）；`vercel.json`、`vercel.staging.json`；`docs/review-2026Q4/10-findings-register.md` F-157 與 `19-observability-ci-supply-chain.md` B09-19；`docs/staging-production-env-vars.md` §7（2026-10-25 查核紀錄）；`docs/goal-beta-prep-2026Q4/OWNER-ACTIONS.md` O-7、O-18、O-26；`.github/workflows/scheduled-jobs.yml`；`scripts/scheduled-jobs-runner.mjs`；`.env.production.example`、`.env.staging.example`；`docs/production-infrastructure-plan.md`、`docs/production-launch-task-breakdown.md`；repo 內程式與文件出現的網域（用搜尋比對 `carry-digital-nomad.in.net`、`vercel.app`、`celebratedeal.com`、`supabase.co`、`payuni.com.tw` 等）。
- 配套：[production-cutover-runbook.md](production-cutover-runbook.md) S11（公開 alias 前必須完成本表）。
- 狀態：**主對話只能從 repo 與先前紀錄盤點，沒有 Cloudflare DNS 的存取權。DNS 內的實際子網域清單必須由 owner 核對，這是本盤點的未完成部分。**

## 1. 先弄清楚 HSTS 到底影響誰

回應標頭 `Strict-Transport-Security: max-age=63072000; includeSubDomains` 的意思是：瀏覽器收到它之後的 **兩年（63072000 秒）** 內，對「**送出這個標頭的那個主機**」以及「**它底下的所有子網域**」一律強制使用 HTTPS，即使使用者輸入 `http://`，也不會有降級選項。

- 範圍是「送出標頭的主機」往下，**不會往上**影響父網域，也不影響同層的其他主機。
  - 例：`celebratedeal.carry-digital-nomad.in.net` 送出標頭，則受影響的是它本身與 `*.celebratedeal.carry-digital-nomad.in.net`；`carry-digital-nomad.in.net` 本身與 `celebrate-deal-staging.carry-digital-nomad.in.net` **不受影響**（後者自己也送同樣的標頭，只管它自己底下的子網域）。
- 沒有 `preload`，所以不會進瀏覽器內建的 preload 清單；風險只存在於「曾經造訪過我們主機的瀏覽器」。未完成本盤點前**不要加 `preload`**。
- 兩年的記憶時間很長：一旦公開後發現某個子網域沒有 HTTPS，已造訪過的使用者在兩年內都連不上，回頭移除標頭也救不了他們（要靠送出 `max-age=0` 才能清除）。所以要在公開前核對。
- 實際風險取決於「Production 最後用哪個主機名」：
  - 若用 `celebratedeal.carry-digital-nomad.in.net`（目前紀錄的正式網域）：只要核對 `*.celebratedeal.carry-digital-nomad.in.net` 底下有沒有子網域。目前 repo 與文件**沒有出現**任何這個主機的子網域，所以預期風險很低，仍須由 owner 在 DNS 確認。
  - 若改用自己的網域的**根網域**（例如把 `celebratedeal.com` 本身當 app 主機）：該網域底下所有子網域（`www.`、`mail.`、`staging.`、`api.`、Resend 的寄信子網域、客服系統等）都在範圍內，風險最大。建議用 `app.` 這類專用子網域作為 app 主機，把影響限縮在 `*.app.<網域>`。
  - 程式沒有商家子網域或自訂網域功能（程式碼與 Prisma schema 中沒有 customDomain／wildcard 相關欄位），商家頁面都在同一個主機的路徑下（例如 `/lp/*`），不會因商家產生新的子網域。

## 2. 已知主機名（來源：repo 與先前查核紀錄）

「是否 HTTPS」欄只寫有證據的事實；沒有證據寫「待確認」。「誰確認」欄：主對話＝可由主對話以外部 HTTP 探測；owner＝需要 Cloudflare／Vercel／registrar 後台。

### 2.1 我方應用程式主機

| 主機名 | 用途 | 是否 HTTPS | 目前狀態與證據 | 誰確認 |
|---|---|---|---|---|
| `celebrate-deal-staging.carry-digital-nomad.in.net` | staging 固定網址：封測商家使用；`scheduled-jobs.yml` 與 `scheduled-jobs-runner.mjs` 的固定目標；PayUni Sandbox 回呼 | 是（Vercel 憑證；2026-10-25 smoke `/api/health` 200） | 公開，跑 master（含 #485） | 主對話（每次切 alias 後） |
| `celebratedeal.carry-digital-nomad.in.net` | **Production 正式網域**（`OWNER-ACTIONS.md` O-18、O-26；Production custom domain） | 公開前待確認 | 2026-10-25 起移除 alias，目前回 404；S11 才重新指派 | owner（指派前）、主對話（指派後探測） |
| `celebrate-deal.vercel.app` | Production 專案的 Vercel 預設網域 | 是（Vercel 提供） | 2026-10-25 起回 404；**部署 Production 時不得自動指派**（runbook S7） | 主對話 |
| `celebrate-deal-staging.vercel.app` | staging 專案的 Vercel 預設網域 | 是 | 403（Vercel Authentication） | 主對話 |
| `celebrate-deal-rollback.carry-digital-nomad.in.net` | 舊的回滾用網域（`staging-production-env-vars.md` §7 的查核清單） | 待確認 | 2026-10-25 回 403（Vercel Authentication）；是否仍在 DNS／Vercel 網域清單內待 owner 確認，**不再需要時應移除** | owner |
| `celebrate-deal-staging-<雜湊>-a25814740s-projects.vercel.app` 等 `*.vercel.app` 部署網址 | staging 與 Production 的每次部署自帶的 immutable 網址（repo 內出現的例如 `-jtozttm8m-`、`-g1b7eu9um-`、`-i6bawqmuo-` 等舊部署） | 是（Vercel 提供） | 在 Vercel Authentication 之後（403／302）；**舊 Production 部署（07-24 build）絕不可公開** | 主對話 |

### 2.2 文件與範例中出現、但是否存在不明的主機

這些只出現在 `.env.*.example` 或規劃文件，**沒有證據顯示已註冊或已設定**。若 owner 要用 `celebratedeal.com`，這張表就是 DNS 核對清單；若不用，請告知，會從文件中移除以免誤導。

| 主機名 | 出現位置 | 預期用途 | 是否 HTTPS | 誰確認 |
|---|---|---|---|---|
| `app.celebratedeal.com` | `.env.production.example`、`production-infrastructure-plan.md` | 範例中的 Production app 主機 | 待確認（網域是否由 owner 持有、是否已建立） | owner |
| `staging-app.celebratedeal.com` | `.env.staging.example`、`external-service-validation-runbook.md` | 範例中的 staging app 主機（實際 staging 用的是 `celebrate-deal-staging.carry-digital-nomad.in.net`） | 待確認 | owner |
| `www.celebratedeal.com`、`api.celebratedeal.com` | `production-infrastructure-plan.md` 的待辦清單 | 官網／API（尚未決定） | 待確認 | owner |
| `staging.celebratedeal.com` | `.env.staging.example` 的 `EMAIL_FROM` | staging 寄件網域 | 寄信用，不一定有 HTTP | owner |
| `mail.celebratedeal.com` | `production-launch-task-breakdown.md` | 正式寄件網域（Resend） | 寄信用；若根網域是 app 主機，此子網域落在 HSTS 範圍內，若有網頁需 HTTPS | owner |

### 2.3 第三方主機（程式連線或 CSP 允許；不在我方 HSTS 範圍內）

我方標頭只約束我方網域的子網域，下列第三方主機各自負責自己的 HTTPS，列出只為完整：

| 主機名 | 用途 | 出處 |
|---|---|---|
| `sandbox-api.payuni.com.tw`、`api.payuni.com.tw`、`sandbox.payuni.com.tw`、`www.payuni.com.tw`、`docs.payuni.com.tw` | PayUni 測試／正式 API、後台與文件 | `next.config.ts`（`connect-src`、`form-action`）、`payuni.ts` |
| `challenges.cloudflare.com` | Turnstile | `next.config.ts` |
| `upload.videodelivery.net`、`upload.cloudflarestream.com`、`videodelivery.net`、`*.cloudflarestream.com` | Cloudflare Stream 上傳與播放 | `next.config.ts`、Stream 整合 |
| `api.cloudflare.com` | Cloudflare API | `next.config.ts` |
| `*.sentry.io`、`*.posthog.com`、`app.posthog.com` | 監控與分析 | `next.config.ts`、`.env.*.example` |
| `api.resend.com` | 寄信 | Email 整合 |
| `*.pooler.supabase.com`、`db.<專案 ref>.supabase.co` | 資料庫連線（非 HTTP） | 連線字串格式 |
| `www.youtube-nocookie.com` | 漏斗頁影片嵌入 | `next.config.ts` |

## 3. 需要 owner 在 Cloudflare DNS（與 registrar）核對的項目

請匯出（或截圖）`carry-digital-nomad.in.net` 與（若使用）`celebratedeal.com` 兩個區域的完整 DNS 紀錄，逐條回答：

1. 有沒有任何 `*.celebratedeal.carry-digital-nomad.in.net`（含萬用字元 `*` 記錄）的記錄？有的話，是否都有有效 HTTPS 憑證，還是只是 TXT／MX 之類不提供網頁的記錄？
2. 有沒有萬用字元記錄（`*.<網域>`）把任意子網域導到沒有 HTTPS 的主機？
3. `celebrate-deal-rollback.carry-digital-nomad.in.net` 是否還存在？不再使用就刪除。
4. Production 最終要用哪一個主機名？（決定 HSTS 的實際範圍；建議使用專用子網域，不要用根網域。）
5. Resend 寄信用的子網域（`send.`、`mail.` 等）與 DKIM／SPF 記錄是否位於 app 主機的子網域下？如果是，這些子網域不應提供沒有 HTTPS 的網頁。
6. 這兩個網域底下有沒有其他專案（例如個人網站、舊測試站）使用的子網域？只要它們在 Production 主機之下，就在範圍內。
7. O-7：正式網域是否全程經過 Cloudflare 橘雲代理、且沒有其他直連入口（目前 staging 回應 `server: Vercel`、沒有 `cf-ray`，表示 staging 沒有經過 Cloudflare 代理）。

回報格式：每個主機名一行，寫「有 HTTPS／無網頁服務／不存在」。

## 4. 完成條件與後續

- ☐ 2.1 的 Production 主機：owner 確認其底下沒有任何沒有 HTTPS 的子網域（或沒有子網域）。
- ☐ 2.2 的每一列：owner 回覆「使用中／不使用」，使用中者確認 HTTPS。
- ☐ 3 的 7 個問題皆回覆。
- ☐ 主對話在 S11 指派網域後，對 2.1 的每個公開主機以 `curl -sI` 驗證 HTTPS 回應與 HSTS 標頭，把結果記入 `production-cutover-receipt`。
- 本表完成前，不要把 `preload` 加進 HSTS 標頭，也不要把根網域當作 app 主機。
- 若日後新增子網域（例如商家自訂網域、文件站），在建立前先更新本表。
