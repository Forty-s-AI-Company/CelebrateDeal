# 封測前 Goal：需要 owner 親自處理的事項

更新：2026-10-19（主對話維護）。owner 指示「不要停下，手動部分集中成報告」，所以這份清單是 owner 回來時唯一要看的東西。每項都寫清楚：做什麼、在哪裡做、做完要回報什麼、沒做會怎樣。**不要把任何金鑰、密碼、Token 貼到對話裡。**

狀態說明：⏳ 等 owner、✅ 已完成、⚠️ 逾期會影響封測。

## 本週（10-24 前）

| # | 狀態 | 動作 | 在哪裡做 | 做完回報什麼 | 沒做的後果 | 對應 |
|---|---|---|---|---|---|---|
| O-1 | ⏳ | **PayUni Sandbox 商店是否開通「信用卡約定 Token」**：登入 PayUni Sandbox 後台，看商店「賀成交AI x CelebrateDeal」的功能列表 | PayUni 後台 | 回「已開通」「未開通」或「不確定」三選一 | 未開通則封測隱藏 Funnel 綁卡與依賴綁卡的發布（已預設如此） | D-03、T1 |
| O-2 | ⏳⚠️ | **跑一筆 Sandbox 測試付款**：主對話會在 staging 建一筆合成訂單並給你付款頁連結，你只要輸入 PayUni 公開的測試卡號；建議順便在 LINE 內建瀏覽器開一次 | staging 付款頁（連結由主對話提供） | 回「付了」即可；工程端會從 staging 稽核紀錄取去識別化的回呼樣本 | 付款判斷修正（F-037）只能依文件寫，10-30 才能驗證 | D-04、T2 |
| O-3 | ⏳ | **平台管理員全部登記 TOTP**：所有 `platform_admin` 帳號登入後到 `/mfa/setup` 完成登記；bootstrap 管理員換掉初始密碼 | staging 與（若有）Production 的 `/mfa/setup` | 回「都登記了」 | #436 合併後，沒登記的管理員下次進財務後台會被導去登記頁（不會被鎖死，只是多一步） | D-05 |
| O-4 | ⏳⚠️ | **Supabase 升級與備份**：封測資料所在的 Supabase 專案升到 Pro、開每日備份；並告訴主對話「哪一個專案是 staging」（專案名稱即可） | Supabase Dashboard → Billing、Backups | 回專案名稱與「已升級」 | 沒有備份就沒有還原演練，封測出事資料救不回（BLOCKER F-058） | D-07 |
| O-5 | ⏳ | **GitHub 安全設定**（若主對話用 CLI 權限不足會在下方註明哪些沒做成）：Settings → Code security：secret scanning、push protection、Dependabot security updates；Actions：fork PR 需核准改為「所有外部貢獻者」；General：只允許 squash merge、自動刪分支；Environments：staging 與 production 只允許 `master` 部署，production 加 reviewer | GitHub repo Settings | 回「設了」 | 公開 repo 的 secret 洩漏偵測全關；曾貢獻過的外部帳號可直接跑 workflow | D-08、D-22 |
| O-6 | ⏳ | **Vercel 三件事**：(a) 看方案是 Hobby 還是 Pro（影響 cron 次數上限）；(b) 看 Production 與 Preview 環境的 `JOB_SECRET` 是不是同一個值（只需回「相同／不同」，不要貼值；相同就換掉 Production 的）；(c) 在 claude.ai 連接器設定重新授權 Vercel connector（目前對 staging 讀取回 403） | Vercel Dashboard → Settings；claude.ai → Connectors | 回方案名稱、相同／不同、已重新授權 | (a) 排程設定可能超過方案上限；(b) Preview 外洩等於 Production 跨租戶寫入權限外洩 | D-06、D-18、D-21 |
| O-14 | ⏳ | **新增 GitHub environment secret `PAYUNI_QA_FINANCE_TOTP_SECRET`**（環境 `Preview – celebrate-deal-staging`）：值是一組 base32 的 TOTP seed，用任何 TOTP 產生器或 `node -e "console.log(require('crypto').randomBytes(20).toString('base64'))"` 轉 base32 皆可；主對話沒有權限新增 secret。工作線 A 的 runner 會用它讓 staging 財務 QA 帳號通過雙重驗證 | GitHub → Settings → Environments → Preview – celebrate-deal-staging → Add secret | 回「加了」 | #436 合併後，PayUni 退款自動化 runner 會卡在 `/mfa/setup` | A1、F-168 |
| O-15 | ⏳ | **資料庫與主機跨區二選一**：Supabase 正式專案「CelebrateDeal」在孟買（ap-south-1），Vercel 函式設在東京（hnd1），正式上線會跨區、後台容易逾時。A（建議）：正式上線前把 Supabase 正式專案遷到東京（等還原演練通過後再做，主對話會備好步驟）；B：Vercel Production 改設孟買 `bom1`。封測跑 staging（兩邊都在東京），所以不急，但要在正式上線前決定 | 回「A」或「B」 | 回「A」或「B」 | 正式環境後台逾時 | B3、F-090、D-19 |
| O-16 | ⏳ | **Vercel staging 專案是 Hobby 方案**：GitHub Actions 排程每 5 分鐘呼叫 staging，每天約 290 筆 deployment／function 紀錄；若 Hobby 的用量上限被撞到，排程會失敗。建議把 staging 專案升 Pro，或接受較低頻率（主對話會先用 5 分鐘觀察一週） | Vercel Dashboard | 回「升了」或「維持」 | 排程可能被限流 | B2、F-042 |
| O-17 | ⏳ | **Sentry 告警規則**：在 Sentry 的 staging 專案建立 alert rule：事件 tag 或 message 含 `webhook-retry exhausted` 或 `InventoryUnavailableError` 時，以 Email（或 LINE Notify 替代管道）通知你；另外確認 Sentry 專案已連到正確的 DSN 環境 | Sentry Dashboard → Alerts | 回「建了」 | 付款通知重試失敗或超賣時沒人知道（B03-07） | B2、M2 |
| O-18 | ⏳⚠️ | **把固定 staging 網址切到 master 最新部署**（主對話執行 `vercel alias set` 被權限擋下）。三條工作線已全部合併進 master（bd85be87），但固定網址仍指向 10-18 的舊部署，所以排程呼叫 `line-notifications` 回 405、新功能都還沒上 staging。在已登入 Vercel CLI 的終端機執行下面這一行即可（目標部署 `celebrate-deal-staging-2opyiacfr` 的程式內容與 master 完全相同，已驗證 tree 一致）：<br>`vercel alias set celebrate-deal-staging-2opyiacfr-a25814740s-projects.vercel.app celebrate-deal-staging.carry-digital-nomad.in.net --scope a25814740s-projects`<br>切完回我一聲，我會跑排程 workflow 與瀏覽器 smoke 驗證。另外建議之後把 staging 專案的 production branch 改成 master 並修復其 production 部署（最後一次是 8 月失敗），這樣每次合併就自動更新 staging | 本機終端機（Vercel CLI 已登入） | 回「切了」 | staging 停在舊版，封測前所有修正都驗證不到 | B2 證據、STATE |
| O-19 | ⏳ | **RLS migration 部署前置查詢（Production 才需要）**：PR #452 會對全部資料表啟用 RLS，執行 migration 的角色必須是每張表的 owner 或可繼承的成員。staging 已由主對話唯讀查證通過（postgres 是 prisma 的成員）；Production 專案主對話無法讀取，請在正式部署前依 `docs/operations/prisma-migration-guards-runbook.md` 的前置 SQL 查一次並回報「通過」 | Supabase SQL editor（Production 專案） | 回「通過」或貼出 owner 清單（不含資料） | migration 在 Production 會整批 RAISE 停止，不會部分成功，但部署會失敗 | B04-08、PR #452 |
| O-20 | ⏳ | **Production migration 的前置（PR #457 之後）**：(a) GitHub `production` environment 設定 required reviewers（你自己）；(b) Production 備份 workflow 尚不存在，`production-migrate.yml` 在你設定 `PRODUCTION_BACKUP_WORKFLOW_PATH` 並提供備份 run ID 前一律拒絕部署，這是刻意的；正式上線前要先完成 O-4 的備份與還原演練 | GitHub Settings → Environments | 回「設了」 | 正式 migration 無法執行（封測不受影響，封測跑 staging） | F-064、D-41 |
| O-21 | ⏳ | **個資保存期限定案**：`/api/cron/data-retention` 預設關閉，期限預設 WebhookEvent payload 180 天、AnalyticsEvent 365 天、AuditLog IP 365 天，請依律師建議回「採預設」或改數字；定案後主對話再開啟排程 | 回覆即可 | 回「採預設」或數字 | 保存期限未定前不清理（只影響儲存量） | F-070、D-38 |
| O-22 | ⏳ | **直播分鐘額度即將第一次真正生效**：審查發現 master 上的用量心跳從 #136 起每次都 500，帳本是空的，所以「方案分鐘額度」從未擋過任何人。PR #461 合併後額度會真的生效。封測前請確認每個封測商家的方案額度足夠（或先設為不限），並在封測說明中告知「超過額度播放會暫停」 | 商家後台方案設定 | 回「確認了」 | 封測客戶直播到一半被暫停 | R461-02 |
| O-23 | ⏳ | **封測商家功能授權**：PR #465 之後課程、billing、Funnel 綁卡、諮詢預約、瀏覽器直播、彈幕六個模組在伺服器端預設關閉，只有平台管理員能在 `/admin/vendor-features` 逐商家開啟。封測前請為每位封測商家決定要開哪些（預設全關；顧問型客戶可開諮詢預約） | staging `/admin/vendor-features` | 回「設了」 | 封測商家看不到這些模組（這是預設行為） | F-001、D-02 |
| O-24 | ⏳ | **Vercel Hobby build 速率上限**：10-22 PR #465 的兩個 Vercel preview 檢查因 build-rate-limit 失敗（非程式問題，`quality` 綠）。切 alias（O-18）或之後自動部署若再遇到，等一小時重試；或與 O-6 一併評估升 Pro | Vercel | 無需立即動作 | 只影響 preview 部署時效 |
| O-25 | ⏳ | **`CSRF_SECRET` 不可再更換**：staging 的 `CSRF_SECRET` 在 7 月後被換過，導致當時加密的資料（管理員驗證器、舊測試的 LINE／付款設定）永遠解不開。封測前請確認 staging 與之後的 Production 都不要再輪替；若不得不換，要先備份並規劃重新登記（D-39） | Vercel／GitHub 環境變數 | 回「知道了」 | 再換一次，封測商家已登記的驗證器與已存的 LINE／Meta 金鑰全部失效 | D-39、F-031 |
| O-7 | ⏳ | **Cloudflare**：正式網域是否全程經 Cloudflare 代理（橘雲）且沒有其他直連入口 | Cloudflare DNS | 回「是／否」 | 否則限流可被偽造標頭繞過，要多修 1～1.5 人日 | D-20 |

