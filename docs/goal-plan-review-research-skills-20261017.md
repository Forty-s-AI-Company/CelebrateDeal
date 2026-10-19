# Goal Plan：全站 Code Review、市場調查重做與 Skill 能力盤點

PLAN_STATUS：COMPLETE_PENDING_OWNER_DECISIONS（2026-10-19 Phase A～E 全部完成；等 owner 回覆 `docs/DECISIONS-2026Q4.md`）
PLANNED_AT：2026-10-17（Asia/Taipei）
DECISIONS_RECORDED_AT：2026-10-17（§9）
PLAN_OWNER：Eden（產品 owner）／主代理 Claude（整合、ownership、最終判斷）
WORKFLOW_MODE：PRELAUNCH_DEV_AUTONOMOUS
GOAL_TYPE：READ_MOSTLY（只產出文件、findings、決策與 skill 草稿；不改產品程式碼）
TRIGGER：等目前正在寫程式的 Session 告一段落後啟動（啟動條件見 §2）

> 這份文件是計畫書，不是任何驗收證據。所有「現況」描述只代表 2026-10-17 讀到的檔案狀態；啟動時必須重新凍結基線。

---

## 0. 為什麼要做這個 Goal

1. 現有程式碼主要由 ChatGPT + Codex 在 2026-07 到 2026-10 之間產出。歷史 Goal 大多以「Work Package 驗收」為單位，沒有人站在整站高度看過一次架構、安全、資料與測試的一致性。
2. 唯一的市場調查是 `docs/bombmy_analysis/`（2026-07-08），只拆解了一家競品（幫賣 Bombmy）的後台截圖，沒有市場規模、定價、法規、通路、目標客群訪談，也沒有 2026 下半年的 AI 直播／短影音趨勢。`DOCUMENT_AUTHORITY.md` 也明確標示它「不可當成目前通過證據」。
3. AI Team（`.ai-team/`、`.agents/skills/*`、`.codex/agents/*`）是為 Codex Desktop 設計的；現在主力已交接給 Claude Code，需要重新評估哪些 skill 要保留、改寫、新建或淘汰。
4. 擁有者擔心「想得太少」。因此本計畫刻意把範圍拉寬，再由 owner 砍，而不是一開始就只做三件事。

---

## 1. Goal 定義

### 1.1 目標（Definition of Done）

| # | 目標 | 完成條件 |
|---|---|---|
| G1 | 全站 Code Review | 產出 `docs/review-2026Q4/` 下的 findings register（BLOCKER／MAJOR／MINOR／NIT）、架構債地圖、模組風險熱度表、修復 backlog（已排序、已估工）。每個 BLOCKER／MAJOR 都有可重現的檔案／行號或測試證據。 |
| G2 | 市場調查重做 | 產出 `docs/market-2026Q4/` 下的市場研究報告、競品矩陣、定價假設、法規清單、ICP／JTBD 假設、以及「功能 Keep／Kill／Add／Defer」決策表。每個論點附來源 URL 與日期，且來源日期不早於 2026-01-01（法規原文除外）。 |
| G3 | Skill／工具能力盤點 | 產出 skill inventory（現有、缺口、淘汰）、新 skill 的 SKILL.md 草稿與觸發條件、MCP／connector 使用方針、以及「如何用這些 skill 完成 G1／G2 的後續修復」的執行手冊。 |
| G4 | 整合決策 | 一份 `ROADMAP-v2.md`：重新定義 MVP 範圍、重構 vs 重寫的建議（含證據）、下一個開發 Goal 的 Work Package 清單、以及需要 owner 拍板的決策清單。 |

### 1.2 非目標（本 Goal 不做）

- 不修改產品程式碼、不修 bug、不加功能。發現的問題只進 findings register。
- 不執行 Production、正式資料庫、正式付款／退款、正式寄信、破壞性 migration。
- 不讀取或輸出 `.env*`、Token、Cookie、私鑰、正式客戶資料。
- 不刪除任何分支、worktree、tag 或歷史 evidence 文件；只建議歸檔方案。
- 不複製競品品牌、文案、素材或受保護內容；只研究可概括的互動模式與商業模式。
- 不做需要真人的客戶訪談（列為 owner 任務，計畫提供訪談腳本）。

### 1.3 現況快照（2026-10-17 讀到的事實，啟動時需重新確認）

| 項目 | 觀察值 |
|---|---|
| 專案根目錄 | `C:\Users\eden\Downloads\AI\CelebrateDeal` |
| 目前分支 | `codex/claude-handoff-20261017`，HEAD `fb3f92b8`，已 merge `origin/master`（`de991b2b`，#424） |
| 其他 worktree | 12 個（`.codex/worktrees/*`、`Documents/Codex/*`、`Downloads/AI/CelebrateDeal-*`），有 3 個是 20261017 當天新建 |
| 技術棧 | Next.js 16.3.8、React 19.2.4、Prisma 6.19、Zod 4、Tailwind 4、Sentry 10、Vitest 4、Playwright 1.61 |
| 程式規模 | `src/` 1,461 個 ts/tsx；`src/lib/` 623 個檔案；116 個 `route.ts`；`prisma/schema.prisma` 3,999 行 |
| 測試設定 | 20 個 `vitest.*.config.ts`、15 個 `playwright.*.config.ts`、4 個 disposable Prisma config |
| 文件 | `docs/` 下約 300 個 branch-integration／remaining-capabilities JSON 收據；`docs/launch/` 60 個檔案；evidence-index 226 KB |
| 外部服務 | Vercel（staging alias）、Supabase Tokyo、Cloudflare Stream／R2、PayUni Sandbox、LINE OA、Meta CAPI、Sentry |
| 已知未完 | PayUni 綁卡 Token 契約未申請；Stream 非正式帳戶隔離未證實；Funnel 公開頁前置條件；CI flaky（direct-url-guard）；#420 通知四渠道真實送達未測；Codex 最後 Goal `product-audit-goal-plan` 20 WP 完成 14，保存於 `archive/wip/product-audit-goal-plan-20261017` tag |

