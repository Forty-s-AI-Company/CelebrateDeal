# Webinar 報名頁範本研究：排名與來源

> 2026-10-28 研究，第一階段（只做研究與規格，不寫程式）。
> 同目錄文件：`specs/01～23`（21–23 來自擁有者指定的參考網站，見 §6）（每個範本的規格）、`shared-components.md`（共用新元件與分批）、`qa-standards.md`（不跑版的驗收標準）、`migration-plan.md`（現有範本處置）。

## 0. 原則：只參考結構，不複製

- 商業範本（Leadpages、Unbounce、ClickFunnels、systeme.io、Instapage、Swipe Pages、HubSpot、Kajabi、Webflow 市集等）與各品牌案例**只用來分析區塊順序、版型與轉換設計**。設計、文案、圖片、Logo 與品牌一律不複製。
- 20 個範本都是**原創**：虛構講者、虛構品牌、原創繁中文案，圖片用自製 SVG、漸層或明顯的替換佔位圖。做法和 #497 黑金範本參考 littleboattan.com 一樣。
- 本文件引用來源時只放連結與一句描述，不轉載原文。
- 「排名」排的是**版型原型**，不是某一家公司的頁面：同一個原型會出現在不同品牌、不同工具的範例中，出現次數越多、轉換證據越好，名次越前面。

## 1. 研究方法

1. 收集 2025–2026 年的「best webinar landing page examples／templates」整理文，以及各工具官方的範本頁和說明文件（第 2 節 S1–S19）。
2. 收集繁中與簡中市場的講座／直播報名頁與報名頁 SOP（第 2 節 C1–C7）。
3. 把每份來源中的案例拆成區塊（hero 型態、表單位置、倒數、講者、議程、社會證明、FAQ、固定 CTA），歸納成 20 個重複出現的**原型**。
4. 排名依據，權重由高到低：
   - **出現頻率**：在幾份獨立來源中出現。
   - **轉換證據**：來源中公開的報名轉換率，主要是 S1 Perspective 逐頁列出的 11%–53%。
   - **在地適用性**：在繁中市場的講座頁也找得到（C1–C4），或很適合 CelebrateDeal 的知識型講者、直播銷講客群。
