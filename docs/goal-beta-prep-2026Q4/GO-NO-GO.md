# 封測 Go／No-Go 檢查表（GO-NO-GO）

- 檢查日：2026-10-31（星期六）。封測日：2026-11-01。
- 版本：2026-10-21 建立範本，依 `STATE.md`（10-20 狀態）填入。未勾選的項目在檢查日前由主對話與 owner 補齊。
- 依據：`docs/ROADMAP-v2.md` §0.2、§3.1、§6.3；`docs/skills-2026Q4/05-execution-playbook.md` §6.3。
- 規則：未驗證的項目不得勾選；不以「設定檔存在」代替「runtime 證據」（playbook §6.3）。

## 0. Go／No-Go 摘要（2026-10-22，L1 全部合併時主對話輸出）

**結論：工程端 GO（條件式）。** 封測形式維持「小規模、免費、concierge、staging＋PayUni Sandbox」。能否在 11-01 開放，取決於下列 owner 動作；工程端沒有未修的 BLOCKER。

| 面向 | 狀態 | 證據 |
|---|---|---|
| 程式 | L0 核心 18 項與 L1 48 項全部進 master（PR #445～#467 共 22 個，含文件） | STATE.md 合併紀錄；每個金流／auth／migration PR 都有獨立 reviewer 報告（docs/review-2026Q4/30～47） |
| 資料庫 | staging 所有 migration 已以 `staging-migrate.yml` 套用；全表 RLS、訂單號唯一、月結 ledger 修正已上 | workflow run 紀錄；STATE.md |
| CI | `quality` 必要檢查全綠；master 既有的帳號限流 3601 秒抖動已修（#467） | PR 檢查 |
| 排程 | GitHub Actions 每 5 分鐘呼叫 staging，端點回 200（O-18 已於 10-25 切 alias，line-notifications 需在新部署上重新確認） | B2 證據 |
| 封測功能閘門 | 六個模組伺服器端閘門已上，預設關閉；需 owner 逐商家在 `/admin/vendor-features` 開啟（O-23） | PR #465 |
| 商家註冊 | **邀請制已完成**：`/register` 預設只接受平台管理員在 `/admin/merchant-invitations` 產生、綁定 Email 的簽章邀請連結（`REGISTRATION_MODE` 未設定＝invite）；owner 逐一寄出（O-25）。**商家 Email 驗證已實作**（`ai/merchant-email-verification`，migration `20261025120000_user_email_verified_at`）：註冊後寄 24 小時有效的驗證信，未驗證的商家不能做新的名單型網站獨立發布，既有帳號不被鎖住（O-27）。**Turnstile 程式已就緒，待 owner 建立金鑰（O-26）**；沒有 Turnstile 或寄信設定時，部署的 preflight 會拒絕 `REGISTRATION_MODE=open` | `ai/invite-only-registration`、`ai/merchant-email-verification` |
| Production | 2026-10-25 主對話已移除 2026-07-24 舊 build 的公開網址（`celebratedeal.carry-digital-nomad.in.net`、`celebrate-deal.vercel.app` 回 404），舊 preview／production 部署網址都在 Vercel Authentication 之後；唯一公開的程式端點是跑 master（含 #485）的 staging 網域。之後恢復任何公開網址前，該部署必須已含 #485，且不得在仍有 #485 前的公開部署時上線新的衍生金鑰用途。Production（專案 `celebrate-deal`）**刻意不更新**：資料庫 migration 需先完成 O-4 備份與還原演練、O-19 RLS 前置查詢、O-20 production migration 設定。Production 目前不服務封測商家，封測只用 staging | O-18 紀錄 |

**11-01 前必須由 owner 完成（否則 No-Go 或縮小範圍）**