---

## 2. 啟動條件：怎樣算「告一個段落」

### 2.1 正在寫程式的 Session（2026-10-17 觀測）

- Session「專案路徑確認」（`local_5963f3df-6a7e-4388-b88e-bccadf709a6a`，Opus 5.5／high，透過 Remote Control 啟動），綁定 PR #423 `feat(commerce): post-purchase source credit and checkout recovery (F2)`，分支 `codex/post-purchase-credit-20261017`。18:39 UTC 後閒置；PR 的 CI 全綠但對 master 為 CONFLICTING，尚未 merge。
- 同日另有開啟中的 PR：#424 已 merge；#425 handoff 文件；#426 CI PostgreSQL fallback；#427 migration inventory 測試；#428 **用 Claude Code agents 取代 Codex AI Team**（刪 141 個檔、新增 `.claude/agents/` 四個 agent 與 `.claude/skills/`，直接影響本計畫 Phase D）；#429 tracking MINOR 修正。較舊的 #420 通知四渠道與 #384 tracking 仍開著。
- 兩個較早的唯讀 Session「CelebrateDeal 產品審視報告」（10-11）與「系統複雜度與初心者友善性」（10-14）沒有留下 repo 內文件；啟動時由 A-02 用 session 事件讀回它們的結論作為輸入，不重做。

### 2.2 啟動條件

1. **「專案路徑確認」Session 的 #423 到達可中斷點**：owner 說一聲，或該 Session 回報 checkpoint 已 push。不要求 #423 merge，也不要求解完 conflict。
2. **凍結 review 基線**：以啟動當下的 `origin/master` 打本機 tag `review-baseline-2026Q4`（只打 tag，不 push，不改檔）。G1 對這個 tag 做全站 review；**開啟中的 PR（#423、#420、#384、#426～#429）另以 PR diff 逐一審**（新增 B-11），不等它們 merge。結束前對 `baseline..origin/master` 做 delta review。
3. **dirty inventory 快照**：記錄 12 個 worktree 各自的 branch、HEAD、`git status --porcelain` 行數到 `docs/review-2026Q4/00-baseline.md`。有未提交變更的 worktree 一律視為「他人 ownership」，不碰。
4. **確認 `node_modules` junction 狀態**（2026-10-17 事故：移除 Codex worktree 時清空了主目錄 node_modules）。啟動前先跑 `npm ls --depth=0` 確認可用，不足就 `npm ci`。
5. ~~owner 回答 §9 的前置決策~~ 已於 2026-10-17 全部回答，見 §9。

### 2.4 接手紀錄（2026-10-19）

「專案路徑確認」Session 已自行停止自動推進。它在 10-17 到 10-18 之間把 Codex 的產品稽核 WP 做成 PR 並全部合進 master（#423、#426～#444，含 WP-01、02、03、05、06、07、08、09、12、15 與通知 #431、綁卡修正 #444），staging 已套用全部 migration 並部署 master `78621ca3`。owner 於 10-19 指示由本 Session 接手其餘事項，並啟動本計畫。

**基線**：`review-baseline-2026Q4` = `origin/master@78621ca3`（本機 tag，未 push）。

**接手的未完事項**（併入 E-04 決策清單與 E-03 WP）：

| # | 事項 | 性質 | 處理 |
|---|---|---|---|
| T1 | PayUni Sandbox 商店開通信用卡 Token：staging 綁定平台付款方式時 PayUni 直接拒絕，稽核紀錄為 `payment_method_setup_provider_declined`；專案發布需要已驗證付款方式，封測若用 Funnel 會被擋 | owner 外部 | E-04 第一優先；owner 向 PayUni 申請或查 Sandbox 後台 |
| T2 | PayUni 訂單付款端到端測試需要有人輸入 Sandbox 測試卡號 | owner 操作 | 封測前安排一次；主代理負責開單與後續退款／重複退款檢查 |
| T3 | PR #436（WP-10 後台財務 MFA）：CI 綠，但現已與 master CONFLICTING；原計畫等 T2 後合併 | 工程 | B-11 審查；由 engineer-hard 解衝突後再送 reviewer，合併需 owner 說 OK |
| T4 | 公開政策頁缺營運者法定名稱、統編或負責人、營業地址 | owner 資料 | E-04；封測前補 |
| T5 | 6 個 Codex 舊 worktree 含未追蹤檔案，已有 archive tag 備份，需強制移除 | 清理 | B-10 提案；執行前先拆 node_modules junction（見記憶）；需 owner 同意 |
| T6 | 小改善：PWA 推播測試偶發失敗、三個後台首次進入無骨架畫面、早期審查留下的通知小問題 | 工程 | 進 B-08／B-07 findings，封測後 |
| T7 | staging 的 GitHub environment 是否限制只有 master 可部署 | 設定 | owner 同意後由主代理設定 |

### 2.3 硬性日期：2026-11-01 封測

owner 將於 2026-11-01 找幾位客戶做免費封測。距今 15 天。因此：

- 本 Goal 必須在 3 個工作天內交出 ROADMAP-v2，留 10 天給封測前修復。
- ROADMAP-v2 §3 的 WP 分成兩層：**封測前必須**（會讓客戶卡住或資料出錯的 BLOCKER／MAJOR、onboarding 首次成功路徑、付款閉環、通知送達）與**封測後**（重構、重寫、擴張功能）。
- 「全新 repo 重寫」選項在 E-02 照常評估，但時間上只能是封測後的決策；封測本身一律跑現有程式碼。
- Phase C 的功能 Keep／Kill 決策要額外標一欄「封測時是否對客戶隱藏」，讓不成熟的模組能先關掉而不是修完。owner 已定：虛擬使用者與聯盟行銷封測開放（聯盟佣金只累計不出款）。

---

## 3. Phase A：基線凍結與全站盤點（唯讀，1 個 WP）

目的：先畫地圖再探險。所有後續 WP 都引用這份地圖。

