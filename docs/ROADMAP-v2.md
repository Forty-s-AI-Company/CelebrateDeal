# CelebrateDeal ROADMAP v2（2026Q4）

- 產出日：2026-10-19（Asia/Taipei，星期一）。封測日：2026-11-01（星期日）。
- 基線：`review-baseline-2026Q4` = `origin/master@78621ca3`，分支 `codex/goal-review-2026q4`。
- 性質：Phase E（E-01～E-03）整合文件。只整理既有報告的結論，**沒有新增 finding、沒有重新執行測試、沒有連任何環境**。所有數字沿用來源報告；標【推估】的是本文件自己推算、來源報告沒有的數字。
- 主要輸入：`docs/goal-plan-review-research-skills-20261017.md`（下稱 goal plan）、`docs/market-2026Q4/reports/台灣直播導購 SaaS 市場研究 2026.md`（下稱市場報告）、`docs/review-2026Q4/10-findings-register.md`（F-001～F-174）、`22-architecture-debt-map.md`、`23-remediation-backlog.md`、`11-architecture.md`、`18-test-quality.md`、`21-open-prs.md`、`docs/skills-2026Q4/01～05`。
- 需要 owner 拍板的事項全部集中在 `docs/DECISIONS-2026Q4.md`，本文以「D-xx」引用。
- 讀法：每個技術問題先用一句白話說明，括號內的 F-xxx 是給工程師追查用的編號（對應 `10-findings-register.md`）。

---

## 0. 一頁摘要

### 0.1 產品重新定位（一句話）

**給「有自己名單的講師與顧問」用的台灣常青銷講系統：報名 → LINE／Email 提醒 → 真人直播或預錄場 → PayUni 結帳 → Meta 轉換回傳，並以「透明公開的方案價格」和「講師賣課收入＋推薦他人課程的佣金收入」作為和幫賣的差異點。**

市場報告原本建議用「誠實標示腳本角色」當賣點；owner 在 10-18 改選「虛擬使用者不標示版」，所以差異點改為透明定價與講師雙向收入（goal plan §5.5、§9 Q3）。+1 留言收單已被免費工具與開店平台商品化，不要自建（市場報告「只有幫賣正面重疊」一節）。

### 0.2 封測能不能如期（11-01）

**判斷：可以如期，但只能是「小規模、免費、陪跑式、付款只走 PayUni Sandbox、跑在 staging」的封測。**

- 依據：封測前必修且無法繞過的工作（L0 核心）共 18 項、11.75～22.25 人日；拆成三條並行工作線後，最長一條約 4.5～9 個工作天（見 §3.1），10-20 到 10-31 有 10 個工作天，放得進去，但上緣幾乎沒有餘裕（`23-remediation-backlog.md` §0、§3.2）。
- 其餘 22 項「可繞過」的問題（18.2～34.7 人日）**不會**在封測前全部修完，要靠創辦人陪同導入與人工流程撐過去（§3.3）。
- 如期的條件（缺一就要縮範圍或延期）：
  1. owner 在 **10-21** 前回覆 `DECISIONS-2026Q4.md` 的「本週」欄（特別是 D-01 付款走 Sandbox、D-02 隱藏範圍、D-06 排程平台）。
  2. PayUni Sandbox 的真實付款回呼樣本在 **10-24** 前到手（T2），否則付款判斷的修正（F-037）只能依文件寫，風險較高。
  3. Supabase 升級到有每日備份的方案並在 **10-28** 前完成一次還原演練（F-058）。
  4. LINE 官方帳號方案 **10-27** 前決定（市場報告「LINE 官方帳號將在 2026-11-01 調價」段）。
  5. 政策頁法定資料（T4）與商家服務條款（律師審閱，或改用每位商家另簽的封測協議）在 **10-29** 前定稿。
  6. 封測規模控制在：每場同時在線 **20 人以下**、商品幣別只用台幣、封測期間**不鎖月結、不撥款**、課程／billing／Funnel 綁卡／瀏覽器直播先不給客戶用。
- **10-27（星期二）容量檢查點**：若 L0 核心完成不到約八成，建議 owner 二選一：(A) 只先開 1～2 位客戶、其餘延一週；(B) 全部延一週。不建議放寬審查換時間（`05-execution-playbook.md` §0）。

### 0.3 最大的三個風險

| # | 風險（白話） | 為什麼嚴重 | 對策 |
|---|---|---|---|
| 1 | **錢的判斷會出錯**：付款通知只要外層寫「成功」就記成已付款，刷卡失敗、取消、ATM 剛取號都會被當成付了錢（F-037）；平台管理員沒設雙重驗證也能進財務後台做退款、匯出銀行帳號（F-024）。 | 會開通不該開的課程、算出不存在的佣金；財務後台只靠一組密碼。 | 第一天開工，工作線 A（§3.1）。F-024 的修正 PR #436 已寫好，只差 rebase 與審查（`21-open-prs.md` §1）。 |
| 2 | **系統背景工作根本沒在跑、壞了也救不回**：repo 內沒有任何排程去觸發寄信、開播提醒、LINE、付款重試、庫存釋放（F-042）；正式環境從沒做過備份還原（F-058）。 | 客戶會以為「報名成功信、開播提醒」有送出，實際沒有；資料毀損時不知道能不能救。 | 工作線 B；owner 選排程平台（D-06）、升級 Supabase（D-07）。 |
| 3 | **法遵與條款跟不上產品選擇**：虛擬使用者採不標示版，但商家條款沒有責任歸屬、註冊沒有同意紀錄（F-114、F-104）；結帳頁直接顯示內部備註給買家（F-101）；消保法七日解除權、金流定性、聯盟多層次傳銷都還沒有律師意見（市場報告法遵表）。 | 公平交易法第 21 條罰鍰 5 萬至 2,500 萬元；出事時無法證明商家同意過責任條款。 | 結帳頁備註第一天就改；條款請律師或先用封測協議；聯盟只累計不出款直到律師與會計師確認。 |

### 0.4 owner 這週要做的五件事

1. **10-21 前回覆 `DECISIONS-2026Q4.md` 的「本週」決策**（D-01～D-23，多數只需回「同意預設」）。最關鍵：付款只走 Sandbox（D-01）、隱藏範圍（D-02）、排程平台（D-06）、同時在線上限（D-15）。
2. **PayUni 兩件事（10-24 前）**：查 Sandbox 商店的信用卡約定 Token 是否開通或向 PayUni 申請（T1，D-03）；排一個時段輸入 Sandbox 測試卡號跑一筆付款，讓工程端取得去識別化的回呼樣本（T2，D-04）。
3. **帳號與方案設定一次做完（10-24 前）**：Supabase 升級並指認哪個專案是 staging（D-07）；GitHub 開啟 secret scanning、push protection、Dependabot、fork PR 核准、環境只允許 master 部署（D-08、D-22）；在 claude.ai 重新授權 Vercel connector（§5.5）。
4. **LINE 官方帳號方案（10-27 前）**：決定平台自己的官方帳號用哪個方案，以及封測時商家是否用自己的官方帳號推播（D-23）。
5. **法務資料與律師（10-29 前）**：補政策頁的營運者法定名稱、統編或負責人、營業地址（T4，D-24）；約律師看商家服務條款（虛擬使用者責任歸屬）與結帳頁七日解除權告知（D-26～D-28）。

---

## 1. 模組決策表（E-01）

### 1.1 讀法

- **市場價值**：市場報告「功能模組決策」表的 Keep／Kill／Add／Defer；與 owner 決策衝突處以 owner 為準（goal plan §5.5、§9）。
- **技術風險**：去重後以該模組為主的 BLOCKER（B）／MAJOR（M）列數（`10-findings-register.md`，模組歸屬依 `22-architecture-debt-map.md`；本表把「live／interaction」拆成直播與互動兩列、「forms／funnel」拆成報名與 Funnel 兩列，並把 F-133 從共用 UI 移到 CRM）。全部合計仍是 B 7、M 65。
- **測試可信度**：引用 `22-architecture-debt-map.md` 與 `18-test-quality.md` 的判斷（高／中高／中／中低／低）。
- **可隔離度**：`11-architecture.md` 模組可隔離度表，1＝很難單獨關掉或替換，5＝很容易。
- **封測狀態**：開放／隱藏／只讀。**重要：目前的「隱藏」多半只是畫面上看不到，伺服器端仍然打得開**（F-001：功能開關只在瀏覽器端遮罩，伺服器元件、Server Action、API 仍可觸及；F-002：課程、billing、Funnel 綁卡連開關都沒有）。所以本表每列都註明伺服器端是否真的擋。封測客戶只有幾位、由創辦人陪同，前端隱藏＋不主動介紹在實務上可接受；若 owner 要求「隱藏＝絕對打不開」，F-001 要升為封測前必修，多 3～4 人日（D-02）。

