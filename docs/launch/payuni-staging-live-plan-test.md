# PAYUNi staging 三方案正式金流測試

狀態：固定 staging 已切換、專用帳號與測試方案已建立，尚未由代理發起付款。MFA 改為自願的候選更新中，舊兩小時測試許可已撤銷；新版本驗證後再重新綁定許可。此流程與「1 元綁卡＋10 分鐘後第二筆 1 元扣款」探針分開。

## 2026-10-03 已執行的 staging 更新

- Supabase CLI profile 已恢復 `ocbugvgojrunvenozsbx` 存取。79 筆歷史 checksum 唯讀 precheck 通過後，固定 migration 工具成功套用兩筆，實際核對 81 筆完成／0 筆未完成、兩張新表 RLS 開啟且空表。
- 固定 prepare 工具成功建立專用 User／Vendor／TrackingSetting／VendorMember／AuditLog 各一筆及三筆停用方案；owner 關係唯一。測試價格 100／200／300 cents；原價仍為 248000／598000／1280000 cents。當次查核訂閱及交易皆 0；未查詢正式資料庫。
- Chrome 的 PAYUNi 正式後台已核對 PureFit健康管理、商店 `HTCU1130301000101`，Token 與幕後授權皆啟用；沒有讀取金鑰。專用帳號已登入 dashboard，但方案頁被舊 MFA 強制設定 gate 阻擋，不能把 dashboard 成功當成方案旅程成功。
- `86df67d01161bd8644a7ce7f1b3fb9b5a48e29aa` 的兩組 quality `37079897483`／`37079900302` 與兩個 Preview 都成功。指定 Preview 分支付款旗標和 vendor 綁定設定後，以相同來源建立 `dpl_zA6xDM6vxPHrxRHvxwktM6iA3ePG`，固定 staging 已切至此部署；三項 preflight、資料庫健康與 callback HEAD 405 通過。候選 generated URL、branch alias 與 rollback host 維持 403。
- Owner 已決定所有角色的 MFA 自願，詳見 [MFA 政策](../admin-mfa-hardening-plan.md)。修改期間已執行 `--disable` 撤銷原許可；即使 Preview 旗標為 true，沒有有效 DB permit 仍不能進行三方案測試。新版本需重新取得同一來源 CI、獨立審查及登入後方案畫面證據。

## 2026-10-03 較早的檢查紀錄（以下阻擋已由上述結果更新）

