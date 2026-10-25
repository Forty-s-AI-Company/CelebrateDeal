# CelebrateDeal Staging / Production Env Vars 對照表

最後更新：2026-10-19

## 1. 使用原則

- 真實 secret 只放 Vercel Environment Variables、GitHub Actions Secrets 或本機 `.env.*.local`。
- 本 repo 只提交 `.env.example`、`.env.staging.example`、`.env.production.example`。
- `NEXT_PUBLIC_*` 會進瀏覽器 bundle，不可放 secret。
- Preview / staging 不可使用 production database。經商店權限核對與隔離審查後，指定 staging 才可暫時使用 CelebrateDeal 正式 PAYUNi 商店做真實小額測試。

## 2. 對照表

| Key | Staging | Production | 來源 | 驗收標準 |
|---|---|---|---|---|
| `DATABASE_URL` | Supabase staging transaction pooler（6543）＋`pgbouncer=true&connection_limit=<N>` | Supabase production transaction pooler（6543）＋`pgbouncer=true&connection_limit=<N>` | Supabase Project Settings | `/api/health` DB ok；preflight 的 `DATABASE_POOLER*`、`DATABASE_CONNECTION_LIMIT` 為 PASS（見 §6） |
| `EXPECTED_FUNCTION_REGION` | 選填；只用來驗證，與 Vercel 設定檔的 `regions` 不一致時警告 | 選填；同左。**設這個值不會換區域**，換區域必須改 Production 實際讀取的 Vercel 設定檔 | 部署設定 | preflight `FUNCTION_REGION`／`DATABASE_REGION` 為 PASS |
| `VERCEL_CONFIG_FILE` | `vercel.staging.json`（由 staging 的 buildCommand 設定） | 不設（讀 `vercel.json`） | 部署設定 | 只接受 `vercel.json`、`vercel.staging.json`；其他值一律改讀 `vercel.json` |
| `DATABASE_REGION` | 選填；AWS 區域 ID，例如 `ap-northeast-1` | 選填；例如 `ap-south-1` | Supabase Project Settings | 只在 `DATABASE_URL` 不是 Supabase pooler 網址、無法推得區域時需要 |
| `DIRECT_URL` | Supabase staging direct URL | Supabase production direct URL | Supabase Project Settings | `npm run db:migrate:status` up to date |
| `NEXT_PUBLIC_APP_URL` | `https://staging-app...` | `https://app...` | Vercel domain | Email links / webhook URLs 正確 |
| `JOB_SECRET` | staging random secret | production random secret | Password manager | `/api/admin/preflight` Bearer token 可通過 |
| `CRON_SECRET` | staging random secret | production random secret | Password manager | Vercel Cron 對 `/api/jobs/email-deliveries` 的 Bearer 驗證可通過；不得輸出值 |
| `CSRF_SECRET` | staging random secret | production 獨立 random secret | Password manager | preflight 通過；不得與 `JOB_SECRET` 共用。**這是應用層資料加密根金鑰：禁止輪替；備份時必須一併保存對應版本**（見 §7） |
| `LIVE_CHAT_INGRESS_SECRET` | staging random secret，至少 32 字元 | production random secret，至少 32 字元 | Password manager＋edge secret store | preflight 通過；不得輸出或進入 client bundle |
| `RATE_LIMIT_PROVIDER` | `cloudflare_waf` 或 `upstash_redis` | `cloudflare_waf` 或 `upstash_redis` | Cloudflare / Upstash | preflight 不得顯示 `memory`；Staging 實測 429 |
| `CLOUDFLARE_ACCOUNT_ID` | same or staging account | production account | Cloudflare dashboard | direct upload API 可建立 upload URL |
| `CLOUDFLARE_STREAM_TOKEN` | staging scoped token | production scoped token | Cloudflare API Tokens | 不在 client bundle 出現 |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | staging webhook secret | production webhook secret | Cloudflare Notifications | 假 secret webhook 會 401 |
| `PAYMENT_PROVIDER` | `payuni` | `payuni` | app config | preflight pass |
| `PAYUNI_ENV` | `sandbox`；隔離的一次性正式測試可設 `production` | `production` | 部署設定 | 同時選擇 API 網址與整組商店金鑰 |
| `PAYUNI_SANDBOX_MERCHANT_ID`、`PAYUNI_SANDBOX_HASH_KEY`、`PAYUNI_SANDBOX_HASH_IV` | Sandbox 商店完整一組 | 可保留供切換 | PAYUNi Sandbox 後台 | `PAYUNI_ENV=sandbox` 時專用，缺一即拒絕交易 |
| `PAYUNI_MERCHANT_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV` | 僅隔離正式 1 元測試需要 | CelebrateDeal 正式商店完整一組 | PAYUNi 正式後台 | `PAYUNI_ENV=production` 時專用，缺一即拒絕交易 |
| PayUni callback 驗證 | 使用所選 Sandbox Hash Key / Hash IV | 使用所選 Production Hash Key / Hash IV | PAYUNi 商店串接設定 | `EncryptInfo` 與 `HashInfo` 驗證通過 |
| `PAYUNI_REFUND_HOLD_RELEASE_CONFIRMATIONS`、`PAYUNI_REFUND_HOLD_RELEASE_WINDOW_HOURS`、`PAYUNI_REFUND_HOLD_CONFIRMATION_INTERVAL_HOURS` | 可不設（預設 3 次、24 小時、6 小時） | 可不設（預設 3 次、24 小時、6 小時） | 財務政策 | F-046：結果不明的 PayUni 退款保留，只有保留建立超過時間窗後、且距上一次計數至少間隔設定小時數的「沒有退款」查詢才計數，連續達設定次數（含釋放當下那次）才可人工釋放；預設最早 36 小時。次數 2–20、時間窗 1–720 小時、間隔 1–168 小時，超出範圍或格式錯誤時用預設值 |
| `FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS` | 可不設（預設 5000000 分＝NT$50,000） | 可不設（預設 5000000 分＝NT$50,000） | 財務政策 | F-049：月結人工調整的新值絕對值，或與現值的差額絕對值，任一超過此值（分）時，需另一位平台管理員覆核後才生效；鎖單時未覆核的申請自動標為 `rejected_by_lock`；只接受非負整數，格式錯誤時用預設值 |
| `PAYUNI_CREDIT_FEE_BPS`、`PAYUNI_FEE_TAX_BPS` | 可不設（預設 280＝2.8%、500＝5%） | 依 PayUni 合約費率設定（預設 280、500） | PayUni 合約；**待會計師確認（D-30）** | F-040：PayUni paid 回呼沒有 NetAmount／GatewayFee 時，伺服器以「毛額 × 費率 ×（1＋手續費營業稅率）」計算 `gatewayFeeCents`，TWD 每筆四捨五入到整數元（分為 100 的倍數；捨入單位與方向**待會計師確認（D-30）**），`netAmountCents`＝毛額−手續費−平台費，交易 metadata 記 `feeSource: "contract_rate"`；provider 有回費用時一律用 provider 值（`feeSource: "provider"`）。合約費率只在交易首次沒有費用紀錄時寫入，之後不帶費用的 paid 重送或 retry 不會覆蓋（即使 env 費率已改）。費率 0–1000 bps、稅率 0–2000 bps，格式錯誤時用預設值。目前一律用信用卡費率，ATM／超商費率待 D-30 確認 |
| `RESEND_API_KEY` | staging key | production key | Resend dashboard | test email delivered |
| `EMAIL_FROM` | staging sender | production sender | Resend verified domain | SPF / DKIM / DMARC pass |
| `SMOKE_TEST_EMAIL` | 單一測試收件信箱 | 單一受控維運信箱（非必要可不啟用 smoke） | 維運設定 | 其他收件人呼叫 test-email 必須回 403 |
| `SENTRY_DSN` | staging DSN | production DSN | Sentry project | ops monitoring test issue appears |
| `NEXT_PUBLIC_SENTRY_DSN` | staging public DSN | production public DSN | Sentry project | client global error can report |
| `SENTRY_ENVIRONMENT` | `staging` | `production` | 手動設定 | server event environment tag 正確 |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `staging` | `production` | 手動設定 | client event environment tag 正確 |
| `SENTRY_ORG` | org slug | org slug | Sentry | source map upload enabled |
| `SENTRY_PROJECT` | staging project slug | production project slug | Sentry | release/source maps visible |
| `SENTRY_AUTH_TOKEN` | staging upload token | production upload token | Sentry auth token | build can upload source maps |
| `NEXT_PUBLIC_POSTHOG_KEY` | staging project key | production project key | PostHog | `production_smoke_test` event appears |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog host | PostHog host | PostHog | capture API 200 |