### 1.2 模組決策表

| # | 模組 | 市場價值（市場報告） | 技術風險 | 測試可信度 | 可隔離度 | 封測狀態（伺服器端是否擋） | 建議動作 | 依據 |
|---|---|---|---|---|---|---|---|---|
| 1 | 直播／預錄場（含常青場、播放、用量計量、瀏覽器直播） | **Keep（核心）**：幫賣證明常青銷講有需求；FB 直播 30 天自動刪除，讓自有回放有價值 | B0／M9（F-079 英文 404、F-091 輪詢量大、F-092 多人同時在線會被誤判額度用完、F-093 播放網址公開、F-095 瀏覽器直播無部署文件、F-102 預覽死路、F-106 狀態顯示英文代碼、F-107 Slug、F-118 手機版步驟） | 中（未專門評估；`stream-usage.test.ts` 把「衝突回額度用完」釘成預期） | 2 | **開放**。瀏覽器直播（browser_live）建議隱藏（D-09，伺服器不擋，只在 UI 隱藏）；常青場設定若走查不生效就隱藏（F-019） | **保留並修主線**：封測前修 404、Slug、預覽；容量問題依同時在線人數決定（≤20 人可延後） | 22 §1、10 F-079／F-091～F-095／F-102、23 §3 |
| 2 | 互動腳本與虛擬使用者 | 市場報告建議 Kill「偽裝觀眾」；**owner 10-18 覆寫：封測開放不標示版**，但虛擬使用者發言不得計入任何商業統計 | B0／M4（F-103 新角色預設不能用在腳本、F-104 畫面與條款都寫「會標示」，目前做不到真正不標示、F-105 彈幕觀眾端看不到、F-113 綁商品就強制要有腳本） | 中（與直播同模組） | 2（屬 Live 模組） | **開放**（虛擬使用者與腳本）。**彈幕與暖場控制台建議隱藏**（D-11，只在 UI 隱藏）；抽獎、快閃、紅包等講師互動台不主動介紹（F-129） | **保留，依 owner 決策改造**：F-103＋F-104 封測前做；商家條款加責任歸屬（律師）；c07 的標示規格降為「可選功能」保留，封測後再評估 | 10 F-103～F-105／F-113、17 §0.3、goal plan §9 Q3 |
| 3 | 商品與結帳（含 PayUni、付款通知、退款） | **Keep（精簡）**：成交閉環；須補消保法揭露與七日解除權告知 | **B2**／M9（F-037 付款判斷錯誤、F-101 結帳頁顯示內部備註；F-003、F-008～F-010、F-040、F-041、F-043、F-050、F-062） | 中高：`payment-webhooks.test.ts` 44 案、0 mock、連真資料庫，是最值得保留的資產；**但 PayUni 測試資料是自創欄位**，所以 BLOCKER 照樣全綠 | 1（不可隱藏、不可下線） | **開放**（只用台幣、單品、PayUni Sandbox） | **保留並重構，不重寫**：先修 F-037、F-101；封測後以特徵化測試把結帳 route 與付款通知拆小（F-009、F-010） | 22 §1、11「給 E-02 的證據摘要」、18 §0 |
| 4 | 報名表單（含雙重確認、報名成功信） | **Keep（核心）**：第一方名單是講師最在意的資產 | B0／M1（F-108 確認完成頁沒有「前往直播間」） | 中低（#441 的重試與 `proxy.test.ts` 有覆蓋） | 2 | **開放** | **保留**：補下一步連結（可繞過：信件內直接放直播間連結） | 22 §1、10 F-108 |
| 5 | Funnel／Landing（漏斗頁、編輯器、綁卡發布閘門） | **Keep 漏斗頁；Defer 綁卡**：綁卡要 PayUni Token 與 Vercel 固定 IP（USD 100／月） | B0／M1（F-015 每次瀏覽 6 次以上資料庫往返）；綁卡閘門散落 ≥8 檔（F-002，記在 billing） | 中低（`funnel-blocks/*` 0 測試、元件 7／25 有測試） | Funnel 3、綁卡閘門 2 | **漏斗頁開放；綁卡與依賴綁卡的發布隱藏**，除非 T1 在 10-24 前打通（D-03）。綁卡閘門**沒有開關**，`funnel_builder` 開關只在瀏覽器端，**伺服器不擋** | **保留漏斗頁、延後綁卡**；`/lp` 先量測（L1）再決定是否重構（L2） | 10 F-002／F-015、市場報告 Funnel 列、11 可隔離度表 |
| 6 | 課程與學員 portal | **Defer**：Teachify、幫開課已覆蓋；線上教學定型化契約與七日解除權排除風險高 | B0／M0（MINOR 1：F-030 學員登入 30 天無法撤銷） | 中（真資料庫測試＋4 個 E2E） | 3（`/portal` 前綴、獨立 session 與資料表） | **隱藏**。**沒有任何課程開關，伺服器端完全不擋**（F-002）；只能靠「不開權限＋導入時不介紹」，或做 F-002 加旗標 | **延後**；封測後若市場證據支持課程，作為 strangler 重寫的第一個候選（§2），否則移除 | 11 可隔離度表、22 §5 |
| 7 | 諮詢預約 | **Keep（輕量）**，預設隱藏，只對顧問型客戶個別開 | B0／M0（NIT：F-034 有一個函式繞過 CSRF） | 低（行動版諮詢有純讀原始碼的假測試，F-133） | 4 | **隱藏（預設）**；顧問型封測客戶個別開。`consultation_booking` 開關**只在瀏覽器端，伺服器不擋**（F-001） | **延後／輕量保留**；個別開啟時附退費條款範本 | 市場報告諮詢列、11 可隔離度表、10 F-001 |
| 8 | 聯盟與團隊漏斗（推薦、佣金、出款、夥伴入口） | 市場報告 Defer；**owner 覆寫：封測開放，佣金只累計不出款**（等會計師確認扣繳與二代健保、律師確認不觸及多層次傳銷） | B0／M2（F-025 沒有最小權限的夥伴身分：會計角色可看全部夥伴佣金並標記任何出款、客服角色可讀全部買家個資；F-044 月結扣佣金但沒有出款路徑） | 中（佣金帳務測試強，`affiliate-actions` 弱） | 2（佣金是付款通知交易的一部分） | **開放累計；出款入口隱藏**。`affiliate_program`、`tax_remuneration` **有伺服器端檢查**（約 7 處，預設開）；但**沒有平台層「禁止標記已出款」的開關**（F-052），所以「不出款」要靠「封測期間不鎖月結、不撥款」的流程擋。夥伴入口**不授權給外部人**（F-025 的繞過方式） | **保留但收斂**：只累計、關出款；封測後決定身分模型（D-17）與出款方式（D-31） | 22 §1／§4、10 F-025／F-044／F-052 |
| 9 | LINE 與通知（Email、LINE、學員通知、SMS／WhatsApp／Web Push） | **Keep（核心）＋Add 費用歸屬設定**：LINE Notify 已終止；11-01 調價；推播依收訊人數計則、超額直接失敗 | B0／M2（F-109 報名成功信範本空白、F-112 LINE 綁定頁沒有教學且錯誤不會變紅）；**受 F-042（沒有排程）這個 BLOCKER 直接影響：信與 LINE 都不會自動送** | 中低（沒有 LINE E2E；#431 的 SMS、WhatsApp、Web Push 沒用真實 provider 驗證） | 3 | **開放**（Email＋LINE；商家用自己的官方帳號）。SMS、WhatsApp、Web Push 不對外宣稱（`21-open-prs.md` §3） | **保留**：先補排程（F-042），再補綁定教學與預設範本 | 22 §1、21 §3、市場報告 LINE 列 |
| 10 | 追蹤（Meta CAPI outbox、analytics） | **Keep Meta；Defer TikTok／Google** | B0／M0；依賴排程（tracking-deliveries）與 job 失敗告警（F-141） | 中（獨立 DB 測試＋瀏覽器 gate 在 CI） | 4（outbox 已是接縫） | **開放但預設關閉**，由創辦人協助設定；無開關 | **保留現狀** | 22 §1、市場報告追蹤列 |
| 11 | billing／方案（平台訂閱、帳單、用量、月結、商家撥款） | **Keep 架構；Add 公開價格頁**；封測免費 | **B2**／M4（F-038 月結把商家付給平台的方案費算成商家營收再退回去、F-039 跨月退款被吃掉；F-002、F-005、F-061、F-077） | 中低（`platform-plan-checkout.ts` 566 行無同名測試；財務區段靠手寫假資料庫） | 2 | **隱藏**。**沒有開關，伺服器端不擋**；6 個帳務導覽項無旗標（F-002）。封測期間不鎖月結、不撥款，兩個 BLOCKER 不會被觸發 | **延後＋隱藏**；第一次撥款（最早 12 月初）前必修 F-038、F-039、F-040、F-044；公開上線前發布價格頁 | 22 §1、23 §1.1、市場報告 billing 列 |
| 12 | 平台 admin ops（WP4／q1 Sandbox 測試工具、28 條 `/api/admin/ops/**`） | 內部工具，不屬市場模組 | B0／M3（F-007 測試用登入工具編進正式程式、F-016 5 個 ops 端點只靠一把共用密鑰且可帶任意商家 ID、F-168 staging QA 帳號沒有 MFA）；另 F-024（auth 列）直接保護這一區 | 中高（但測的是工具本身） | 4 | **不對客戶開放**（內部）。payuni ops 在 production 會回 404；其餘 5 條只靠 `JOB_SECRET`，建議 production 一律回 404（F-016①，可繞過：確認各環境密鑰不同，D-18） | **移出正式程式**：短期 proxy 回 404；中期建置時排除（L2） | 22 §1、10 F-007／F-016／F-168 |
| 13 | 後台 CRM／客服（客戶名單、客服案件、黑名單、團隊績效、訊息） | 不在市場報告決策範圍（報告建議由 ROADMAP 評估） | B0／M1（F-133：CRM 與行動諮詢有 4 個測試只讀原始碼字串，從沒真正執行，而它們正好處理個資與租戶範圍） | **低** | 未評估（11 未列） | **開放**（商家自己的名單、訂單、客服案件）；黑名單、團隊績效不主動介紹 | **保留**；L1 把假測試換成兩租戶行為測試（F-133、F-134） | 18 §0、10 F-133 |