- 候選 source `7ac9121cd10962a8d1e1604fb9d52ea4b660c3b8`，staging Preview deployment `dpl_GbzeUVN7Rbury9RKRgU3Ss3egm3L`，host `celebrate-deal-staging-3cbi4axvk-a25814740s-projects.vercel.app` 已 Ready。建置的 `PAYUNI_ENV`、`STAGING_PREVIEW_DATA_IDENTITY`、`STAGING_PREVIEW_MEDIA_ISOLATION` 三項 PASS；`/api/health` 為 database ok。未登入 `/billing/plans` 內容為登入導向、沒有 PAYUNi 表單；這不是已登入方案旅程或付款證據。
- PR #351 先前兩個 quality run 的失敗根因為 `env.test.ts` 合成外部資料庫 URL 觸發 Secret 掃描；已改為既有的分段合成 fixture，不降低 scanner 規則。Secret scan 與相關 42 個單元測試通過。該 SHA 的 quality runs `37075627934`、`37075624219` 均成功，兩個 Vercel 專案 Preview 亦成功；新 runner 或 migration 變更仍須取得新 SHA 的檢查結果。
- staging WAF rule `rule_log_generated_staging_preview_hosts_HJx9RW` 已發布為 `preview AND host not-in [固定 staging host, 上述唯一候選 host] => deny`。固定站與候選首頁 200；舊 q2twvn3z2 immutable host、分支 alias、rollback 自訂網域皆 403；固定站與候選 `/api/webhooks/payments` HEAD 405。此專案 Ready Production deployment 清單為空。固定 alias 仍指向 `dpl_HkdbLiibYXna3ewGGhGyPBbxYeCb`／`5d5b814681525427ae8f787a75b7ef27fa64ed29`，尚未切換。
- 指定 CLI profile 的 linked staging 已可執行 Management API 唯讀 SQL；79 筆完成 migration、0 筆未完成，專用帳號、商家與三筆測試方案仍不存在。唯讀交易確認 SERIALIZABLE 與 read-only 均生效；`postgres` 在 public 的新表 default privileges 沒有給 `anon`／`authenticated`／`service_role` 權限。這不取代新表的 RLS 防禦與 migration 審查。
- 正式 PAYUNi 後台仍等待 owner 登入，尚未獨立核對 PureFit 代號與功能權限。Secret 值未讀取。付款旗標維持關閉；沒有線上資料寫入、真實付款、綁卡、退款或寄信。
- 固定 Management API prepare／migration 工具已完成獨立 Critical 複審，無 findings；10 項 targeted tests、TypeScript、ESLint、Secret scan 通過。以合成資料建立完整 79 migrations 的拋棄式 PostgreSQL 17，驗證套用後 81 筆／兩表 RLS／空表、重跑拒絕、重複 migration 名稱拒絕、後段故障時兩表及 history 全數回滾，Prisma migrate status／deploy 亦成功。使用專用 Docker bridge、僅綁定 127.0.0.1，完成後清除容器、網路及暫存檔；此為合成 schema 測試，並非對真實備份的還原演練。
- 執行前再次唯讀檢查時，Supabase profile 回傳 403；projects list 只列另外兩個專案，已排除繼承的 Supabase／DB 環境覆蓋，仍看不到指定 staging。因此尚未執行任何線上 migration／fixture 寫入；owner 須恢復該 profile 的 staging 專案存取，接續時重新核對身分與歷史，不能沿用較早成功的 CLI 登入證據。
- 後續 Chrome 已登入的 Supabase SQL Editor 可對精確 staging ref 執行 `BEGIN READ ONLY` 查詢：79 筆完成且名稱唯一、0 筆未完成，專用 User／Vendor／測試方案各 0 筆。原方案實際為 starter 248000、growth 598000、team-pro **1280000 cents**，皆 active；Team / Pro 與既有 seed 相符，先前文件的 128000 少一個 0，應更正紀錄而非改資料。UI 存取可用，不代表 CLI profile 已恢復，也不代替經審查工具的寫入前置條件。僅儲存了不含秘密的唯讀 SQL snippet，未改動應用資料。
- AI Team：requested/effective `ai-team-pro`；實作與 CI 診斷 selected Sol high，獨立 Critical review 使用既有 Astra high fallback（`critical_review_no_equivalent`），observed model/effort unknown。單一 writer、最多一個 helper、depth 1、每個 work package dispatch cap 4；主代理整合 migration 工具與證據。必要 review 已完成，整體 Goal 尚未驗收，最新來源仍須 CI 與線上 staging gates。

## 2026-10-02 歷史執行收據與剩餘閘門

