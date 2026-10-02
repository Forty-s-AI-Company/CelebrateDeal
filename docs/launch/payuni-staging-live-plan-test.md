# PAYUNi staging 三方案正式金流測試

狀態：程式候選；固定 staging 尚未切換，測試方案尚未寫入 staging 資料庫，尚未付款。此流程與「1 元綁卡＋10 分鐘後第二筆 1 元扣款」探針分開。

## 2026-10-02 執行收據與剩餘閘門

- 已從 Supabase staging 專案 `ocbugvgojrunvenozsbx` 製作加密的 roles、public schema、public data 邏輯備份。本機 archive 雜湊已核對；在無網路、無對外連接埠的一次性 PostgreSQL 容器還原成功。來源與還原後皆為 79 筆已套用的 Prisma migration、120 張 public 表、1542 個 public 欄位；所有表的列數摘要一致。這證明 public 應用資料可還原，**不涵蓋** Supabase Auth、Storage 物件與平台設定。
- Owner 確認 Google Drive 中看得到三個 `.age` 與 `manifest.json`，並確認 age 私鑰已存入密碼管理器。這兩項為 owner 回報；本次沒有從雲端重新下載、也沒有從密碼管理器取回私鑰演練。
- PR #351 的程式候選基準 commit `0d7e32cc`：該版兩個 quality check 及 `celebrate-deal-staging` Preview 部署通過。主專案 `celebrate-deal` Preview 曾因 PAYUNi Sandbox 三件組缺值而被 preflight 擋下；Owner 決定該專案 Preview 使用 demo 付款，已只修改其 Preview 的 `PAYMENT_PROVIDER` 並重新建置通過，Production 設定未動。最新 PR 檢查須依最新提交判讀。固定 staging alias 尚未切換。
- staging 資料庫仍是 79 筆已套用 migration；候選程式另有 `20260929170000_payment_method_setup_intent` 與 `20260930094500_payuni_live_probe` 兩筆尚待套用。未修改 staging 資料列或價格，正式資料庫未動。
- 只查 Vercel **變數名稱、類型與範圍**：`celebrate-deal-staging` 專案的三個正式 PAYUNi Secret 已透過 Vercel API 只提交 target 與 gitBranch 欄位，限縮為 `codex/prelaunch-engineering-20260929` 分支的 Preview；隨後逐筆核對三者皆為 Preview／該分支／sensitive。`PAYUNI_STAGING_PLAN_TEST_VENDOR_ID` 尚未設定。既有其他 Preview 變數多為不可讀的 Secret，CLI 本機注入只得到空值，不能據此宣稱連線錯誤或驗證資料隔離。部署執行期仍須以只輸出布林結果的受控檢查核對資料庫、Auth、Storage、固定網域及 PAYUNi 商店歸屬。
- `PAYUNI_STAGING_PLAN_TEST_ENABLED` 的 Preview 變數存在；Owner 回報其值為 `false`，本次沒有讀取該 Secret。以上閘門未完成前維持關閉，也不執行 `--prepare`、`--enable` 或 alias 切換。
- 候選程式加入 staging Vercel Preview 建置時的 `STAGING_PREVIEW_DATA_IDENTITY` 閘門，只判斷固定網址與四個 Supabase staging URL，輸出 PASS／FAIL，不記錄連線內容。Vercel staging 專案 metadata 顯示系統環境變數自動注入已開啟；commit `ecfc53a4` 的 immutable Preview deployment `dpl_28hSHMU8h6gWrSuXiZzge2CMuYyi` 實際建置輸出 PASS，`/api/health` 回傳 HTTP 200、資料庫連線成功。此證據只屬於該部署，固定 staging alias 未切換。應用登入使用 Prisma 資料庫，媒體使用 Cloudflare R2／Stream；此閘門不證明 R2／Stream 資源隔離。獨立審查已核對並關閉系統變數可能未注入的 finding。
- 在 `--network none`、無對外連接埠的一次性 PostgreSQL，從同一組加密備份再次還原 public schema/data，按順序套用兩筆候選 migration SQL 均成功；新表為空、預期外鍵存在。容器已停止並自動移除。這是 SQL 相容性演練，不是線上 staging migration，也沒有寫入線上 Prisma migration history。
- 該部署的 PAYUNi preflight 仍選用 Sandbox 三件組；三個正式 Secret 的分支範圍已修好，但 `PAYUNI_ENV=production`、受控旗標及指定測試商家尚未啟用。Owner 重新登入 Supabase CLI 後，指定 profile 已列出 staging ref `ocbugvgojrunvenozsbx`（linked）與不同的 production ref `awigitueyqdqaqwbjdgu`（未 linked）。透過 linked staging 的唯讀 SQL 再查：79 筆已套用 migration、0 筆失敗；setup intent 與 live probe 兩筆候選 migration 均未套用。原 `starter`／`growth`／`team-pro` 價格依序仍為 248000／598000／128000 cents，均啟用；三筆 `staging-payuni-*` 測試方案不存在。舊測試信箱 `zeroyuanbrothers@gmail.com` 在 staging 的 `User` 表沒有相符帳號；目前 staging 有 3 個使用者、2 個商家與 2 筆商家成員關係，仍須確認唯一測試商家，不能猜測或指定其他商家。上述為 2026-10-02 線上唯讀快照，未改動資料。
- 網站目前沒有自行註冊頁，既有商家成員邀請會加入既有商家，不能建立獨立測試商家。候選工具 `scripts/staging-payuni-test-vendor.ts` 只在固定 staging 網域、四項 staging DB 身分、直接連線、付款旗標為 `false` 及獨立變更閘門通過後，建立一個專用商家及 owner 帳號；不寄信、不設定已知密碼、不修改現有帳號。正式執行尚待隔離、回復點與 review；建立後由帳號持有人在 staging 密碼重設頁自行取得一次性連結，登入完成後再唯讀核對該商家 ID。
- Cloudflare 後台可見 `celebrate-deal-staging` 與 `celebrate-deal` 兩個獨立 R2 bucket，以及一筆標示給 staging bucket、權限為物件讀寫的 R2 Token；但目前可登入的 Cloudflare 帳戶只有一個。Vercel staging Preview 有 R2 與 Stream 變數名稱，未讀取任何憑證值，因此仍未證明部署實際使用上述 bucket 限定 Token。候選建置閘門 `STAGING_PREVIEW_MEDIA_ISOLATION` 要求 staging Preview 的 R2 bucket 名稱精確等於 `celebrate-deal-staging`；在指定付款測試分支（即使付款旗標仍關閉）或任何啟用 1／2／3 元正式金流的 staging Preview，還要求 R2 的 `CLOUDFLARE_R2_ACCESS_KEY_ID`、`CLOUDFLARE_R2_SECRET_ACCESS_KEY` 和 Stream 的 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_STREAM_TOKEN`、`CLOUDFLARE_STREAM_WEBHOOK_SECRET` 全部為空。既有 production preflight 要求 Stream 三件組同時存在或同時不存在。這只保障**新付款測試部署**不持有 Cloudflare 媒體操作憑證，並非證明完整媒體 staging 資源隔離。已在指定 Preview 分支加入五個空值覆蓋，原有 Preview 範圍的五個 Secret 保留；依 Vercel 的分支覆蓋規則，新部署應取空值，仍須由新提交的建置閘門驗證。回復時只移除這五個指定分支覆蓋，原有 Secret 即重新適用；不得在付款旗標仍開啟時復原。唯讀盤點原先有 28 個 Ready 的 staging Preview 部署；**舊 immutable Preview URL 不會因變數變更或 alias 切換而失效**。切換前須確認其中仍可公開存取且持有共享媒體憑證的舊部署已限制存取或依核准程序停用。完成前不得宣稱整個 staging 專案的媒體已隔離。

## 測試範圍與價格

- 固定網站：`https://celebrate-deal-staging.carry-digital-nomad.in.net`，Vercel `celebrate-deal-staging` 專案的 Preview 部署。
- 資料庫：Supabase staging project ref `ocbugvgojrunvenozsbx`，Production project ref `awigitueyqdqaqwbjdgu`（owner 於 2026-10-01 提供）。兩個 ref 不同只是第一項證據；仍須核對應用、Auth、Storage、資料庫實際連線，並建立可用回復點。
- 金流：`PAYUNI_ENV=production`，只用 owner 確認的 PureFit 正式商店，商店代號 `HTCU1130301000101`。部署前仍須由該商店後台核對權限與 Vercel 設定歸屬；不得讀取或輸出 Hash Key／Hash IV。
- 測試方案是三筆**獨立且 `isActive=false`** 的資料列：`staging-payuni-starter` NT$1、`staging-payuni-growth` NT$2、`staging-payuni-team-pro` NT$3。原本 `starter`、`growth`、`team-pro` 資料列及 production seed 完全不改。舊部署仍只查 `isActive=true`，不能販售測試方案。
- 新部署只對資料庫許可中指定的單一商家、PAYUNi 商店與 immutable deployment URL 開放三筆測試方案。一般商品、發票結帳和退款的 Preview 正式金流保護仍生效。付款回呼依既有簽章、訂單號、交易金額和幣別核對。