**橫切項目（不是功能模組，但風險最高）**

| 項目 | 技術風險 | 說明 | 建議 |
|---|---|---|---|
| auth／租戶 | **B1**／M6（F-024 財務後台不強制 MFA；F-001、F-004、F-088、F-114、F-134、F-169） | 被 487 條相依關係依賴；可隔離度 1；`auth.test.ts` 有一條把漏洞當預期行為釘住 | 保留並強化：合併 #436、補夥伴身分與第二租戶測試 |
| infra／CI（排程、備份、Sentry、CI、區域） | **B2**／M15（F-042 沒有排程、F-058 沒有備份證據；F-090、F-141、F-143、F-152、F-153 等） | 「做了也看不見、壞了救不回」；覆蓋率 Statements 65.52%、Lines 70.78% 可信但分母含 423 個 scripts 檔 | 封測前補排程、備份、Sentry 個資過濾三個缺口 |
| 共用 UI／殼層 | B0／M8（F-078、F-083、F-089、F-110、F-111、F-115、F-116、F-117） | 時區、錯誤頁、狀態用詞，一次修好全站受益 | 封測前修時區（F-110）；其餘封測期間 |

### 1.3 與市場報告的差異（以 owner 決策為準）

| 項目 | 市場報告 | owner 決策 | 本 ROADMAP 的處理 |
|---|---|---|---|
| 虛擬使用者 | Kill 偽裝觀眾，改造為強制標示的官方腳本角色 | 10-18 改選不標示版；商業統計只算真實資料 | 依 owner：F-104 採不標示版（方案 A）；風險改由商家條款與律師處理；「觀眾端在線人數是否計入虛擬使用者」另列 D-10，建議不計入 |
| 聯盟分潤 | Defer、封測隱藏、人工轉介 | 封測開放，只累計不出款 | 依 owner：保留累計；以「不鎖月結＋不撥款＋夥伴入口不給外部人」落實 |
| 定位主張 | 「誠實標示」是差異化訊息 | 改為「透明定價＋講師雙向收入」 | §0.1 已改寫；註：幫賣官網也列有聯盟行銷，差異在「講師之間雙向交叉推廣」，需在封測訪談中驗證（goal plan §5.5） |

---

## 2. 重構 vs 重寫（E-02）

owner 已開放重寫選項（goal plan §9 Q4），但**封測一律跑現有程式碼**（§2.3）。以下三個選項只影響封測之後的路線。

### 2.1 三個選項比較

「要修的問題」三個選項都得付：封測前 L0 30.45～57.45 人日、封測期間 L1 39.05～66.05 人日、公開上線前 L2 53.8～75.3 人日（`23-remediation-backlog.md` §2）。下表的「成本」是**在這之外額外**要花的。

| | 選項一：漸進重構 | 選項二：strangler 分模組重寫 | 選項三：全新 repo |
|---|---|---|---|
| 做法 | 不換架構；先補「特徵化測試」（把現有行為錄成測試），再在同一檔內抽函式、反轉依賴，逐步把大檔拆小 | 核心（結帳、付款通知、auth、月結）照選項一；邊緣模組一個一個在舊程式旁邊重寫，接好後關掉舊的 | 另開新專案，從頭寫封測五模組＋auth，最後把資料搬過去 |
| 額外成本 | L3 結構工作 43.15～59.65 人日，其中核心「不重寫、特徵化測試推進」約 17～25 人日（F-007～F-010） | 選項一的成本＋每個邊緣模組重寫【推估】：學員 portal＋課程（約 70 檔、5,900 行）15～25 人日；追蹤 5～8 人日；三到四個模組合計約 60～120 人日 | 【推估】150～300 人日（封測五模組＋auth 約 6 萬行非測試程式；假設重寫可精簡一半、每人日 200～300 行含測試）＋資料搬遷 15～30 人日；**AI 代理實際產能未量測，誤差很大** |
| 風險 | 低～中：每一步都有既有測試與 CI 保護；風險在「大檔同時只能一人改」的排隊 | 中：接縫清楚的模組風險低；若把錢路模組也拿來重寫，風險升到高 | **高**：重寫會發生在近三個月改動最頻繁、也最常出錯的營收路徑（`actions.ts` 25 次、`payment-webhooks.ts` 19 次、checkout route 19 次 commit）；6,357 個 Vitest 案例、1,225 個 Node TAP 案例、90 個 E2E 的保護要重建 |
| 可沿用資產 | 全部 | 全部；被重寫的模組保留它的真資料庫測試當驗收（`student-course-learning.db`、`course-community.db`、4 個 E2E） | Prisma schema（3,999 行）與 108 個 migration 可當起點；PayUni Sandbox runner、`docs/domain-workflows.md`、runbook、CI `quality` 規則、設計 token（`ui.tsx`、`FormSubmitButton`）；**真資料庫的付款通知測試只能當規格參考，無法直接沿用** |
| 對封測的影響 | 無；可與封測並行 | 無；第一個候選（課程／portal）本來就在封測隱藏 | 封測照跑舊程式碼，但同一時間要維護兩套；封測熱修會分散重寫人力 |
| 對 2027 的影響 | 2027 Q1 完成 L2 後即可公開上線；L3 可邊上線邊做 | 視候選模組是否真的要做；若課程模組封測後被判定不做，則只剩追蹤，價值低 | 2027 上半年大部分時間花在追平現有功能；公開上線延後 |
| 資料與 staging 怎麼搬（選項三必答） | 不需要 | 被重寫模組沿用同一個資料庫與資料表，不搬 | 最低風險做法：新程式**直接連同一個 Supabase 資料庫、沿用現有 schema 與 Prisma migration 歷史**，只換應用程式；Cloudflare Stream 影片與 R2 圖片以 ID 沿用。若要改 schema，就得寫 ETL 腳本，而且所有加密欄位（MFA secret、LINE／Meta 憑證、個資信封）都由 `CSRF_SECRET` 衍生，**換了這把鑰匙就全部解不開**（F-031），搬遷時必須保留原鑰匙或先解密再重新加密。11-01 之後 staging 有真實客戶資料，搬遷要先備份並取得 owner 同意 |