| WP | 內容 | 產出 | 建議執行 |
|---|---|---|---|
| A-01 | 專案地圖：路由樹（`src/app/(app)`、`(viewer)`、`api/*` 116 條）、Server Actions 清單、`src/lib` 模組分群、Prisma model／migration 數量、cron／jobs／webhooks 清單、環境變數名稱清單（只列名稱，不列值）、CI workflow 清單、外部服務依賴圖 | `00-baseline.md`、`01-system-map.md`（含 mermaid 依賴圖） | Sonnet，唯讀；可用 Explore agent 分批 |
| A-02 | 文件地圖：把 `docs/` 300 多個檔案分成 canonical／runbook／historical evidence／research 四類，標出互相矛盾的「現況」敘述（例如 `DOCUMENT_AUTHORITY.md` 指向的 `docs/codex-goal/*` 是否仍存在） | `02-docs-map.md`、歸檔建議（不執行） | Sonnet |
| A-03 | 測試地圖：20 個 vitest config、15 個 playwright config 各自覆蓋什麼、哪些需要 disposable PostgreSQL、哪些需要外部服務、最近一次通過紀錄在哪、已知 flaky 清單 | `03-test-map.md` | Sonnet |
| A-04 | 自動化靜態掃描（全部唯讀、不改檔）：`tsc --noEmit`、`typecheck:strict-index`、`eslint`、`npm audit`、未使用檔案／export 偵測（knip 或 ts-prune，裝在 scratchpad 不進 package.json）、循環依賴（madge）、bundle 分析（`next build` 的 analyze 若可離線執行）、`secret:scan` | `04-static-scan.md` 附原始輸出於 `reports/review-2026Q4/` | Opus 判讀，Sonnet 執行 |

---

## 4. Phase B：全站 Code Review（唯讀，分 10 條審查軸線）

### 4.1 方法

- 三層審查：**自動掃描**（Phase A-04）→ **模組逐一審查**（依系統地圖切 scope，每個 scope 一個 reviewer 任務）→ **橫切主題審查**（下表 B-01～B-10）。
- Reviewer 只輸出 `BLOCKER／MAJOR／MINOR／NIT` findings，不改 code（AGENTS.md 規則）。
- 每條 finding 格式：`ID、嚴重度、軸線、檔案:行號、問題、為何重要、重現方式或測試、建議修法、估工（S/M/L）、是否需 owner 決策`。
- 審查 Next.js 相關程式前必讀 `node_modules/next/dist/docs/`（AGENTS.md 強制；此版本有 breaking changes）。
- Critical 軸線（B-02、B-03、B-04）由 Claude Opus 審，Sonnet 做前掃；主對話 Fable 只做整合與最終裁決（依既有工作習慣）。

### 4.2 審查軸線

| WP | 軸線 | 重點問題 | 主要證據來源 |
|---|---|---|---|
| B-01 | 架構與邊界 | `src/lib` 623 檔有無分層？Server Action、route handler、lib 之間依賴方向是否單向？有無 God module？Puck editor（`@puckeditor/core`）耦合程度？Cloudflare-first 的宣稱與實際 Vercel 部署是否一致？ | A-01 依賴圖、madge |
| B-02 | 多租戶與授權（Critical） | 每個 action／route 是否追到 authenticated actor → capability → 輸入 ID → related ownership → 最終 DB 操作？第二租戶測試覆蓋率？Supabase RLS 是否存在或完全靠應用層？MFA／CSRF 邊界？平台 admin 與商家界線？ | `celebratedeal-multi-tenant-security` skill、`docs/launch/m2-security-authorization-inventory-*` |
| B-03 | 金流與財務（Critical） | PayUni checkout／callback 冪等、簽章驗證、金額以整數分計算、退款／佣金／payout ledger 一致性、Serializable transaction 使用是否正確、pending refund consumer、綁卡 provider_setup_unsupported 缺口 | `celebratedeal-attribution-commission` skill、payuni runbooks |
| B-04 | 資料與 Migration（Critical） | 3,999 行 schema 的 model 數、index 是否覆蓋查詢、soft delete 一致性、`migrations_sqlite_archive` 殘留、migration inventory 計數（#423／#424 衝突）、backup／restore 演練是否可重現、PII 欄位加密（bank account backfill script） | `supabase-postgres-best-practices` skill、prisma migrations |
| B-05 | Next.js 16／React 19 慣例 | 是否誤用舊版 API（依本機 docs 核對）、Server／Client component 邊界、cache／revalidate 策略、`proxy.ts`（middleware 替代）行為、streaming 回應被誤判 200 的問題（CURRENT.md 已提） | `node_modules/next/dist/docs/` |
| B-06 | 效能與成本 | Dashboard 跨區延遲歷史、N+1 查詢、Stream／R2 流量成本模型、Vercel function 區域、圖片／影片處理路徑、hls.js 載入策略 | Sentry、A-04 bundle 分析 |
| B-07 | 可用性、a11y、繁中文案 | WCAG 2.2 AA 目標 vs `e2e:a11y` 實際覆蓋；非同步狀態回饋（PRODUCT.md 原則 4）；行動版核心任務；工程術語外露 | `celebratedeal-design-system` skill、PRODUCT.md |
| B-08 | 測試品質 | 20+15 個 config 的重複與維護成本、flaky 根因、coverage 是否被 synthetic-db-coverage 灌水、assertion 強度、E2E 對外部服務依賴 | A-03 |
| B-09 | 可觀測性、CI／CD、供應鏈 | Sentry 設定與 PII scrubbing、health endpoint、cron 監控、GitHub Actions 權限、`npm audit` 結果、`overrides` 原因、secret scan 覆蓋 | `.github/`、`sentry.*.config.ts` |
| B-10 | 死碼、歷史殘留與文件漂移 | 12 個 worktree、`archive/*` tag、`src/app/__test`、`browser-qa`、`sentry-example-page`、`__celebratedeal_wp187_fingerprint.json` 等是否該留在 production bundle；`docs/` 收據是否該搬到 `reports/` 或獨立 repo | A-02、knip |
| B-11 | 開啟中 PR 審查 | #423（post-purchase credit，CONFLICTING）、#420（通知四渠道）、#384（tracking，疑已被 #424 取代）、#426／#427（CI 與 migration 測試）、#428（Claude agents 取代 Codex）、#429（tracking MINOR）：每個 PR 給 merge／close／rebase 建議與 findings；#384 與 #420 要判定是否已被 master 取代 | `gh pr diff`、PR CI 結果 |

