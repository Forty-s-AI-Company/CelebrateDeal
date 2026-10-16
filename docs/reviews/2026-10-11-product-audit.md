# CelebrateDeal 產品審視報告

- 審視日期：2026-10-11（Asia/Taipei）
- 審視基底：**`origin/master@efb8b7e9`**（#422）。依使用者指示與 Codex 回覆核對後定案；**不是**使用者目前工作樹的 `codex/one-stop-webinar-flow`。
- 審視方式：以 `git archive efb8b7e9` 匯出唯讀快照到暫存目錄，在快照內安裝依賴、型別檢查、測試與啟動 dev server；使用者工作樹（HEAD `60132971`、branch `codex/one-stop-webinar-flow`、274 個未提交變更）未被 checkout／reset／stash／clean／修改。
- 引用路徑與行號：皆指 `origin/master@efb8b7e9` 的 repo 相對路徑。
- 模型與推理程度：Sonnet 5.5（`claude-sonnet-5-5`）；推理程度 **unknown**（環境未揭露）。
- 證據標籤：【實測】本次實際執行或看到畫面／輸出；【程式碼】讀過原始碼；【文件宣稱】repo 文件所述；【推論】由證據推得；【待驗證】尚無證據。

---

## 1. 決策摘要

### 1.1 目前產品定位與整體判斷

- **產品是什麼**：CelebrateDeal 自稱「Cloudflare-first 直播導購 SaaS」（`PRODUCT.md`）。行銷文件把首波客群收斂為「靠說明會／銷講影片／直播成交、且有多位夥伴複製同一套內容的台灣小型團隊」【文件宣稱；該行銷文件只在 `codex/one-stop-webinar-flow`，master 沒有】。
- **整體判斷**：工程底盤相當紮實（付款、webhook、冪等、租戶範圍、a11y 自動掃描都有強證據），但**產品在「第一次成功」前就會斷掉**：商家按下「發布」後，公開頁仍是 404、付款方式的語意與外部核准懸而未決、對外政策頁還是內部治理草稿。產品面積（42 個導覽項、約 140 頁、約 100 支 API、96 個 migration）遠大於「報名→提醒→到場→成交」這條主幹需要的範圍，而主幹上的關鍵件（排程、提醒、電子發票、LINE 事件）仍是半成品。
- **發布狀態**：repo 自身標示 `NO_GO`（`docs/launch/manual-blockers.md`、`docs/launch/CURRENT.md`）。本審視不改變這個結論，並指出更多「非外部證據、而是產品本身」的阻擋點。

### 1.2 最值得保留的優勢

1. **付款與對帳紀律**：結帳價格由伺服器決定、冪等鍵、provider readiness fail-closed（`src/app/api/payments/checkout/route.ts`）；webhook 簽章→事件冪等 claim→重試→redact 後保存（`src/app/api/webhooks/payments/route.ts:140-302`）；checkout recovery 只回不可變條款（`src/app/api/payments/checkout/recovery/route.ts`）。【程式碼】
2. **誠信設計**：腳本互動對觀眾固定揭露「官方互動為商家預先設定的腳本，不代表即時真人留言、真實購買或觀看人數」（`src/components/live-playback.tsx:1048`）；Webinar 註冊頁明示「送出後請至 Email 完成確認，才會列入正式名單」（`src/components/landing-pages/funnel-webinar-experience.tsx:51`）。【程式碼】
3. **團隊模板＋夥伴頁＋歸因**：行銷文件主張的差異點，且資料模型（TeamFunnelTemplate／PartnerFunnelPage／TeamClick/Lead/ConversionAttribution）已具備。【程式碼】但入口缺失（見 F-05）。
4. **無障礙基線**：axe（WCAG 2.0/2.1/2.2 A·AA 標籤）掃 13 個代表頁 × 桌機／行動，**0 違規**；只有 Funnel 工作區（operations 與 editor 兩頁）命中 color-contrast／target-size（F-14）。【實測】
5. **誠實的 UI 文案**：LINE 圖文選單明寫「同步至 LINE 的功能尚未開放」（`src/components/line-rich-menu-studio.tsx:29`），沒有假裝完成。【程式碼】

### 1.3 最影響採用或付費的問題

| 排名 | 問題 | 編號 |
|---|---|---|
| 1 | 「已發布」的 Funnel 在專案未發布前對外是 404，且專案發布閘門混入「商家付平台費用的付款方式」 | F-01、F-02 |
| 2 | 對外政策頁是內部治理草稿；條款／隱私／退款全為草稿，且掛在每一頁頁尾 | F-10 |
| 3 | 提醒與信件管線在 repo 內無排程；Email 二次確認讓可用名單與到場率不確定 | F-15、F-09 |
| 4 | 夥伴頁（差異化核心）與 LINE 設定無入口；導覽有死連結 | F-05、F-06 |
| 5 | 開發基礎線漂移：master 的 `db:seed` 在 master schema 失敗、本機 DB 落後、179 個測試失敗大宗因 schema 落後 | F-20 |

### 1.4 最優先的 5 個決策

1. **決定「發布」只有一個語意**：把專案發布、Funnel 發布、付款方式就緒收斂成一條有逐項檢查表、可一鍵前往修復的就緒流程；公開 404 前必須在商家端看得到原因（F-01、F-03、F-04、F-07）。
2. **決定資金流與「付款方式」的定位**：平台是否代收再結算給商家（`Settlement` 結構顯示 gross→payoutable→final payout）？「商家付款方式」是付平台費用還是收款？並向 PayUni 取得 Token／IP 核准路徑（F-02；假設 A2、A4）。
3. **在任何對外測試前補齊正式政策與信任面**：把內部治理語言移出公開頁（F-10）；這是上線前必要項，也需要非工程輸入（法遵文字）。
4. **把範圍收斂到銷講主幹**：排程／提醒／LINE 事件／電子發票先補完，暫緩勞報單、課程社群、平台推薦等擴張（第 9 節）。
5. **先修好「新人 30 分鐘能跑起 master」**：seed、DB 漂移、測試分層（F-20），否則後續任何 UX 改善都無法被穩定驗證。

---

## 2. 證據與覆蓋範圍

### 2.1 基底與環境

| 項目 | 內容 |
|---|---|
| 基底確認 | `git ls-remote`：`origin/master`=`efb8b7e9`；使用者目前分支與 master 的 merge-base 為 2026-07-19（#117），master 多 263 commit、該分支多 553 commit；兩者 tree diff 1,888 檔（+60k／−155k 行）；master 多 7 個頁面、16 支 API、20 個 migration【實測】 |
| 未合併分支 | `codex/notifications-main-20261011`（PR #420，四渠道通知）、`codex/server-tracking-webhooks-20261007`（PR #384，Meta 追蹤）— **不在 master，未審**【實測】 |
| 使用者工作樹 | 未動。結束時 HEAD=`60132971`、branch 不變、變更數 275（原 274＋本次新增的 `docs/reviews/`）【實測】 |
| 快照 | `git archive efb8b7e9` → 暫存目錄；`npm ci`（730 packages，exit 0）；Next 16.3.8 |
| Next.js 文件 | 專案規則要求查本機 Next 文件；本審視未修改任何 Next 行為，只讀取與實測 |
| 副作用（需知悉） | ① 快照內執行 `next dev` 會改寫快照的 `AGENTS.md`（預期行為，未碰你的 repo）。② 本機可拋棄 PostgreSQL（Docker，port 54329）內我**新建並已刪除**一個一次性 DB `celebratedeal_dev_audit_master_20261011`，並對它做過一次直接 SQL（把合成專案標為 published，僅為驗證 F-01 因果）；你的 `celebratedeal_dev`／`celebratedeal_e2e`／`celebratedeal_test` 結構與資料**未被我修改**。③ `vitest` 的 DB 類測試會連到 `vitest.config.ts` 內建的 `celebratedeal_test`（loopback 54329）並可能寫入合成測試資料（schema 落後下多數在寫入前即失敗），我未檢查清理是否完整；更正基底前，我也曾在你的工作樹（one-stop 分支）內跑過一次完整 `vitest`，它使用該專案自己的本機環境設定（我未讀取其內容）。④ 我曾以唯讀查詢列出本機 Postgres 的資料庫名稱與 `_prisma_migrations` 筆數，用來判斷該用哪個 DB。 |

### 2.2 已檢查範圍