### 2.2 證據

- **核心不適合重寫**：結帳／金流核心與 auth 的可隔離度都是 1，billing 與聯盟是 2（`11-architecture.md` 模組可隔離度表）。耦合集中在兩個樞紐（`payment-webhooks.ts` 的事件扇出、`commerce-orders.ts` 的訂單狀態），其他模組伸進來的邊很少（課程 3 個契約檔、聯盟 3～4 個、追蹤 3 個），這種形狀適合「在樞紐前面建介面、逐模組移出」，不適合整體重寫（`11-architecture.md`「與重寫相關的結構事實」）。
- **安全網已經存在**：沒有執行期循環、lib 反向依賴 app 為 0、架構邊界與複雜度棘輪都在 CI 內（同上）。
- **測試比外觀可信**：付款通知測試 44 案、0 個 mock、連真資料庫，被 4 個拋棄式設定重複執行（`11-architecture.md` 證據表）；覆蓋率數字合成流程合理，但全域分母含 scripts、`src/lib` 專屬值沒輸出（`18-test-quality.md` §5）。真正的問題是**測試資料不真實**（PayUni 自創欄位）與**少數測試把漏洞當預期**，這兩者修測試即可，不需要重寫程式。
- **可以先刪的東西比重寫便宜**：admin ops／WP4 工具約 54 檔、死碼約 20 檔，刪掉就能讓核心變小（F-007、F-016、F-018、F-161）；knip 判定的未使用檔只有 19 個（約 490 行可直接刪），占全部 1,461 個 ts／tsx 很小。文件 91.5% 可封存，但那是 `docs/`，不是程式（F-164）。
- **功能被砍的比例很低**：市場報告的決策表裡，只有「留言 +1 收單」被 Kill（而且本來就沒做）；「偽裝觀眾」的 Kill 被 owner 覆寫。其餘是 Keep 或 Defer。重寫無法靠「少做很多功能」換到簡化。

### 2.3 建議

1. **採選項一（漸進重構）作為主線**，與封測並行；核心模組（結帳、付款通知、auth、退款／出款／月結）不重寫。
2. **選項二只保留為選項**：等 2026-12 封測回顧（D-36）時，若市場證據支持「課程」值得做，以學員 portal＋課程作為第一個 strangler；若不支持，直接移除課程模組，比重寫更便宜。
3. **不建議選項三（全新 repo）**。只有在封測後產品方向大幅轉向（例如放棄直播與結帳、改做純課程站）時才重新評估。
4. 不論選哪一個，先做三件便宜、且與結論無關的事：刪不可達的退款程式（F-003）、修限流的來源 IP 判斷（F-004）、讓功能開關在伺服器端真的生效（F-001）。

---

## 3. 下一個開發 Goal 的 Work Package（E-03）

### 3.0 開工前置（10-19～10-20，主對話）

| # | 事項 | 為什麼 |
|---|---|---|
| P-1 | 把工作目錄中已修改、尚未 commit 的 `PRODUCT.md` 與 `docs/domain-workflows.md`（虛擬使用者改為不標示版的新規則）開文件 PR 合併 | master 版本仍寫「互動角色必須揭露」，代理照舊規則驗收會誤判（`01-skill-inventory.md` §0.4） |
| P-2 | 建立 `docs/goal-beta-prep-2026Q4/STATE.md`（工作項目、檔案鎖、owner 待辦、每日摘要），只有主對話編輯 | Goal 狀態的唯一來源（`02-agent-gaps.md` §2） |
| P-3 | 主工作樹執行 `npm run db:generate` | 本機 Prisma Client 過期，`typecheck` 會假失敗（F-174） |
| P-4 | 寫入 `CSRF_SECRET` 是資料根金鑰、禁止輪替、還原時必須一併保存的說明（docs） | F-031①；工作線 B 的還原演練要驗證這一點 |

### 3.1 封測前（10-20～10-31）：L0 核心 18 項，三條並行工作線

依 `23-remediation-backlog.md` §3.1／§3.2 排定；同一時間每個檔案只有一個 writer；同時最多 3 個寫入者＋1 個 reviewer（goal plan §8.5「一般額度」）。

與 backlog 的兩處調整（依 `05-execution-playbook.md` §1.2 的風險路徑規則）：
- **F-090 從工作線 C 移到 B**：它要改 `vercel.json`，屬風險路徑，需要 reviewer；而且若排程選 Vercel Cron，F-042 也改同一檔。
- **F-101 仍由 engineer 做，但送 reviewer 輕審**：`commerce-checkout-form.tsx` 符合風險路徑 `src/components/*checkout*`。

#### 工作線 A：engineer-hard＋reviewer（auth 與付款），約 3.5～7.5 人日

| WP | 對應 finding | scope（白話） | 檔案範圍 | 完成標準 | 測試要求 | reviewer | 估工 | 依賴 |
|---|---|---|---|---|---|---|---|---|
| A1 | F-168（B11-01） | 讓 staging 的財務 QA 帳號有雙重驗證，自動化退款測試腳本才不會在 #436 合併後卡住 | `src/lib/staging-qa-finance-bootstrap.ts`、`scripts/q1-original-refund-runner.mjs`、`scripts/payuni-sandbox-pending-refund-consumer.mjs`、`scripts/payuni-issued-recovery-runner.mjs`、`scripts/payuni-current-source-refund-qa.mjs`（及對應 `.test.mjs`） | QA 帳號有 TOTP 因子；runner 以 staging secret 中的 seed 算驗證碼，能通過 `/mfa/setup` 與 `/mfa/verify`；repo 內不含任何 seed | 對應 `node:test`、`npm run typecheck`、`npm run lint` | 隨 A2 一起審 | 0.5～1 | owner 同意在 staging 新增一個 secret（seed 由 owner 或受控 runner 產生，不經聊天） |
| A2 | F-024（B02-01、B03-09、B08-03、B11-02） | 平台管理員沒設雙重驗證就不能進財務後台（PR #436） | `src/lib/auth.ts`、`src/lib/auth.test.ts`、`tests/e2e/wp88-direct-url-guard-matrix.spec.ts`、`tests/e2e/smoke.spec.ts`、`tests/e2e/accessibility.spec.ts`、`src/app/actions/auth-security-actions.ts` | rebase 到 master（衝突檔採 master 的 LF 版本再套回 3 個 hunk）；`auth.test.ts:224` 改成「拒絕」；21 個呼叫 `requireFinanceAdmin` 的入口都導向 `/mfa/setup`；新 head 的 `quality` 綠 | `npx vitest run src/lib/auth.test.ts`、`actions.mfa-db` 真資料庫測試、相關 Playwright spec、typecheck、lint | **是**＋`security-review` | 0.5～1 | A1；owner 先讓所有平台管理員完成 TOTP 登記並更換 bootstrap 密碼（F-169 的繞過方式）；**owner 說 OK 才合併**（D-05） |
| A3 | F-037（B03-01、B08-02）；同批可順手做 L1 的 F-047、F-048、F-067 | 付款通知必須「外層成功＋交易狀態＝1＋允許的付款方式」才算已付款；失敗、取消、ATM／超商剛取號都不能入帳 | `src/lib/payment-providers/payuni.ts`、`payuni.test.ts`、`payuni-fixtures.ts`、`src/lib/payment-webhooks.ts`（及其測試） | 先寫會失敗的測試，再修到綠；`TradeStatus` 0／2／3／4／9 不產生已付款交易、不產生佣金；eventId 改為 `TradeNo:TradeStatus`；fixture 使用 PayUni 真實欄位名稱 | `payuni.test.ts`、付款通知真資料庫測試（`vitest.*db*.config.ts`，只在 loopback `celebratedeal_*`）、typecheck、lint | **是**＋`security-review` | 2～3.5 | T2 的去識別化 Sandbox 回呼樣本（10-24 前，D-04）；樣本到之前先寫紅燈測試 |
| A4 | F-114（B07-15） | 商家註冊時必須勾選服務條款與隱私權政策，並記錄同意的版本與時間 | `src/app/register/page.tsx`、註冊 action；若要存同意紀錄則含 `prisma/schema.prisma`＋一個新 migration（並登記 `docs/codex-goal/PRISMA_INVARIANTS.md`） | 不勾選無法註冊；同意紀錄可查；標題改「建立你的商家帳號」 | 對應單元測試、註冊 Playwright spec、typecheck、lint；有 migration 則跑 DB 測試 | 是（有 schema 變更時） | 0.5～2 | 律師完成商家服務條款、#435 條款 owner 簽核（D-25、D-26）；**來不及就改用每位商家另簽封測協議，本項延到 L1** |