### 4.3 產出

- `docs/review-2026Q4/10-findings-register.md`（總表）＋每條軸線一份 `1x-<axis>.md`。
- `docs/review-2026Q4/19-architecture-debt-map.md`：模組 × 風險熱度表。
- `docs/review-2026Q4/20-remediation-backlog.md`：依「風險 × 商業價值 ÷ 估工」排序，標出哪些能自動化修、哪些需 owner 決策。
- Delta review：Goal 結束前對 `review-baseline-2026Q4..HEAD` 補審。

---

## 5. Phase C：市場調查重做

### 5.1 為什麼舊調查不夠

`bombmy_analysis` 只回答「幫賣後台有哪些頁」，沒有回答：誰會付錢、付多少、為什麼選我們不選 FB/LINE/蝦皮直播、法規會不會卡、2026 下半年 AI 工具改變了什麼。

### 5.2 研究題目（WP 切分）

| WP | 題目 | 關鍵問題 | 方法 |
|---|---|---|---|
| C-01 | 台灣直播電商／導購市場 2026 | 市場規模與成長、主要賣家類型（品牌商、團媽、課程講師、顧問）、他們現在用什麼工具、痛點 | 公開報告、新聞、產業協會、平台財報；WebSearch extended |
| C-02 | 競品與替代品矩陣（合併原 C-02／C-03／C-04） | 三層：(a) 直接競品：幫賣 Bombmy 現況（定價、功能更新、客群）與其他台灣直播導購 SaaS；(b) 替代品：FB／IG／TikTok／LINE／蝦皮直播原生導購功能到 2026 年補了什麼，以及 SHOPLINE、91APP、Cyberbiz、WACA 等開店平台是否內建直播導購；(c) 參考品：跨境 webinar／evergreen 與漏斗課程工具（Zoom Events、WebinarJam／EverWebinar、Demio、Livestorm、ClickFunnels、Kajabi、Teachable、Thinkific）只做功能與定價參照 | 一張競品矩陣：功能 × 定價 × 客群 × 弱點 × 對我們的威脅等級；只研究公開頁面與可概括的互動模式。舊文件只點名過幫賣與蝦皮直播，其餘名單由本 WP 第一步先用搜尋補齊再請 owner 確認 |
| C-03 | （已併入 C-02） | | |
| C-04 | （已併入 C-02） | | |
| C-05 | 金流、通知與整合生態 | PayUni、藍新、綠界、TapPay、Stripe TW 的直播場景適配與費率；LINE OA 2026 計價變動；Meta CAPI／TikTok Events API 要求 | 官方文件；對照 B-03 的 PayUni 綁卡缺口 |
| C-06 | 法規與合規 | 個資法 2025–2026 修法與主管機關、消保法網購 7 日猶豫期對直播／課程商品的適用、電子發票強制化時程、第三方支付／電子支付管理條例對平台代收的限制、廣告不實與直播話術規範、金管會對分潤／聯盟行銷的態度、未成年與境外賣家 | 法規原文與主管機關新聞稿；輸出「合規需求清單」給 B-03／B-04 |
| C-07 | AI 與內容趨勢 | AI 虛擬主播／數位人、AI 腳本生成、短影音切片、自動字幕、AI 客服機器人在直播電商的採用。owner 已決定（§9 Q3）：允許「明確標示為官方腳本角色」的互動，仍禁止偽裝真人與虛構觀看／評論／成效。本 WP 要研究競品如何揭露腳本角色、各平台對此的政策、以及台灣廣告不實規範的邊界，產出「標示規格」建議（名稱、徽章、揭露文案、紀錄保存） | 趨勢報告、產品公告、平台政策；輸出標示規格與 PRODUCT.md 修訂建議 |
| C-08 | 定價與商業模式 | 競品定價區間、月費 vs 抽成 vs 點數、Cloudflare Stream／R2／Vercel／Supabase 的單位成本推估、單一商家每月毛利模型 | 試算表（xlsx skill），假設全部標示 |
| C-09 | ICP 與 JTBD 假設 | 2～3 個 persona、他們的工作流程、目前替代方案、切換成本；附 8～10 題訪談腳本供 owner 訪談 | 由 C-01～C-04 歸納；訪談由 owner 執行 |
| C-10 | 通路與 GTM 假設（併入 C-09，縮為一節） | 代理商／顧問通路、LINE 社群、課程講師社群、聯盟行銷（專案已有 affiliate 模組）、內容行銷 | 歸納；標示為假設 |

市場範圍決定（§9 Q2）：**以台灣為主市場**。港澳與馬來西亞華語市場只在 C-01 加一節「鄰近市場一頁」，列出是否有同類工具、金流與法規差異的粗略判斷，不做完整研究；日本不納入（staging 在 Tokyo 是基礎設施選擇，不是市場訊號）。

### 5.3 研究紀律

- 每個論點附來源 URL、擷取日期、可信度（官方／媒體／推測）。
- 來源日期不早於 2026-01-01，法規原文與平台基礎文件除外。
- 不下載任何檔案、不登入任何競品後台、不建立競品帳號。
- 不複製競品文案或截圖進文件；舊 `bombmy_analysis/screenshots` 保留但標示為歷史快照。
- 研究使用 `deep-research` skill 協調子代理，各 WP 獨立，最後由主代理合併。

### 5.5 執行紀錄（2026-10-18）

Phase C 已於 2026-10-18 先行執行（owner 指示：另一 Session 尚未到段落，市場調查不碰程式碼可先做）。