- 已從 Supabase staging 專案 `ocbugvgojrunvenozsbx` 製作加密的 roles、public schema、public data 邏輯備份。本機 archive 雜湊已核對；在無網路、無對外連接埠的一次性 PostgreSQL 容器還原成功。來源與還原後皆為 79 筆已套用的 Prisma migration、120 張 public 表、1542 個 public 欄位；所有表的列數摘要一致。這證明 public 應用資料可還原，**不涵蓋** Supabase Auth、Storage 物件與平台設定。
- Owner 確認 Google Drive 中看得到三個 `.age` 與 `manifest.json`，並確認 age 私鑰已存入密碼管理器。這兩項為 owner 回報；本次沒有從雲端重新下載、也沒有從密碼管理器取回私鑰演練。
- PR #351 的程式候選基準 commit `0d7e32cc`：該版兩個 quality check 及 `celebrate-deal-staging` Preview 部署通過。主專案 `celebrate-deal` Preview 曾因 PAYUNi Sandbox 三件組缺值而被 preflight 擋下；Owner 決定該專案 Preview 使用 demo 付款，已只修改其 Preview 的 `PAYMENT_PROVIDER` 並重新建置通過，Production 設定未動。最新 PR 檢查須依最新提交判讀。固定 staging alias 尚未切換。
- staging 資料庫仍是 79 筆已套用 migration；候選程式另有 `20260929170000_payment_method_setup_intent` 與 `20260930094500_payuni_live_probe` 兩筆尚待套用。未修改 staging 資料列或價格，正式資料庫未動。
- 只查 Vercel **變數名稱、類型與範圍**：`celebrate-deal-staging` 專案的三個正式 PAYUNi Secret 已透過 Vercel API 只提交 target 與 gitBranch 欄位，限縮為 `codex/prelaunch-engineering-20260929` 分支的 Preview；隨後逐筆核對三者皆為 Preview／該分支／sensitive。`PAYUNI_STAGING_PLAN_TEST_VENDOR_ID` 尚未設定。既有其他 Preview 變數多為不可讀的 Secret，CLI 本機注入只得到空值，不能據此宣稱連線錯誤或驗證資料隔離。部署執行期仍須以只輸出布林結果的受控檢查核對資料庫、Auth、Storage、固定網域及 PAYUNi 商店歸屬。
- `PAYUNI_STAGING_PLAN_TEST_ENABLED` 的 Preview 變數存在；Owner 回報其值為 `false`，本次沒有讀取該 Secret。以上閘門未完成前維持關閉，也不執行 `--prepare`、`--enable` 或 alias 切換。
- 指定 Preview 分支已新增 `PAYUNI_ENV=production`、`PAYMENT_PROVIDER=payuni`、`PAYUNI_STAGING_PLAN_TEST_ENABLED=false` 與 `PAYUNI_LIVE_PROBE_ENABLED=false` 的分支覆蓋。一次新部署的 preflight 因舊程式仍要求旗標關閉時必須使用 Sandbox 而安全失敗；候選修正只在精確 staging Vercel 專案、測試分支與四項 staging 資料身分通過時允許正式商店設定先建置，付款入口仍要求旗標及資料庫短效許可。修正已送 PR #351，仍須以最新 SHA 重建及核對，不得沿用失敗部署的狀態。
- 候選程式加入 staging Vercel Preview 建置時的 `STAGING_PREVIEW_DATA_IDENTITY` 閘門，只判斷固定網址與四個 Supabase staging URL，輸出 PASS／FAIL，不記錄連線內容。Vercel staging 專案 metadata 顯示系統環境變數自動注入已開啟；commit `ecfc53a4` 的 immutable Preview deployment `dpl_28hSHMU8h6gWrSuXiZzge2CMuYyi` 實際建置輸出 PASS，`/api/health` 回傳 HTTP 200、資料庫連線成功。此證據只屬於該部署，固定 staging alias 未切換。應用登入使用 Prisma 資料庫，媒體使用 Cloudflare R2／Stream；此閘門不證明 R2／Stream 資源隔離。獨立審查已核對並關閉系統變數可能未注入的 finding。
- 在 `--network none`、無對外連接埠的一次性 PostgreSQL，從同一組加密備份再次還原 public schema/data，按順序套用兩筆候選 migration SQL 均成功；新表為空、預期外鍵存在。容器已停止並自動移除。這是 SQL 相容性演練，不是線上 staging migration，也沒有寫入線上 Prisma migration history。
- 該部署的 PAYUNi preflight 仍選用 Sandbox 三件組；三個正式 Secret 的分支範圍已修好，但 `PAYUNI_ENV=production`、受控旗標及指定測試商家尚未啟用。Owner 重新登入 Supabase CLI 後，指定 profile 已列出 staging ref `ocbugvgojrunvenozsbx`（linked）與不同的 production ref `awigitueyqdqaqwbjdgu`（未 linked）。透過 linked staging 的唯讀 SQL 再查：79 筆已套用 migration、0 筆失敗；setup intent 與 live probe 兩筆候選 migration 均未套用。原 `starter`／`growth`／`team-pro` 價格依序仍為 248000／598000／1280000 cents，均啟用；三筆 `staging-payuni-*` 測試方案不存在。舊測試信箱 `zeroyuanbrothers@gmail.com` 在 staging 的 `User` 表沒有相符帳號；目前 staging 有 3 個使用者、2 個商家與 2 筆商家成員關係，仍須確認唯一測試商家，不能猜測或指定其他商家。上述為 2026-10-02 線上唯讀快照，未改動資料。
- 網站目前沒有自行註冊頁，既有商家成員邀請會加入既有商家，不能建立獨立測試商家。候選工具 `scripts/staging-payuni-test-vendor.ts` 只在固定 staging 網域、四項 staging DB 身分、直接連線、付款旗標為 `false` 及獨立變更閘門通過後，建立一個專用商家及 owner 帳號；不寄信、不設定已知密碼、不修改現有帳號。正式執行尚待隔離、回復點與 review；建立後由帳號持有人在 staging 密碼重設頁自行取得一次性連結，登入完成後再唯讀核對該商家 ID。
- Cloudflare 後台可見 `celebrate-deal-staging` 與 `celebrate-deal` 兩個獨立 R2 bucket，以及一筆標示給 staging bucket、權限為物件讀寫的 R2 Token；但目前可登入的 Cloudflare 帳戶只有一個。Vercel staging Preview 有 R2 與 Stream 變數名稱，未讀取任何憑證值，因此仍未證明部署實際使用上述 bucket 限定 Token。候選建置閘門 `STAGING_PREVIEW_MEDIA_ISOLATION` 要求 staging Preview 的 R2 bucket 名稱精確等於 `celebrate-deal-staging`；在指定付款測試分支（即使付款旗標仍關閉）或任何啟用 1／2／3 元正式金流的 staging Preview，還要求 R2 的 `CLOUDFLARE_R2_ACCESS_KEY_ID`、`CLOUDFLARE_R2_SECRET_ACCESS_KEY` 和 Stream 的 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_STREAM_TOKEN`、`CLOUDFLARE_STREAM_WEBHOOK_SECRET` 全部為空。既有 production preflight 要求 Stream 三件組同時存在或同時不存在。這只保障**新付款測試部署**不持有 Cloudflare 媒體操作憑證，並非證明完整媒體 staging 資源隔離。已在指定 Preview 分支加入五個空值覆蓋，原有 Preview 範圍的五個 Secret 保留；依 Vercel 的分支覆蓋規則，新部署應取空值，仍須由新提交的建置閘門驗證。回復時只移除這五個指定分支覆蓋，原有 Secret 即重新適用；不得在付款旗標仍開啟時復原。唯讀盤點原先有 28 個 Ready 的 staging Preview 部署；**舊 immutable Preview URL 不會因變數變更或 alias 切換而失效**。切換前須確認其中仍可公開存取且持有共享媒體憑證的舊部署已限制存取或依核准程序停用。完成前不得宣稱整個 staging 專案的媒體已隔離。

## 測試範圍與價格

- 固定網站：`https://celebrate-deal-staging.carry-digital-nomad.in.net`，Vercel `celebrate-deal-staging` 專案的 Preview 部署。
- 資料庫：Supabase staging project ref `ocbugvgojrunvenozsbx`，Production project ref `awigitueyqdqaqwbjdgu`（owner 於 2026-10-01 提供）。兩個 ref 不同只是第一項證據；仍須核對應用、Auth、Storage、資料庫實際連線，並建立可用回復點。
- 金流：`PAYUNI_ENV=production`，只用 owner 確認的 PureFit 正式商店，商店代號 `HTCU1130301000101`。部署前仍須由該商店後台核對權限與 Vercel 設定歸屬；不得讀取或輸出 Hash Key／Hash IV。
- 測試方案是三筆**獨立且 `isActive=false`** 的資料列：`staging-payuni-starter` NT$1、`staging-payuni-growth` NT$2、`staging-payuni-team-pro` NT$3。原本 `starter`、`growth`、`team-pro` 資料列及 production seed 完全不改。舊部署仍只查 `isActive=true`，不能販售測試方案。
- 新部署只對資料庫許可中指定的單一商家、PAYUNi 商店與 immutable deployment URL 開放三筆測試方案。一般商品、發票結帳和退款的 Preview 正式金流保護仍生效。付款回呼依既有簽章、訂單號、交易金額和幣別核對。
- 啟用條件同時要求 Vercel project ID `prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn` 與 git branch `codex/prelaunch-engineering-20260929`；`--enable` runner 也必須提供這兩項核對值。執行前仍要由 Vercel deployment metadata 獨立確認 permit 指向的 host 屬於該專案、分支與已審查 SHA。

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