## 部署前證據

1. PR #351 的 required checks、獨立金流安全審查與 `celebrate-deal-staging` Preview build 通過；記錄 exact commit SHA、generated deployment URL、deployment ID。另一個 Vercel 專案的失敗必須單獨釐清。
2. 以唯讀方式核對 staging 應用、資料庫、Auth、Storage 身分，核對 migration 狀態與回復點時間。`STAGING_DATABASE_URL`、`DATABASE_URL`、`DIRECT_URL` 和 `NEXT_PUBLIC_SUPABASE_URL` 必須都指向同一 staging Supabase 專案。不輸出連線字串或 Secret。
3. 由 CelebrateDeal 的 PAYUNi 正式商店後台獨立核對「商店代號」和 Token／幕後授權權限。只有後台確認的代號才能交給下面的資料庫許可；不要用另一個 Preview 環境變數冒充獨立證據。不得提供金鑰、Token、卡號或客戶資料。
4. 確認唯一測試商家 ID、目前訂閱及所有待付款交易。任何未明狀態先人工對帳；切換方案時不允許把仍可付款的舊表單悄悄取代。
5. Staging 為 Supabase Free Plan，沒有平台自動備份。受控 runner 應先從**已核對的 staging 連線**製作加密邏輯備份，驗證 archive 完整性，並在一次性 PostgreSQL 中演練還原、留存 sanitized receipt 與回復點時間。不得使用歷史 PR 的備份演練結果冒充本次回復點，也不得將明文備份上傳 artifact。邏輯備份不涵蓋 Supabase Auth／Storage 等平台設定時，須另記錄限制與復原方法；回復演練未通過前不得執行 `--prepare`。