- 六個研究子題並行（Sonnet 各一）：c01 市場概況、c02 競品矩陣、c05 金流與單位成本、c06 合規清單、c07 AI 趨勢與標示規格、c09 ICP／GTM／訪談腳本；報告由 Opus 綜整。
- 筆記：`docs/market-2026Q4/research_notes/台灣直播導購 SaaS 市場研究 2026/c0*.md`；報告：`docs/market-2026Q4/reports/台灣直播導購 SaaS 市場研究 2026.md`。原本規劃的 01～10 分檔改以這一份報告加六份筆記取代。
- 核心結論（報告原文）：重新定位為「給有自有名單的講師與顧問使用、以誠實標示為賣點的常青銷講系統」；封測只開直播／預錄場、報名表單、商品結帳、LINE 通知、Meta 追蹤五個模組；課程、聯盟、billing、Funnel 綁卡、虛擬使用者先隱藏。
- **owner 2026-10-18 覆寫兩項**（報告本文不回改，以本節為準）：
  - 虛擬使用者：封測開放，採幫賣版不標示（§9 Q3）。報告中「誠實標示」定位改為「透明定價＋講師雙向收入」定位；c07 標示規格保留為可選功能。
  - 聯盟行銷：封測開放，佣金只累計不出款；等會計師確認扣繳與二代健保補充保費、律師確認單層推薦不觸及多層次傳銷後再開放出款。owner 視「講師賣課收入＋推薦他人課程的佣金收入」為核心差異點；註：幫賣官網亦列有聯盟行銷，差異在雙向交叉推廣，E-01 需重新比對。
- 已知缺口（未補編）：台灣直播 GMV 與賣家數、幫賣定價、通路 CAC、TikTok Shop 台灣現況；法規條號與金額經摘要工具取得，寫進需求前須律師／會計師核對。
- `src/lib/interaction-role.ts` 的 `audience` 角色型別（預設名「一般觀眾」、標籤可自訂）原列為與標示規格衝突；owner 選 B 後改為符合預期，B-07 改審「虛擬使用者發言不得進入商業統計」與「腳本時機工具是否好用」。
- 時效提醒：LINE 官方帳號 2026-10-27 前須決定方案，10-28 至 11-02 系統維護，新價 11-01 生效。

### 5.4 產出（原規劃，已由 5.5 取代）

- `docs/market-2026Q4/00-method-and-sources.md`
- `docs/market-2026Q4/01-market-landscape.md`、`02-competitor-matrix.md`、`03-platform-native.md`、`04-tw-ecommerce-platforms.md`、`05-payments-integrations.md`、`06-compliance-checklist.md`、`07-ai-trends-and-ethics.md`、`08-pricing-model.xlsx`＋`08-pricing-model.md`、`09-icp-jtbd-and-interview-script.md`、`10-gtm-hypotheses.md`
- `docs/market-2026Q4/20-feature-decisions.md`：對照現有功能模組（lives、products、forms、funnel、courses、affiliates、LINE、tracking、billing 等）給出 Keep／Kill／Add／Defer，每項附理由與來源。

---

## 6. Phase D：Skill、工具與能力盤點

### 6.1 現有資產

| 類別 | 項目 | 狀態觀察 |
|---|---|---|
| 專案 skill（`.agents/skills/`） | ai-team／lite／pro／style 4 個 adapter；celebratedeal-attribution-commission、browser-qa、design-system、multi-tenant-security、product-domain、release-gate 6 個領域 skill | 都是 thin adapter，指向 `docs/ai-team/domain-workflows.md`；為 Codex `route_task` 設計 |
| Codex agents（`.codex/agents/`） | analyst、explorer、planner、reviewer、worker、worker-deep | Codex 專用 toml |
| AI Team runtime（`.ai-team/`） | routing-policy.json、mcp_server/routing.py、goal-state.json、40 個 wp checkpoint | 目前 goal-state 屬於 Codex 的舊 Goal |
| Claude Code 這個 session 可用 skill | code-review（含 ultra 多代理雲端審查）、security-review、simplify、deep-research、docs、xlsx／pptx／pdf／docx、dataviz、artifact-design、supabase、supabase-postgres-best-practices、schedule／loop、skill-creator、plugin-authoring、hyperframes 系列（影片）、built-in-browser／chrome-browser、run | 多數尚未在本專案使用過 |
| MCP／connector | Vercel MCP（200+ 工具）、Supabase MCP（需 OAuth 授權後才可用）、Claude Docs、scheduled-tasks | Supabase MCP 目前未授權 |
| 專案 memory | master 為 canonical；worktree junction 注意事項；Fable 不直接寫碼、交給 Opus／Sonnet | 已存在 |

### 6.2 盤點題目