### 已登入 CLI 的固定 staging 替代工具

本機無法安全注入 Prisma 連線時，可使用已登入的 Supabase CLI 2.108.0、固定 profile `celebratedeal-staging-20261002` 與已核對 linked ref 的 main workspace。以下工具透過 `db query --linked` 的 Management API 操作，不讀取 CLI 憑證或 `.env*`。必須先完成同一來源的檢查、隔離、回復點與獨立審查；本機環境布林值只是操作閘門，不能冒充遠端證據。

- `scripts/staging-payuni-management-prepare.ts --prepare`：同時要求兩個既有變更閘門、固定帳號 email、Preview 專案／分支／網址及 `PAYUNI_STAGING_PLAN_TEST_ENABLED=false`。一次 SERIALIZABLE 交易建立 Vendor、User、TrackingSetting、VendorMember、AuditLog 各一筆及三筆停用方案；沒有 enable、寄信或付款。與原 Prisma vendor/plan prepare 工具是替代關係，不可兩套都跑。
- `scripts/staging-payuni-management-migrate.ts --apply`：另外要求 `STAGING_PAYUNI_MIGRATION_CHANGE_APPROVED=true`。只接受兩筆固定 SHA 的尚未套用 migration，完整比對 79 筆唯一已完成 migration 的名稱／checksum，確認沒有未完成紀錄或既有目標表，才在同一交易套用 DDL、記錄兩筆 Prisma history 並核對 81 筆／RLS／空表／Data API 無直接權限。這不是 `prisma migrate deploy`；歷史紀錄只在精確 DDL 成功時同交易落地，不可單獨手動標為 applied。
- `scripts/staging-payuni-management-permit.ts --enable`：在 owner 已可登入專用商家、正式商店後台核對及精確部署驗證完成後才執行。要求原有 change gate 與固定 project／branch／Preview／app／Supabase 綁定、正式 PAYUNi、live probe 關閉、固定 PureFit 代號，以及經 Vercel metadata 核對的唯一 generated host／vendor ID。資料庫再次核對專用 email／slug／唯一 owner、三筆停用且無 permit 的 100／200／300 cents 方案、該商家無 pending PAYUNi platform 交易，才以 DB 時間寫入同一份兩小時許可。執行前不得只看環境變數就推論部署或商店歸屬。
- `scripts/staging-payuni-management-permit.ts --disable`：保留基本 change gate 與固定 linked staging 目標，其他環境值漂移仍可撤銷；只清除三筆測試方案 description 並保持 inactive，不修改原價、訂閱或交易。重新啟用前先明確撤銷舊許可及核對 pending，不能直接覆蓋非空 permit。