1. ✅ O-18 已於 2026-10-25 完成：staging 固定網址指向 `dpl_2NRwSRDjhhXNGKX216BrKgzCwKQ7`（commit `585385cc`，tree 與 master `a9291147` 相同，含 #484、#485），smoke 通過；回滾選項 `dpl_FPzL7VRCHnCgeJQhmTdzHj6f4XYQ`。staging 只有 preview 部署，**之後每次合併都要再把 alias 指到 tree 與 master 相同的部署**；新 migration（例如 `20261025120000_user_email_verified_at`）要在切 alias 前以 `staging-migrate.yml`（先 `status` 再 `deploy`）套用到 staging；這個 migration 尤其不能晚於程式：每個已登入的請求都會讀 `User.emailVerifiedAt`，程式先上線會讓所有登入頁出錯。Production 日後恢復時也一樣：先套用 migration，再部署這版程式。
2. O-2 跑一筆 PayUni Sandbox 付款取樣本，10-30 再做 O-12 完整演練。
3. O-3 平台管理員登記 TOTP；O-14 新增 QA TOTP secret。
4. O-23 為每個封測商家開啟需要的模組。
5. O-10／O-11 條款與揭露文字簽核（可先以封測協議過渡）。
6. O-4 Supabase 升級與備份（沒做則封測資料無每日備份，屬可接受風險但需知情）。
7. O-8 LINE 官方帳號方案於 10-27 前決定（10-28～11-02 LINE 維護期）。
8. O-25 為每位封測商家產生並寄出邀請連結（沒有連結無法註冊）；staging／Production 不設定 `REGISTRATION_MODE`。**前置條件**：第一個邀請發出前，CSRF 金鑰分離修正 PR #485 必須已合併、staging 固定網址已切到包含它的部署（O-18，已完成）；Production 開始服務商家之前，也必須在跑包含它的版本；否則邀請可被偽造。
9. O-27 封測說明提醒商家收驗證信；O-26 Turnstile 金鑰在開放公開註冊前設定（邀請制封測可稍後）。

**已接受的殘餘風險**：F-093 Stream 簽章網址只做評估；F-091 (2)、F-134 其餘矩陣列 L2；虛擬使用者不標示版的公平法風險待律師（O-11）；Supabase 正式專案在孟買與 Vercel 東京跨區（O-15）。

**封測期間工程端待命**：10-30 付款演練（O-12）配合、10-31 檢查表（本檔 §1～§3）逐項勾選、封測客戶回報分流。

## 1. 封測必修項（L0 核心，18 項 finding）

對照 `ROADMAP-v2.md` §3.1 的 18 項核對表與 `STATE.md` 的工作項目。