| WP | 題目 | 產出 |
|---|---|---|
| D-01 | **以 PR #428 為基準**（它已把 Codex AI Team 整套移到 `archive/codex-ai-team-vnext-20261017` tag，六個 `celebratedeal-*` skill 搬到 `.claude/skills/`，新增 `.claude/agents/` 的 engineer-hard／engineer／reviewer／docs 四個 agent 與 CLAUDE.md dispatch guide）。本 WP 審查 #428 的結果：六個 skill 內容是否過期、agent 的模型／effort／工具權限是否合理、CLAUDE.md 與 AGENTS.md 是否與本計畫的治理規則一致；不重做 Codex 時代的盤點 | `docs/skills-2026Q4/01-skill-inventory.md`（併入 B-11 對 #428 的 findings） |
| D-02 | #428 之後的缺口：reviewer agent 如何接 `code-review`／`security-review` skill；Critical 軸線（租戶、金流、資料）是否需要專屬 reviewer 指令；Goal 狀態（原 `.ai-team/state/goal-state.json` 被刪）改用什麼追蹤 | `02-agent-gaps.md` |
| D-03 | 新 skill 缺口分析，候選：`celebratedeal-nextjs16-conventions`（強制讀本機 docs 的檢查清單）、`celebratedeal-prisma-migration-safety`、`celebratedeal-payuni-sandbox`（既有 runner 的入口與禁區）、`celebratedeal-market-research-ledger`（來源格式與時效規則）、`celebratedeal-evidence-receipt`（收據格式與 `reports/` 歸檔）、`celebratedeal-tw-compliance`（C-06 輸出的合規檢查）、`celebratedeal-worktree-hygiene`（junction／branch 清理 SOP） | 每個候選一份 SKILL.md 草稿＋觸發條件＋驗證方式（用 `skill-creator` 的 eval 流程）；放在 `docs/skills-2026Q4/drafts/`，不直接進 `.claude/skills/` |
| D-04 | 外部能力：Supabase MCP 授權後能做哪些唯讀健檢（advisors、logs）；Vercel MCP 能自動抓哪些 runtime errors／deployment lineage 取代人工收據；Cloudflare 是否有可用 MCP；GitHub CI 監控（ccd_pr）如何接 | `03-connector-playbook.md` |
| D-05 | 行銷內容能力：hyperframes／product-launch-video／website-to-video 是否能用於 demo 影片與 onboarding 教學；需要的素材與品牌規範 | `04-content-production-options.md` |
| D-06 | 執行手冊：用上述 skill 完成 G1 修復 backlog 與 G2 功能決策的建議流程（哪類任務用 code-review ultra、哪類用 security-review、哪類交 Opus 單 writer、哪類可並行） | `05-execution-playbook.md` |

---

## 7. Phase E：整合與決策

| WP | 內容 | 產出 |
|---|---|---|
| E-01 | 把 B 的 findings、C 的功能決策、D 的能力對照成一張表：每個模組 → 市場價值 → 技術風險 → 建議動作（保留、重構、重寫、移除、延後） | `docs/ROADMAP-v2.md` §1 |
| E-02 | 重構 vs 重寫評估（owner 已決定開放重寫選項，§9 Q4）：以證據（B-01 架構債、B-08 測試可信度、A-04 死碼比例、C 的功能 Kill 比例）給出三個選項（漸進重構、strangler 分模組重寫、全新 repo）的成本、風險、可沿用資產清單（schema、runner、文件、測試）與建議。不預設答案；全新 repo 選項必須說明 Prisma 資料與 staging 資產如何遷移。 | `ROADMAP-v2.md` §2 |
| E-03 | 下一個開發 Goal 的 Work Package 清單（前 10 個），每個含 scope、ownership、建議模型／effort、測試策略、是否需授權 | `ROADMAP-v2.md` §3 |
| E-04 | Owner 決策清單：所有在 B／C／D 中標記「需 owner 決策」的項目集中列出，附選項與影響 | `docs/DECISIONS-2026Q4.md` |
| E-05 | Goal 收尾：delta review、`git status` 確認只新增文件、`goal_finalize` 或等效 acceptance gate 紀錄、handoff 文件 | `docs/goal-plan-review-research-skills-20261017-handoff.md` |

---

## 8. 治理、分工與證據

### 8.1 角色

- **主代理（Claude，本對話）**：整合、ownership、routing 決定、最終判斷、與 owner 溝通。不直接寫長篇審查，交給子代理或獨立 session。
- **Review／研究執行**：Opus 負責 Critical 軸線（B-02／B-03／B-04）與 E-02；Sonnet 負責盤點、靜態掃描判讀、非 Critical 軸線、市場研究子題。需要升級到 Fable 執行時先問 owner。
- **Owner（Eden）**：回答 §9 決策、執行 ICP 訪談、提供外部帳號狀態（PayUni Token 申請、Cloudflare 非正式帳戶）、最後拍板 ROADMAP-v2。

### 8.2 並行與 ownership

- 本 Goal 幾乎全部唯讀，可大量並行：A-01～A-04 並行；B-01～B-10 在 A 完成後並行；C-01～C-10 與 B 完全不相交可同時進行；D 在 A 後即可開始。
- 唯一 writer 規則只適用於文件：每個 WP 只寫自己的輸出檔；總表（findings register、ROADMAP-v2）由主代理合併。
- 不在其他 Session 的 worktree 內執行任何指令。

### 8.3 證據與格式

- 每個 WP 結束寫一份 `reports/review-2026Q4/<WP>-receipt.md`：執行的命令、原始輸出路徑、花費時間、使用模型（實際觀測不到就寫 unknown）、未完成項。
- 不把未執行的掃描標成 PASS；工具失敗照實記 `TOOL_BLOCKED`。
- 文件只放 sanitized 內容：環境變數只列名稱、SQL 不含正式資料、競品只摘要不複製。

### 8.4 停止條件

- 同一命令或根因失敗兩次 → 停止重試，記 blocked，改做其他 WP。
- 發現疑似真實 secret 外洩、正式資料進 repo、或可被外部利用的安全漏洞 → 立即以單獨訊息通知 owner，不寫入一般文件。
- owner 更改範圍、或另一個 Session 需要搶回 writer → 建 checkpoint 後停止。

### 8.5 子代理額度與排程（owner 要求：一般額度、越快越好）

額度上限：同時最多 4 個子代理；Opus 只用在 B-02、B-03、B-04、E-02 與最終 findings 合併，其餘一律 Sonnet；每個 WP 一次執行，失敗不自動重跑超過一次。主對話 Fable 只整合與裁決，不自己跑長篇審查。

| Phase | WP 數 | 排程 |
|---|---|---|
| A | 4 | Day 1 上午，4 個並行 |
| B | 11 ＋ delta | Day 1 下午到 Day 2，先跑 Critical 三條與 B-11 開啟中 PR，其餘兩批各 3～4 條 |
| C | 8（C-03、C-04、C-10 已併入） | Day 1 下午到 Day 2，與 B 交錯排入 4 個槽位 |
| D | 6 | Day 2，排在 B／C 空檔 |
| E | 5 | Day 3 |
| 合計 | 34 | 目標 3 個工作天牆鐘（封測 2026-11-01 前留 10 天修復）；若 B 的 Critical 軸線 findings 過多，E 順延半天而不是砍 review |