上述工具的暫存 SQL 皆先套 Windows owner-only ACL，再寫入及執行，最後清除。**逾時、連線中斷或清理失敗屬於結果未知，不可因 CLI failure 盲目重跑。** 先唯讀核對：prepare 的完整八筆、owner 關聯、測試價格 100／200／300 cents、isActive=false、permit null；migration 的 79／81 筆歷史、兩個名稱／checksum、兩表及 RLS；permit 的三列 description 是否一致、host／vendor／merchant／expiresAt 是否與本次操作相符，或撤銷後是否皆為 null 且 inactive。完整成功則記錄成功狀態並處理本機殘留檔，不再執行；完整未寫入且原因已修復才可重新評估執行。任何部分狀態或非預期金額皆停止變更、保持付款關閉，保留 sanitized evidence 進一步診斷。清理失敗時只移除已核對由該次工具建立的精確檔案與空目錄，不掃描或清除其他資料。

在方案準備前，先於隔離與回復點確認後以受控 runner 設 `STAGING_PAYUNI_TEST_VENDOR_CHANGE_APPROVED=true`、`STAGING_PAYUNI_TEST_ACCOUNT_EMAIL=zeroyuanbrothers@gmail.com`、可選的 `STAGING_PAYUNI_TEST_ACCOUNT_NAME`，且保持 `PAYUNI_STAGING_PLAN_TEST_ENABLED=false`，執行 `npx tsx scripts/staging-payuni-test-vendor.ts`。工具只接受 owner 已指定的上述信箱，其他地址直接拒絕；若需換信箱，先取得新的 owner 指示並審查程式變更。重跑或撞到既有同名商家／帳號也會拒絕；不會發信或回傳密碼。建立前須先確認 staging 的重設郵件設定與寄送能力；使用者在固定 staging 站的 `/password-reset/request` 自行設定密碼。若郵件未送達，專用帳號因未知隨機密碼仍無法登入：保持付款旗標關閉、不要設定測試商家 ID、不要重跑建立工具；先修復寄信設定，再由帳號持有人重新要求重設連結。唯讀查詢確認新帳號只有一個專用商家 owner 成員關係、沒有原有訂閱或待付款交易後，才把其商家 ID 設為指定 Preview 分支的 `PAYUNI_STAGING_PLAN_TEST_VENDOR_ID`。不要將帳號密碼、重設連結或資料庫連線輸出到日誌。