#### 工作線 B：engineer-hard＋reviewer（資料與營運），約 3.25～5.25 人日

| WP | 對應 finding | scope（白話） | 檔案範圍 | 完成標準 | 測試要求 | reviewer | 估工 | 依賴 |
|---|---|---|---|---|---|---|---|---|
| B1 | F-026（B02-03、B04-08） | 確認資料庫有沒有「只要拿到公開金鑰就能直接讀訂單與個資」的漏洞 | 查詢由主對話用 Supabase connector 唯讀白名單執行（只查中繼資料）；若有漏洞，engineer-hard 寫 `prisma/migrations/<新>` 對全部表開 RLS，加 CI catalog 測試 | 查詢結果記入 `STATE.md`（只記表名與結論）；若 `anon`／`authenticated` 有權限，當天補 forward migration | migration 的 DB 測試、`quality` | 是（有 migration 時） | 0.5 | owner 指認哪個 Supabase 專案是 staging 並同意唯讀查詢（D-07） |
| B2 | F-042（B03-06、B09-01） | 讓寄信、開播提醒、LINE、付款重試、庫存釋放、追蹤這些背景工作真的會定時執行 | 依 D-06：`vercel.json`／`vercel.staging.json` 或 `.github/workflows/<schedule>.yml`；`src/app/api/jobs/*`、`src/app/api/cron/*`（4 個只收 POST 的 job 補可排程入口）；`src/app/api/jobs/email-deliveries/scheduler-config.test.ts`；排程 runbook | **以 staging 的 runtime log 證明每個 job 確實被呼叫**（不是只看設定檔存在） | scheduler 契約測試、job route 測試、typecheck、lint | **是** | 1～2 | D-06 排程平台；確認 Vercel 方案的 cron 與 `maxDuration` 上限 |
| B3 | F-090（B06-03） | 確保網站主機與資料庫都在東京，避免後台逾時 | `vercel.json`（及 `vercel.staging.json`，若封測跑 staging）、`src/lib/db.ts`（連線池參數）、`scripts/preflight.ts`、相關文件 | `regions: ["hnd1"]`；pooler URL 參數；preflight 檢查並記錄 `VERCEL_REGION` | preflight 測試、typecheck、lint | 是（`vercel*.json` 屬風險路徑） | 0.5 | owner 確認區域與 pooler（D-19）；與 B2 同檔，排在 B2 之後 |
| B4 | F-058（B04-01）＋F-074（B04-21） | 在封測資料所在的資料庫開啟每日備份，並實際做一次「還原到隔離環境」的演練 | `docs/production-backup-restore-runbook.md`、還原腳本、`.github/workflows/staging-backup-recovery.yml`（若需補 age 金鑰設定） | 記錄 RTO（多久能還原）與帳務彙總前後一致；`pg_trgm` 擴充的 schema 問題在 runbook 與腳本中修正；收據放 `reports/` | 還原演練本身就是測試；收據由主對話檢查 | 否（收據由主對話檢查） | 1.25～2.25 | D-07 Supabase 升級；P-4（F-031①） |

#### 工作線 C：engineer（首次成功路徑），約 4.5～9 人日

| WP | 對應 finding | scope（白話） | 檔案範圍 | 完成標準 | 測試要求 | reviewer | 估工 | 依賴 |
|---|---|---|---|---|---|---|---|---|
| C1 | F-101（B07-01） | 結帳頁不再對買家顯示「這些文件在正式上線前仍需真人 owner 核准」這段內部備註 | `src/components/commerce-checkout-form.tsx` | 依 `resolvePolicyStatus` 顯示政策生效日；買家看不到任何內部字樣 | 元件測試、結帳 Playwright spec、typecheck、lint | 輕審（風險路徑檔，只改文案） | 0.5 | owner 確認 #435 條款版本（D-25） |
| C2 | F-110（B07-11）＋F-079（B05-03、B07-08） | 時間一律以台灣時間顯示（避免講師排 20:00 列表顯示 12:00）；觀眾找不到直播時看到中文的「找不到頁面」並有返回出口 | `src/lib/format.ts`、`src/app/(viewer)/not-found.tsx`（新增）、`src/app/not-found.tsx`（新增）、`src/app/global-error.tsx`、`src/app/p/[slug]/error.tsx`；標籤字串所在元件 | `formatDateTime` 預設 `Asia/Taipei`，欄位標籤改「台灣時間」；404 與錯誤頁為繁中並有重試與回首頁 | `format` 單元測試、相關頁面測試、typecheck、lint；需讀 `node_modules/next/dist/docs/` 的 not-found／error 文件 | 否 | 1 | — |
| C3 | F-103（B07-03）＋F-104（B07-04） | 新建的虛擬使用者角色預設就能用在腳本；聊天室依 owner 決策「不標示」：標籤改選填、移除「一般觀眾」預設、改寫四處說明與條款揭露、統一用詞；**確認虛擬使用者發言不計入任何商業統計** | `src/components/interaction-roles-workbench.tsx`、`interaction-script-form.tsx`、`scripted-roles-control.tsx`、`src/lib/live-chat-contract.ts`、`src/components/live-chat-panel.tsx`、`src/lib/public-policy-content.ts` | 腳本頁角色下拉不再空白且有空狀態；聊天室不輸出「一般觀眾」fallback；後台統計只算真實觀眾（以測試斷言） | 對應元件與 lib 測試、互動角色 Playwright／browser QA、typecheck、lint | 否 | 1～2.5 | 同一 writer 依序做；條款揭露文字等律師（D-26）；D-10 在線人數 |
| C4 | F-107（B07-07） | 「Slug」改為「直播網址」，從標題自動帶入，重複時在欄位上提示而不是整頁錯誤 | `src/components/live-stepper-form.tsx`、`src/app/actions.ts:816` 附近的直播建立區段 | 撞名回欄位錯誤；草稿存檔即時檢查；不再出現未攔截的 P2002 | 直播 stepper 測試、`actions.test.ts` 對應 describe、typecheck、lint | 否 | 0.5～2 | L0 期間沒有其他工作線寫 `actions.ts`；排在 C2 之後（同檔標籤） |
| C5 | F-113（B07-14） | 綁了商品的直播不再強制要有互動腳本；上線引導只列必要步驟 | `src/lib/live-publish-readiness.ts`、`src/lib/merchant-onboarding.ts`、`src/components/live-stepper-form.tsx` | 不想用虛擬使用者的講師可以直接發布 | 對應單元測試、typecheck、lint | 否 | 0.5～2（若 owner 選維持強制則 0） | D-12；排在 C4 之後（同檔） |
| C6 | F-143（B09-04） | 錯誤追蹤（Sentry）不再把 cookie、網址參數、程式變數等可能含個資的內容送到海外 | `sentry.server.config.ts`、`sentry.edge.config.ts`、`src/instrumentation-client.ts`、新增 scrubber 模組與測試；可順手做 F-098 取樣率（L1） | 明確關閉 cookies／queryParams／stackFrameVariables；headers 白名單；`beforeSend` 過濾＋單元測試 | scrubber 單元測試、typecheck、lint | 否（主對話加跑 `security-review`） | 1 | — |