---

## 9. Owner 決策紀錄（2026-10-17）

| # | 問題 | 決定 | 落地位置 |
|---|---|---|---|
| Q1 | 範圍取捨 | owner 授權主代理決定。決定：審查十條軸線全留；研究題 C-03、C-04 併入 C-02，C-10 併入 C-09，共 8 題；盤點六題全留，D-05 做輕量版 | §4、§5、§6 |
| Q2 | 市場範圍 | 台灣為主市場；港澳、馬來西亞只在 C-01 加「鄰近市場一頁」；日本不納入 | §5.2 |
| Q3 | 虛擬使用者 | 2026-10-17 先決定「允許明確標示的官方腳本角色」；**2026-10-18 owner 改選 B（幫賣版）**：允許不標示、外觀如一般觀眾的虛擬使用者在聊天室依腳本發言，營造人氣並在講師設定的時機促成下單。主代理已說明風險（PRODUCT.md 原則衝突、公平交易法第 21 條與「三星寫手門」先例、FTC 假社群指標規則、喪失對幫賣的「誠實標示」差異點），owner 仍選 B。前提：商家後台的報名、訂單、付款、成效統計仍只顯示真實資料，虛擬使用者的發言不計入任何商業統計；觀眾端「在線人數」是否計入虛擬使用者列為 E-04 子決策。風險緩解：商家服務條款需由律師加入責任歸屬條款。c07 的標示規格降為「可選功能」保留 | C-07、功能決策、PRODUCT.md 修訂、E-04 |
| Q4 | 重寫選項 | **開放**，E-02 評估三個選項 | §7 E-02 |
| Q5 | 競品名單 | 舊文件只點名幫賣 Bombmy 與蝦皮直播（其他出現的名字是 Cloudflare Stream 的誤判字串）。C-02 第一步先補名單再請 owner 確認 | C-02 |
| Q6a | PayUni | owner 已提供多組金鑰；owner 指示不需再由 owner 查核，主代理自行處理。處理方式：本計畫指的「Token 契約」不是金鑰，而是 PayUni 信用卡約定 Token（綁卡）的商店層級功能開通（見 `docs/launch/payuni-token-contract-20260929.md`）。主代理不能登入 PayUni 後台，所以 B-03 把它列為「未驗證」finding；master adapter 缺 setup 三方法、action 拒絕 form_post 則可由程式碼確認。**封測風險**：Funnel 專案發布要求有效 verified PaymentMethodReference，若封測客戶要用 Funnel，這會是封測 blocker，E-04 會標為第一優先決策，屆時只需 owner 看一眼 Sandbox 後台 | B-03、C-05、E-04 |
| Q6b | Cloudflare | owner 已提供憑證；owner 指示由主代理自行處理。處理方式：B-09 以不輸出 token 的名稱級探測（例如列出帳戶顯示名稱與 Stream library 內是否有非合成命名的資源）判定隔離狀態；探測只在既有受控 runner 或 process environment 已注入的情況下執行，不讀 `.env*`。判不出來就維持 UNVERIFIED 並寫進 E-04 | B-09、E-04 |
| Q6c | Supabase MCP | owner 指示由主代理決定。決定：**不要求授權**，B-04 以 schema、migration 與程式碼靜態審查為主；若之後封測前修復需要 advisors，再請 owner 授權 | B-04 |
| Q7 | 額度與時間 | 一般額度、不超出太多；越快越好。落地為 §8.5：最多 4 個並行、Opus 限 Critical、目標 3 個工作天 | §8.5 |
| Q8 | 文件歸檔 | owner 指示由主代理決定。決定：只提案不執行 | E-01、B-10 |
| Q9 | 其他 Session | owner 確認正在寫程式的是「專案路徑確認」Session（#423）；主代理可看到它的狀態（§2.1） | §2 |
| Q10 | 子代理 | owner 確認可直接啟動 Opus／Sonnet | §8.1 |
| Q11 | 外部客戶資料 | 沒有 repo 以外的商家接觸紀錄；C-09 persona 全為假設，封測客戶訪談是第一批真實資料 | C-09 |
| Q12 | 里程碑 | **2026-11-01 封測**，免費提供給幾位客戶 | §2.3、E-03 |

### 9.1 owner 已無需提供其他資訊

原則（owner 指示）：除非必須由 owner 決策，否則主代理自行找資料。剩下只有兩個時間點需要 owner：

1. 「專案路徑確認」Session 到可中斷點時說一聲（或直接說「開始」，主代理會以當下 `origin/master` 凍結基線）。
2. E-04 決策清單出來後拍板，特別是封測前要關掉哪些模組、以及 Funnel 綁卡缺口要不要在封測前補。

### 9.2 封測準備（新增，給 C-09 與 E-03 的輸入）

- 封測客戶的訪談腳本（C-09）改為「封測前訪談＋封測後回訪」兩份。
- E-03 增加「封測環境」WP 候選：staging 是否可直接給客戶用、合成資料清理、客戶資料隔離、Sentry 告警接收、回報問題的管道、封測期間的付款是否走 Sandbox。
- 封測不等於 Production 上線；Production 部署、正式付款仍需另行授權。

---

## 10. 可能被忽略的盲點清單

這一節的目的就是回應「怕想得太少」。每項都已經對應到上面的 WP；owner 看完若覺得不需要，直接刪。

**產品與商業**
- 現有 affiliate、course、consultation、funnel、LINE rich menu、team-template 等模組是否都還符合「直播導購 SaaS」定位，或是半年內功能蔓延的結果（C-01、E-01）。
- 單一商家的單位經濟：Stream 分鐘數、R2 流量、Vercel function、LINE 推播計價，是否撐得起月費（C-08）。
- 定價頁與 billing 模組（`src/app/(app)/billing`）是否已和市場定價假設一致（C-08 對照 B-03）。
- 商家 onboarding 的第一次成功體驗（PRODUCT.md 強調首次上線成功率）目前沒有量測指標（B-07、C-09）。