5. 轉換率基準（只用來設驗收預期，不做行銷承諾）：
   - 各家常引用的報名頁轉換率約 20%–45%（S17 ClickMeeting、[Learnybox](https://learnybox.com/en/blog/webinar-conversion-rate/)）。
   - 報名到出席率約 50%–57%（[ON24 2025 Benchmarks 摘要](https://www.on24.com/de/blog/key-takeaways-from-the-2025-webinar-benchmarks-report/)）。
   - 這些數字多半來自廠商自家資料，可信度有限。

### 1.1 研究限制（如實記錄）

- 沒有找到獨立第三方「依轉換率排名範本」的研究。各整理文都是廠商內容行銷，所以排名是本研究的綜合判斷。
- Teachable 中文課程頁、Hahow／PressPlay／大人學的免費講座頁，搜尋引擎找不到可直接引用的公開頁面。繁中部分改用 CMoney 理財寶線上體驗課、104 talks、訊連科技 webinar eDM、Accupass 線上活動頁，以及 CMoney 公開的報名頁 SOP。
- systeme.io、ClickFunnels、Kajabi、Instapage 的範本庫要登入才能完整瀏覽。本研究只引用公開的說明文件與市集頁，沒有進入後台。
- 部分搜尋結果是轉貼或灌關鍵字的頁面（例如大學網域上的 “webinar landing page template” 頁），已排除不用。

## 2. 來源清單

### 2.1 英文整理文、工具範本與官方文件

| 代號 | 來源 | 一句描述 |
|---|---|---|
| S1 | [Perspective — 23 Best Webinar Landing Page Examples (2026)](https://www.perspective.co/article/webinar-landing-page-example) | 23 個真實報名頁，逐頁列出轉換率（11%–53%）與結構特徵，是本研究最主要的轉換證據 |
| S2 | [Univid — Best Webinar Landing Page Examples（2026-04 更新）](https://univid.io/blog/best-webinar-landing-page-examples-registration/) | HubSpot、Canva、Slack、Lyyti、Intercom 等 7 例，強調講者置頂、對象明確、header CTA |
| S3 | [Leadpages — Webinar Landing Page Examples（2025）](https://leadpages.com/blog/webinar-landing-page-examples) | 9 個創作者型報名頁，含講者照片 hero、頂部倒數、影片介紹與錯過場次頁 |
| S4 | [Landingi — 31 Webinar Landing Pages（2025-09）](https://landingi.com/blog/webinar-landing-pages/) | 31 個品牌頁與對應範本，涵蓋雙色分割、表單位置、倒數、短表單的優缺點 |
| S5 | [Moosend — Webinar Landing Pages（2025-04）](https://moosend.com/blog/webinar-landing-pages) | 10 例＋4 種範本型態（主講者型、名單型、極簡型、影片型） |
| S6 | [GemPages — 25 Webinar Landing Page Examples（2025-08）](https://gempages.net/blogs/shopify/webinar-landing-page-examples) | 25 個品牌頁，含固定報名鈕、多時區場次表、剩餘席次表、上下重複 CTA |
| S7 | [HubSpot Blog — Webinar Landing Page](https://blog.hubspot.com/marketing/webinar-landing-page) | HubSpot 的報名頁最佳實務與範例，強調簡短標題與極短表單 |
| S8 | [Unbounce — Webinar Landing Page Templates](https://unbounce.com/landing-page-templates/webinar) | Unbounce 官方 webinar 範本分類，以教學型 hero＋表單為主 |
| S9 | [Swipe Pages — Webinar funnel templates](https://swipepages.com/funnel-templates/webinar/negotiation-strategies-webinar/negotiation-strategies-webinar/)／[Webinar builder](https://swipepages.com/create/webinar-landing-page) | Masterclass 報名頁、AI 生成線上峰會頁的公開預覽 |
| S10 | [systeme.io — Automated webinars](https://systeme.io/automated-webinars)／[說明文件](https://help.systeme.io/article/265-how-to-create-automated-webinars) | 自動化 webinar：選場次後報名，預設三頁漏斗（報名、感謝、播放） |
| S11 | [ClickFunnels — Live webinar funnel](https://support.myclickfunnels.com/docs/how-to-create-live-webinar-funnel.md) | 報名頁、倒數頁、直播間的多頁 webinar 漏斗結構 |
| S12 | [Kajabi Templates — Webinar funnel](https://templates.kajabi.com/products/flix-webinar-funnel) | 創作者 webinar 範本市集：報名、確認、觀看、回放成套 |
| S13 | [Webflow — Webinar website templates](https://webflow.com/list/webinar)／[BRIX Webinar X](https://brixtemplates.com/templates/webinar-webflow-template) | 活動／webinar 網站範本，多頁、多 hero 變化 |
| S14 | [Demio — 自訂報名頁](https://help.demio.com/en/articles/2303544-customize-the-registration-page)／[Livestorm — Webinar landing pages](https://livestorm.co/blog/webinar-landing-pages) | webinar 平台內建的報名頁：Logo、封面、影片區塊、自訂欄位 |
| S15 | [Zoom — Event landing pages that boost registrations](https://www.zoom.com/en/blog/how-to-design-event-landing-pages-that-boost-registrations/) | Zoom Events 建議的元素：報名表、詳細議程、講者介紹、分享鈕 |
| S16 | [Maven — How the best instructors create landing pages](https://maven.com/resources/winning-landing-page) | 課程／cohort 頁的區塊順序：首屏價值、適合對象、成果、講師、評價、大綱、時程、FAQ |
| S17 | [ClickMeeting — Webinar landing page](https://blog.clickmeeting.com/webinar-landing-page) | 痛點標題、轉換率基準（廠商宣稱） |
| S18 | [EasyWebinar — Examples that convert（2025-06）](https://easywebinar.com/blog/webinar-landing-page-examples-that-convert/) | 2025 年 webinar 報名頁的轉換元素整理 |
| S19 | [Growform — Webinar landing page examples](https://www.growform.co/landing-page-examples/webinar/) | 報名頁設計靈感集，偏重標題與表單 |

### 2.2 繁中與簡中市場

| 代號 | 來源 | 一句描述 |
|---|---|---|
| C1 | [CMoney 理財寶 — 線上體驗課頁](https://www.cmoney.tw/app/classesdetail.aspx?id=3187) | 台灣理財講師的免費線上體驗課，含「原價／優惠價 NT$0」錨定、上課時間、加入行事曆、報名截止 |
| C2 | [CMoney — 課程報名頁 SOP 筆記](https://www.cmoney.tw/notes/note-detail.aspx?nid=53888) | 繁中報名頁的區塊順序：講師照首圖、引言、價格與贈品、講師經歷、適合對象、大綱、過往照片、最後再重複一次時間 |
| C3 | [104 talks — 線上免費直播](https://blog.104.com.tw/ducational-training-strategies-in-turbulent-times/) | 雙講者講題、活動資訊框（時間、截止、形式、原價改免費）、資訊框下方放報名鈕 |
| C4 | [訊連科技 — PhotoDirector 線上講座 eDM](https://cyberlink.com/stat/edms/cht/2023/Q2/04_PHD_Webinar/eDM.html) | 三步驟報名流程、前一天寄連結、直播問卷抽獎誘因 |
| C5 | [Accupass — 線上活動頁範例](https://www.accupass.com/event/2207250317119135901370) | 台灣主流活動平台的線上活動頁：活動形式、時間、購票後在票券頁取得直播連結 |
| C6 | [人人都是產品經理 — 試聽課轉正式課直播設計](https://www.woshipm.com/operate/4293229.html) | 簡中知識付費：公開課到正式課的轉換設計、課前預熱 |
| C7 | [人人都是產品經理 — 小鵝通產品拆解](https://www.woshipm.com/pd/5763328.html) | 簡中知識付費平台頁面搭建：直播元件、優惠券、限時折扣等轉換工具 |

## 3. 排名前 20 的版型原型

「來源」欄是看得到這個原型的來源代號；轉換率只引用 S1 公開的數字。每個原型都對應一份 `specs/NN-*.md`。

| 名次 | 原型 | 出現來源 | 代表案例與證據 | 入選理由 | 規格（虛構主題） |
|---|---|---|---|---|---|
| 1 | **極簡單欄、表單緊接標題** | S1、S3、S4、S5、S6、S7 | S1 Teachly 53%、Beauty Literacy 40%、AI Arbitrage 40%；S3 模特兒講座 58%；S6 Uber Merchants、Notion | 公開轉換率最高的一群。熟客流量最適合；行動版第一屏就看得到表單 | [01 AI 工具](specs/01-ai-minimal.md) |
| 2 | **雙欄 hero：左文案、右表單卡** | S1、S4、S5、S6、S8、S9、S14 | S4 Salesforce、Hootsuite、LinkedIn；S6 Amazon Business、Coursera、Sprout Social | 出現次數最多的 B2B 版型。桌機首屏同時講價值又收表單 | [02 SaaS 產品 demo](specs/02-saas-split.md) |
| 3 | **標準講座長頁：你將學到＋講者＋議程時間軸** | S2、S5、S6、S15、S16、C2、C3、C6 | S5 Sitecore、Salesforce；S15 Zoom 建議議程與講者；S16 Maven 區塊順序；C2 CMoney SOP | 中英文市場都通用的完整骨架，也是其他原型的基礎 | [03 設計工作坊](specs/03-design-workshop.md) |
| 4 | **講者主視覺 hero（人像主導）** | S1、S2、S3、S5、S9、S16、C2 | S1 Chizi D 42%、Lifespan Edge 44%；S3 講者笑臉照；C2「首圖一定放講師本人」 | 知識型網紅、個人品牌講者的主流；繁中市場特別常見 | [04 理財](specs/04-finance-host.md) |
| 5 | **倒數主導：下一場倒數＋表單** | S1、S3、S4、S6、S11、S14、C1 | S1 FD First Deal 21%、Sandra Coan 26%；S4 Pipedrive；S6 Google；C1 報名截止倒數 | 有真實開場時間時，倒數是最常見的急迫感來源 | [05 房地產](specs/05-realestate-countdown.md) |
| 6 | **長篇銷講信：故事＋多段 CTA＋固定報名列** | S4、S6、S11、S12、C2 | S6 HubSpot 多段 CTA、CFA Institute 固定報名鈕、GM 上下重複 CTA；C2 頁尾重複時間 | 冷流量與高單價銷講的主力。行動版需要固定報名列 | [06 旅遊](specs/06-travel-story.md) |
| 7 | **影片預告 hero** | S3、S4、S5、S6、S14、S15 | S4 HubSpot 影片背景、DMI 預告片；S5 影片型範本；S14 Demio 影片區塊 | 講者有鏡頭魅力或示範性強的主題，用影片取代長文案 | [07 健身](specs/07-fitness-video.md) |
| 8 | **多講者線上峰會** | S2、S6、S9、S13、S15、C3 | S2 Lyyti Future of Events；S6 Shopify 三段式；S9 AI 線上峰會範例；C3 104 talks 雙講題 | 多講者、多場次活動需要講者牆和議程表 | [08 行銷峰會](specs/08-marketing-summit.md) |
| 9 | **價值錨定體驗課：原價／免費、贈品清單** | C1、C3、C4、S4、S5、S12 | C1「原價 NT$8,888、優惠價 NT$0」；C3「原價 NT$3,600 免費」；C4 問卷抽獎；S4 Adobe 強調免費 | 繁中市場特別常見；直播銷講常用的價值堆疊 | [09 職涯](specs/09-career-value.md) |
| 10 | **系列講座／多場次學習路徑** | S2、S3、S5、S6、S10 | S6 LinkedIn 學習路徑與剩餘席次表、Microsoft Azure 多時區場次；S3 兩個開場時間；S10 選場次 | 系列課、每週固定場次的講者需要 | [10 語言學習](specs/10-language-series.md) |
| 11 | **痛點問句開場：問題→解方** | S1、S4、S5、S6、S17 | S1 Howard Kaye 痛點開場、ACE 自我篩選問句；S4 OptinMonster、SEJ；S6 Cisco | 身心、保險、轉職等需要先建立共鳴的主題 | [11 心理療癒](specs/11-healing-question.md) |
| 12 | **隨選／回放狀態型（evergreen）** | S2、S3、S5、S10、S11、S14 | S2／S5 Slack on-demand；S3「錯過了」頁；S10 自動化 webinar；S14 Demio 回放頁 | 讓同一頁在開場前、直播中、回放期都可用，延長名單收集 | [12 永續](specs/12-sustainability-ondemand.md) |
| 13 | **數據導向標題** | S1、S4、S5 | S4 WordStream 數字標題、Sprout 統計開場；S5 Calm 統計；S1 單一數字 hero 14%、A Better Life 收入目標 | 電商、行銷等以成果數字說服的主題 | [13 電商](specs/13-ecommerce-data.md) |
| 14 | **對象篩選＋FAQ 主導** | S1、S2、S7、S16 | S16 Maven 至少兩個對象條件＋FAQ 處理疑慮；S1 Sandra Coan 標題寫對象；S2 Lyyti 點名職業 | 家長、初學者等「適不適合我」是主要疑慮的族群 | [14 親子](specs/14-parenting-fit.md) |
| 15 | **機構認證：Logo 牆＋師資＋認證** | S1、S5、S6、S14 | S1 ACE Coaching 認證與師資、LeadFi Logo；S6 CFA Institute、Coursera 師資；S5 極簡型底部 Logo | 證照、學院、協會型主辦方 | [15 寵物](specs/15-pet-academy.md) |
| 16 | **雙講者對談** | S1、C3 | S1 Neel Dhingra × Gary Vaynerchuk 37%、Lifespan Edge 共同創辦人 44%；C3 雙講者講題 | 對談、跨界合作講座；標題同時放兩人姓名 | [16 領導力](specs/16-leadership-duo.md) |
| 17 | **作品集證明** | S1、S3、S16 | S1 Sandra Coan 攝影工作坊；S3 演員學生作品、學員評價；S16 用學員作品取代圖庫照 | 攝影、設計、手作等成果看得見的主題 | [17 攝影](specs/17-photo-portfolio.md) |
| 18 | **技術／開發者型** | S4、S6、S13 | S4 Linux Foundation、Intel 技能條列；S6 Microsoft Azure；S13 深色科技範本 | 工程師受眾偏好資訊密度高、深色、等寬字 | [18 程式](specs/18-dev-tech.md) |
| 19 | **插畫手作風** | S2、S4、S6 | S4 BigCommerce 插畫、Sprout 插畫標題；S6 Canva 留白；S2 自製圖形 | 生活風格、手作、興趣型講座；沒有專業照片的講者也能做得漂亮 | [19 烘焙](specs/19-baking-craft.md) |
| 20 | **專業顧問合規型：資訊側欄＋合規頁尾** | S1、S7 | S1 Arcwood、Dennis Tax、Greater Washington（日曆側欄＋合規文字）；S7 Gartner 聯絡資訊 | 醫療、金融等受廣告法規約束的產業；台灣醫美有醫療廣告規範 | [20 醫美](specs/20-aesthetic-clinic.md) |

## 4. 跨來源共同結論（套用到全部 20 個範本）

1. **表單短**：姓名＋Email（必要時加手機）；資格題放感謝頁（S1、S4、S7、S17）。CelebrateDeal 的報名表單沿用平台的 opt-in 表單與同意勾選，不另做收集流程。
2. **日期、時間、時長、形式要在首屏看得到**（S2、S4、S6、C3）。範本中這些資訊**要綁定漏斗 webinar 設定**（`FunnelWebinarSettings.startsAt／endsAt／timezone`），不要寫死在文字裡。
3. **CTA 至少出現三次**：首屏、中段、頁尾。行動版加固定報名列（S6 CFA、GM，C2）。
4. **急迫感只能用真實資料**：倒數綁開場時間；席次只在有真實容量資料時顯示。目前 schema 沒有容量欄位，所以範本**不得寫死「剩 N 席」**（見 `shared-components.md` C-15）。
5. **講者可信度**：照片、職稱、具體成果；繁中市場習慣放在首屏（C2）。
6. **社會證明**：評價要寫姓名與身分（S16）。範本中的評價一律標示「範本示意」，商家套用後必須替換（沿用 #497 做法）。
7. **導覽列最少化**：報名頁通常不放完整選單，最多一個錨點連結到報名表（S7 第三方整理）。
8. **感謝頁**：加入行事曆＋下一步（C4、S12），列在 migration-plan 的功能頁重設計。

## 5. 與 CelebrateDeal 現況的差距（摘要）

- 現有 webinar 報名範本（`webinar-registration` 等 4 個）用的都是同一套 section、columns、form 組法，缺少講者卡、議程時間軸、活動資訊列、行動版固定 CTA、倒數變化型。視覺上只有換色，版型沒有差異。
- #497 的展示元件（nav_bar、logo_strip、stats、icon_list、shape_divider、section_title、image_cards、testimonial_wall、content_cards、video_gallery）已經達到品質基準，20 個範本會盡量重用。
- 詳細的缺口與新元件見 `shared-components.md`。

## 6. 擁有者指定的參考網站（規格 21–23）

這 3 個網站由擁有者在 2026-10-28 指定，不在 §3 的排名內，各自成為一個原創範本。

處理原則和其他範本相同：

- 只參考區塊結構與轉換設計，不複製文案、圖片、配色、品牌。
- 主題換成不同的虛構領域。
- 原本是多頁的網站，內容整併成單一頁面。

| 代號 | 來源 | 一句描述 | 改成的範本 |
|---|---|---|---|
| R1 | [flyingeagle-ai.com/lp](https://flyingeagle-ai.com/lp) | 多日線上課加贈實體課的招生頁：文字首屏＋數據背書、逐日課綱、歷屆花絮、評分摘要、三步驟報名＋資格題表單 | [21 Podcast 五日線上營](specs/21-podcast-bootcamp.md) |
| R2 | [xway.com.tw](https://xway.com.tw/) | 行銷顧問公司的多頁官網：成就亮點、案例、服務卡、歷屆高峰會、成效數據、客戶牆、預算與服務類型諮詢表單 | [22 餐飲品牌顧問說明會](specs/22-restaurant-consulting.md) |
| R3 | [appedu.com.tw 短影音活動頁](https://www.appedu.com.tw/Event/short-video-maker/) | 電腦教育機構的課程活動頁：錨點導覽、問題數據、報名好禮、師資作品、課程模組、限時報名、短表單 | [23 Excel 自動化短期班](specs/23-excel-shortcourse.md) |

- 網址已移除廣告追蹤參數（`utm_*`、`gclid`、`gbraid` 等）。
- 3 個參考頁都沒有倒數計時器。倒數是常見的 Facebook 銷售頁做法，23 號範本加入了綁定報名截止的真實倒數（`shared-components.md` §3.1）。
- 參考頁的配色與字型無法從文字擷取判斷。21–23 的配色是原創，不要以「和參考頁相似」作為驗收標準。