## Vercel 變數名稱與適用範圍

在 **`celebrate-deal-staging` 專案的指定 Preview branch scope** 設定：`PAYMENT_PROVIDER=payuni`、`PAYUNI_ENV=production`、`PAYUNI_MERCHANT_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV`。`PAYUNI_STAGING_PLAN_TEST_ENABLED` 在隔離、回復演練與審查完成前維持 `false`；最後啟用時才設為 `true` 並建立新部署。`PAYUNI_LIVE_PROBE_ENABLED` 必須不為 `true`。`NEXT_PUBLIC_APP_URL`、`NEXT_PUBLIC_SUPABASE_URL`、`DATABASE_URL`、`DIRECT_URL` 應維持 staging 綁定。Vercel 提供的 `VERCEL_URL` 必須是部署專屬 URL。三個正式商店金鑰值不可寫入文件、PR 或日誌。

付款測試部署另須有 `CLOUDFLARE_R2_BUCKET=celebrate-deal-staging`，且 **R2 兩個存取憑證與 Stream 三件組均不得注入**；候選建置閘門會在指定分支或旗標啟用時拒絕任何一項殘留。付款測試不執行媒體上傳、播放或刪除，因此不依賴尚未核對的 R2 Token 綁定。完整媒體 staging 測試仍須另外核對 R2 Token 歸屬並建立 Stream 隔離資源。

截至 2026-10-02 的**名稱與範圍**檢查：staging 專案的 `PAYUNI_MERCHANT_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV` 已限縮為指定 Preview 分支；沒有讀取金鑰值，既有部署不會回溯更新。`PAYUNI_STAGING_PLAN_TEST_ENABLED` 已見於所有 Preview，owner 回報值為 `false`；本次沒有讀取值。`PAYUNI_ENV`、`PAYMENT_PROVIDER` 的有效值仍須透過部署執行期受控核對。這些設定範圍本身不是商店歸屬或資料庫隔離證據。