切換順序：先在 Sandbox 部署的 Secret 管理新增完整 `PAYUNI_SANDBOX_*` 三件組，再發布此程式。正式商店沿用 `PAYUNI_MERCHANT_ID`／`PAYUNI_HASH_KEY`／`PAYUNI_HASH_IV`；確認它們屬於 CelebrateDeal 正式商店後，才在目標環境將 `PAYUNI_ENV` 切成 `production`。切換不會自動取得或改寫金鑰。

## 2026-10-01 staging 正式金流測試決定

指定 staging 的目標設定是 `PAYUNI_ENV=production`，使用 CelebrateDeal 正式商店；平台三個方案 Starter、Growth、Team / Pro 的測試月費分別為 NT$1、NT$2、NT$3，正式站維持原價。受控程式路徑仍在草稿 PR #351；固定 staging 尚未切換。測試價格存於三筆獨立且停用的 staging 專用方案，原本三筆方案與正式站資料不改。`PAYUNI_STAGING_PLAN_TEST_ENABLED=true` 只在已審查的 Preview 部署使用；程式還會核對 staging 資料庫、指定商家、CelebrateDeal 商店代號及短效資料庫許可綁定的唯一部署 URL。一般商品／發票結帳與退款仍封鎖。完整順序見 [三方案正式金流 staging runbook](launch/payuni-staging-live-plan-test.md)。現有「首筆 1 元綁卡＋第二筆 1 元扣款」探針是另一條受控流程，不能視為三方案付款已通過。

PayUni 不另外設定 `PAYUNI_NOTIFY_URL`、`PAYUNI_RETURN_URL` 或自訂 webhook secret。每筆 UPP checkout 會從 `NEXT_PUBLIC_APP_URL` 組合 `ReturnURL` 與 `NotifyURL`，回傳則只接受官方 `EncryptInfo`、`HashInfo`、Hash Key 與 Hash IV 驗證。