#### 文件（主對話或 docs agent），約 0.5 人日

| WP | 對應 finding | scope | 檔案範圍 | 完成標準 | 估工 |
|---|---|---|---|---|---|
| D1 | F-031① | 見 P-4 | `docs/staging-production-env-vars.md`、`docs/production-backup-restore-runbook.md` | 明寫 `CSRF_SECRET` 是資料根金鑰、禁止輪替、還原必須一併保存 | 0.5 |

**18 項核對**：A1 F-168、A2 F-024、A3 F-037、A4 F-114、B1 F-026、B2 F-042、B3 F-090、B4 F-058＋F-074、C1 F-101、C2 F-110＋F-079、C3 F-103＋F-104、C4 F-107、C5 F-113、C6 F-143、D1 F-031①。

#### 建議日程

| 日期 | 工作線 A | 工作線 B | 工作線 C | 里程碑 |
|---|---|---|---|---|
| 10-20（二） | A1 | B1（等 owner 指認專案）；B2 先修 job handler | C1 → C2 | P-1～P-4 完成 |
| 10-21（三） | A2 送 reviewer | B2 | C2 → C3 | **owner 回覆本週決策** |
| 10-22（四） | A2 合併（owner OK）→ A3 紅燈測試 | B2 送審 → B3 | C3 | — |
| 10-23（五） | A3 | B3 | C3 → C4 | 週檢查 |
| 10-24（六） | A3（樣本到後補真實 fixture） | B4 準備（等 Supabase 升級） | C4 | T1、T2、GitHub 設定期限 |
| 10-25（日） | 緩衝，只合併已審查的 PR | | | — |
| 10-26（一） | A3 送 reviewer＋`security-review` | B4 | C5 → C6 | — |
| 10-27（二） | A4（或改封測協議） | B4 演練 | C6；空檔做可繞過的高分項（§3.3） | **容量檢查點**；LINE 方案期限 |
| 10-28（三） | A4 收尾 | B4 收據 | 可繞過項 | 備份 gate |
| 10-29（四） | **18:00 功能凍結**；RC 增量審查（reviewer 三軸＋`security-review`＋`code-review ultra`，需 owner 同意額度） | | | 條款、法定資料期限 |
| 10-30（五） | 修 RC 的 BLOCKER／MAJOR；PayUni Sandbox 實付演練（付款成功／失敗、重複通知、部分與重複退款各一次）；合成資料清理（§4.2） | | | RC 驗收 |
| 10-31（六） | owner 以封測客戶身分走完首次成功路徑；Go／No-Go 檢查表（`05-execution-playbook.md` §6.3） | | | Go／No-Go |

#### 10-27 容量檢查點與「若來不及就砍什麼」

檢查點問三件事：(1) L0 核心 18 項完成幾項？(2) owner 外部動作（T1、T2、Supabase、LINE、條款）到位幾項？(3) reviewer 退回的 BLOCKER／MAJOR 有沒有收斂？

來不及時依下列順序砍（越前面越先砍、代價越小）：

1. **L0 可繞過 22 項全部改用繞過方式**（§3.3），不再排工程。
2. **核心中可部分繞過的四項**（`23-remediation-backlog.md` §3.3）：
   - F-114 → 每位封測商家另簽封測協議（含服務條款與虛擬使用者責任），註冊同意紀錄延到 L1。
   - F-113 → 維持強制腳本，由創辦人幫商家套用預設腳本。
   - F-058 → Supabase 每日備份先開，隔離還原演練延到封測第一週（代價：第一週出事時還原時間未知）。
   - F-042 → 先用 GitHub Actions 排程暫代（延遲 5～10 分鐘以上；閒置 60 天會被停用）。
3. **縮封測範圍**：隱藏彈幕與暖場控制台、不用瀏覽器直播、Funnel 綁卡隱藏、課程與 billing 隱藏、諮詢預約不開、每場同時在線 ≤20 人、商品只用台幣、不鎖月結不撥款。
4. **縮客戶數**：先開 1～2 位，其餘延一週。

**不可砍**（砍了就不能開封測）：F-024（財務後台 MFA）、F-037（付款判斷）、F-101（結帳頁內部備註）、F-143（Sentry 個資）、F-026 的唯讀確認、F-042 至少有暫代排程、F-110（時間顯示）。

### 3.2 封測期間（11-01 起）：L1 前 10 項

只做 S0／S1 熱修與小批次；帶 migration 的 PR 預設不合併（staging 每次部署都會自動套用 migration），例外需先備份、通知 owner（`03-connector-playbook.md` §0.5）。

| 序 | ID | 項目（白話） | 派工 | reviewer | 估工 |
|---:|---|---|---|---|---|
| 1 | F-015 | 量測公開漏斗頁 100 人同時開啟時的反應速度，決定要不要重構 | engineer | 否 | 0.5 |
| 2 | F-045 | 後台退款也要釋放庫存、排電子發票作廢 | engineer-hard | 是 | 0.5 |
| 3 | F-046 | 結果不明的退款，確認沒退後可人工釋放 | engineer-hard | 是 | 0.5 |
| 4 | F-048 | 只接受系統建立過的訂單的付款通知，移除通知內容覆寫佣金率 | engineer-hard | 是 | 0.5 |
| 5 | F-067 | 付款通知的事件編號納入事件類型，避免退款通知被當重複吞掉 | engineer-hard | 是 | 0.5 |
| 6 | F-106 | 狀態徽章顯示中文，不再顯示 `draft`、`vod` 這類代碼 | engineer | 否 | 0.5 |
| 7 | F-049 | 退款金額與月結調整嚴格檢查格式、必填理由、上限與第二人覆核 | engineer-hard | 是 | 0.5 |
| 8 | F-065 | 開發用的 migration 指令加防呆，避免誤對遠端資料庫執行 | engineer-hard | 是 | 0.5 |
| 9 | F-115 | 側欄「系統連線正常」綠燈改接真正的健康檢查或移除 | engineer | 否 | 0.5 |
| 10 | F-116 | 儀表板加「已付款訂單數／金額」 | engineer | 否 | 0.5 |

F-047、F-048、F-067 若已在 A3 同批完成，順延 L1 第 11 項以後（F-083、F-040、F-050…）。

**有觸發條件、必須在觸發前完成的 L1 項**（不在前 10 名，但時間點硬）：
- 第一次鎖定商家月結／撥款前（最早 12 月初）：F-038、F-039、F-040、F-044、F-073（月結與撥款的兩個 BLOCKER 與淨額、佣金扣除、撥款帳號）。
- 同時在線超過 50 人或導入廣告流量前：F-091、F-015、F-092。
- 封測第一週：F-070 個資請求處理 runbook；接手事項 T6（PWA 推播測試偶發失敗、三個後台首次進入無骨架畫面、通知小問題）。
- L0 可繞過但封測前沒做的項目，依分數在封測期間補（優先 F-041、F-112、F-078、F-019、F-088、F-141）。

L1 合計 39.05～66.05 人日（另 1 項未估）。

### 3.3 封測前若有空檔：L0 可繞過的高分項

分數高、成本低，做了能大幅減少創辦人的人工負擔（`23-remediation-backlog.md` §3.4 建議）：F-041（只允許台幣，0.5）、F-112（LINE 綁定頁錯誤顯示，0.5）、F-078（錯誤頁「重試」真的重抓資料，0.5）、F-019（常青場設定走查，0.5）、F-077（3 個錯誤頁的重新載入按鈕，0.1）。全部 22 項與繞過方式見該檔 §3.4。

### 3.4 封測後：L2 與 L3 方向

