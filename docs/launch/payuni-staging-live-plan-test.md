# PAYUNi staging 三方案正式金流測試

狀態：程式候選；固定 staging 尚未切換，測試方案尚未寫入 staging 資料庫，尚未付款。此流程與「1 元綁卡＋10 分鐘後第二筆 1 元扣款」探針分開。

## 2026-10-02 執行收據與剩餘閘門

- 已從 Supabase staging 專案 `ocbugvgojrunvenozsbx` 製作加密的 roles、public schema、public data 邏輯備份。本機 archive 雜湊已核對；在無網路、無對外連接埠的一次性 PostgreSQL 容器還原成功。來源與還原後皆為 79 筆已套用的 Prisma migration、120 張 public 表、1542 個 public 欄位；所有表的列數摘要一致。這證明 public 應用資料可還原，**不涵蓋** Supabase Auth、Storage 物件與平台設定。
- Owner 確認 Google Drive 中看得到三個 `.age` 與 `manifest.json`，並確認 age 私鑰已存入密碼管理器。這兩項為 owner 回報；本次沒有從雲端重新下載、也沒有從密碼管理器取回私鑰演練。
- PR #351 的程式候選基準 commit `0d7e32cc`：該版兩個 quality check 及 `celebrate-deal-staging` Preview 部署通過；另一個 `celebrate-deal` Vercel Preview 失敗，故不能將整個 PR 標為檢查全通過。後續文件提交的檢查須依最新 PR 狀態判讀。固定 staging alias 尚未切換。
- staging 資料庫仍是 79 筆已套用 migration；候選程式另有 `20260929170000_payment_method_setup_intent` 與 `20260930094500_payuni_live_probe` 兩筆尚待套用。未修改 staging 資料列或價格，正式資料庫未動。
- 只查 Vercel **變數名稱、類型與範圍**：`celebrate-deal-staging` 專案的三個正式 PAYUNi 變數仍同時覆蓋 Production 與所有 Preview，尚未限縮指定 branch；`PAYUNI_STAGING_PLAN_TEST_VENDOR_ID` 未設定。既有 Preview 變數多為不可讀的 Secret，CLI 本機注入只得到空值，不能據此宣稱連線錯誤或驗證資料隔離。部署執行期仍須以只輸出布林結果的受控檢查核對資料庫、Auth、Storage、固定網域及 PAYUNi 商店歸屬。
- `PAYUNI_STAGING_PLAN_TEST_ENABLED` 的 Preview 變數存在；Owner 回報其值為 `false`，本次沒有讀取該 Secret。以上閘門未完成前維持關閉，也不執行 `--prepare`、`--enable` 或 alias 切換。

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

截至 2026-10-01 的**名稱與範圍**檢查：staging Preview 已見 `PAYUNI_MERCHANT_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV`，但三者均未限制 Git 分支，且同時套用 staging Vercel 專案的 Production 範圍；須由 owner 在平台內限縮。`PAYUNI_STAGING_PLAN_TEST_ENABLED` 已見於所有 Preview，owner 回報值為 `false`；本次只核對名稱與適用環境，沒有讀取值。`PAYUNI_ENV`、`PAYMENT_PROVIDER` 的有效值也仍須由 owner 在 Vercel 後台確認。這些都不是商店歸屬或資料庫隔離證據。

## 準備、啟用與復原

使用受控 CI Environment／平台 Secret provider 注入 staging 資料庫連線；不要讀取 `.env*` 或列舉 Secret Store。執行工具時只輸出代碼和金額。

1. `npx tsx scripts/staging-payuni-plan-prices.ts --inspect`：唯讀確認原方案價格、測試方案狀態。工具會要求固定 staging 網域與四個 staging 資料庫身分欄位一致。
2. 取得隔離與回復點證據後，在受控 runner 設 `STAGING_PAYUNI_TEST_CHANGE_APPROVED=true`，執行 `--prepare`。它只複製三筆原方案的額度與費率、建立 `isActive=false` 的 NT$1／2／3 測試列；不更新原方案。再 `--inspect` 驗證。
3. 部署已通過檢查的 Preview commit，先確認網站沒有測試付款入口。以部署專屬 `VERCEL_URL`、指定測試商家 ID、經後台核對的 CelebrateDeal 商店代號，在受控 runner 執行 `--enable`。此步只將短效資料庫許可寫入三筆測試列；許可兩小時到期，且綁定唯一 immutable deployment URL。
4. 唯讀檢查指定商家看到 NT$1／2／3、其他商家看不到測試入口；原價方案與其他商家不受影響。檢查一般商品／發票與退款仍被封鎖。核對 fixed staging alias 指向已審查部署後，才能更新 alias。
5. 此任務不提交付款表單、不綁卡。後續另獲真實交易授權時，每筆需核對 PAYUNi 正式後台、可信回呼、交易金額和訂閱狀態；未明結果不得重送。

停止時**先執行 `--disable`** 清除資料庫許可，所有同版舊 Preview URL 立即停止建立或顯示新測試付款表單。再移除固定 alias、停用相關舊部署、將 Vercel Preview 旗標關閉並重新部署。環境變數變更不會回溯既有部署，單靠改旗標不構成撤銷。已交給瀏覽器或 PAYUNi 的表單無法撤回，須逐筆核對 pending／paid／failed 和延遲回呼；需要退款時依獨立正式金流程序由人工處理，Preview 退款 API 仍封鎖。對帳完成後，依人工核准的訂閱流程結束測試商家的 active 測試訂閱或改回正常方案，再以月結模擬確認不再產生非預期測試帳單。測試方案列維持停用且保留交易歷史，月結仍讀取它們的 NT$1／2／3 價格，避免訂閱帳務被復原操作改價。

正式站部署、正式資料庫、正式付款／綁卡／退款均不屬於本次操作。