| 面向 | 範圍 | 方式 |
|---|---|---|
| 商家端 `(app)` | dashboard、onboarding/welcome、projects、landing-pages（含 operations）、forms、lives（new/presenter/chat）、videos、products（含 lessons/community）、orders、customers、consultations、messages、interaction-*、affiliates（含 access/remuneration/policy/payout-policy）、team-templates、partner-pages、team-performance、billing/*、settings/* | 程式盤點（Explore ×2＋本人抽查）；約 46 個頁面實測截圖（桌機＋行動） |
| 公開／參與者 | `/live/[slug]`、`lp/**`、`form/**`、`p/**`、`checkout/**`、`portal/**`、`support/**`、`affiliate-portal/**`、`r/[code]`、login/register/policies/verify-registration | 程式盤點；其中 login、register、policies、support、portal、verify-registration、password-reset、merchant-onboarding、已發布 Funnel 頁實測 |
| API／整合 | 101 支 route；PayUni、LINE（Push/Login/Rich Menu 草稿/Webhook）、Resend、Cloudflare Stream/R2、Sentry/PostHog、電子發票、SMS | 程式盤點＋抽查 |
| 授權／租戶 | `lib/auth.ts`、`api-security.ts`、`rate-limit.ts`、`csrf.ts`、租戶範圍查詢 | 程式 |
| 資料 | 141 個 model、96 個 migration | 在全新 DB 套用 migration：**96/96 成功**【實測】 |

### 2.3 已執行的測試與指令

| 指令 | 結果 |
|---|---|
| `tsc --noEmit --incremental false`（master 快照） | **PASS**，exit 0【實測】 |
| `prisma generate`、`prisma migrate deploy`（全新 DB，96 個 migration） | **PASS**【實測】 |
| `prisma db seed`（master） | **FAIL**：`prisma/seed.ts:316` `live.create` → `Unknown argument vendorId`；之前的 Vendor／User／Product／Form 已建立【實測】（F-20） |
| `vitest run`（master 快照，無 `.env`） | **24 檔失敗／675 通過／3 略過；179 測試失敗／5,257 通過／15 略過**。失敗分類：①DB schema 落後（`table … does not exist`、`column heldAmountCents does not exist` 等 64 筆明確訊息）；②`scripts/repository-hygiene.test.ts` 需要 `.git`（快照無）；③未逐項歸因的其餘。**不能據此宣稱這些測試在正確環境會通過或失敗。**【實測】 |
| `vitest`（使用者工作樹 `one-stop` 分支，僅作對照） | 4 檔 150 測試通過；完整：11 檔失敗／78 測試失敗／4,460 通過，原因含 `RegistrationForm.pageBlocks does not exist`（本機 dev DB 落後）【實測；非 master】 |
| axe-core（WCAG A/AA，桌機＋行動）13 頁 | 0 違規；Funnel operations：color-contrast serious ×8 nodes；Funnel editor：target-size ×1（桌機）、color-contrast ×1（行動）【實測】 |
| 未執行 | `eslint`、`npm run e2e*`（需 build＋隔離 DB＋憑證）、`npm audit`、`secret:scan`、覆蓋率、備份腳本測試 —**未驗證，不得視為通過** |

### 2.4 未驗證範圍（誠實清單）

- 直播觀看頁、結帳／付款、學員中心、聯盟入口、LINE、Email 實際寄送：seed 在建立 Live 前失敗、且無外部服務憑證，**僅有程式靜態證據**。
- 以全新帳號的「新商家」狀態實測；沒有大量資料下的列表／分頁／效能。
- 競品功能為官方頁摘要（`WebFetch` 小模型摘要），未實際註冊試用。
- 子代理使用：共 4 次 Explore（2 次在被更正前的錯誤基底、2 次在 master），超過原提示的「最多 3 次」；原因是基底於中途被使用者更正後整輪重跑。

---

## 3. 同等級競品比較

### 3.1 選擇理由

本產品的實際核心工作是「**用一場說明會／銷講把報名者變成買家，並讓多位夥伴複製與歸因**」，目標市場為台灣小型講師／教練／代理團隊（價格帶 NT$ 千元～萬元級）。據此選：

| 類型 | 對象 | 為何可比 |
|---|---|---|
| 直接 | Systeme.io | 漏斗＋自動化 Webinar＋聯盟（affiliate）同一套；repo 內亦以其為參考（`docs/product/systeme-reference`） |
| 直接 | WebinarJam / EverWebinar | 專營直播＋自動化 Webinar 的銷講工具，含 offer、A/B、重播 |
| 直接 | Demio | 專營 Webinar（含 automated）、報名來源追蹤 |
| 替代（在地） | Accupass Online | 台灣最常見的活動報名＋售票＋直播組合，免費上架、低金流費 |
| 替代（現況） | Zoom Webinars（＋LINE 官方帳號＋表單） | repo 行銷文件稱目標客群現況是 Zoom／LINE／Google 表單／YouTube（【文件宣稱】） |
| 鄰近（未納入表格） | SHOPLINE 直播導購（留言收單） | 屬電商導購戰場，repo 文件亦主張首波不與之正面競爭；官方價格未查到 |

### 3.2 比較表（外部事實皆為 2026-10-11 查閱）

| 項目 | CelebrateDeal（master，方案取自 dev DB 資料） | Systeme.io | WebinarJam／EverWebinar | Demio | Zoom Webinars | Accupass Online |
|---|---|---|---|---|---|---|
| 價格（月，適用方案） | Starter $2,480／Growth $5,980／Team‑Pro $12,800（幣別符號為 `$`，推測 TWD；另有平台金流月費 $499/$999/$0、交易服務費 1.2%/1%/0.8%）【實測：`/billing/plans`，為 seed／migration 資料，非公告價】 | Free $0／Startup $17／**Webinar $47**（含 evergreen）／Unlimited $97；0% 交易費；全方案含 affiliate | Starter $49($39 年繳)／Basic $99($79)／Pro $299($229)／Enterprise $499($379)；全方案含 automated；Basic 以上含 EverWebinar | Starter $63 月繳／$45 年繳（50 人）；Premium $196/月/host；Growth 未顯示；automated 在 Growth+Premium | 頁面抽取未得金額（500 人上限方案；第三方稱 $79 起，**未驗證**） | 上架免費；付費票另收金流費（官方部落格摘要：5%＋NT$10／張，需再核實） |
| 來源 | 本機實測 | https://systeme.io/pricing | https://home.webinarjam.com/pricing | https://demio.com/pricing | https://www.zoom.com/en/products/webinars/ | https://campaign.accupass.com/advanced-services/accupass-online.html、https://blog.accupass.com/why-using-accupass.html |
| 報名頁／漏斗 | Funnel 編輯器（Puck）＋模板，目標含 Webinar | 有（漏斗為核心） | 有報名頁 | 有（欄位／來源追蹤在 Growth+） | 品牌化報名頁 | 活動頁＋報名 |
| 自動化（evergreen）Webinar | 有（`/lp/[slug]/[stepPath]/play` 時間閘門導向既有 Live；`evergreen-webinar`） | 有（Webinar 方案） | 有（EverWebinar） | 有（Growth+） | Simulive | 未提及 |
| 直播 | Cloudflare Stream／自架 WHIP／Presenter Studio | 頁面未提串流 | 有（核心） | 有 | 有 | Accupass Live 1080p，也可嵌入 YouTube/Zoom |
| 成交／付款 | 內建結帳（PayUni 為唯一真實 provider）、加購、閃購、購後 upsell | Stripe／PayPal | 優惠（offer）展示與整合 | 未提 offer；整合 | 未明確 | 售票金流；直播中引導購票 |
| 夥伴／聯盟 | 有（聯盟＋團隊模板＋夥伴頁＋歸因＋佣金帳本） | 全方案有 affiliate | 無（需整合） | 無 | 無 | 無 |
| 提醒 | Email（佇列）＋LINE Push；**repo 內無排程** | Email 自動化 | Email＋SMS | Email | Email | 未提及 |
| 在地化 | 繁中、TWD、PayUni、LINE Login、電子發票（**無 adapter**） | 無 | 無 | 無 | 繁中介面 | 在地金流、代開發票（每筆 NT$15） |

### 3.3 已證實的優勢／劣勢／待驗證差異

- **優勢（有證據）**：①同一產品內有「Webinar＋成交＋夥伴歸因＋佣金帳本」，競品要靠多工具拼裝；②與 PayUni／LINE Login 的在地整合方向正確；③Systeme.io 的 Webinar 方案是 $47 並含全方案 affiliate，說明「漏斗＋聯盟」不是獨家，**獨家性要靠團隊受控模板／夥伴頁／帳本的深度**，而這一塊目前入口缺失（F-05）。
- **劣勢（有證據）**：①定價單位複雜（播放小時／場次／推廣者數／儲存分鐘／平台金流月費／交易費 6 個維度）vs 競品多以「人數上限」單一維度；②上線所需的外部核准與排程未就緒；③模板內容與銷講定位不符（F-12）。
- **尚待驗證**：目標客群是否真的需要「自建直播」（Presenter Studio、自架 WHIP）還是以 YouTube／Zoom 直播＋本產品做報名與成交就夠（假設 A6）；方案維度是否易懂（A7）；Accupass 免費上架＋低金流費是否讓「報名＋售票」在價格上難以匹敵。

---

## 4. 全功能取捨表

建議只用一個：保留並強化／保留／簡化／合併／延後／移除／需要使用者研究。

| # | 功能 | 角色與情境 | 實作狀態 | 使用價值 | 競品差異 | 複雜度與依賴 | 必要性 | 建議 | 證據 | 信心 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 報名＋Funnel 編輯器（名單頁／感謝頁／銷售頁／Webinar） | 主辦者：建立可公開的報名與成交頁 | COMPLETE，**但發布鏈斷裂、術語英文化** | 極高（主幹） | 與 Systeme.io 同級；模板為公益主題 | 高（Puck、版本、A/B、自動化） | 必要 | **保留並強化**（先修發布與語言） | F-01/03/11/12；`landing-page-service.ts` | 高 |
| 2 | 自動化 Webinar（報名→感謝→播放→重播） | 主辦者／報名者 | COMPLETE（程式）；UI 未實測 | 極高 | 對標 EverWebinar／Systeme Webinar 方案 | 中高（時間閘門＋Live 授權） | 必要 | **保留並強化** | `lp/.../play/route.ts`；docs/product/funnel-operations.md | 中 |
| 3 | 直播（Cloudflare Stream、自架 WHIP、Presenter Studio、8 步建立） | 主辦者：開播、控場 | COMPLETE（程式）；依外部媒體服務 | 高，但「自建直播」是否必要未知 | WebinarJam/Demio 以直播為核心 | **很高**（`live-stepper-form.tsx` 1,233 行；`live-playback.tsx` 1,838 行；用量／配額／對帳） | 必要（能播）；自建推流不一定 | **需要使用者研究**（外接 YouTube/Zoom 作為預設路徑？） | 盤點；F-21 | 中 |
| 4 | 互動腳本／角色（官方留言、抽獎、紅包、閃購） | 主辦者：預排互動 | COMPLETE | 中（提升臨場感）／**信任與法遵風險** | 競品偏真人互動；本產品以腳本為特色 | 高（748+705 行表單、雙路徑） | 差異化但敏感 | **簡化**：保留揭露；移除「一般觀眾外觀」或加強標示；抽獎／紅包先延後 | `live-playback.tsx:1048`；`interaction-roles-workbench.tsx:114`；PRODUCT.md anti-references | 中 |
| 5 | 報名表單 Builder（獨立 `/forms`） | 主辦者 | COMPLETE | 高 | 競品內嵌於頁面 | 中；與 Funnel 內表單重複（3 套實作） | 必要 | **合併**進 Funnel 工作區（單一表單概念）、保留名單 workbench | F-08/F-21 | 中 |
| 6 | 商品＋結帳（PayUni、加購、購後 upsell、閃購） | 買家：付款；主辦者：定價 | COMPLETE；僅 PayUni 為真實 provider | 極高 | 內建結帳優於 Webinar 專營工具 | 高（對帳、庫存預留、冪等） | 必要 | **保留** | `payments/checkout/route.ts`、`webhooks/payments/route.ts` | 高 |
| 7 | 訂單／履約／退款交接 | 主辦者、客服、平台財務 | COMPLETE；商家**不能**直接退款 | 高 | — | 中 | 必要 | **保留**；退款自助流程列為待決策 | `commerce-order-detail.tsx:203` | 高 |
| 8 | 學員 CRM（標籤、備註、旅程、補券） | 主辦者、顧問 | COMPLETE | 中 | 輕量 | 中 | 基本期待（名單後續追蹤） | **保留（最小）**；延後進階功能 | `customer-crm-workbench.tsx` | 中 |
| 9 | 諮詢預約（時段、手機工作台） | 顧問型商家 | COMPLETE；**預設隱藏且 onboarding 不啟用** | 對高客單諮詢高；對主幹中 | 非 Webinar 專營工具之標配 | 中 | 非主幹 | **延後**（或明確成為第二主流程並修 F-07） | F-07 | 中 |
| 10 | Email 模板／寄送紀錄／重送 | 主辦者 | COMPLETE；**無排程** | 高 | 基本期待 | 中（佇列＋Resend） | 必要 | **保留並補排程** | F-15 | 高 |
| 11 | LINE（登入、Push、Rich Menu 草稿、模板渠道） | 報名者／主辦者 | **PARTIAL**：Push／Login 真實；Rich Menu 僅草稿；webhook 不處理事件；模板 LINE 渠道 disabled；設定頁無入口 | 台灣極高 | 在地關鍵差異 | 中高 | 在地必要 | **保留並補完**（入口＋提醒閉環） | F-05/F-23 | 高 |
| 12 | 推廣夥伴／佣金／分潤政策／出款政策 | 主辦者、推廣者、財務 | COMPLETE；4 個政策頁 | 高（若 ICP 是團隊） | Systeme.io 全方案有 affiliate；本產品帳本較深 | 高（ledger、月結、稅務） | 主幹延伸 | **保留核心（歸因＋佣金帳本）、簡化政策頁**（4 頁→1 頁分段） | `affiliates/*`；盤點 | 中 |
| 13 | 勞報單／稅務匯出／remuneration 匯出 | 財務 | COMPLETE（唯讀／匯出，明示不付款） | 中（台灣法遵價值）／現階段使用機率低 | 無競品 | 高 | 非主幹 | **延後**（等首批客戶真的出款） | `billing/payouts`、`affiliates/[id]/remuneration` | 中 |
| 14 | 團隊模板／夥伴頁／團隊成效 | 內容主理人、夥伴 | COMPLETE；**夥伴頁無導覽入口** | 極高（差異化） | 無對手同級 | 高 | 差異化核心 | **保留並強化**（先補入口與一頁式引導） | F-05 | 高 |
| 15 | 課程（lessons）、社群（community）、學員中心（portal） | 學員、主辦者 | PARTIAL（lessons 無刪除／重排、只能貼外部 HTTPS 影片；community 商家不能回覆） | 低～中；偏離銷講主幹 | 與課程平台競爭 | 高（新增 8+ 頁、4+ migration） | 非必要 | **延後／停止擴張** | 盤點 | 中 |
| 16 | 平台財務後台（settlement／payout／stream 對帳／webhook 對帳） | 平台營運 | COMPLETE（內部） | 內部必要 | — | 高 | 平台必要 | **保留**，不對商家曝光 | `admin/billing/*` | 高 |
| 17 | 銷售專案（SalesProject）概念 | 主辦者 | PARTIAL（無編輯／封存）；發布閘門複雜 | 中（組織單位） | 競品多為「活動」單一概念 | 中（影響所有頁面範圍） | 需釐清 | **簡化／合併**：專案＝活動，單一發布 | F-01/F-04 | 中 |
| 18 | 自動化規則（`/settings/automations` 與 Funnel「Automation Rules」） | 主辦者 | COMPLETE；兩處入口 | 中 | 基本期待（提醒、標籤） | 中 | 部分必要 | **合併**為單一入口（Funnel 內為主） | 盤點 | 中 |
| 19 | 功能模組開關（`/settings/features`） | 主辦者 | COMPLETE | 低（認知成本高） | — | 低，但造成預設隱藏與 404 | 非必要 | **合併／移除**（以專案模式取代） | F-06/F-07 | 中 |
| 20 | Dashboard／進階分析 | 主辦者 | COMPLETE；新商家 10 個 0 值 KPI | 中 | 基本期待 | 中 | 必要（最小） | **簡化**（新商家只顯示下一步與 3 個關鍵指標） | F-13 | 中 |
| 21 | 電子發票 | 主辦者、買家 | **STUB**（無 adapter，永遠 queued） | 台灣 B2C 高 | 在地關鍵 | 中（需選供應商） | 視客群（B2C 販售必要） | **補完或對外隱藏**（不可顯示假能力） | F-16 | 高 |
| 22 | 追蹤（GTM／Pixel）／Meta CAPI | 行銷 | Pixel／GTM 完成；CAPI 不在 master | 中 | 廣告主期待 | 低～中 | 非必要 | **保留 Pixel；CAPI 延後**（PR #384 待驗收） | 盤點 | 中 |
| 23 | 平台推薦（PlatformReferral）／平台方案計費 | 平台 | COMPLETE | 商業模式用 | — | 高 | 平台自身 | **延後對外曝光** | 盤點 | 低 |
| 24 | 封鎖名單 | 主辦者 | COMPLETE | 低 | — | 低 | 小 | **保留** | `blacklist-search-list.tsx` | 高 |
| 25 | MFA／安全設定／稽核 | 全部 | COMPLETE；強制範圍有缺口 | 高 | — | 中 | 必要 | **保留並補強** | F-17 | 中 |

---

## 5. 使用流程審視

### 5.1 主辦者：從註冊到第一筆成交（實測＋程式）

目前流程：
`/login`（首頁就是登入）→ `/register` → `/welcome` 4 題問卷 → `/welcome/preparing` → `/dashboard`（10 個 0 值 KPI）→ 側欄「上線任務」→ `/projects/new`（名稱、**網址代稱**、推薦工作模式、優先建立的流程、建立方式 5 項決策）→ 被導向 `/onboarding`（直播流程的 5 步）→ `/landing-pages/new`（先選 4 種目標、模板）→ 編輯 → **按「發布」→ 訊息「版本 v1 已發布。」**→ 公開網址 **404** → 回到 `/projects/[id]` → 「檢查並發布」→ 紅字「發布前請完成有效價格商品、漏斗頁、付款方式，以及目前專案的直播或可預約諮詢流程」。

| 卡點 | 證據 | 影響 |
|---|---|---|
| 「已發布」≠ 公開可見 | F-01 | 商家第一次對外分享連結就失敗，且不知原因 |
| 專案發布需要「商店付款方式」，但該頁說明是「平台方案與 Stream 用量需要的付款方式驗證」 | F-02 | 商家以為要串接收款；本機 demo provider 下根本無法完成 |
| 發布的名單頁沒有綁定報名表 | F-03 | 公開頁顯示內部提示「此 Funnel 尚未綁定可公開使用的報名表，表單已停用」 |
| 無專案時 `/landing-pages/new` 只有一句話、沒有連結 | F-04 | 死路 |
| 「快速建立（直接進入編輯器）」在第一個專案被強制改成導引（`sales-workspace-actions.ts:84`），且「編輯器」其實是只有計數與發布鈕的專案頁 | F-04 | 選項說謊 |
| 夥伴頁無入口 | F-05 | 差異化功能找不到 |

**建議流程**：註冊後**只問一次**意圖 → 直接建立「第一場活動」（專案＝活動＝一次發布）→ 單一就緒清單（商品／報名頁／直播或預約／收款）每項可點擊前往 → 按發布時一次檢查全部並顯示公開網址與「複製連結」→ 若未就緒，**不允許顯示「已發布」**。
**預期改善**：把「第一次對外連結可用」所需決策從 5+ 個降到 1 個；消除 404。**驗證**：以 5 位新商家做 think‑aloud，記錄首次公開連結可用時間；以 e2e 驗收「Funnel 發布成功 ⇒ 公開頁 200 且含表單」。

### 5.2 報名者／參與者

目前流程：進入 `/lp/[slug]` → 理解價值 → 填表（姓名／Email…）→ `303` 到感謝頁（`?submitted=verification_required`）→ **到信箱點確認連結** → `/verify-registration`（品牌為「CelebrateDeal」）→（確認後）可綁 LINE → 收提醒 → `/lp/.../play` 時間閘門 → `/live/[slug]` 觀看／聊天 → 購買。

| 卡點 | 證據 | 影響 |
|---|---|---|
| 表單送出失敗（400/403/404/429/503）原生 POST 直接顯示 JSON | F-08 | 報名者看到 `{"error":"Verification email unavailable"}`，且資料可能已寫入而重複送出 |
| 未點確認連結者：不收提醒、不能聊天、不被歸因到場次 | F-09 | 可用名單與到場率不確定；商家看不到「為什麼沒人到場」 |
| 確認頁品牌為「CelebrateDeal」 | F-09 | 商家品牌斷裂、信任下降（待驗證） |
| 提醒依賴外部排程 | F-15 | 沒有排程＝沒有提醒 |

**建議流程**：報名成功頁即顯示「加入 LINE 提醒」或「加入行事曆」（不依賴 Email 確認即可收一次提醒），Email 確認改為「選擇性強化」；錯誤頁一律導回表單並保留已填值。**驗證**：用內建 A/B 比較「需確認 vs 不需確認」的 到場率與名單品質（假設 A3）。

### 5.3 推廣夥伴／團隊

目前流程：主理人建立團隊模板 → 夥伴到 `/team-template` 認領 → redirect `/partner-pages/{id}/edit` → 編輯／發布 → `/p/[slug]`；之後想回到「我的夥伴頁」**沒有導覽入口**（F-05）。**建議**：側欄「夥伴成長」加入「我的夥伴頁」；夥伴角色登入後預設落地頁即為此頁。

---

## 6. UI／UX 審視

### 6.1 全站共通

| 問題 | 具體位置 | 改法與理由 | 編號 |
|---|---|---|---|
| 英文與工程識別字外露 | Funnel 工作區：`Funnels › …`、`Configuration`／`Automation Rules`／`A/B test`／`Stats`／`Leads`／`Sales`／`Deadline settings`、`Add step`、`Funnel settings`、步驟型別 `opt_in_page`、`opt_in_thank_you_page`、副標「audience · revision 1」、「模板已依 audience 與 opt_in_page 過濾」；Dashboard 標題為 `Dashboard`、副標「Cloudflare-first …」、KPI「session／admission／CTA」 | 全面改為使用者語言（名單頁、感謝頁、自動化規則…）；內部識別字不顯示。違反 `PRODUCT.md`「避免工程欄位與模糊狀態」「台灣常見用語」 | F-11 |
| 導覽名稱與頁面標題不一致 | 「一頁式網站」→ 頁名 `Funnels`；「互動腳本」→「留言組」；「團隊模板」→「團隊展業」；「推廣夥伴」→「聯盟夥伴」；「報名管理」→「報名表管理」；「訂單管理」→「訂單與履約」；「媒體素材」→「影片庫」；「直播間」→「直播間管理」 | 每個概念一個名稱，導覽與頁名完全一致 | F-11 |
| 側欄／行動版 chrome 擠壓主內容 | 桌機 1440×900：工作區卡＋上線任務卡佔滿左欄首屏，導覽只露 2 組；行動 390×844：工作區卡＋任務卡＋nav chips 佔約 560px，頁面主表單在摺線下；行動版 nav 平鋪 41 個 chips | 任務卡預設收合；行動版導覽改抽屜／底部 4 項 | F-13 |
| 對外頁尾暴露治理語言 | 每個頁面頁尾（含商家端與登入）：「使用條款（草稿）／隱私通知（草稿）／退款政策（草稿）」 | 見 F-10 | F-10 |
| 死連結／孤兒頁 | 見 F-05、F-06 | 修正 | — |
| 開發用浮層 | 右下「最新消息」按鈕與左下 Next 開發指示（後者僅 dev） | 確認「最新消息」不遮擋主要操作（行動版覆蓋表單底部） | F-13 |
| 幣別符號 | `/billing/plans` 顯示 `$2,480`（無 TWD／NT） | 明示 NT$／TWD | F-14 |

### 6.2 頁型別

| 頁型 | 發現 | 修正方向 | 畫面證據 |
|---|---|---|---|
| 登入（`/login`＝首頁） | 首頁即登入頁；「返回首頁」會導回同頁（`/` → `/login?from=home`）；dev 下預填 demo 帳密；沒有任何產品說明或價值主張 | 提供最小價值主張與「看範例」；「返回首頁」改指向行銷站或移除 | `F-10_login-footer-draft-links-desktop.png` |
| 政策中心 | 見 F-10 | 正式化 | `F-10_policies-internal-draft-*.png` |
| Dashboard（新商家） | 10 個全 0 KPI，每張卡標題與下方 chip 文字重複（如「近 7 天報名」×2）；「已驗證報名／觀看 0%」語意難懂；底下又有轉換漏斗、近期直播、checklist（再次英文「Onboarding checklist」） | 新商家只顯示「下一步」與 3 個指標（報名、到場、成交）；其餘有資料才出現 | `F-13_dashboard-new-merchant-*.png` |
| 專案建立 | 5 項決策（名稱、**網址代稱（必填需自創）**、推薦工作模式、優先建立的流程、建立方式），與 `/welcome` 4 題重複 | 代稱自動產生；模式與流程合併；只在第一次問 | `F-04_projects-new-decisions-desktop.png` |
| Funnel 工作區 | 見 F-11、F-12；分頁文字灰淡（axe color-contrast ×8） | 對比 ≥4.5:1 | `F-11_*.png` |
| 直播建立（8 步） | 以步驟列＋即時手機預覽組織，方向正確；但預設「從空白開始」＋8 步一次呈現，任務清單（已完成／待完成）混合；預覽內「AI 主持人 官方」角色預設出現 | 預設用「商品銷售直播」開始器；將預覽中的 AI 主持人標示為「腳本互動」 | `app-lives-new-desktop.png` |
| 帳務／付款方式 | 見 F-02；說明文字多為技術語（provider opaque reference） | 用任務語言：「用來繳 CelebrateDeal 月費的卡」 | `F-02_payment-methods-page-desktop.png` |
| 方案 | 6 維度計價（見 3.3） | 以「每月活動數＋推廣者數」兩軸呈現，用量為進階說明 | `F-14_plans-currency-symbol-desktop.png` |

> 可用性問題（F-01～F-13）與審美偏好嚴格區分：本報告**沒有**提出純審美建議。

---

## 7. 技術與可靠性

等級：BLOCKER／MAJOR／MINOR／NIT。已確認缺陷與待驗證風險分開標示。

| 編號 | 等級 | 類型 | 觸發情境 | 證據 | 後果 | 修正方向 |
|---|---|---|---|---|---|---|
| F-01（技術面） | **BLOCKER** | 已確認缺陷 | 專案未發布而 Funnel 發布 | `src/lib/landing-page-service.ts:249,627`（公開查詢要求 `salesProject.status="published"`）；`src/app/actions/landing-page-actions.ts:137-141`（回「版本 vN 已發布。」）；實測 404 與手動標記專案後出現頁面 | 對外 404、商家誤以為成功 | 發布前檢查專案狀態；或 Funnel 發布即視為專案發布；公開 404 改為商家可見診斷 |
| F-15 | **MAJOR** | 已確認缺陷（外部排程未知） | 部署後沒有外部排程 | `vercel.json` 只有 framework 與 `git.deploymentEnabled.master=false`；`vercel.staging.json` `"crons": []`；`.github/workflows` 無 `schedule`；`docs/launch/staging-cron-operations.md` 標 PENDING_EXTERNAL | Email 確認信／提醒、LINE、webhook 重試、帳單週期、庫存釋放不會自動跑 | 在 Vercel Cron／外部 scheduler 註冊並加心跳監控；上線前驗證一次端到端提醒 |
| F-16 | **MAJOR** | 已確認缺陷 | 任何需要電子發票的訂單 | `src/app/api/jobs/electronic-invoices/route.ts:8-14`（無 adapter→202，註解「No production provider is silently selected」） | 發票永遠 `queued`；台灣 B2C 法遵缺口；UI 有 `/billing/electronic-invoices` 頁 | 選定供應商並實作 adapter，或對外隱藏／標明「尚未開放」 |
| F-08 | **MAJOR** | 已確認（程式）；待實測 UI | 原生表單 POST 失敗 | `src/app/api/form-submissions/route.ts:389-586`（錯誤一律 JSON；僅成功路徑 303，:607-609）；`funnel-webinar-experience.tsx:43-52` 使用 `method="post"` | 報名者看到 raw JSON；503（驗證信排程失敗）時名單已寫入 | 原生 POST 錯誤改 303 回原頁＋錯誤代碼；顯示可修正訊息 |
| F-17 | **MAJOR** | 待驗證風險 | platform_admin 未註冊 MFA | `src/lib/auth.ts:237-246`（僅 `if (auth.user.mfaFactor && !isMfaVerified)` 才要求驗證）；`:320-336` `requireFinanceAdmin` 僅 `requireAuth`＋`isPlatformAdmin`；登入後僅在已有 factor 時導向 `/mfa/verify`（`auth-security-actions.ts:131`） | 平台財務／退款／月結頁可能被未啟用 MFA 的管理員帳號直接進入 | 平台管理員強制註冊 MFA 才能進 `/admin/*`；加 e2e 驗收 |
| F-18 | **MAJOR（條件式）** | 待驗證風險 | 非 Cloudflare 前置或可繞過 | `src/lib/rate-limit.ts:26-32`（直接信任 `cf-connecting-ip`／`x-forwarded-for` 首段）；`cloudflare_waf` 模式應用層直接放行；僅 live-chat 走 ingress 證明（`request-client-ip.ts`）；`env.ts:330-335` 在 production 對 memory 判 fail | 可輪換標頭繞過登入／結帳／表單限流；memory 在 serverless 形同無效 | 全站改用已有的信任鏈解析；部署拓撲文件化；Upstash 或 WAF 實證 |
| F-19 | MINOR | 已確認 | 郵件掃描器預取連結 | `src/app/portal/[vendorSlug]/access/route.ts:9-31`（magic link 以 GET 消耗且無限流）；`/api/automation/vouchers/redeem` 以 GET 兌換；`/r/[code]`、`live-admission` DELETE 無限流 | 學員／買家第一次點連結顯示「無效或已過期」 | 兩段式（GET 顯示確認頁→POST 消耗）；補限流 |
| F-20 | **MAJOR** | 已確認 | 新人依 README 流程 | 實測：`prisma db seed` 於 `prisma/seed.ts:316` 失敗；本機 `celebratedeal_test` 停在 80 個 migration（缺 `heldAmountCents`、`MerchantAffiliatePolicyState` 等）；vitest 179 失敗；`payment-webhooks.test.ts` 等需要 DB 但未用 `.db.test.ts` 命名 | demo 帳號流程斷、DB 測試無法判讀、CI 以外無人知道 master 是否健康 | 修 seed；啟動前自檢 migration 落後並提示；統一 DB 測試命名與 `vitest` 專案分層 |
| F-21 | MINOR | 已確認 | 維護 | `src/app/actions.ts` 2,498 行（商家、安全、影片、聯盟、平台財務混合）；`live-playback.tsx` 1,838；`interaction-scripts` 同時有 server action（`interaction-actions.ts:703`、`actions.ts:1450`）與新 API route；報名表 3 套實作 | 變更風險高、行為不一致 | 依領域拆分；保留單一路徑；抽共用報名表單元件 |
| F-22 | MINOR | 已確認 | 專案治理 | `git ls-files docs`=1,875、`branch-integration-*` 157 檔、scripts 327；`.ai-team` 磁碟 6.2GB（tracked 90 檔）；master 沒有 `docs/marketing/*` 與 `docs/product/webinar-funnel.md`（只在一頁分支） | 產品決策文件落在非 master 分支；工程治理文件量遠大於產品文件 | 定義 `docs/product/` 為單一事實來源並歸檔 branch-integration 證據 |
| F-23 | MINOR | 已確認 | LINE 使用者 | Rich Menu 僅 DB 草稿、全 src 無 richmenu API 呼叫；`api/webhooks/line/[vendorId]/route.ts:22-35` 驗簽後不處理事件；`message-template-form-client.tsx:72-73` LINE／SMS disabled；Meta CAPI 不在 master | 在地最重要的渠道只做一半 | 先補「報名後 LINE 提醒」閉環，再做 Rich Menu 同步 |
| F-24 | MINOR | 推論 | 每次進入商家端頁面 | `src/app/(app)/layout.tsx:16-49`：≥4 個串行 DB 往返（subscription→projects/preference→states→counts） | 跨區部署延遲放大（docs 記載 staging Dashboard 曾逾時） | 合併查詢或快取 onboarding 指標 |
| F-25 | NIT | 已確認 | — | README 寫 Next 16.2.11，實際 16.3.8；`media/videos/status/route.ts:23` 角色清單含不存在的 `manager`；`funnel-goal-picker.tsx` 有已不會觸發的「開發中」死碼（一頁分支） | 認知噪音 | 順手清理 |

**已確認的優點（不需處理）**：同源／CSRF／限流／簽章一致；admin/ops 路由皆有 `JOB_SECRET`（另加 preview＋sandbox＋SHA 比對）；Session token 只存 SHA-256；webhook 事件冪等與重試；全新 DB 套用 96 個 migration 成功。【程式碼】【實測】

---

## 8. 整合改善順序

工作量：S／M／L（相對）。不提供精確工期與投報率。

### 8.1 上線前必要

| 項目 | 影響 | 工作量 | 依賴 | 信心 | 驗收條件 |
|---|---|---|---|---|---|
| A. 單一發布語意與就緒清單（F-01、F-03、F-04、F-07） | 解除「已發布卻 404」與死路 | M | 決策 1 | 高 | e2e：Funnel 發布成功 ⇒ 公開頁 200 且含可送出的表單；未就緒時發布鈕顯示缺項而非成功訊息；`/landing-pages/new` 無專案時有「建立專案」按鈕 |
| B. 付款方式語意拆分（F-02） | 商家不再誤解、可完成發布 | S～M | PayUni Token／IP 核准結果（A4）；決策 2 | 中 | 文案與閘門：「商家扣款方式」不再阻擋公開頁；有核准時 e2e 綁定成功 |
| C. 正式政策與信任面（F-10） | 法遵與信任 | S（程式）＋外部（內容） | 法遵／owner 提供文字 | 高 | 公開頁無 `DRAFT`／內部角色／P0‑P2 字樣；條款／隱私／退款有版本與生效日 |
| D. 排程與信件／提醒管線（F-15） | 提醒與確認信真的送出 | M | 部署設定授權 | 高 | 排程註冊＋心跳；一次端到端：報名→確認信→開播提醒送達（Sandbox） |
| E. 報名失敗處理（F-08） | 不顯示 raw JSON | S | 無 | 高 | 單元＋e2e：400/429/503 皆回原頁並保留欄位 |
| F. 導覽死連結與孤兒頁（F-05、F-06） | 找得到核心功能 | S | 無 | 高 | 導覽 e2e 逐項點擊無 404；夥伴頁與 LINE 設定可由導覽到達 |
| G. 開發基礎線（F-20） | 可驗證性 | S～M | 無 | 高 | 全新 DB：`migrate deploy`＋`db seed` exit 0 並可登入；DB 測試落後時給出明確提示 |

### 8.2 下一階段值得投入

| 項目 | 影響 | 工作量 | 依賴 | 信心 | 驗收條件 |
|---|---|---|---|---|---|
| H. 在地化與術語統一（F-11） | 降低認知成本 | M | 無 | 高 | 商家端無英文標題與 `opt_in_page` 類識別字；導覽與頁名一致（快照測試） |
| I. 銷講／課程模板（F-12） | 與定位一致 | M | 內容 | 中 | 「建立名單」與「Webinar」各至少 3 個銷講主題模板 |
| J. 平台管理員 MFA 強制（F-17） | 資安 | S | 無 | 中 | 未註冊 MFA 的 platform_admin 進 `/admin/*` 被導向註冊 |
| K. IP 信任與限流收斂（F-18、F-19） | 資安 | M | 部署拓撲 | 中 | 偽造標頭測試無法繞過限流；magic link 兩段式 |
| L. 電子發票 adapter 或對外隱藏（F-16） | 法遵 | M～L | 供應商選擇 | 高 | 付款後開立並回寫字軌；或 UI 顯示「尚未開放」 |
| M. LINE 提醒閉環＋Rich Menu 同步（F-23） | 到場率 | M～L | LINE 憑證 | 中 | 報名→LINE 綁定→開播提醒送達（Sandbox） |
| N. 二次確認策略實驗（F-09） | 名單品質／到場 | S | A/B 流量 | 低～中 | A/B 結果與決策紀錄 |
| O. 新商家 Dashboard 與行動版 chrome（F-13、F-14） | 首次體驗 | M | 無 | 中 | 新商家首屏看到下一步；行動版首屏即主要表單；axe 0 serious |
| P. 資料／程式結構整理（F-21、F-24） | 維護成本 | L | 無 | 中 | 巨型檔拆分、單一路徑 |

### 8.3 延後或不建議投入

勞報單／稅務匯出／remuneration 擴充（#13）、課程社群與學員中心擴張（#15）、平台推薦對外功能（#23）、抽獎／紅包互動（#4）、Meta CAPI 在 PR #384 驗收前、再新增任何「政策頁」類模組。

---

## 9. 刪減建議

| 項目 | 建議 | 代價 | 替代方案 |
|---|---|---|---|
| 功能模組開關（`/settings/features`） | **移除**，以專案模式決定導覽 | 失去細粒度隱藏；需資料遷移 | 專案模式＋角色權限 |
| 「專案」與「Funnel」雙層發布 | **合併**為單一發布 | 需調整資料模型語意與 e2e | 專案＝活動，Funnel 為其頁面 |
| 獨立 `/forms` 與 Funnel 內表單 | **合併** | 表單名單舊連結需轉址 | 名單 workbench 保留 |
| `/settings/automations` 與 Funnel「Automation Rules」 | **合併**單一入口 | 兩處教學內容整併 | 只留 Funnel 內 |
| 聯盟 4 個政策頁 | **簡化**為 1 頁分段 | 失去分頁深連結 | 單頁＋錨點 |
| 勞報單／稅務匯出 | **延後** | 首批客戶若要出款需手動 | 以 CSV 匯出代替 UI |
| 課程 lessons／community／portal | **延後／停止擴張** | 無法承接課程型客戶 | 以外部課程平台連結 |
| 互動「一般觀眾外觀」 | **移除或加強標示** | 降低「臨場感」 | 官方外觀＋明確揭露 |
| 公開頁中的內部治理文案 | **移除**（見 F-10） | 無 | 內部文件放內部 |
| `docs/branch-integration-*`（157 檔） | **歸檔**到 `docs/archive/` 或獨立 repo | 追溯需多一步 | 保留索引檔 |

---

## 10. 尚待驗證的關鍵假設

| # | 假設 | 為何影響決策 | 成本最低的驗證方式 |
|---|---|---|---|
| A1 | 目標客群付費的是「報名→提醒→到場→成交」自動化，而非一般直播導購 | 決定主幹與刪減範圍 | 訪談 5 位現用 Zoom／LINE／表單的講師，請其現場操作 Funnel 建立（含錄螢幕） |
| A2 | 平台代收款項再結算（`Settlement`）是預期模式；是否涉及代收轉付／信託等法遵 | 影響架構與上線資格；master docs 對「代收／信託／第三方支付／電子支付機構」搜尋 0 筆 | 一次法遵諮詢（半天）＋閱讀 PayUni 商店條款 |
| A3 | 二次確認顯著降低報名名單與到場率 | 決定是否保留強制確認 | 用內建 A/B 跑一場，比較「確認後名單／提醒送達／到場」 |
| A4 | PayUni Token／IP 核准在可接受時間內可取得 | 決定「商店付款方式」閘門能否成立 | 提交申請並記錄回覆日（文件記載 9/29 為「不確定／尚未申請」） |
| A5 | staging／production 已有外部排程在跑 | 決定 F-15 是缺陷還是文件缺口 | 檢查 Vercel／外部 scheduler 設定，手動呼叫 `jobs/email-deliveries` 一次並觀察 |
| A6 | 目標客群需要「自建直播」而非外接 YouTube／Zoom | 決定直播子系統投資 | 10 場實際活動的直播來源統計（問卷） |
| A7 | 6 維度用量計價可被理解 | 影響轉換 | 價格頁 5 秒測試＋3 位訪談 |

---

## 11. Codex ai-team-pro 交接包

說明：以下 WP 僅描述範圍、風險信號與驗收；**不指定實作模型與推理程度**（交由 `.ai-team/config/routing-policy.json` 的 router 決定）。標「需獨立深度審查」者符合 Critical security／Auth／Permission／Payment／Billing／Production data／Migration。基底為 `origin/master@efb8b7e9`；執行前須在 `codex/*` 新分支上，且不得動使用者目前工作樹的未提交變更。

### 11.1 Work Package 清單

> task signals 欄：C=complexity、R=risk、S=surface、P=production／security／data impact。

| WP | 對應發現 | 目標 | Scope（檔案／目錄） | 不可觸碰 | Task signals | 驗收條件 | 建議驗證 | 依賴 | 額外授權 |
|---|---|---|---|---|---|---|---|---|---|
| **WP-01 發布鏈合一** | F-01、F-03、F-04、F-07 | Funnel 發布與專案發布單一語意；發布鈕顯示缺項；無專案時有可行動路徑；諮詢模式自動啟用模組或不導向被隱藏頁 | `src/lib/sales-workspace.ts`、`src/app/actions/sales-workspace-actions.ts`、`src/app/actions/landing-page-actions.ts`、`src/lib/landing-page-service.ts`、`src/app/(app)/projects/**`、`src/app/(app)/landing-pages/new/**`、`src/components/landing-page-workspace.tsx`、`src/lib/vendor-feature-toggles.ts` | `prisma/schema.prisma` 與 migration（如需 schema 變更須另開 WP）、支付程式、`.env*` | C=高 R=中 S=商家端＋公開頁 P=無 PII 變更 | Funnel 發布成功⇒公開頁 200 且含表單；未就緒時顯示缺項與前往連結；`/landing-pages/new` 無專案時有「建立專案」；諮詢專案導向可用頁 | targeted tests＋E2E（建立專案→發布→公開頁） | 無 | 否 |
| **WP-02 付款方式語意** | F-02 | 把「商家扣款方式」自銷售就緒閘門拆開或改名；文案改任務語言 | `src/app/(app)/billing/payment-methods/**`、`src/lib/sales-workspace.ts`、`src/lib/merchant-onboarding.ts`、onboarding 文案 | `src/lib/payment-providers/**`、webhook | C=中 R=高(Billing) S=商家端 P=billing 閘門 | 閘門與文案一致；有／無核准兩種情境均不誤導；測試涵蓋 | targeted tests＋integration | 決策 2、A4 | **是**（決策） |
| **WP-03 政策頁正式化** | F-10 | 移除內部治理語言、建立版本化政策頁骨架與頁尾 | `src/app/policies/**`、頁尾元件（`src/components/**` 內含「（草稿）」者）、`src/app/support/**` 文案 | 法律內容本身（需 owner 提供） | C=低 R=中(法遵) S=公開頁 P=無 | 公開頁無 `DRAFT`／`HUMAN OWNER`／`P0-P2` 字樣；有版本與生效日欄位 | targeted tests＋E2E a11y | 法遵／owner 文字 | **是**（內容） |
| **WP-04 排程與提醒管線** | F-15 | 註冊排程、心跳與健康檢查；文件化外部 scheduler | `vercel.json`、`vercel.staging.json`（僅 cron 欄位）、`src/app/api/jobs/**`、`src/app/api/cron/**`、`docs/launch/staging-cron-operations.md` | Production 部署、正式信件寄送、帳單週期的實際執行 | C=中 R=高(Billing/Email) S=基礎設施 P=production 設定 | 非 production：排程可被呼叫且有心跳；一次端到端確認信＋提醒（Sandbox／測試收件匣） | integration＋staging 端到端（Sandbox） | 部署設定授權 | **是**（production cron 與 billing-cycle 不得自動啟用）；billing-cycle 部分**需獨立深度審查** |
| **WP-05 報名失敗處理** | F-08、F-21（表單部分） | 原生 POST 失敗回原頁；3 套報名表單收斂 | `src/app/api/form-submissions/route.ts`、`src/components/landing-pages/funnel-webinar-experience.tsx`、`src/components/landing-pages/funnel-page-document-renderer.tsx`、`src/components/lead-form.tsx` | 驗證邏輯與 Email 確認規則本身（見 WP-14） | C=中 R=中 S=公開頁 P=PII 表單 | 400/403/429/503 皆 303 回原頁並保留欄位；aria-live／role=alert 一致 | targeted tests＋E2E＋a11y | 無 | 否 |
| **WP-06 導覽死連結／孤兒頁** | F-05、F-06 | 修 `/settings/commissions`；補「我的夥伴頁」「LINE 整合」入口 | `src/components/app-shell.tsx`、`src/lib/vendor-feature-toggles.ts`、`src/app/(app)/settings/**` | 權限邏輯 | C=低 R=低 S=商家端 P=無 | 導覽逐項點擊無 404；兩頁可由導覽到達；角色過濾測試通過 | targeted tests＋E2E smoke | 無 | 否 |
| **WP-07 開發基礎線** | F-20 | 修 seed；DB 落後自檢；DB 測試命名分層 | `prisma/seed.ts`、`vitest.config.ts`、`scripts/local-database-safety.ts`、含 DB 的 `*.test.ts` | schema 與 migration | C=低～中 R=低 S=開發流程 P=僅本機 DB | 全新 DB：`migrate deploy`＋`db seed` exit 0 並可登入；落後時啟動前提示；`.db.test.ts` 與實際相符 | targeted tests | 無 | 否 |
| **WP-08 術語在地化** | F-11 | Funnel 工作區與 Dashboard 中文化、導覽與頁名一致 | `src/components/landing-pages/**`、`src/components/landing-page-workspace.tsx`、`src/app/(app)/dashboard/**`、`src/components/app-shell.tsx`、`src/app/(app)/**/page.tsx` 標題 | 識別字（資料層）不改 | C=中 R=低 S=商家端 P=無 | 無英文標題／內部識別字；導覽與頁名對照表通過快照測試 | targeted tests＋a11y | WP-06 | 否 |
| **WP-09 銷講模板** | F-12 | 新增銷講／課程主題模板 | `src/lib/funnel-template-gallery.ts`（模板登錄處）、`src/components/landing-pages/**` | 既有公益模板 | C=中 R=低 S=商家端 P=無 | 名單／Webinar 各 ≥3 個銷講模板可套用並可發布 | targeted tests＋E2E | 內容 | 否 |
| **WP-10 管理員 MFA 強制** | F-17 | platform_admin 未註冊 MFA 禁止進 `/admin/*` | `src/lib/auth.ts`、`src/app/admin/**`、`src/app/mfa/**` | session 儲存格式 | C=中 R=高(Auth) S=平台 P=security | 未註冊 MFA 的管理員被導向註冊；已註冊流程不變；e2e 通過 | targeted tests＋E2E | 無 | **需獨立深度審查** |
| **WP-11 IP 信任與限流** | F-18、F-19 | 統一 IP 解析；magic link／voucher 兩段式；補無限流端點 | `src/lib/rate-limit.ts`、`src/lib/request-client-ip.ts`、`src/app/portal/**/access/**`、`src/app/api/automation/vouchers/**`、`src/app/r/**`、`src/app/api/live-admission/**` | 付款相關路由行為 | C=中 R=高(Security) S=公開 API P=security | 偽造標頭無法繞過；兩段式兌換；既有 e2e 通過 | targeted tests＋integration | 部署拓撲（A5） | **需獨立深度審查** |
| **WP-12 電子發票 adapter** | F-16 | 選定供應商並實作 adapter，或對外隱藏 | `src/lib/taiwan-electronic-invoice*.ts`、`src/app/api/jobs/electronic-invoices/**`、`src/app/(app)/billing/electronic-invoices/**` | 付款流程 | C=高 R=高(Billing/稅務) S=帳務 P=billing | Sandbox 開立並回寫；失敗可重試；或 UI 顯示尚未開放 | integration（Sandbox） | 供應商選擇、憑證 | **是**；**需獨立深度審查** |
| **WP-13 LINE 提醒閉環** | F-23 | 報名→LINE 綁定→開播提醒；模板啟用 LINE；Rich Menu 同步 | `src/lib/line-*.ts`、`src/app/api/webhooks/line/**`、`src/components/message-template-form-client.tsx`、`src/app/(app)/settings/line/**` | 憑證儲存加密邏輯 | C=高 R=中 S=商家＋報名者 P=PII 綁定 | Sandbox 端到端送達；webhook 處理 follow／unfollow | integration（Sandbox）＋E2E | WP-04、LINE 憑證 | 是（憑證） |
| **WP-14 二次確認實驗** | F-09 | 加入「報名後立即 LINE／行事曆提醒」並以 A/B 比較 | `src/app/verify-registration/**`、`src/lib/form-submission-verification*.ts`、funnel A/B 設定 | 驗證安全性（token） | C=中 R=中 S=公開頁 P=PII | A/B 可設定；指標可讀取；token 安全測試仍通過 | targeted tests＋E2E | WP-05、WP-13 | 否 |
| **WP-15 新商家首屏與行動版** | F-13、F-14 | Dashboard 新手模式；任務卡預設收合；行動導覽；對比與目標尺寸 | `src/app/(app)/dashboard/**`、`src/components/app-shell.tsx`、`src/components/landing-pages/funnel-operations-panel.tsx` | 資料查詢邏輯 | C=中 R=低 S=商家端 P=無 | axe 0 serious；行動版首屏即主要表單 | a11y＋E2E smoke | WP-08 | 否 |
| **WP-16 結構整理** | F-21、F-24 | 拆分 `actions.ts`；單一路徑；layout 查詢合併 | `src/app/actions.ts`、`src/app/actions/**`、`src/app/(app)/layout.tsx` | 行為變更 | C=高 R=中 S=全站 P=無 | 無行為變更；測試不降 | 全量 targeted tests | WP-01～08 完成 | 否 |

### 11.2 並行與序列

- **可並行組 A（scope 不相交）**：WP-03、WP-05、WP-06、WP-07。
- **可並行組 B**：WP-10、WP-11（各自獨立審查）；WP-09 與 WP-12 在 A 完成後可併行。
- **序列**：WP-01 → WP-02（共用 `sales-workspace.ts`）；WP-06 → WP-08 → WP-15；WP-04 → WP-13 → WP-14；WP-01～08 → WP-16。
- 同一檔案同一時間只有一個 writer：`src/components/app-shell.tsx` 由 WP-06 先、WP-08／WP-15 後。

### 11.3 AI_TEAM_HANDOFF（精簡格式）

```text
AI_TEAM_HANDOFF
CURRENT_TASK_STATUS: COMPLETE
CURRENT_WORK_ITEM: CelebrateDeal 跨面向產品審視（基底 origin/master@efb8b7e9）
ACTUAL_RESULT: 報告 docs/reviews/2026-10-11-product-audit.md；證據 docs/reviews/2026-10-11-product-audit/（working-notes.md、screenshots/）；未修改產品程式碼、未 commit、未推送、未部署
EVIDENCE: tsc PASS；migrate deploy 96/96 PASS；db seed FAIL(prisma/seed.ts:316)；vitest 179 failed/5257 passed（schema 落後與缺 .git 為主因，未逐項歸因）；axe 13 頁 0 違規、Funnel 工作區 3 項；實測發布鏈 404；eslint/e2e/audit/secret:scan 未執行
NEXT_ACTION: 依報告 11.1 以 ai-team-pro 分批執行 WP-01/03/05/06/07（並行組 A），其後 WP-02、WP-04
ROLLBACK: 本輪僅新增 docs/reviews/** 文件；刪除該目錄即可還原；一次性資料庫 celebratedeal_dev_audit_master_20261011 已刪除
SAFETY_STATUS: PASS
PLAN_REVIEW_STATUS: NOT_REQUIRED
GIT_PROMOTION_STATUS: NOT_REQUESTED
PRODUCTION_DEPLOYMENT: NOT_AUTHORIZED
COPY_TO_NEW_TASK: YES
NEXT_PROMPT_BEGIN
請使用 ai-team-pro，基底為 origin/master（efb8b7e9）。先閱讀 AGENTS.md、docs/ai-team/ROUTING.md、docs/ai-team/handoff-schema.md，以及報告 docs/reviews/2026-10-11-product-audit.md 第 11 節。
要求：
1. 在新的 codex/* 分支上工作；不得動既有工作樹的未提交變更；不得 force push；不得 Production 部署、正式付款、退款、寄信或對正式資料庫操作。
2. 每個 WP 先經 MCP assess_task gate 再開始，完成後以 assess_acceptance gate 驗收；模型與推理程度由 .ai-team/config/routing-policy.json 的 router 決定，不在此指定。
3. 先執行並行組 A：WP-03、WP-05、WP-06、WP-07；各 WP 的 scope、不可觸碰範圍與驗收條件以報告為準。
4. WP-10、WP-11、WP-12 與 WP-04 的 billing-cycle 部分標示為需獨立深度審查；WP-02、WP-03、WP-12、WP-13 需要額外授權或外部輸入，缺少時回報 WAITING_AUTHORIZATION，不得自行假設。
5. 只使用本機、Preview、staging、固定 Sandbox 或 disposable PostgreSQL 與合成資料；不得讀取或輸出 .env*。
6. 每個 WP 完成後保存 sanitized evidence 並更新 handoff；同一根因無改善時停止重試並記錄 blocked。
NEXT_PROMPT_END
```

---

## 附錄 A：發現編號與證據檔對照

| 編號 | 摘要 | 嚴重度 | 證據檔（`docs/reviews/2026-10-11-product-audit/screenshots/`） |
|---|---|---|---|
| F-01 | 發布鏈斷裂：Funnel「已發布」→公開 404；專案閘門 | BLOCKER | `F-01_funnel-editor-says-published-desktop.png`、`F-01_funnel-published-public-404-desktop.png`／`-mobile.png`、`F-01_project-publish-not-ready-desktop.png` |
| F-02 | 「付款方式」語意錯置＋外部核准未定 | MAJOR | `F-02_payment-methods-page-desktop.png` |
| F-03 | 可發布無表單的名單頁 | MAJOR | `F-03_published-lead-page-without-form-desktop.png` |
| F-04 | 死路／重複決策／專案無編輯封存 | MAJOR | `F-04_landing-pages-new-dead-end-desktop.png`、`F-04_projects-new-decisions-desktop.png` |
| F-05 | 夥伴頁與 LINE 設定無入口 | MAJOR | `F-05_partner-pages-no-nav-entry-desktop.png`、`F-05_settings-line-no-nav-entry-desktop.png` |
| F-06 | `/settings/commissions` 404 | MAJOR | `F-06_settings-commissions-404-desktop.png` |
| F-07 | 諮詢預約預設隱藏且 onboarding 不啟用 | MAJOR | `F-07_consultations-hidden-desktop.png` |
| F-08 | 報名失敗顯示 raw JSON | MAJOR | （程式碼證據；UI 待實測） |
| F-09 | 二次確認壓低可用名單；確認頁非商家品牌 | MAJOR（假設） | `public-verify-registration-invalid-desktop.png` |
| F-10 | 公開政策頁為內部治理草稿 | BLOCKER（上線前） | `F-10_policies-internal-draft-desktop.png`／`-mobile.png`、`F-10_login-footer-draft-links-desktop.png` |
| F-11 | 英文與工程識別字外露、術語不一致 | MAJOR | `F-11_funnel-workspace-english-identifiers-desktop.png` |
| F-12 | 模板為公益主題，與銷講不符 | MINOR | `F-12_funnel-templates-nonprofit-desktop.png` |
| F-13 | Dashboard／行動版首屏密度 | MINOR | `F-13_dashboard-new-merchant-desktop.png`／`-mobile.png`、`F-13_lives-new-mobile-chrome-mobile.png` |
| F-14 | 對比、目標尺寸、幣別符號 | MINOR | `F-14_plans-currency-symbol-desktop.png` |
| F-15～F-25 | 技術與可靠性（見第 7 節） | 如表 | 程式碼證據 |

其他畫面（`app-*`、`public-*`、`flow-*`）為頁面巡覽與流程腳本輸出，檔名即路徑；桌機 1440×900、行動 390×844。截圖中右下「最新消息」為產品元件，左下「N」為 Next.js dev 指示（僅開發模式）。

---

## 附錄 B：對標 幫賣 Bombmy 的補充（2026-10-11）

**資料來源與限制**：①Bombmy 官網首頁 https://www.bombmy.live（WebFetch 摘要，2026-10-11）：報名頁、簡訊／Email 提醒、自動銷講（錄一次反覆重播）、台灣金流、對未參與／未下單／未付款自動追銷；模組含 CRM、銷售頁、商品、累積／直播留言、聯盟行銷、黑名單、虛擬使用者、附屬帳號、廣告設定、第三方服務；**首頁未列方案與價格**，僅「免費體驗一場」；教學頁 https://index.bombmy.live/teaching 抽取為空。②使用者提供的第三方整理文字（含社群貼文，未驗證）。③repo 內 `docs/bombmy_analysis/*` 為舊的內部觀察紀錄。**我沒有註冊或實測 Bombmy。**

| 銷講 5 元件 | Bombmy（官網宣稱） | CelebrateDeal master | 判斷 |
|---|---|---|---|
| 1 報名頁 | 設時間與場次自動產生報名頁 | Funnel 編輯器＋Webinar 目標；需先過專案／模板／表單綁定（F-01、F-03、F-04） | 能力在，**上手成本遠高於對手** |
| 2 自動銷講／仿真現場 | 錄一次反覆重播；虛擬使用者、留言組 | evergreen 場次＋互動腳本／角色／閃購（有揭露機制） | 能力在且更深；入口埋在 8 步直播精靈與「互動腳本＝留言組」命名不一致（F-11） |
| 3 催單／預約 | 收單與金流；預約 | 結帳、加購、CTA 切換、諮詢預約（預設隱藏，F-07） | 能力在；金流僅 PayUni 為真實 provider |
| 4 追蹤培育 | 對**未參與、未下單、未付款**自動追銷；簡訊＋Email 提醒 | 自動化 trigger 僅 7 種：payment_paid、viewer_watch_progress、webinar_attended_duration_gte、form_registered、consultation_booked／no_show、form_no_show。**無「未付款／棄單」trigger、無簡訊**；且 repo 內無排程（F-15） | **這是與 Bombmy 最大的實質落差** |
| 5 分析與金流 | 首頁未提分析 | Dashboard 與場次分析以觀看→點擊→CTA→名單為主；`lives/[id]/analytics/page.tsx` 內未見「完看率／平均觀看時長／報名率」（搜尋範圍限該頁） | 銷講核心指標不完整 |

### 追加 WP（併入 11.1 的 WP-04／WP-13 之後）

| WP | 目標 | Scope | 驗收 | Signals | 依賴 | 額外授權 |
|---|---|---|---|---|---|---|
| WP-17 一場即上線（Bombmy 式快速路徑） | 「新增一場銷講」單一入口：選影片、設時間表 → 自動產生報名頁／感謝頁／播放頁／提醒；專案、表單綁定與就緒檢查在背景完成並顯示缺項 | `src/app/(app)/lives/new/**`、`src/lib/evergreen-webinar.ts`、`src/lib/funnel-webinar.ts`、`src/lib/landing-page-service.ts`、`src/lib/sales-workspace.ts` | 新商家 ≤3 次決策即得到可公開、可報名、可播放的網址；未就緒時不得顯示「已發布」 | C=高 R=中 S=商家端＋公開 | WP-01 | 否 |
| WP-18 追銷序列與「未付款」trigger | 新增「結帳未完成」trigger；提供 3 套一鍵啟用的追銷範本（未到場／看完未下單／未付款） | `src/lib/automation-workflow.ts`、`src/app/api/payments/checkout/**`（僅發事件）、`src/app/(app)/settings/automations/**` | 沙盒：建立待付款訂單後依規則排入信件／LINE；去重與退訂有效 | C=中 R=中(Email/Billing 事件) S=商家端 | WP-04 | 否；涉付款事件的部分需獨立審查 |
| WP-19 簡訊提醒（或明確以 LINE 取代並文件化） | 補 SMS provider adapter 與計量，或在 UI 與文件明示僅支援 Email＋LINE | `src/lib/message-template.ts`、新增 SMS adapter、`src/components/message-template-form-client.tsx` | 供應商 Sandbox 送達與退訂；計費點數記錄 | C=中 R=中(PII/成本) S=商家端 | 供應商選擇（A8） | 是（供應商與憑證） |
| WP-20 銷講核心指標 | 場次分析加入報名率、到場率、完看率、平均觀看時長、看完下單率 | `src/app/(app)/lives/[id]/analytics/**`、`src/lib/dashboard-read-model.ts` | 指標與資料表一致（合成資料對賬測試） | C=中 R=低 S=商家端 | 無 | 否 |

**新增待驗證假設 A8**：目標客群的提醒首選是簡訊還是 LINE？驗證：訪談 5 位講師並查看其現行名單的觸達管道。