## 3. Vercel 設定方式

建議用 Vercel Dashboard 設定，並分別套用：

- Production：正式網域與 production credentials。
- Preview：staging / preview credentials，可指定 `staging` branch。
- Development：本機開發可用 staging 或 mock credentials。

CLI 範例：

```bash
vercel env ls production
vercel env pull .env.production.local --environment=production --yes
vercel env pull .env.staging.local --environment=preview --yes
```

## 4. 本機 smoke test

```bash
npm run preflight
npm run external:smoke
```

`npm run build` 會先執行 preflight。Vercel Preview／Production 缺少 `CSRF_SECRET`、使用 `memory` rate limit，或公開網址仍是 localhost 時，build 會直接失敗；一般本機開發則維持可使用 localhost 與 memory provider。

## 5. Live chat ingress trust

Production／Preview 的 live chat route 使用專用 header `x-celebratedeal-live-chat-ingress` 作為 edge 入口 proof。Cloudflare Worker／Transform Rule 或 Vercel 前置 proxy 必須在每個請求覆寫該 header，值與 server-side `LIVE_CHAT_INGRESS_SECRET` 完全一致；app 只有在 proof 通過常數時間比較後，才會信任 `cf-connecting-ip` 或 `x-real-ip`。

- `cf-ray` 只是不可信 metadata，不能作為 proof。
- `RATE_LIMIT_PROVIDER` 只能選擇 Cloudflare／Vercel proxy 類型，不能單獨建立信任根。
- Edge 必須刪除使用者自行帶入的同名 header，並封鎖公開網路直接連到 origin；否則攻擊者可能繞過 edge 規則。
- 本機 runtime 只使用 `request.ip`，不讀取 proxy headers。
- `LIVE_CHAT_INGRESS_SECRET` 只放 server 與 edge secret store，不放 `NEXT_PUBLIC_*`、repo 或瀏覽器程式碼。

預設 `external:smoke` 不會建立 Cloudflare Live Input 或 payment transaction。若要測會產生狀態的流程：

```bash
RUN_CLOUDFLARE_SMOKE=true npm run external:smoke
RUN_DEMO_PAYMENT_WEBHOOK_SMOKE=true SMOKE_VENDOR_SLUG=your-vendor npm run external:smoke
```

## 6. 函式區域與連線池（F-090／B06-03）

- `vercel.json` 與 `vercel.staging.json` 都寫明 `"regions": ["hnd1"]`（東京）。staging 的 Supabase 專案在 `ap-northeast-1`，兩者同區。
- **已知跨區：Supabase production 專案在 `ap-south-1`（孟買）。** 若 Production 也讀 `vercel.json`，函式會在 `hnd1`、資料庫在孟買，每次資料庫往返多約 100 ms 以上（仍比 Vercel 預設的 `iad1` 近）。這需要 owner 二選一：把 Supabase production 遷到東京，或讓 Production 函式改用 `bom1`。在決定之前，preflight 會對 Production build 印出 `[WARN] DATABASE_REGION` 但不阻擋建置。
- 區域不寫死在程式裡：preflight 讀 Vercel 設定檔（預設 `vercel.json`，`VERCEL_CONFIG_FILE=vercel.staging.json` 時讀 staging 設定）的 `regions`，以它為準，因為設定檔會覆蓋 Dashboard。`EXPECTED_FUNCTION_REGION` 只用來驗證：兩者不一致就警告，資料庫比對仍用設定檔的區域；設定檔沒有 `regions` 時才以 `EXPECTED_FUNCTION_REGION` 描述 Dashboard 設定。資料庫區域由 Supabase pooler 主機名稱推得（只印區域 ID，不印主機），或由 `DATABASE_REGION` 指定。函式執行時另有 Vercel 注入的 `VERCEL_REGION`，有值時會一併比對。
- **Production 上線前，preflight 的 `DATABASE_REGION` 必須是 PASS**（PR #447 審查 m3）。若 owner 選 Production 改用 `bom1`，只改 Dashboard 會被 `vercel.json` 的 `regions` 蓋掉，必須改 Production 讀取的設定檔（或讓 Production 使用專屬設定）。是否把跨區從 WARN 升為 FAIL 會改變 build gate，需要 owner 同意。
- preflight 也會比對 `CRON_SECRET` 與 `JOB_SECRET`：兩者相同時警告（不印值），因為 GET／POST 排程入口的密鑰分離會失效。
- 連線池參數只放在 `DATABASE_URL`（`src/lib/db.ts` 不覆寫）：6543 transaction pooler、`pgbouncer=true`、`connection_limit` 從 3～5 起依負載測試調整。Migration 走 `DIRECT_URL`（session mode）。
- 這些檢查只在 `VERCEL_ENV` 是 `production` 或 `preview` 時執行，結果一律是 PASS／WARN，不改變 build 的 exit code。

## 7. `CSRF_SECRET` 是資料加密根金鑰（F-031①／B04-03）

`CSRF_SECRET` 的名稱容易讓人以為只管 CSRF token，實際上它是**應用層資料加密的根金鑰**：