| 層 | 方向 | 代表項目 | 人日合計 |
|---|---|---|---|
| L2 公開上線前（65 段） | **資料完整性**：帳務表加檢查約束與唯一鍵、財務資料改成刪商家時不連帶刪除、大金額欄位改 BIGINT（F-062、F-059、F-066、F-068）；**安全強化**：CSP 正式啟用、加密金鑰改可輪替的 keyring、ops 端點建置時排除、session 強化（F-156、F-031②③、F-016②③、F-036）；**效能**：聊天與互動輪詢合併、公開漏斗頁快取（F-091(2)、F-015）；**CI 與供應鏈**：CI 拆平行、`.gitattributes`、workflow 權限（F-137、F-171、F-148）；**文件封存**：91.5% 的收據搬到 `reports/archive/2026/`（F-164、F-165） | 見 `23-remediation-backlog.md` §5 | **53.8～75.3** |
| L3 之後／重構（21 段） | **結構重構**（E-02 選項一）：`actions.ts` 拆分（F-005）、結帳 route 抽服務（F-010）、付款通知抽具名 reconciler（F-009）、付款 adapter 契約（F-008）、`src/lib` 分層規則（F-006）、測試設定合併（F-138） | 見同檔 §6 | **43.15～59.65** |

另：E-02 若選 strangler，課程／portal 重寫【推估】15～25 人日另計。

---

## 4. 封測環境與營運準備

### 4.1 環境：staging 直接給客戶用

- **建議：封測跑 staging（Vercel 專案 `celebrate-deal-staging`，Supabase Tokyo），付款走 PayUni Sandbox，不碰 Production。** Production 從未做過備份還原、狀態「未評定」（F-058、`14-data-migration.md`），而且 Production 部署與正式付款都需要 owner 另外授權（AGENTS.md）。
- 前提（封測前完成）：
  - staging 的 GitHub environment 只允許 master 部署；Production 環境加 reviewer（T7、F-152、D-08）。
  - **備份要開在 staging 專案上**，因為封測資料會在那裡（F-058 原本談的是 Production；改跑 staging 後，同樣的要求轉到 staging）。
  - staging 函式區域與資料庫同在東京（F-090；`vercel.staging.json` 是否已設定未驗證）。
  - Vercel Skew Protection：直播進行中或表單填到一半遇到部署時，避免 Server Action 失敗（F-086）。
- **11-01 起 staging 不再是拋棄式環境**：AGENTS.md 允許直接在 staging 做開發驗證的規則，到封測開始就要改為「先通知 owner、先確認備份」（`03-connector-playbook.md` §0.5）。
- 給客戶的網址：沿用 staging 網址或另設網域，屬 owner 決定（未列入既有報告，D-24 一併處理）。

### 4.2 合成資料清理與客戶資料隔離

- 10-30 前列出 staging 內的合成商家、合成訂單與 Cloudflare Stream 合成影片（只列清單，不刪）。刪除只針對明確標記為合成的資料、先備份、經 owner 同意，由 engineer 用腳本執行並留收據。
- 封測客戶一律用**新建的商家帳號**；合成商家保留在各自租戶內，不影響封測客戶畫面。
- 隔離：目前租戶隔離 100% 靠應用程式層（F-026）；B1 確認資料庫層沒有外漏缺口。CRM 與行動諮詢的租戶測試是假測試（F-133），封測期間補。
- 客戶姓名、Email、電話、截圖、訂單內容**一律不進** repo、Issue、PR、`docs/`、`reports/`（repo 是公開的）。

### 4.3 告警接收與問題回報

- **Sentry 告警**：先完成 C6（個資過濾）再對外；在 Sentry 後台設定告警規則，接收人為 owner 的 Email（或 owner 指定的管道）；建議連線 Sentry MCP 供主對話唯讀查 issue 摘要（`03-connector-playbook.md` §6，需 owner OAuth）。
- **排程與背景工作**：F-141（job 失敗不會送 Sentry）若封測前沒修，創辦人每天檢查寄送紀錄頁與排程執行紀錄。
- **問題回報管道**（`02-agent-gaps.md` §4）：客戶透過 LINE 或 Email 回報給 owner → owner 以匿名代號（客戶A、客戶B）登記、原始內容留在私人處 → 主對話每天兩次建立**去識別化** GitHub Issue（標籤 `beta`、`sev:S0..S3`）→ 依嚴重度派工 → 修好後 owner 回覆客戶。
- **嚴重度目標**：S0（疑似跨租戶外洩、金額錯誤、secret 外洩）當天止血並單獨通知 owner；S1（無法登入、無法發布直播、無法結帳、通知未送達）24 小時內；S2 三天內；S3 每週一批。

### 4.4 封測付款走 Sandbox 的限制

- **Sandbox 不會真的收錢**：買家必須輸入 PayUni 的測試卡號才能完成付款。所以封測客戶若對真實觀眾辦活動，**真實觀眾無法在系統內真正付款**；可行做法是 (a) 結帳流程只由商家與創辦人自己演練，真實收款仍用商家原本的方式；或 (b) owner 另行授權上 Production＋PayUni 正式商店，這會把 F-058、F-064、F-061、F-152 等 Production 相關項目全部升為封測前必修。建議 (a)（D-01）。
- Sandbox 下 F-037 的錯誤不會造成真實金錢損失，但仍會開通不該開的內容、算出錯的佣金，所以照樣封測前修。
- PayUni 綁卡（Funnel 發布）需要 Sandbox 商店開通信用卡約定 Token（T1）；沒開通就隱藏 Funnel 綁卡。
- Sandbox 不會碰到 PayUni 的 30 天交易額度上限（個人 20 萬、企業 100 萬），但正式上線前要評估（市場報告金流段）。

### 4.5 LINE

- **10-27 前決定方案**：11-01 調價；10-27 之後仍用中／高用量視為同意新價；10-28～11-02 系統維護，避免在這段期間異動方案（市場報告 LINE 段）。
- 建議封測商家**用自己的 LINE 官方帳號**推播，平台不代付；在綁定頁顯示當月則數與額度（市場報告「LINE 推播必須走商家自己的官方帳號」）。
- 綁定由創辦人陪同完成（F-112 的繞過方式）。

### 4.6 訪談

- 封測前探索訪談與封測後回顧訪談腳本：`docs/market-2026Q4/research_notes/台灣直播導購 SaaS 市場研究 2026/c09_icp_jtbd_gtm_interviews.md` 附錄 B（腳本 1、腳本 2）；精簡版也在市場報告「封測前探索訪談腳本」「封測後回顧訪談腳本」兩節。
- 原則：先取得錄音同意；不索取密碼、金流後台截圖、客戶個資；每個人物誌至少 5 位再下結論。
- 註：回顧腳本第 11 題（「官方腳本」「預錄重播」標示的觀眾反應）是依市場報告的標示版設計；owner 改選不標示版後，建議改問「虛擬使用者的發言有沒有讓你或觀眾感到困擾」。

### 4.7 封測成功指標

| 指標 | 目標（建議） | 資料來源 |
|---|---|---|
| 每位客戶完成至少 1 場直播或預錄場 | 100% | 後台場次紀錄 |
| 首場有非親友出席 | ≥ 50% 的客戶 | 報名與入場紀錄（只算真實觀眾） |
| 每位客戶完成至少 1 筆 Sandbox 訂單，且對帳正確 | 100% | 訂單與付款交易紀錄；10-30 演練的對帳結果 |
| 通知送達率（報名成功信、開播提醒、LINE） | ≥ 95%，失敗皆有紀錄 | 寄送紀錄；LINE API 回應 |
| onboarding 到首場活動的天數 | 記錄中位數（基準值） | 創辦人紀錄 |
| S0 事件 | 0 | Issue 標籤 |
| 回顧訪談完成率 | 100% | 訪談紀錄 |
| 付費意願（回顧腳本第 8 題的四個價位）與是否願意預付或簽意向書 | 記錄分布 | 訪談紀錄（行為證據優先於口頭） |

前四項對應市場報告建議的「首次成功四階」：第一筆報名 → 首場有非親友出席 → 首筆付費訂單且對帳正確 → LINE 提醒成功送達並被點開。

---

## 5. 治理與工具