1. `npx tsx scripts/staging-payuni-plan-prices.ts --inspect`：唯讀確認原方案價格、測試方案狀態。工具會要求固定 staging 網域與四個 staging 資料庫身分欄位一致。
2. 取得隔離與回復點證據後，在受控 runner 設 `STAGING_PAYUNI_TEST_CHANGE_APPROVED=true`，執行 `--prepare`。它只複製三筆原方案的額度與費率、建立 `isActive=false` 的 NT$1／2／3 測試列；不更新原方案。再 `--inspect` 驗證。
3. 部署已通過檢查的 Preview commit，先確認網站沒有測試付款入口。以部署專屬 `VERCEL_URL`、指定測試商家 ID、經後台核對的 CelebrateDeal 商店代號，在受控 runner 執行 `--enable`。此步只將短效資料庫許可寫入三筆測試列；許可兩小時到期，且綁定唯一 immutable deployment URL。
4. 唯讀檢查指定商家看到 NT$1／2／3、其他商家看不到測試入口；原價方案與其他商家不受影響。檢查一般商品／發票與退款仍被封鎖。staging 專案 WAF 須使用 `environment=preview AND host not-in [固定 staging host, 唯一候選 host] => deny`，同時限制舊 immutable、branch alias 及 rollback 自訂網域。候選例外只用於切換前檢查；記錄 deployment ID、完整 SHA、branch、建置身分/媒體隔離 PASS 與兩付款旗標關閉證據。例外會允許該 host 全站流量，不等同技術上的唯讀權限。確認固定 host、候選可達，舊 immutable、branch alias、rollback host 皆回 403，才切換固定 alias；切換後移除候選例外並再次驗證生成網址 403。復原維持 Deny，只調整已驗證安全的精確 host／alias，不可改回 Log 或停用而重新公開舊部署。
5. 此任務不提交付款表單、不綁卡。後續另獲真實交易授權時，每筆需核對 PAYUNi 正式後台、可信回呼、交易金額和訂閱狀態；未明結果不得重送。

停止時**先執行 `--disable`** 清除資料庫許可，所有同版舊 Preview URL 立即停止建立或顯示新測試付款表單。關閉 Vercel Preview 旗標並重新部署，同時保留固定 staging alias 指向相容且使用正確商店設定的回呼處理部署，直到 pending 與延遲回呼完成對帳。以 HEAD 核對 `/api/webhooks/payments` 回應用層 405，首頁 200 不足以證明回呼可達。環境變數變更不會回溯既有部署，單靠改旗標不構成撤銷。已交給瀏覽器或 PAYUNi 的表單無法撤回，須逐筆核對 pending／paid／failed 和延遲回呼；需要退款時依獨立正式金流程序由人工處理，Preview 退款 API 仍封鎖。對帳完成後，依人工核准的訂閱流程結束測試商家的 active 測試訂閱或改回正常方案，再以月結模擬確認不再產生非預期測試帳單。測試方案列維持停用且保留交易歷史，月結仍讀取它們的 NT$1／2／3 價格，避免訂閱帳務被復原操作改價。

本次可沿用已演練的 2026-10-01 加密備份作為回復點；日期本身不構成重做備份的理由。新增前先確認 migration 狀態、測試資料尚不存在並記錄新增範圍；優先以交易回滾、撤銷許可及停用新增資料復原，相容的新空表可保留。整庫還原會丟失備份後其他合法變更，不作為例行復原。若改為更新/刪除既有資料或無法界定影響範圍，才需重新建立對應回復點。

正式站部署、正式資料庫、正式付款／綁卡／退款均不屬於本次操作。

## 2026-10-04：本地 pending 與 PAYUNi 無資料的診斷

唯讀核對指定 staging 測試商家：一筆 pending、TWD 100 cents，無 providerTradeNo；已保存表單的正式 UPP 目的地與 PureFit 商店代號匹配。這只是設定與本地紀錄的證據，不代表表單曾送出、Hash Key／IV 正確或 PAYUNi 已接受交易。沒有讀取或輸出密文、金鑰或供應商原始回應。

舊流程在建立 pending 後返回方案頁，需再次點擊付款；2982de26 已改為選擇 POST 直接交接。GET 回復頁仍不自動重送。新部署切換會使舊 deployment-bound permit 不再適用，兩小時許可到期也會關閉入口。畫面現在區分許可到期、版本未綁定及未啟用；本地 pending 提示只呈現给目前商家的 owner。