## 準備、啟用與復原

使用受控 CI Environment／平台 Secret provider 注入 staging 資料庫連線；不要讀取 `.env*` 或列舉 Secret Store。執行工具時只輸出代碼和金額。

在方案準備前，先於隔離與回復點確認後以受控 runner 設 `STAGING_PAYUNI_TEST_VENDOR_CHANGE_APPROVED=true`、`STAGING_PAYUNI_TEST_ACCOUNT_EMAIL=zeroyuanbrothers@gmail.com`、可選的 `STAGING_PAYUNI_TEST_ACCOUNT_NAME`，且保持 `PAYUNI_STAGING_PLAN_TEST_ENABLED=false`，執行 `npx tsx scripts/staging-payuni-test-vendor.ts`。工具只接受 owner 已指定的上述信箱，其他地址直接拒絕；若需換信箱，先取得新的 owner 指示並審查程式變更。重跑或撞到既有同名商家／帳號也會拒絕；不會發信或回傳密碼。建立前須先確認 staging 的重設郵件設定與寄送能力；使用者在固定 staging 站的 `/password-reset/request` 自行設定密碼。若郵件未送達，專用帳號因未知隨機密碼仍無法登入：保持付款旗標關閉、不要設定測試商家 ID、不要重跑建立工具；先修復寄信設定，再由帳號持有人重新要求重設連結。唯讀查詢確認新帳號只有一個專用商家 owner 成員關係、沒有原有訂閱或待付款交易後，才把其商家 ID 設為指定 Preview 分支的 `PAYUNI_STAGING_PLAN_TEST_VENDOR_ID`。不要將帳號密碼、重設連結或資料庫連線輸出到日誌。

1. `npx tsx scripts/staging-payuni-plan-prices.ts --inspect`：唯讀確認原方案價格、測試方案狀態。工具會要求固定 staging 網域與四個 staging 資料庫身分欄位一致。
2. 取得隔離與回復點證據後，在受控 runner 設 `STAGING_PAYUNI_TEST_CHANGE_APPROVED=true`，執行 `--prepare`。它只複製三筆原方案的額度與費率、建立 `isActive=false` 的 NT$1／2／3 測試列；不更新原方案。再 `--inspect` 驗證。
3. 部署已通過檢查的 Preview commit，先確認網站沒有測試付款入口。以部署專屬 `VERCEL_URL`、指定測試商家 ID、經後台核對的 CelebrateDeal 商店代號，在受控 runner 執行 `--enable`。此步只將短效資料庫許可寫入三筆測試列；許可兩小時到期，且綁定唯一 immutable deployment URL。
4. 唯讀檢查指定商家看到 NT$1／2／3、其他商家看不到測試入口；原價方案與其他商家不受影響。檢查一般商品／發票與退款仍被封鎖。先盤點舊 staging Preview 專屬 URL 是否仍可公開使用共享 Stream 憑證，並限制或停用需要處置的部署；再核對 fixed staging alias 指向已審查的新部署，才能更新 alias。若舊部署尚未處置，只能說新付款測試部署無 Stream 憑證，不得宣稱整個 staging 媒體已隔離。
5. 此任務不提交付款表單、不綁卡。後續另獲真實交易授權時，每筆需核對 PAYUNi 正式後台、可信回呼、交易金額和訂閱狀態；未明結果不得重送。

停止時**先執行 `--disable`** 清除資料庫許可，所有同版舊 Preview URL 立即停止建立或顯示新測試付款表單。再移除固定 alias、停用相關舊部署、將 Vercel Preview 旗標關閉並重新部署。環境變數變更不會回溯既有部署，單靠改旗標不構成撤銷。已交給瀏覽器或 PAYUNi 的表單無法撤回，須逐筆核對 pending／paid／failed 和延遲回呼；需要退款時依獨立正式金流程序由人工處理，Preview 退款 API 仍封鎖。對帳完成後，依人工核准的訂閱流程結束測試商家的 active 測試訂閱或改回正常方案，再以月結模擬確認不再產生非預期測試帳單。測試方案列維持停用且保留交易歷史，月結仍讀取它們的 NT$1／2／3 價格，避免訂閱帳務被復原操作改價。

正式站部署、正式資料庫、正式付款／綁卡／退款均不屬於本次操作。