- `src/lib/sensitive-data.ts` 的 `deriveSensitiveDataKey()` 以 `CSRF_SECRET` 經 HMAC-SHA256 依用途衍生 AES-256-GCM 金鑰與雜湊索引金鑰（沒有 `CSRF_SECRET` 時改用 `JOB_SECRET`）。
- 受影響的資料包含：MFA secret、LINE 憑證、訂單買家與收件個資、私訊、tracking token、學員通知、發票請求、交付網址，以及各種 token 雜湊與查詢用雜湊索引（例如 customerKeyHash、destinationKeyHash）。
- 通用密文格式只有 `v1`，沒有 key id。2026-10-25 起改以「換用途名稱」做依用途輪替（第 7 點）：MFA secret 另有 `m2.` 格式，其餘用途由 `src/lib/derived-key-rotation.ts` 以「新鑰優先、舊鑰後備」驗證或解密。銀行帳號另用 `BANK_ACCOUNT_KEYRING_JSON`，有輪替設計，不在此列。

因此：

1. **禁止輪替 `CSRF_SECRET`**，包括資安事件時。換掉它，上述密文會永久無法解密，雜湊索引全部對不上（GCM auth failure）。要能輪替，必須先完成 B04-03 ②③：獨立的 `DATA_ENCRYPTION_KEYRING`（含 key id、decrypt-only 舊金鑰）與可重跑的 re-encrypt 腳本。
2. **不可在已有資料的環境「補設」或「改設」**：某環境原本沒有 `CSRF_SECRET`、一直用 `JOB_SECRET` 加密，之後才補上 `CSRF_SECRET`，效果等同輪替。這種環境的 `JOB_SECRET` 也同樣不可輪替。
3. **備份必須一併保存對應版本**：每一份資料庫備份都要能對應到「備份當下」的 `CSRF_SECRET`（必要時含 `JOB_SECRET`）。金鑰存放在與備份分開的密碼管理器，記錄「哪一段期間的備份對應哪一版」；不得與備份檔放在同一處，不得寫進 repo、log、收據或聊天。
4. **還原時缺它，加密資料全部不可讀**：資料表與筆數都會還原成功，但所有加密欄位與雜湊查詢失效，等同遺失個資與 MFA。隔離還原演練必須用對應版本的金鑰抽查加密欄位可讀，見 `docs/production-backup-restore-runbook.md` §B 第 6 步與 §E。
5. staging 與 production 必須使用不同值；staging 值外洩不影響 production 資料。
6. **根金鑰只能用在 KDF（domain separation）**：根金鑰（`CSRF_SECRET`，或退回時的 `JOB_SECRET`）只能出現在 `deriveKeyFromRootSecret()`，也就是 `HMAC(root, "CelebrateDeal:" + purpose)`。任何其他 HMAC／雜湊都必須先用自己的 purpose 衍生金鑰，再在該金鑰下計算，並在訊息前加固定標籤。**絕對不可直接用根金鑰 HMAC 攻擊者可控的輸入**（cookie、header、表單值、URL）：只要輸出會回到使用者手上，攻擊者送出 `CelebrateDeal:<purpose>` 就能讀到該用途的衍生金鑰。2026-10-25 前的 CSRF fingerprint 就是這個漏洞（`HMAC(CSRF_SECRET, session cookie)`），現已改為 CSRF 專用衍生金鑰（#485 時為 `csrf-hmac-v1`，2026-10-25 起為 `csrf-hmac:r2:…`，見第 7 點）＋`csrf-fp:v1:`／`csrf-token:v1:` 標籤；修正後部署時，既有 CSRF token（最長 2 小時）會失效，行為與 token 過期相同。`deriveSensitiveDataKey()` 的輸出不得改變，`src/lib/sensitive-data.test.ts` 以合成秘密的 golden 值鎖住既有用途；`src/lib/sensitive-data-root-key-boundary.test.ts` 確保通用 KDF helper 不外露，且只有 `csrf.ts` 使用 `deriveCsrfMacKey()`。
   - **修正前的曝露無法偵測**：任何人都可能已從公開頁取得各用途衍生金鑰的前 192 bits，且不會留下可辨識的紀錄，因此應視為可能已外洩。
   - **依用途輪替，絕不為此輪替根金鑰 `CSRF_SECRET`**（換根金鑰會讓所有密文失效，見第 1 點）。優先順序併入 keyring 工作 B04-03 追蹤：
     1. 第 1 級：尚未正式使用的用途直接改名，例如商家邀請（先改為 `merchant-registration-invite-v2`，2026-10-25 再改為帶隨機後綴的名稱，見第 7 點）。新用途一律用**不可猜的隨機後綴**（例如商家 Email 驗證連結用 `merchant-email-verification:r2:5a881e5879ba6156`，已登記在 `DERIVED_KEY_ROTATIONS`、沒有 legacy），不用 `-v1`、`-v2` 這類可預先猜到的名稱。
     2. 第 2 級：短效公開 bearer token，例如 `public-checkout-admission`、`form-submission-email-verification`、`form-submission-chat-session`、`form-submission-line-binding`。
     3. 第 3 級：長效連結，需要新舊兩版並行驗證，例如 `email-delivery-unsubscribe`、`student-portal-access-token-v1`、`automation-voucher-bearer-v1`、`team-funnel-attribution-cookie`。
     4. 第 4 級：加密與雜湊索引金鑰，需要 re-encrypt migration，先處理 MFA，再處理 PII。
   - 第 2～4 級（MFA）已於 2026-10-25 實作，見第 7 點。
   - **不變量：只要還有任何公開部署在跑 #485 之前的程式，就不得上線新的用途字串**（詳見第 7 點）。2026-10-25 已移除舊 Production build 的公開網址（`celebratedeal.carry-digital-nomad.in.net`、`celebrate-deal.vercel.app` 回 404），舊 preview／production 部署網址都在 Vercel Authentication 之後（403／302），唯一公開的程式端點是跑 master（含 #485）的 staging 網域；之後恢復任何公開網址前，該部署必須已含 #485。