### 未明交易的安全處理

1. 保留原交易、訂閱、冪等鍵與不可變 metadata。後台空清單及 providerTradeNo 為空，均不能當作已取消／未送出的證據；先核對商店、訂單識別及日期篩選。
2. 已由供應商確認存在的交易，依可信簽章回呼或受控對帳完成狀態更新。不要要求取消一筆尚未證實存在的 PAYUNi 交易。
3. 未明或查無資料時不自動取消、重送、重新加密舊表單或建立替代付款。既有 Sandbox 未引用交易查詢不允許用來查正式商店；尚無經驗收的 staging 正式商店未引用訂單回收流程，需取得具體供應商契約及查詢結果後再實作。
4. 可先依原 runner disable 撤銷許可，交易及 metadata 保持原狀。只有確認交易已透過受控生命週期進入終態且其他閘門通過後，才能 enable 綁定最新經驗證 Preview host。不得修改 runner 的 pending 防護來解鎖。

### 最後由 owner 手動付款（目前尚未解鎖）

先確認三方案許可與畫面均有效，再到固定 staging `/billing/plans` 選 Starter NT$1。由 owner 自行完成 PAYUNi 付款；只有可信回呼驗證完成後，才核對該 staging 訂閱啟用、交易 paid 與金額一致。提供去敏的成功／錯誤訊息、金額與時間即可，不提供卡號、Token 或完整付款回應。Growth NT$2 與 Team/Pro NT$3 必須在前筆結果明確後分別測試；綁卡及第二筆扣款探針另行驗證。

Chrome 合成 POST 點擊被擴充介面阻擋，瀏覽器交接驗證仍未通過；程式測試及部署成功不能代替這項證據。

### 2026-10-04：owner 明確同意一次新單重試

Owner 最新回答「是」，已同意保留舊 pending 訂單、重新選方案建立新單，並理解可能出現兩筆付款。這項新授權只取代上節對這一筆未明交易的禁止重試結論：商家固定為 `199d96aa-7e6e-48e0-986c-23ba07f5a856`，舊交易固定為 `cmusddjxy0003jt04ov7ylk3h`／`CD-20261003123000-PBHP04`；其他商家、商品、退款與額外 pending 都維持既有保護。

候選 `scripts/staging-payuni-management-permit.ts --enable-retry` 額外要求非 Secret 操作閘門 `STAGING_PAYUNI_PENDING_RETRY_APPROVED=true` 與 `PAYUNI_STAGING_PLAN_TEST_ACKNOWLEDGED_PENDING_TRANSACTION_ID` 精確等於上述舊交易，並保留原有 change gate、linked staging、Preview project／branch、商店與 generated host 核對。SQL 在同一 SERIALIZABLE 交易核對舊 pending 的商家、訂单、平台付款、TWD 100 cents、無 providerTradeNo、原冪等鍵、訂閱／方案與 immutable permit／UPP snapshot，且沒有 PAYUNi callback、額外 pending 付款／訂閱或已使用的 acknowledgment。僅允許三筆停用測試方案的 description 都精確等於該舊 snapshot、且舊 legacy permit 已過期時，原子替換為同一份 30 分鐘的新 permit。不能再次更新 retry permit，也不能以 disable 後 enable-retry 重新延長窗口。

新 permit 含 `acknowledgedPendingTransactionId` 與 DB 產生的 `retryAttemptId`；三種價格共用一次 attempt 的冪等鍵與不可變交易 metadata。任選 NT$1／2／3 只建立一笔新單。雙擊沿用同一筆已建立的新付款；換方案、終態、新 nonce 或 provider setup 失敗都不能再次使用此 acknowledgment，因為 callback／cleanup 即使清掉 transient key，metadata 的使用紀錄仍保留。舊 PaymentTransaction 的 status、orderNumber、key、metadata 不由此重試修改；舊表單不重送也不重新加密。沿用既有 `payment_superseded` 訂閱排序：可信晚到回呼仍可把舊交易記為 paid，但不會把舊方案重新啟用或取代新方案。

此節描述候選控制與 owner 授權，不是部署、許可寫入或付款成功證據。執行前須記錄經審查的 exact SHA／host，並以 staging transaction ROLLBACK 預演核對真實 schema 與 predicates；實際付款由 owner 自行完成。