| # | 項目 | 建議 | 來源 | 需 owner |
|---|---|---|---|---|
| 5.1 | **reviewer 寫檔權限** | 採選項 C：reviewer 加 `Write`，用 hook 限制只能新增 `docs/review-*/**` 與 `reports/**` 的檔案，Bash 擋 git 寫入；**先用拋棄式 agent 實測子代理 frontmatter 的 hook 是否生效**，不生效就退回「只回報文字＋主對話代寫」，並在每次 reviewer 回合後檢查 `git status` | `01-skill-inventory.md` §2.3 | 是（持久設定） |
| 5.2 | **7 個 skill 草稿** | **主對話已決定：採用**。以 PR 從 `docs/skills-2026Q4/drafts/` 搬進 `.claude/skills/`，**SKILL.md 保留完整檢查清單，不縮短成一句連結**。另加 `celebratedeal-review-checklists`（`02-agent-gaps.md` §1.3）。注意：`tw-compliance` 措辭需律師看過、條號不當定案；`payuni-sandbox` 的 `TradeStatus` 代碼表需由有 Sandbox 後台權限的人核對；B05／B03 修好後，相關清單改寫成「回歸檢查」 | `04-skill-drafts-index.md` §1、§4 | 否（`CLAUDE.md` 領域技能說明若要改則需 owner） |
| 5.3 | **Goal 狀態** | 改用 `docs/goal-<slug>/STATE.md`（本次為 `docs/goal-beta-prep-2026Q4/STATE.md`），只有主對話編輯；封測 bug 用去識別化 GitHub Issues；不用 GitHub Projects；舊的 `.ai-team/state/goal-state.json`、`docs/codex-goal/*` 狀態不沿用；`DOCUMENT_AUTHORITY.md` 加一行指向新 `STATE.md` | `02-agent-gaps.md` §2 | 否 |
| 5.4 | **Supabase connector 唯讀白名單** | 已連線且含寫入工具。只允許 `get_project`、`get_advisors`、`list_tables`、`list_extensions`、`list_migrations`、`search_docs`，以及只查中繼資料的 `execute_sql`；`query_logs` 只在 S0／S1 看錯誤層級。**`apply_migration` 永久禁止**（繞過 Prisma 歷史）；任何寫入 SQL、分支、建立／暫停專案都禁止；Production 專案任何呼叫（含唯讀）先經 owner 指定 | `03-connector-playbook.md` §3 | 是（指認 staging 專案） |
| 5.5 | **Vercel MCP 403** | deployments 與 runtime errors 對 staging 回 403，需 owner 在 claude.ai connector 設定重新授權 team `a25814740s-projects`；在那之前用本機 `vercel` CLI 唯讀檢查（永遠帶 `--scope` 與專案名稱），不讀環境變數的值 | `03-connector-playbook.md` §2.4 | 是 |
| 5.6 | 專案層 `.claude/settings.json` deny 清單 | 把「不讀 `.env*`、不碰 Production」從 prompt 約定變成機制 | `01-skill-inventory.md` §4.2 | 是（持久設定） |
| 5.7 | PR template 與合併方式 | 新增 PR template（類別、檔案範圍、驗證、審查證據）；repo 只允許 squash、合併後刪分支 | `02-agent-gaps.md` §3.3、§5 | 是（repo 設定） |
| 5.8 | 內建審查 skill 的分級 | reviewer 是高風險 PR 必經；`security-review` 用於 auth／租戶／付款／webhook／RLS；`code-review high` 用於大 diff；`code-review ultra` 只在 10-29 RC 用一次；`--comment` 預設不用（公開 repo 等於以 owner 帳號發佈） | `02-agent-gaps.md` §3.2 | `ultra` 額度需 owner 同意 |
| 5.9 | Sentry MCP | 建議封測前連線，只讀 issue 摘要，不把事件內容貼進 repo | `03-connector-playbook.md` §6 | 是（OAuth） |

---

## 6. 已知缺口與未驗證項目

以下彙整各報告「未覆蓋／未驗證」段。這些都**不能**被當成「已通過」。

### 6.1 沒有實際執行或量測

- 沒有執行 `next build`：First Load JS、bundle 大小、路由靜態／動態標記、streaming 實際 HTTP 狀態都沒量到（11、15、16、20）。
- 沒有瀏覽器實測：英文 404（F-079）、UTC 時間顯示（F-110）、重複 Slug 整頁錯誤（F-107）、LINE 內建瀏覽器付款回跳（F-130）、焦點樣式的實際視覺都是讀程式碼推論（17 §10）。
- 沒有負載測試與資料庫查詢計畫：每位觀眾每分鐘約 53 次請求、185 條 SQL 是讀碼計數；300 人場次撐不撐得住未驗證（16 §1、F-091）。
- 沒有執行完整 Vitest、E2E、覆蓋率或 DB 測試；兩個已知 flaky 的根因全是假說（18 §8）。
- 本機 `npm run typecheck` 因 Prisma Client 過期而失敗（F-174），派工前要先 `db:generate`。

### 6.2 沒有連到的環境與後台

- Supabase 實際的 RLS 與 `anon`／`authenticated` 權限、`SHOW timezone`（F-026、F-069）。
- `RATE_LIMIT_PROVIDER` 實際值、`JOB_SECRET` 是否各環境不同（F-028、F-016）。
- 正式網域是否經 Cloudflare 代理（F-004、F-017）。
- Vercel 方案、函式區域、環境變數、production branch、Skew Protection（F-090、F-086）。
- Sentry 後台的告警規則、PII 設定、資料保留；`stackFrameVariables` 在 Node 端是否實際啟用（19 §8）。
- repo 外是否已有排程在呼叫 job（F-042）。
- 瀏覽器直播的自架媒體伺服器實際部署（F-095）。
- Cloudflare Stream 是否混有非合成資源（goal plan §9 Q6b，仍 UNVERIFIED）。
- Production 是否存在 Puck 舊格式草稿（F-014）。

### 6.3 外部服務尚未驗證

- PayUni：Sandbox Token 是否開通（T1）；真實回呼樣本（T2）；正式商店開了哪些付款方式；PayUni 是否推送退款／爭議通知（F-067）；`TradeStatus` 代碼表未對照官方文件。
- 通知：#431 的 SMS、WhatsApp、Web Push 沒用真實 provider 測試；LINE 沒有 E2E。

### 6.4 審查沒有涵蓋的程式範圍

- 金流（13）：`checkout-admission.ts`、`commerce-orders.ts` 建單細節、分潤與退款目標演算法、課程分潤數學、平台推薦佣金與課程出款 action、電子發票 adapter、PayUni live probe、support 退款移轉、funnel 結帳服務、所有 `*.db.test.ts`。
- 租戶（12）：`api/form-submissions`、`api/live-interactions`、`api/payments/checkout` 只抽查 ID 綁定段；144 個 `page.tsx` 只 grep 角色 guard；`scripts/` 未審。
- UX（17）：144 頁只深讀約 40 頁；admin、portal、affiliate-portal、lp 編輯器、課程學習頁、品牌設定、追蹤設定未做互動審查。
- 死碼（20）：`~/.codex/worktrees` 的 23 個未登記目錄未檢查；knip 不看動態 import 與字串路徑。

### 6.5 市場研究的缺口

- 台灣直播電商 GMV、賣家數、成長率沒有可靠數字；講師與顧問的人數與行為完全沒有資料。
- 幫賣的價格與虛擬使用者實際行為未公開；多數本地競品官方價格未取得。
- 賣家實付金額與任何通路 CAC 都沒有資料，只能由封測與訪談產出。
- 法規條號、金額、門檻（電子支付許可 10 億 vs 20 億元互相矛盾）多經摘要工具取得，**寫進產品需求或對外揭露前必須由律師或會計師核對**。

### 6.6 本文件自己的限制

- 標【推估】的數字（§2.1 的 strangler 與全新 repo 成本）是本文件的推算，來源報告沒有；AI 代理的實際產能沒有量測，工作線天數不含 reviewer 等待與 owner 決策延遲。
- 封測付款走 Sandbox、封測跑 staging 是本文件的建議前提；owner 若改選正式付款或 Production，§3 的 L0 範圍要重排（見 `DECISIONS-2026Q4.md` D-01）。