| ☐ | Finding | 工作包 | 10-20 狀態（STATE） | 還需要的證據 | 10-29 預檢結果 |
|---|---|---|---|---|---|
| ☐ | F-168 staging QA 帳號 MFA | A1 | 已合併（PR #448） | QA 帳號通過 TOTP；O-14 已加 secret | 待 O-14（需 QA TOTP secret） |
| ☐ | F-024 財務後台強制 MFA | A2 | 已合併（取代 #436） | 平台管理員 TOTP 登記完成（O-3） | 待 O-3（需平台管理員登記 TOTP）；`recent-mfa`、`mfa` 單元測試通過僅為輔助 |
| ☐ | F-037 付款通知狀態判斷 | A3 | 已合併；待 Sandbox 樣本驗證 | O-2 的 Sandbox 樣本；TradeStatus 4／9、外層 Status、PaymentType 比對；B03-13 未做 | 待 O-2（需 Sandbox 樣本）；`payuni`、payments webhook 單元測試通過僅為輔助 |
| ☐ | F-114 註冊同意紀錄 | A4 | 已合併 | 條款文字定稿（O-10、O-11）；或改用封測協議 | 待 O-10／O-11（條款定稿或封測協議） |
| ☑ | F-026 RLS 與 grant 查證 | B1 | 唯讀查證完成，非阻擋 | 無；RLS 全表 migration 已合併（PR #452） | 10-29 驗證：staging-migrate run 40646327623「128 migrations found … All migrations have been successfully applied」（與 repo 128 個一致）；master `ci` run 40804657424 quality 成功（含 `rls-catalog.db.test.ts`）。[說明](../ai-team/evidence/go-nogo-20261031/README.md) |
| ☑ | F-042 背景工作排程 | B2 | 已合併（PR #447）；GitHub Actions 每 5 分鐘 | `scheduled-jobs` run 的 runtime log 證明各 job 被呼叫（O-18 切 alias 後） | 10-29 驗證：`scheduled-jobs` run 40826761897 日誌 email-deliveries／line-notifications／webhook-retry 皆 http=200 outcome=ok；每日 run 40773959731 electronic-invoices http=202。10-24 起全部成功。**注意實際觸發頻率遠低於每 5 分鐘，見 §5 B-1**。[說明](../ai-team/evidence/go-nogo-20261031/README.md) |
| ☐ | F-090 區域與連線池 | B3 | 已合併；跨區未決 | O-15 決定 A 或 B；`regions: hnd1` 已設 | 待 O-15；補充觀察 `x-vercel-id` 為 hnd1（函式在東京） |
| ☐ | F-058 每日備份與還原演練 | B4 | 準備完成；演練 BLOCKED_OWNER | O-4 升級並開備份；還原演練收據（RTO 記錄） | 待 O-4 與還原演練 |
| ☐ | F-074 `pg_trgm` 還原問題 | B4 | runbook 與修正已驗證 | 還原演練中確認 | 待還原演練 |
| ☑ | F-101 結帳頁內部備註 | C1 | 已合併（PR #449） | 結帳頁買家端無內部字樣（Playwright 或人工） | 10-29 驗證：[桌機](../ai-team/evidence/go-nogo-20261031/F-101-checkout-desktop.png)、[手機](../ai-team/evidence/go-nogo-20261031/F-101-checkout-mobile.png)；買家端無「owner／核准／內部」等字樣，改顯示「將自 2026 年 11 月 1 日起生效」。[結果](../ai-team/evidence/go-nogo-20261031/browser-checks.txt) |
| ☑ | F-110 台灣時區與 404 | C2 | 已合併 | 頁面實際顯示台灣時間（staging smoke） | 10-29 驗證：[截圖](../ai-team/evidence/go-nogo-20261031/F-110-taipei-time.png)；Vercel（UTC）渲染的草稿儲存時間與現在的 UTC+8 相差 0.2 分鐘。[結果](../ai-team/evidence/go-nogo-20261031/browser-checks.txt) |
| ☑ | F-079 英文 404 與 Slug 類顯示 | C2 | 已合併 | 中文 404 與返回出口 | 10-29 驗證：[截圖](../ai-team/evidence/go-nogo-20261031/F-079-404.png)；未知網址回 404，顯示「找不到這個頁面」與「回首頁」。[結果](../ai-team/evidence/go-nogo-20261031/public-probe.txt) |
| ☑ | F-103 新建角色預設可用 | C3 | 已合併 | 腳本頁角色下拉正常 | 10-29 驗證：[截圖](../ai-team/evidence/go-nogo-20261031/F-103-script-role-dropdown.png)；新建角色預設為排程角色，腳本頁角色下拉可選到。[結果](../ai-team/evidence/go-nogo-20261031/browser-checks.txt) |
| ☐ | F-104 不標示版揭露文字 | C3 | 已合併；播放頁「部分互動」未移除 | 律師意見（O-11）；揭露文字定稿 | 待 O-11 律師意見 |
| ☑ | F-107 直播網址重複 | C4 | 已合併 | 撞名時欄位錯誤，不出現整頁錯誤 | 10-29 驗證：[截圖](../ai-team/evidence/go-nogo-20261031/F-107-slug-taken.png)；撞名時欄位紅字「這個直播網址已被使用」、無整頁錯誤。送出時 redirect 由 `actions.test.ts` slug 5 項測試證明。[結果](../ai-team/evidence/go-nogo-20261031/browser-checks.txt) |
| ◐ | F-113 強制腳本 | C5 | 已合併（腳本改選配） | 未使用腳本的直播可發布 | ◐ 程式端：`live-publish-readiness.test.ts`、`live-stepper-form.test.tsx`（「lets a sales live publish without an interaction script」）通過。staging 完整發布走查需影片、表單、Email 範本，併入 O-13 第 5 步後才勾選 |
| ◐ | F-143 Sentry 個資過濾 | C6 | 已合併 | staging 事件內無 cookie、query、變數（抽查） | ◐ 程式端：`sentry-scrub.test.ts` 通過；server／edge／client 設定都套用 `sentryDataCollection` 與 `beforeSend`。staging 事件抽查需 Sentry 帳號，待 owner 後才勾選 |
| ☑ | F-031① `CSRF_SECRET` 資料根金鑰說明 | D1 | 已合併（PR #447） | 無 | 10-29 驗證：`DECISIONS-2026Q4.md` D-39、`docs/launch/scheduled-jobs-runbook.md` 第 104 行已文件化「資料根金鑰、不可輪替」 |