7. **2026-10-25 依用途輪替（B04-03）**：新舊名稱、舊鑰停用日都集中在 `src/lib/derived-key-purposes.ts` 的 `DERIVED_KEY_ROTATIONS`（不 import 任何模組，讓 `sensitive-data.ts` 也能讀取；驗證與解密 helper 在 `src/lib/derived-key-rotation.ts`）。根金鑰不變，舊用途的衍生金鑰也不變（golden test 鎖住），所以既有密文與連結照常可讀。

   **前提與部署順序**

   - 舊 oracle 對**任何字串**都會回答，所以新名稱一律帶隨機後綴（`<舊名>:r2:<16 hex>`），不用可猜的 `-v2`。後綴不是秘密：repo `Forty-s-AI-Company/CelebrateDeal` 是**公開的**，推上 GitHub 後**任何人**都看得到新名稱。新名稱的安全性因此完全取決於下一點的不變量。
   - **不變量（推送任何新用途名稱之前都必須成立）**：沒有任何可公開連線的部署仍在執行 #485 之前的程式碼。所有 Preview 與舊部署必須一直留在 Vercel Authentication 之後；**絕不可**把舊部署重新掛到公開網域或 alias（包括為了回滾）。需要回滾時，只能回滾到含 #485 的 build。
   - **2026-10-25 主對話的查核紀錄**：
     - 舊的 staging／Preview 部署 URL 全部回 403（Vercel Authentication），例如 `qytj0bbdk`、`5cih3a950`、`celebrate-deal-staging.vercel.app`、`celebrate-deal-rollback.carry-digital-nomad.in.net`。
     - production 的部署 URL 回 302（需登入）。
     - 2026-07-24 production build 僅有的兩個公開入口 `celebratedeal.carry-digital-nomad.in.net` 與 `celebrate-deal.vercel.app` 已**移除 alias**（現在回 404）。這個 build 早於 KDF（`sensitive-data.ts` 於 2026-08-30 才加入），但它的 CSRF fingerprint 仍是 `HMAC(production CSRF_SECRET, 攻擊者 cookie)` oracle；production 與 staging 是否共用根金鑰值不明。
     - 若必須暫時還原 production 公開入口：把上述兩個網域重新 alias 到 `dpl_no9wQ7yn22bPjia7PKThhPoEWM3h`。**這會重新打開舊 oracle、違反上面的不變量**，只能在 owner 明確決定、且接受 production 根金鑰視同外洩的前提下進行；之後必須重做下方 production 根金鑰輪替。
     - staging 公開網域現在服務含 #485 的 master，舊 oracle 運作到 2026-10-25 切換別名為止，所以 #485 才引入、名稱可猜的 `csrf-hmac-v1`、`merchant-registration-invite-v2`、`merchant-invite-email-v1` 也一併改名。
   - **production 必做（不是建議）：服務任何人之前先輪替 production 根金鑰**。production 的舊 oracle 曾公開，且可能與 staging 共用根金鑰值，所以 production 的所有衍生金鑰（含本次新名稱）都必須視為可能外洩；依用途改名對 production 不夠。順序：
     1. 先把含 #485（及本變更）的 build 部署到 production，仍保持在 Vercel Authentication 之後或沒有公開 alias。
     2. 確認所有舊部署仍無法公開連線（上面的不變量）。
     3. 確認 production 資料庫沒有需要保留的加密欄位、雜湊索引或 MFA（第 1、2 點的禁令針對「已有資料」的環境）；有的話先停下來決定。
     4. **owner** 在 Vercel production 環境設定新的 `CSRF_SECRET`（至少 32 bytes 隨機值，且與 staging 不同）。Claude 不輸入、不產生、不經手這個值。`JOB_SECRET` 若曾是退回用的根金鑰，一併由 owner 更換。
     5. 重新部署 production，讓新值生效；依第 3 點記錄「此日之後的備份對應新根金鑰」，舊備份對應舊根金鑰。
     6. **重新註冊 production 管理員 MFA**：換根金鑰後，舊 MFA secret 無法解密，管理員會無法通過 `/mfa/verify`。目前沒有「管理員重設他人 MFA」或「已有 MFA 的使用者自行更換 authenticator」的功能（`startMfaEnrollment` 遇到既有 factor 會回 `mfa_exists`），所以要由 operator 在 owner 授權下刪除該使用者的 `UserMfaFactor` 與 `UserRecoveryCode` 列，再由管理員到 `/mfa/setup` 重新註冊並保存新的復原碼。
     7. 之後才把公開網域 alias 到新部署。

   **已輪替的用途**

   | 舊用途 | 新用途 | 級別 | 策略 | token 壽命 | 舊鑰停用（台灣時間） |
   |---|---|---|---|---|---|
   | `csrf-hmac-v1`（CSRF MAC，`deriveCsrfMacKey()`） | `csrf-hmac:r2:…` | 2 | 改名；部署後既有 CSRF token 失效，行為同過期 | ≤ 2 小時 | 不接受 |
   | `merchant-registration-invite-v2` | `merchant-registration-invite:r2:…` | 1 | 改名；改名時尚未簽發任何邀請 | 14 天 | 不接受 |
   | `merchant-invite-email-v1`（邀請稽核 Email 雜湊） | `merchant-invite-email:r2:…` | 1 | 改名；當時沒有邀請紀錄，也沒有程式比對此雜湊 | 稽核紀錄 | 不接受 |
   | `public-checkout-admission` | `public-checkout-admission:r2:…` | 2 | 改名，舊 token 自然過期 | 30 分鐘 | 不接受 |
   | `form-submission-line-binding` | `form-submission-line-binding:r2:…` | 2 | 改名 | 30 分鐘 | 不接受 |
   | `student-portal-access-token-v1` | `student-portal-access-token:r2:…` | 2 | 改名（原列第 3 級；實際只活 15 分鐘，且是資料庫一次性 capability，舊 magic link 失效後重新索取即可） | 15 分鐘 | 不接受 |
   | `live-viewer-pass` | `live-viewer-pass:r2:…` | 2 | 改名（admission binding 的雜湊標籤不變） | ≤ 2 分鐘 | 不接受 |
   | `live-chat-cursor` | `live-chat-cursor:r2:…` | 2 | 改名 | 單次輪詢 | 不接受 |
   | `live-private-chat-cursor:<scope>` | `live-private-chat-cursor:r2:…:<scope>` | 2 | 改名 | 單次輪詢 | 不接受 |
   | `live-private-chat-conversation-binding:v1` | `live-private-chat-conversation-binding:r2:…` | 2 | 改名（不授予存取權；部署當下進行中的私訊草稿或重送會被拒一次） | 單次草稿／重送 | 不接受 |
   | `post-purchase-checkout` | `post-purchase-checkout:r2:…` | 2 | 改名。部署前發出的舊 token 不再被接受；部署當下進行中的加購續付仍可經 `/checkout/recover/<grantId>` 完成付款（該入口用 buyer grant cookie 與已綁定的 credit 驗證，不需要 token） | 10 分鐘 | 不接受 |
   | `registration-submission-result-v1` | `registration-submission-result:r2:…` | 2 | 改名 | 1 分鐘 | 不接受 |
   | `form-submission-email-verification` | `form-submission-email-verification:r2:…` | 3 | 雙版本驗證（原列第 2 級；連結活 48 小時，超過一天改為第 3 級）。舊鑰只接受 `expiresAt ≤ 生效時間＋48 小時` 的連結 | 48 小時 | 2026-12-01 00:00 |
   | `form-submission-chat-session` | `form-submission-chat-session:r2:…` | 3 | 雙版本驗證（原列第 2 級；cookie 活 30 天）。舊鑰只接受 `expiresAt ≤ 生效時間＋30 天` 的 cookie | 30 天 | 2027-01-01 00:00 |
   | `email-delivery-unsubscribe` | `email-delivery-unsubscribe:r2:…` | 3 | 雙版本驗證。token 沒有時間戳記，舊鑰只受停用日限制 | 無期限 | 2027-11-01 00:00 |
   | `team-funnel-attribution-cookie` | `team-funnel-attribution-cookie:r2:…` | 3 | 雙版本驗證。舊鑰只接受簽章內 `issuedAt < 生效時間` 的 cookie | 30 天 | 2027-01-01 00:00 |
   | `student-portal-session-v1`（加密 cookie） | `student-portal-session:r2:…` | 3 | 新鑰加密、舊鑰後備解密。舊鑰只接受密文內 `issuedAt < 生效時間` 的 cookie | 30 天 | 2026-12-01 00:00 |
   | `cloudflare-resumable-upload-ticket`（加密 ticket） | `cloudflare-resumable-upload-ticket:r2:…` | 3 | 新鑰加密、舊鑰後備解密。舊鑰只接受 `expiresAt ≤ 生效時間＋7 天` 的 ticket | 7 天 | 2026-12-01 00:00 |
   | `automation-voucher-bearer-v1` | `automation-voucher-bearer:r2:…` | 3 | 新券用新鑰；重試時依資料列的 `claimTokenHash` 判斷新舊鑰重建連結，舊鑰只用於 `createdAt < 生效時間` 的券；都對不上時該次執行明確失敗（`action_failed`），不寄出無效連結 | 券效期 ≤ 365 天 | 2027-01-01 00:00（只影響重建連結） |
   | `mfa-encryption` | `mfa-encryption:r2:…` | 4 | 新密文 `m2.`；舊格式以舊鑰解密；TOTP 驗證成功後 lazy re-encrypt；批次腳本 | 永久（資料） | 重新加密完成後 |
   | `mfa-recovery-code-authentication` | `mfa-recovery-code-authentication:r2:…` | 4 | 新雜湊 `hmac-sha256-v2`；`v1` 以舊鑰驗證 | 至使用或重產 | 未使用的 v1 歸零後 |

   - 雙版本驗證一律先試新鑰，失敗才在停用日之前試舊鑰；舊鑰成功時 log `legacy_derived_key_used`（只含固定標籤 `key` 與本程序累計次數，每個標籤每 10 分鐘最多一筆，不含 token、ID 或金鑰）。
   - **生效時間 `ROTATION_EFFECTIVE_AT` = 2026-10-27 00:00（台灣時間，= 2026-10-26T16:00:00Z）**（`src/lib/derived-key-purposes.ts`；比 merge 晚約一天，留給 merge、CI 與 staging 換 alias）。生效後伺服器不再用舊鑰簽發，所以舊鑰 token 的內容若顯示它在生效後才簽發，必定是偽造，即使在停用日之前也拒絕；這個檢查只在舊鑰 MAC／解密成功後才讀內容，被拒的不計入 `legacy_derived_key_used`。退訂連結沒有時間戳記，只受停用日限制。
   - **部署檢查清單**：staging alias 必須在**生效時間之前**切到本 build；做不到就先把常數往後調再部署。否則舊 build 在生效時間到 alias 切換之間用舊鑰簽發的 token 會被當成偽造：學員入口 session、報名聊天 session 會被登出（重新登入即可），但**推廣歸因 cookie 會被靜默丟棄，該期間點擊後成交的訂單將失去分潤歸因（佣金影響）**，而且事後無法補回。
   - 學員入口 session、報名聊天 session、歸因 cookie 都在 Server Component 或一般讀取路徑上解析，無法在那裡重簽 cookie（Next.js 只允許在 Server Function／Route Handler 寫 cookie），所以沒有「舊鑰驗證成功即換發」。這三者合法的舊 cookie 本來就會在部署後 30 天內過期；停用日只需晚於「部署日＋30 天」。
   - 自動化優惠券：資料列只存 bearer 的雜湊，已寄出的舊連結在券到期前照常可兌換，輪替無法撤回這些連結。要偽造舊券連結需要舊鑰**和**不公開的 `executionLogId`。若要強制撤回，只能讓舊券失效後重發。
   - 停用日是硬性上限：即使沒人刪常數，過了日期舊鑰也不再被接受。若 staging 部署晚於 2026-11-01，對應的停用日需順延後再部署。

   **舊鑰停用計畫**

   1. 部署後觀察 Vercel log 的 `legacy_derived_key_used`，各標籤次數應逐步歸零。
   2. 停用日之後（或確認歸零後），開 PR 把 `DERIVED_KEY_ROTATIONS` 對應項目的 `legacy` 改成 `null`，並從 `sensitive-data.test.ts` 的「仍會讀取」golden 清單移除該舊用途（之後已無程式讀它）。時程：2026-12 上旬清第一批（Email 驗證、學員入口 session、上傳 ticket），2027-01 上旬清第二批（聊天 session、歸因 cookie、優惠券），2027-11 清退訂連結。
   3. MFA：staging 與 production 都跑完下方腳本且 `remainingLegacy: 0`，並連續 14 天沒有 `key: "mfa-encryption"` 的 log 後，才把 `mfaEncryption.legacy` 改為 `null`。復原碼 v1：以 `SELECT count(*) FROM "UserRecoveryCode" WHERE "usedAt" IS NULL AND "codeHash" LIKE 'hmac-sha256-v1:%'` 確認歸零（或請仍有 v1 的使用者重產復原碼）後，才把 `mfaRecoveryCode.legacy` 改為 `null`。
   4. 舊鑰永遠能從同一個根金鑰重新衍生，「停用」的意思是程式不再接受。部署前的資料庫備份仍含舊格式密文，備份的保存與銷毀照第 3 點。
   5. **MFA 重新加密不會更換 TOTP seed**：只是把同一個 seed 改用新鑰包起來。部署前的資料庫備份仍含舊格式密文；若舊衍生金鑰真的外洩，拿到舊備份的人仍可解出目前仍在使用的 seed。因此建議（operator 執行、owner 決定時程）：
      - **platform admin 與財務（finance）帳號強制重新註冊 MFA 並重產復原碼**。復原碼可由本人在 `/settings/security` 重產（`src/lib/mfa-recovery-regeneration.ts`，需目前的 TOTP）。更換 TOTP seed 目前**沒有**自助或管理員重設功能（`startMfaEnrollment` 遇到既有 factor 回 `mfa_exists`），只能由 operator 在 owner 授權下刪除該使用者的 `UserMfaFactor`／`UserRecoveryCode` 列，再由本人到 `/mfa/setup` 重新註冊。後續可另開工作補「step-up 後更換 authenticator」功能。
      - staging QA 財務帳號的 TOTP seed 由 `PAYUNI_QA_FINANCE_TOTP_SECRET` 提供（`src/lib/staging-qa-finance-bootstrap.ts`），更換時需由 owner 同步更新該 secret。

   **在 staging 執行 MFA 重新加密（owner／operator）**

   1. 在受保護的環境注入 staging 的 `DATABASE_URL` 與 staging 的根金鑰（`CSRF_SECRET`，沒有時 `JOB_SECRET`）。不得貼到聊天、log 或 repo；不讀 `.env*` 檔。
   2. Dry run（只輸出筆數）：`node --import tsx scripts/reencrypt-mfa-secrets.ts --target=staging`。確認 `unreadable` 為 0；不為 0 代表根金鑰不對或有損壞資料，先停下來查。
   3. 執行：`MFA_REENCRYPT_CONFIRM=REENCRYPT_MFA_SECRETS node --import tsx scripts/reencrypt-mfa-secrets.ts --target=staging --execute`。輸出應為 `remainingLegacy: 0`。可重跑：已是新格式的列不會再寫；`changed` 代表執行期間該使用者剛登入或重新註冊，重跑即可。
   4. 用 staging 的 QA 帳號實際完成一次 `/mfa/verify`，確認新格式可登入。
   5. production 只能在 owner 明確授權後執行，需額外的 `--target=production` 與 `MFA_REENCRYPT_PRODUCTION_APPROVAL=OWNER_APPROVED_PRODUCTION_MFA_REENCRYPT`。
   - 腳本守門：loopback `celebratedeal_*` 直接允許；`--target=staging` 時 URL 必須是 staging 資料庫；其他資料庫一律需要 production 授權值；每列先以舊鑰解密成功、確認新密文可解回同一 secret 才以 compare-and-swap 寫入；不輸出 secret、密文、使用者 ID 或 Email。

   **下一步：PII 與雜湊索引（B04-03，尚未輪替）**

   本次**沒有**重新加密下列用途，仍以 2026-10-25 前的金鑰運作（`:<scope>` 代表用途字串後接 vendorId／記錄 ID）：`commerce-order-buyer`／`-shipping`／`-identity-fingerprint`、`commerce-custom-checkout:<scope>` 與 `commerce-custom-checkout-identity-fingerprint`、`commerce-entitlement-access:<scope>`、`product-delivery-config:<scope>`、`commerce-order-item-delivery:<scope>`、`commerce-order-invoice:<scope>` 與 `commerce-order-invoice-fingerprint`、`email-delivery-recipient:<scope>`／`email-delivery-recipient-hash`、`src/lib/support-case-pii.ts` 的案件內容、`line-official-account:<scope>`（LINE 憑證）、`line-profile:<scope>`、`line-user-lookup:<vendor>`、`line-login-state:<scope>`、`line-delivery:<scope>`、`server-side-tracking:<scope>`（tracking 憑證與 browser context）、`learner-notification-*`／`learner-contact-proof-v1:<scope>`、`live-private-chat-body:<scope>`、`live-lucky-draw-claim-hash:v1` 與 `live-lucky-draw-claim:v1:<scope>`、`cloudflare-live-stream-key`、`registration-form-retry-v1`、`automation-customer-key-v1`。

   1. **加密欄位（lazy＋batch）**：讓 envelope 帶 key 版本（例如 `v2.` 表示新用途名稱、`v1.` 表示舊用途），解密依版本選鑰、加密一律用新鑰；寫入路徑自然換新，再為每張表寫一支與本腳本相同模式的批次腳本（cursor 分頁、先解密成功再寫、以舊密文做 CAS、dry run／確認值／資料庫守門、可重跑）。用途字串多半含 vendorId／記錄 ID，新名稱以「新前綴＋原本的 scope」組成即可。
   2. **雜湊索引（雙查詢）**：`customerKeyHash`、`automationCustomerKeyHash`、`recipientHash`、`checkoutIdentityHash`、發票 fingerprint、`line-user-lookup`、學員通知 destination index／rate／delivery key、抽獎碼雜湊。先部署「同時算新舊雜湊、查詢用 `IN (新, 舊)`、寫入只寫新」；再以批次腳本從明文來源（解密 envelope 或原始欄位）重算；確認舊雜湊歸零後移除舊鑰。有 unique 約束的欄位要先查新舊兩種雜湊再插入，避免同一身分在過渡期出現兩列。
   3. **優先順序**：訂單買家個資與身分 fingerprint → LINE 與 tracking 憑證（同時建議到供應商端換發憑證，舊密文即失去價值）→ 其餘 PII。短效資料（`registration-form-retry-v1` 10 分鐘、LINE Login verifier）只要改名即可；`cloudflare-live-stream-key` 以在 Cloudflare 換發 stream key 處理較省事。
   4. **PayUni EncryptInfo 的 GCM tag 長度（另案，尚未強制）**：其他 AES-GCM 解密已固定 16-byte tag（`sensitive-data.ts`、`mfa.ts`，`bank-account.ts`／`affiliate-tax-identity.ts` 指定 `authTagLength: 16`），但 `src/lib/payment-providers/payuni.ts` 的 `decryptInfo` 維持原樣：repo 內沒有 PayUni 實際 tag 長度的證據，而 callback 的真正完整性檢查是 `HashInfo`（以秘密 hashKey 計算的 SHA-256，常數時間比對）。貿然強制 16 bytes 可能靜默丟掉真實付款通知。步驟：先只記錄觀察到的 tag byte 長度（只記長度）；在 sandbox 跑完 Notify、Return、查詢、退款、綁卡全部路徑並確認一律 16 bytes；之後才強制，`scripts/payuni-sandbox-external-qa.mjs` 一併處理。
   5. #485 引入、名稱可猜的 `csrf-hmac-v1`、`merchant-registration-invite-v2`、`merchant-invite-email-v1` 已於 2026-10-25 一併改為帶隨機後綴的名稱（見上表）。之後新增任何用途，名稱都要帶隨機後綴，並登記到 `DERIVED_KEY_ROTATIONS`。