**法規與合規**
- 消保法 7 日猶豫期對線上課程與直播限時商品的適用與例外（C-06）。
- 電子發票：checkout 已有 invoice fields，是否符合財政部規格與時程（C-06、B-03）。
- 平台代收代付是否觸及電子支付機構管理條例門檻（C-06）。
- 個資法：bank account 加密、PII 在 Sentry 的 scrubbing、資料保留與刪除流程、跨境傳輸（Supabase Tokyo）（B-04、B-09、C-06）。
- 聯盟行銷分潤的稅務扣繳與勞報單需求（C-06 對照 affiliate payout 模組）。

**技術與營運**
- 「Cloudflare-first」宣稱與實際 Vercel 部署的落差，是否影響成本與架構決策（B-01、B-06）。
- 35 個測試 config 的維護成本，以及 synthetic-db-coverage 是否讓 coverage 數字失真（B-08）。
- 12 個 worktree 與 Windows junction 的操作風險，需要 SOP（D-03 的 worktree-hygiene skill）。
- 備份還原演練只有 staging 文件，Production 從未演練，且 Production 一直「未評定」（B-04、B-09）。
- Sentry、health、cron 的告警接到哪裡？目前沒有人值班的設計（B-09）。
- CI flaky 根因未證實，長期會侵蝕對綠燈的信任（B-08）。
- 依賴更新策略：Next 16.3.8、React 19.2、Prisma 6.19 都是新版，升級頻率與 breaking change 風險（B-05、B-09）。

**AI Team 與工作方法**
- 大量歷史 evidence 文件讓新代理每次都要花 context 讀過期狀態；`DOCUMENT_AUTHORITY.md` 指向的 canonical 文件可能已不存在（A-02、D-02）。
- `.ai-team/state/goal-state.json` 仍是 Codex 舊 Goal 的狀態，新 Goal 啟動時要決定是沿用、歸檔還是另建（E-05）。
- Claude Code 的 `code-review ultra`、`security-review`、Supabase advisors 等能力尚未納入專案 release gate（D-04、D-06）。
- 行銷素材與 demo 影片沒有生產流程；hyperframes 系列 skill 可補（D-05）。

**使用者與市場驗證**
- 到目前為止沒有任何真實商家訪談紀錄；所有 persona 都是推測（C-09 需 owner 訪談）。
- 沒有試用／waitlist 數據；GTM 假設無法驗證（C-10）。
- 競品不只 SaaS，更大的替代品是 FB／LINE 原生直播加人工私訊下單；要證明「為什麼要多付一個工具的錢」（C-03）。

---

## 10.5 執行紀錄：Phase A／B／D／E（2026-10-19）

- **基線**：`review-baseline-2026Q4` = `origin/master@78621ca3`；收尾時 `git fetch` 確認 master 未移動，delta review 為空。工作分支 `codex/goal-review-2026q4` 自 origin/master 建立，主工作目錄原本的 `codex/claude-handoff-20261017` 落後 master 15 個 commit（#425 已 merge），已不再使用。
- **Phase A**（4 個 Sonnet 並行）：01～04 文件。重要發現：主目錄 HEAD 不含基線（已切分支修正）；本機 Prisma Client 過期造成官方 typecheck 313 錯，重新 generate 後 0 錯；repo 內沒有任何排程驅動 9 個 cron／jobs 端點；docs/ 1,885 個追蹤檔案中 91% 是收據。
- **Phase B**（11 條軸線；B-02／B-03／B-04 用 reviewer agent＝Opus，其餘 Sonnet）：11～21 文件。reviewer agent 無 Write 權限，三份 Critical 報告由主對話依回報原文存檔（已在 D-01 提出改善建議）。去重後 174 列 findings：BLOCKER 7、MAJOR 65。
- **Phase D**（2 個 Sonnet）：`docs/skills-2026Q4/01～06` 與 7 份 SKILL.md 草稿（`drafts/`，未進 `.claude/skills/`）。主對話決定：草稿保留完整檢查清單，不縮成單句格式；是否採用列入 DECISIONS。
- **Phase E**（2 個 Opus）：`10-findings-register.md`、`22-architecture-debt-map.md`、`23-remediation-backlog.md`、`docs/ROADMAP-v2.md`、`docs/DECISIONS-2026Q4.md`（46 項決策）。
- **同步的既有文件修改**（owner 決策 B）：`PRODUCT.md` 第 22、31 行；`docs/domain-workflows.md` 第 20 行。
- **沒有做的事**：沒有修改任何產品程式碼；沒有連 staging／Production／Supabase；沒有讀 `.env*`；沒有合併或關閉任何 PR（#436 只綁定到本 Session 供後續追蹤）；沒有移除任何 worktree。
- **模型觀測**：子代理模型依 Agent 參數指定（Sonnet／Opus），實際 served model 未觀測，記為 unknown。
- **封測判斷**（ROADMAP-v2 §0.2）：可如期，但限小規模、免費、陪跑式、付款只走 Sandbox、跑在 staging，且 owner 須在 10-21 前回覆本週決策。

## 11. 文件與目錄約定（本 Goal 新增）

```
docs/
  goal-plan-review-research-skills-20261017.md        ← 本計畫
  goal-plan-review-research-skills-20261017-handoff.md ← E-05 產出
  review-2026Q4/        ← Phase A、B 產出
  market-2026Q4/        ← Phase C 產出
  skills-2026Q4/        ← Phase D 產出（含 drafts/）
  ROADMAP-v2.md         ← Phase E 產出
  DECISIONS-2026Q4.md   ← Phase E 產出
reports/
  review-2026Q4/        ← 原始掃描輸出與每個 WP 的 receipt
```

所有新增檔案以 PR 進 `codex/*` 分支，不直推 master，不 force push。本計畫文件本身目前只在工作目錄，尚未 commit。