## 封測前（10-27～10-29）

| # | 狀態 | 動作 | 截止 | 對應 |
|---|---|---|---|---|
| O-8 | ⏳⚠️ | **LINE 官方帳號方案**：10-27 前決定平台自己的官方帳號用哪個方案；10-28 到 11-02 是 LINE 維護期，不要異動。封測商家用自己的官方帳號推播，平台不代付（已預設） | **10-27** | D-23 |
| O-9 | ⏳ | **政策頁法定資料**：營運者法定名稱、統編或負責人姓名、營業地址；建議申請專用網域信箱取代個人 Gmail。給主對話文字即可，會由 docs 改到政策頁 | 10-29 | D-24 |
| O-10 | ⏳ | **#435 條款簽核**：看過 staging 的服務條款、隱私權政策、退款政策頁後，回「條款 OK」，主對話會記進 STATE.md | 10-29 | D-25 |
| O-11 | ⏳ | **律師**：商家服務條款（虛擬使用者責任歸屬、不標示版的公平法風險）、七日猶豫期告知文字、個資告知簡版。來不及就改成每位封測商家另簽一份封測協議（主對話會先備好草稿） | 10-29 | D-26～D-28 |
| O-12 | ⏳ | **10-30 完整付款演練**：再輸入一次測試卡號，工程端跑成功、失敗、重複通知、部分與重複退款 | 10-30 | D-04 |
| O-13 | ⏳ | **10-31 Go／No-Go**：以封測客戶身分走一次首次成功路徑（註冊、建商品、建表單、建直播、發布、報名、觀看、Sandbox 結帳），回「Go」或列出卡住的地方 | 10-31 | ROADMAP §3.1 |