- 圖例：☑ 已有 runtime 證據；◐ 程式端（測試）已驗證、staging 實走待補；☐ 待驗證。
- 10-29 預檢小計：☑ 8 項（F-026、F-042、F-101、F-110、F-079、F-103、F-107、F-031①）；◐ 2 項（F-113、F-143）；☐ 8 項全部卡在 owner（F-168、F-024、F-037、F-114、F-090、F-058、F-074、F-104）。證據索引見 [go-nogo-20261031/README.md](../ai-team/evidence/go-nogo-20261031/README.md)。
- 仍阻擋的項目：無工程端阻擋；上列 ☐ 皆需 owner 帳號、付款或律師（O-2、O-3、O-4、O-10、O-11、O-14、O-15）。

## 2. owner 外部動作（O-1～O-19）

| ☐ | 編號 | 事項 | 截止 | 沒做的後果（OWNER-ACTIONS） |
|---|---|---|---|---|
| ☐ | O-1 | PayUni Sandbox 信用卡約定 Token 是否開通 | 10-24 | 封測隱藏 Funnel 綁卡與依賴綁卡的發布 |
| ☐ | O-2 | 跑一筆 Sandbox 測試付款（取樣本） | 10-24 | F-037 只能依文件寫，風險較高 |
| ☐ | O-3 | 平台管理員全部登記 TOTP；換掉 bootstrap 密碼 | 10-24 | 未登記者下次進財務後台會被導去登記頁 |
| ☐ | O-4 | Supabase 升級 Pro、開每日備份，告知 staging 專案名稱 | 10-24 | 無備份則無還原演練，資料救不回（F-058） |
| ☐ | O-5 | GitHub 安全設定（secret scanning、push protection、Dependabot、fork PR 核准、squash only、environment 限制） | 10-24 | 公開 repo 的 secret 偵測全關 |
| ☐ | O-6 | Vercel 方案、JOB_SECRET 是否 Production 與 Preview 相同、重新授權 connector | 10-24 | 排程超過方案上限；跨環境寫入權限外洩 |
| ☐ | O-7 | Cloudflare 橘雲代理與無直連入口 | 10-24 | 限流可被偽造標頭繞過（+1～1.5 人日） |
| ☐ | O-8 | LINE 官方帳號方案 | 10-27 | 封測商家推播範圍未定 |
| ☐ | O-9 | 政策頁法定資料（營運者名稱、統編或負責人、地址） | 10-29 | 政策頁不能定稿 |
| ☐ | O-10 | #435 條款簽核（「條款 OK」） | 10-29 | 商家註冊同意版本無法定稿 |
| ☐ | O-11 | 律師：商家服務條款、七日猶豫期告知、個資告知簡版；或改封測協議 | 10-29 | 條款與揭露文字無法定稿（F-104、F-114） |
| ☐ | O-12 | 10-30 完整付款演練（成功、失敗、重複通知、部分與重複退款） | 10-30 | RC 驗收的付款項目不能勾選 |
| ☐ | O-13 | 10-31 以客戶身分走首次成功路徑，回覆 Go 或卡住點 | 10-31 | 本檢查表第 3 節不能勾選 |
| ☐ | O-14 | GitHub environment 新增 `PAYUNI_QA_FINANCE_TOTP_SECRET` | 10-24 | 退款自動化 runner 卡在 `/mfa/setup` |
| ☐ | O-15 | 跨區二選一（A 遷東京、B Vercel 改孟買） | 正式上線前 | 正式環境後台逾時（封測不急） |
| ☐ | O-16 | Vercel staging 升 Pro 或接受低頻率 | 10-24 | Hobby 用量上限可能讓排程失敗 |
| ☐ | O-17 | Sentry 告警規則（名稱以 `scheduled-jobs-runbook.md` §3.1 為準） | 10-24 | 付款重試失敗或超賣時沒人知道 |
| ☑ | O-18 | 固定 staging 網址切到 master 最新部署（2026-10-25 主對話完成，smoke 通過；之後每次合併要再切） | 10-24 | staging 停在舊版，封測前修正驗證不到 |
| ☐ | O-19 | Production RLS migration 前置查詢回報「通過」 | 正式部署前 | Production migration 會整批失敗（不會部分成功） |
| ☐ | O-25 | 在 `/admin/merchant-invitations` 為每位封測商家產生邀請連結並親自寄出 | 每位商家開通前 | 封測商家無法註冊（邀請制是預設） |
| ☐ | O-26 | 建立 Cloudflare Turnstile widget，在 staging／正式設定 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` | 公開註冊前 | 註冊沒有機器人防護；不能設 `REGISTRATION_MODE=open` |
| ☐ | O-27 | 封測說明提醒商家收 Email 驗證信（既有帳號不被鎖住） | 封測前 | 商家不知道名單型網站為何無法獨立發布 |

- 10-29 預檢：§2 全部需要 owner 的帳號、付款或簽核，工程端沒有勾選任何一項（O-18 維持 ☑）。唯讀觀察（不構成完成）：O-7 staging 回應標頭 `server: Vercel`、無 `cf-ray`，目前沒有經過 Cloudflare；O-9／O-10／O-11 `/policies*` 已顯示營運者與客服信箱、版本 2026.10.18、「本版本尚未生效」（預定 11-01），無占位字樣；O-26 程式端就緒，金鑰是否設定無法從外部判斷。
- 未完成的 owner 項目：O-1～O-17（O-18 除外）、O-19、O-25～O-27；其中 10-29 到期的 O-9、O-10、O-11 與 10-30 的 O-12 最急。

## 3. 首次成功路徑實走

由 owner 以「封測客戶」身分走一次（對應 O-13）。使用 staging 與 Sandbox，合成資料或新建的測試商家。每一步記錄時間與結果，卡住就停在該步並回報。

| ☐ | 步驟 | 通過標準 | 時間（分鐘） | 結果／卡住點 |
|---|---|---|---|---|
| ☐ | 1. 註冊 | 沒有邀請連結時只看到受邀註冊說明；用 O-25 的邀請連結開啟後 Email 已帶入且不可改，勾選條款後建立商家帳號，同意紀錄可查；收到驗證信，按信中連結再按「確認驗證 Email」後，後台的「請先驗證 Email」提示消失 | | |
| ☐ | 2. 建立商品 | 只用台幣、單品；狀態顯示中文 | | |
| ☐ | 3. 建立報名表單 | 表單可送出；雙重確認頁有「前往直播間」 | | |
| ☐ | 4. 建立直播 | 直播網址自動帶入；撞名時欄位提示 | | |
| ☐ | 5. 發布 | 不需強制腳本即可發布 | | |
| ☐ | 6. 報名 | 收到第一筆報名；報名確認信送達 | | |
| ☐ | 7. 觀看 | 觀眾端顯示台灣時間；虛擬使用者發言不計入觀眾人數 | | |
| ☐ | 8. Sandbox 結帳 | 測試卡付款成功；買家端無內部備註；訂單與交易對帳正確 | | |
| ☐ | 9. 通知送達 | 付款後的交易信、開播提醒送達；LINE 依商家自己的官方帳號 | | |

- 完整路徑所需時間（首次到第 9 步）：____ 分鐘（首次成功路徑指標，見 `BETA-METRICS.md`）。

## 4. 已接受風險

來源：`ROADMAP-v2.md` §3.3（可繞過高分項）、§3.1（砍項順序）、§1.1、§1.2。完整 22 項的繞過方式見 `docs/review-2026Q4/23-remediation-backlog.md` §3.4。

| ☐ | Finding | 風險 | 繞過方式 | 是否已做（待確認） |
|---|---|---|---|---|
| ☑ | F-041 | 非台幣商品可被建立 | 只用台幣；主對話不指導其他幣別 | 已處理：#454（`8d72080b`）起結帳只收 TWD，商品 action 對非 TWD 幣別直接拒絕、不轉換（`product-actions.ts`、`product-form-client.tsx` 的 `unsupported_currency` 提示）。2026-10-30 依 git 紀錄與程式查證，未另做 staging 實測 |
| ☑ | F-112 | LINE 綁定頁錯誤不會變紅 | 創辦人陪同綁定 | 已處理：#453（`23a6a22d`，F-112）LINE 綁定頁加三步驟教學、欄位級錯誤與成功回饋。依 commit 紀錄查證，未另做 staging 實測 |
| ☑ | F-078 | 錯誤頁「重試」不會重新抓資料 | 失敗時由工程端重新整理頁面 | 已處理：#453（`23a6a22d`，F-077、F-078）error boundary 改用 Next 16 的 `retry` 並補掃描測試。依 commit 紀錄查證，未另做 staging 實測 |
| ☑ | F-019 | 常青場設定可能不生效 | 常青場設定由創辦人走查；必要時隱藏 | 已處理：#505（`0aa58e5d`）公開觀看頁依常青排程為每位觀眾安排場次；#507（`89d2088e`）統一常青生效規則（`evergreen-activation.ts`），非 VOD 或影片長度未知時拒絕啟用；#520（`cf6b0610`）儲存設定後立即重建提醒。依 commit 紀錄查證，建議創辦人仍走查一次 |
| ☑ | F-077 | 錯誤頁無重新載入按鈕 | 同上 | 已處理：同 F-078，#453（`23a6a22d`） |
| ☑ | F-001、F-002 | 隱藏只在前端，伺服器仍可呼叫（課程、billing、Funnel 綁卡、諮詢） | 不開權限、不主動介紹 | 已處理：#465（`1330e107`）新增 `Vendor.betaFeatureGrants` 與 `src/lib/feature-gates.ts`，courses、billing、funnel_binding、consultation_booking、browser_live、danmaku 的 action、route 與 page 都在伺服器端檢查，並有 `feature-gates.matrix.test.ts` 與 DB 測試。依 commit 紀錄查證 |
| ☐ | F-052 | 平台沒有「禁止標記已出款」開關 | 封測期間不鎖月結、不撥款 | |
| ☐ | F-025 | 夥伴身分權限過大（會計可看全部夥伴佣金） | 夥伴入口不授權外部人 | |
| ☐ | F-042 | GitHub 排程延遲 5～15 分鐘，偶爾略過；60 天無 commit 會停用 | 每日看排程 run；每 60 天內至少一次 commit | |
| ☐ | F-058 | 若 O-4 還原演練未完成，第一週出事時還原時間未知 | 備份先開，隔離演練延到第一週 | |
| ☐ | F-114 | 若 O-11 未定稿 | 每位商家另簽封測協議 | |
| ☐ | F-141 | job 失敗不會送 Sentry | 每日看排程 run 與寄送紀錄頁 | |
| ☐ | F-004、F-017 | 限流可能被偽造標頭繞過（若 O-7 為否） | 多修 1～1.5 人日，或接受風險 | |
| ☐ | F-016 | 5 個 ops 端點只靠 `JOB_SECRET`（若 O-6 為相同） | 確認各環境密鑰不同 | |
| ☐ | F-015、F-091、F-092 | 漏斗頁與即時輪詢在 20 人以上可能變慢或誤判額度 | 封測同時在線 ≤20 人（D-15） | |
| ☐ | F-095、F-102 | 瀏覽器直播無部署文件；預覽死路 | 不用瀏覽器直播（D-09） | |
| ☐ | F-103（揭露語） | 播放頁「部分互動」字樣未移除 | 等律師意見（O-11） | |
| ☑ | F-133 | CRM 與行動諮詢的租戶測試是假測試 | 封測期間補；目前靠人工與 B1 查證 | 已處理：#459（`ad453597`）以真實 DB 的兩租戶測試取代 mock 假測試：新增 `customer-crm-actions.db.test.ts`、`mobile-consultation-actions.db.test.ts`、`consultations/mobile/page.db.test.tsx`，並刪除原本的 mock 版 `.test.ts` |
| ☐ | 邀請制註冊 | 邀請連結是持有者憑證，不證明對方擁有該信箱 | 只寄給本人；14 天到期；帳號 Email 唯一，一個連結最多建立一個帳號。寄錯對象或不再需要時，在 `/admin/merchant-invitations` 該筆邀請按「撤銷」（需 15 分鐘內完成 MFA 驗證）：寫入 `merchant_registration_invite_revoked` 稽核紀錄後，`/register` 立即拒絕該連結並顯示已撤銷；已用它建立的帳號不受影響，需另行停用。撤銷擋不住已經送出、正在處理中的註冊（建立帳號的交易內會在寫入前再查一次撤銷紀錄，只縮小而非消除這段時間差），所以撤銷後請重新整理清單，確認該筆狀態是「已撤銷」而不是「已註冊」。前置條件：PR #485 已部署到 staging（O-18，已完成），Production 開始服務商家前也必須部署，否則邀請可被偽造。不要為了撤銷邀請輪換 `CSRF_SECRET`：它也是 MFA 與敏感資料的加密根金鑰 | |

- 其餘 `ROADMAP` §1 模組表標為「延後」或「隱藏」的項目，一律視為已接受。
- 未列入的 BLOCKER 或 MAJOR：__________

## 5. 10-29 預檢發現的缺陷與風險

證據與重現方式見 [go-nogo-20261031/README.md](../ai-team/evidence/go-nogo-20261031/README.md)。

| 編號 | 嚴重度 | 現象 | 重現 | 建議 |
|---|---|---|---|---|
| B-1 | MAJOR（封測體驗） | GitHub Actions 的 `*/5 * * * *` 實際約每 2～5 小時才跑一次，遠低於 runbook 寫的「延遲 5～15 分鐘」。10-24 起 36 次 schedule run，間隔中位數 184 分鐘、最長 425 分鐘。報名確認信、開播提醒、webhook 重試若只靠這個排程，可能晚數小時 | `gh run list --workflow scheduled-jobs.yml --limit 100 --json createdAt,event`，只看 `event=schedule`，計算相鄰間隔 | 封測前補一個外部觸發（Vercel Cron 需 Pro、cron-job.org 類服務或 Cloudflare Worker cron，呼叫同一批 `/api/jobs/*`，仍用 `JOB_SECRET`）；O-16 一併決定。確認報名確認信是否在註冊當下就同步寄出，若是則影響較小。這是 O-13 第 6、9 步的風險，也要告知 owner。**工程緩解已合併（#517，`bc1f559c`；尚未驗證，本項不勾選）**：新增 `scheduled-jobs-heartbeat.yml`（GitHub Actions 長駐迴圈，每 5 分鐘呼叫同一批 job，不花錢、不需外部帳號），設計與檢查方式見 [runbook §3.0](../launch/scheduled-jobs-runbook.md)。此做法是封測期間的過渡措施，預設關閉（需 owner 設 `SCHEDULED_JOBS_HEARTBEAT_ENABLED=true` 才啟動）；風險是把 Actions 當 24 小時常駐排程器屬 GitHub 使用條款灰色地帶，若 Actions 被停用，CI 也會失效；長期方案是外部 cron（cron-job.org 或 Cloudflare Worker cron）呼叫同一批端點，heartbeat 保留作備援。合併後須用 `gh run list --workflow scheduled-jobs-heartbeat.yml` 與 staging Logs 實測呼叫間隔，確認後才能關閉 B-1 |
| B-2 | MAJOR（封測體驗，非超賣） | F-055 50 併發壓測（2026-10-30，loopback disposable DB）：同一商品同時下單時，每筆成交都推進 `Product.revision`，其他已 admission 的買家都收到 409「Product changed; reload checkout」。50 人搶 25 件，只有 1 人第一次就成功，賣完要 25 輪；限量快閃相同。沒有超賣，名額與金額都正確 | `npm run test:db:stress`，看 `checkout_reservation` 的 `firstLoadWinners` 與 `reloads` | 封測同時在線 ≤20 人（D-15）時仍會出現，直播快閃前告知商家與買家「遇到請重新整理」。長期把商品內容版本與庫存分開，需 engineer-hard＋reviewer，由 owner 決定時程。詳見 [serializable-retry-callsites.md](../operations/serializable-retry-callsites.md) 〈50 併發壓測〉 |
| B-3 | MINOR（有補救路徑） | 同一場直播多位報名者同時通過驗證時，提醒信具現化大多用完重試（50 併發 47 位、10 併發 7 位失敗，P2034）。報名本身成功，錯誤會被攔下回報，提醒在到期時由排程補建 | 同上，看 `live_notification_distinct_recipients` | 依賴排程頻率（B-1）。Sentry 可能出現成批 `verified_submission_materialize` 回報，屬已知。修正需縮小交易內的查詢範圍（索引或改由排程具現化），另開 PR。**工程修正已提交（分支 `ai/live-notification-contention`，尚未合併，本項不勾選）**：只加索引無效（同時報名的收件人落在同一個索引頁，SERIALIZABLE 的頁級 SIREAD 鎖仍互相衝突），所以具現化改成 READ COMMITTED 加綁 `vendorId` 的列鎖（場次／規則／範本 `FOR SHARE`、報名列 `FOR NO KEY UPDATE`），一位收件人一條規則一列由確定性 id 主鍵保證；另加 `(vendorId, sourceFormSubmissionId)` 索引（migration `20261031090000_email_delivery_source_submission_index`），常青啟用提交後補一次 supersede。同一台機器、全新 disposable DB：不同收件人 50 併發 47→0 失敗、連線池 5 時 25→0、10 併發 6→0，每人只開 1 次交易；同一收件人仍剛好 1 筆。數字與設計見 [serializable-retry-callsites.md](../operations/serializable-retry-callsites.md)〈B-3 修正〉。合併並部署後才關閉 |

未發現 BLOCKER。

## 6. 簽收

| 角色 | 結論 | 日期 | 簽收 |
|---|---|---|---|
| 主對話 | ☐ Go ☐ 有條件 Go ☐ No-Go | | |
| owner | ☐ Go ☐ 縮範圍 ☐ 延期 | | |

- 有條件 Go 的條件（逐條寫入 `STATE.md`）：__________
- 縮範圍的選項依 ROADMAP §3.1 順序：先改用繞過方式；再砍核心中可部分繞過的四項；再縮封測範圍；最後縮客戶數。
- 不可砍（砍了就不能開封測）：F-024、F-037、F-101、F-143、F-026 的唯讀確認、F-042 至少有暫代排程、F-110。