## 封測後再處理

- 會計師：手續費、扣繳、二代健保、發票開立主體（第一次撥款前，最早 12 月初）。
- 律師意見書：聯盟是否觸及多層次傳銷、金流定性（聯盟開放出款前）。
- 舊 worktree 移除、`prisma/dev.db` 與 `error.log` 刪除、docs 歸檔。

## 主對話代為決定並已執行的事（owner 回來後只需知道）

- DECISIONS-2026Q4 的 D-01、D-02、D-06、D-09～D-17、D-19、D-21、D-29 全部採預設建議 A；D-06 排程平台以 Vercel Cron 為主，若方案上限不足則用 GitHub Actions 排程暫代。
- 封測範圍：直播／預錄場、互動腳本與虛擬使用者（不標示版）、商品結帳（只用台幣、Sandbox）、報名表單、漏斗頁、LINE／Email、Meta 追蹤（預設關）、聯盟只累計不出款、CRM／客服；隱藏課程、billing、Funnel 綁卡、諮詢預約、瀏覽器直播、彈幕。每場同時在線 20 人以下，不鎖月結、不撥款。
- 三條工作線已在獨立 worktree 開工：`codex/beta-lineA-auth-payments`、`codex/beta-lineB-data-ops`、`codex/beta-lineC-first-success`。
