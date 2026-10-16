# CelebrateDeal 產品審視：整合版報告（供 Codex 讀取並製作 Goal Plan）

- 版本日期：2026-10-11（Asia/Taipei）
- 本文件性質：**整合版**。合併 `docs/reviews/2026-10-11-product-audit.md`（完整版）與其附錄 B（對標 Bombmy）。細節與長證據以完整版與證據資料夾為準。
- 審視基底：**`origin/master@efb8b7e9`**（#422）。不是使用者目前的工作樹分支 `codex/one-stop-webinar-flow`。
- 證據資料夾：`docs/reviews/2026-10-11-product-audit/`（`working-notes.md`、`screenshots/`）
- 證據標籤：【實測】【程式碼】【文件宣稱】【推論】【待驗證】。路徑與行號皆指 `origin/master@efb8b7e9`。
- 審視者模型：Sonnet 5.5；推理程度 unknown。

---

## 0. 給 Codex 的使用方式

**你的任務是「讀取本文件並製作 Goal 任務計畫（Goal Plan）」，不是實作。** 不修改產品程式碼、不建立 commit 以外的產品變更、不推送、不部署。
計畫格式與狀態遵守 `docs/ai-team/GOAL-PROTOCOL.md`、`docs/ai-team/ROUTING.md`、`docs/ai-team/handoff-schema.md`；模型與推理程度由 `.ai-team/config/routing-policy.json` 的 router 決定，本文件不指定。

---

## 1. 前提與安全邊界

1. 基底為 `origin/master@efb8b7e9`。使用者本機工作樹在另一分支且有約 274 個未提交變更，**不得 checkout／reset／clean／stash／restore／rebase 該工作樹**。要實作時請用獨立 worktree 或新的 `codex/*` 分支從 `origin/master` 建立。
2. 只使用本機、Preview、staging、固定 Sandbox、disposable PostgreSQL 與合成資料；不得讀取或輸出 `.env*`、Token、Cookie、私鑰、正式 Secret、正式客戶或付款資料。
3. 不得 Production 部署、正式付款／退款／寄信、對正式 DB 操作、破壞性 migration；不得 force push。
4. 本機既有 DB（`celebratedeal_dev` 停在 2026-09-17 的 migration、`celebratedeal_test` 停在 2026-10-06 的 migration；兩者均缺 master 後續 migration，且內含大量測試殘留資料）schema 落後 master（master 有 96 個 migration）。實測請在**全新 disposable DB** 上 `prisma migrate deploy`（已驗證 96/96 可套用），不要在既有 dev／test DB 上直接套用。
5. 未執行的測試不得標 PASS。本審視**未執行**：eslint、e2e、npm audit、secret:scan、覆蓋率；直播觀看頁、結帳、學員中心、LINE、Email 實寄也未實測。

---

## 2. 一頁結論

**產品判斷**：工程底盤強（付款／webhook 冪等、租戶範圍、a11y 掃描 0 違規），但「第一次成功」會斷，且與對標的銷講軟體（幫賣 Bombmy）相比，**功能面不缺，缺的是把「報名→提醒→到場→追銷→成交」做通、做簡單**。

**最需要改的 4 件事**
1. **發布鏈**：Funnel 顯示「已發布」但公開頁 404（所屬專案未發布）；專案發布閘門又混入「商家付平台費用的付款方式」。【實測】（F-01、F-02）
2. **提醒與追銷真的會跑**：repo 內無排程；自動化 trigger 無「未付款／棄單」；無簡訊。（F-15、WP-18、WP-19）
3. **公開信任面**：政策頁是內部治理草稿；夥伴頁與 LINE 設定沒有入口；導覽有死連結。【實測】（F-10、F-05、F-06）
4. **開發基礎線**：master 的 `prisma db seed` 失敗；DB 落後使 179 個測試失敗難以判讀。【實測】（F-20）

**不建議現在投入**：課程／社群／學員中心擴張、勞報單與稅務匯出擴充、平台推薦對外、抽獎／紅包互動。

---

## 3. 發現索引

等級：BLOCKER／MAJOR／MINOR／NIT。證據檔位於 `docs/reviews/2026-10-11-product-audit/screenshots/`。

| ID | 等級 | 證據 | 一句話 | 位置（master） | 證據檔 |
|---|---|---|---|---|---|
| F-01 | BLOCKER | 【實測】【程式碼】 | Funnel 發布成功訊息，但公開 URL 為 404；專案未發布前不可見 | `src/lib/landing-page-service.ts:249,627`；`src/app/actions/landing-page-actions.ts:137-141`；`src/lib/sales-workspace.ts:130-140` | `F-01_*` |
| F-02 | MAJOR | 【程式碼】【實測】【文件宣稱】 | 專案發布要 verified「商店付款方式」，該頁說明是「平台方案與 Stream 用量需要的付款方式」；PayUni Token／IP 核准 9/29 為不確定／尚未申請 | `src/app/actions/sales-workspace-actions.ts:99-140`；`src/app/(app)/billing/payment-methods`；`docs/launch/CURRENT.md` | `F-02_*` |
| F-03 | MAJOR | 【實測】 | 未綁表單的名單頁可被發布，公開頁顯示「此 Funnel 尚未綁定可公開使用的報名表」 | `landing-page-service.ts` publish 驗證 | `F-03_*` |
| F-04 | MAJOR | 【實測】【程式碼】 | `/landing-pages/new` 無專案時只有一句話無連結；專案建立 5 項決策；「快速建立」在第一個專案被強制導引（`sales-workspace-actions.ts:84,95`）；專案無編輯／封存 | `src/app/(app)/landing-pages/new`、`projects/new` | `F-04_*` |
| F-05 | MAJOR | 【程式碼】【實測】 | `/partner-pages`、`/settings/line` 頁面完整但無任何導覽入口 | `src/components/app-shell.tsx` | `F-05_*` |
| F-06 | MAJOR | 【實測】 | 導覽「分潤規則」`/settings/commissions` 無對應路由，404 | `app-shell.tsx:76,171` | `F-06_*` |
| F-07 | MAJOR | 【程式碼】【實測】 | `consultation_booking` 預設不在 `enabledFeatureModules`；onboarding 選諮詢模式不啟用它 | `prisma/schema.prisma:82`；`sales-workspace-actions.ts:50-53` | `F-07_*` |
| F-08 | MAJOR | 【程式碼】（UI 待實測） | 原生表單 POST 失敗（400/403/404/429/503）回 raw JSON，僅成功 303 | `src/app/api/form-submissions/route.ts:389-586,607-609`；`funnel-webinar-experience.tsx:43-52` | — |
| F-09 | MAJOR（假設） | 【程式碼】【待驗證】 | Email 二次確認：未確認者不收提醒／不能聊天／不被歸因；確認頁為平台品牌 | `app/verify-registration/page.tsx`；`lib/live-chat.ts`；`lib/live-notification-delivery.ts` | `public-verify-registration-invalid-*` |
| F-10 | BLOCKER（上線前） | 【實測】 | `/policies` 顯示「DRAFT — HUMAN OWNER ACCEPTANCE REQUIRED」等內部治理語言；條款／隱私／退款皆標草稿且掛在每頁頁尾 | `src/app/policies/**` | `F-10_*` |
| F-11 | MAJOR | 【實測】 | Funnel 工作區英文與識別字外露（`Funnels`、`Configuration`、`Automation Rules`、`opt_in_page`、`audience · revision 1`）；導覽名稱與頁名不一致（一頁式網站↔Funnels、互動腳本↔留言組…） | `src/components/landing-pages/**`、`app-shell.tsx` | `F-11_*` |
| F-12 | MINOR | 【實測】 | 「建立名單」僅 3 個公益主題模板，與銷講定位不符 | `src/lib/funnel-template-gallery.ts` | `F-12_*` |
| F-13 | MINOR | 【實測】 | 新商家 Dashboard 10 個 0 值 KPI、標籤重複、jargon；側欄／行動版 chrome 佔滿首屏 | `src/app/(app)/dashboard/**` | `F-13_*` |
| F-14 | MINOR | 【實測】 | axe：Funnel operations color-contrast（serious×8）、editor target-size／行動 color-contrast；方案頁幣別僅 `$` | `funnel-operations-panel.tsx` | `F-14_*` |
| F-15 | MAJOR | 【程式碼】【文件宣稱】 | repo 內無排程：`vercel.json` 無 crons、staging `crons: []`、workflows 無 schedule | `vercel.json`；`docs/launch/staging-cron-operations.md` | — |
| F-16 | MAJOR | 【程式碼】 | 電子發票無 adapter，永遠 queued | `src/app/api/jobs/electronic-invoices/route.ts:8-14` | — |
| F-17 | MAJOR | 【程式碼】【待驗證】 | MFA 僅在已註冊 factor 時要求；platform_admin 未註冊可能直達財務頁 | `src/lib/auth.ts:237-246,320-336` | — |
| F-18 | MAJOR（條件） | 【程式碼】 | `clientIp` 直接信任 `cf-connecting-ip`／`x-forwarded-for` | `src/lib/rate-limit.ts:26-32` | — |
| F-19 | MINOR | 【程式碼】 | magic link／voucher 以 GET 消耗；`/r/[code]`、`live-admission` DELETE 無限流 | `src/app/portal/[vendorSlug]/access/route.ts:9-31` | — |
| F-20 | MAJOR | 【實測】 | `prisma db seed` 在 `prisma/seed.ts:316` 失敗；DB 落後；vitest 179 失敗；需 DB 的測試未用 `.db.test.ts` 命名 | `prisma/seed.ts`、`vitest.config.ts` | — |
| F-21 | MINOR | 【程式碼】 | `src/app/actions.ts` 2,498 行混合職責；互動腳本雙路徑；報名表單 3 套實作 | 如左 | — |
| F-22 | MINOR | 【實測計數】 | docs 追蹤檔 1,875、branch-integration 157；產品定位文件不在 master | `docs/**` | — |
| F-23 | MINOR | 【程式碼】 | LINE：Rich Menu 僅草稿、webhook 不處理事件、模板 LINE 渠道 disabled；Meta CAPI 不在 master | `src/lib/line-*.ts`、`src/app/api/webhooks/line/**` | — |
| F-24 | MINOR | 【推論】 | `(app)/layout.tsx` 每次 ≥4 個串行 DB 往返 | `src/app/(app)/layout.tsx:16-49` | — |
| F-25 | NIT | 【程式碼】 | README Next 版本漂移；`media/videos/status` 角色清單含不存在的 `manager` | — | — |
| F-26 | MAJOR | 【程式碼】 | 對標差距：自動化 trigger 僅 7 種，**無「未付款／棄單」、無簡訊**；場次分析缺完看率／平均觀看時長／報名率（僅搜尋該頁） | `src/lib/automation-workflow.ts:15-23`；`src/app/(app)/lives/[id]/analytics/page.tsx` | — |

---

## 4. 對標 幫賣 Bombmy

**來源與限制**：Bombmy 官網首頁 https://www.bombmy.live（WebFetch 摘要，2026-10-11）：報名頁（設時間與場次）、簡訊／Email 提醒、自動銷講（錄一次反覆重播）、台灣金流、對未參與／未下單／未付款自動追銷；模組含 CRM、銷售頁、商品、累積／直播留言、聯盟、黑名單、虛擬使用者、附屬帳號、廣告設定、第三方服務；**首頁未列方案與價格**，只有「免費體驗一場」。教學頁抽取為空。其餘為使用者提供的第三方整理（未驗證）與 repo 內舊的內部觀察紀錄。**未註冊或實測 Bombmy。**

| 銷講元件 | Bombmy | CelebrateDeal master | 判斷 |
|---|---|---|---|
| 報名頁 | 設時間與場次自動產生 | Funnel＋Webinar 目標；需過專案／模板／表單綁定 | 能力在，上手成本高（F-01/03/04） |
| 仿真現場 | 重播＋虛擬使用者＋留言組 | 常青場次＋互動腳本／角色／閃購＋觀眾端揭露 | 能力在且更深；入口與命名需整理（F-11） |
| 催單／預約 | 收單、台灣金流 | 結帳、加購、CTA、諮詢預約；真實 provider 僅 PayUni | 能力在；金流多元待驗證 |
| 追蹤培育 | 未參與／未下單／未付款追銷；簡訊＋Email | 無棄單 trigger、無簡訊、無排程 | **最大落差**（F-15、F-26） |
| 分析 | 首頁未提 | 缺完看率等核心指標 | 不完整（F-26） |

---

## 5. 需要人類決策或外部輸入

| # | 決策／輸入 | 影響的 WP | 最低成本的驗證方式 |
|---|---|---|---|
| D-1 | 發布語意：專案＝活動單一發布，或保留雙層但加檢查？ | WP-01、WP-17 | 5 位新商家 think‑aloud 或內部決議 |
| D-2 | 資金流與「商店付款方式」定位（平台代收再結算 vs 商家自有金流；`Settlement` 結構顯示 gross→payoutable→final payout；docs 對代收／信託搜尋 0 筆） | WP-02 | 一次法遵諮詢＋PayUni 條款 |
| D-3 | PayUni Token／IP 核准是否取得與時程 | WP-02 | 提交申請並記錄回覆 |
| D-4 | 提醒通道：補簡訊，或明確以 LINE 取代 | WP-19、WP-13 | 訪談 5 位講師的名單觸達管道 |
| D-5 | 正式政策文字（條款／隱私／退款） | WP-03 | owner／法遵提供 |
| D-6 | 外部排程在 staging／production 是否已設定；電子發票供應商 | WP-04、WP-12 | 檢查平台設定、手動呼叫一次 job |

---

## 6. Work Package 清單

> 欄位：scope、不可觸碰、task signals（C=complexity、R=risk、S=surface、P=production／security／data impact）、驗收、驗證、依賴、額外授權、審查。**不指定模型與推理程度。** 「獨立深度審查」＝符合 Critical security／Auth／Permission／Payment／Billing／Production data／Migration。

| WP | 對應 | 目標 | Scope | 不可觸碰 | Signals | 驗收條件 | 驗證 | 依賴 | 額外授權 | 審查 |
|---|---|---|---|---|---|---|---|---|---|---|
| **WP-01** | F-01、F-03、F-04、F-07 | 發布鏈單一語意；缺項清單；無專案時可行動；諮詢模式不導向被隱藏頁 | `src/lib/sales-workspace.ts`、`src/app/actions/sales-workspace-actions.ts`、`src/app/actions/landing-page-actions.ts`、`src/lib/landing-page-service.ts`、`src/app/(app)/projects/**`、`src/app/(app)/landing-pages/new/**`、`src/components/landing-page-workspace.tsx`、`src/lib/vendor-feature-toggles.ts` | `prisma/schema.prisma`、migration、支付程式、`.env*` | C高 R中 S商家＋公開 P無 | Funnel 發布成功⇒公開頁 200 且含表單；未就緒顯示缺項；`/landing-pages/new` 無專案有「建立專案」；諮詢專案導向可用頁 | targeted＋E2E | D-1 | 否 | 一般 |
| **WP-02** | F-02 | 「商家扣款方式」拆出銷售就緒閘門或改名；文案任務化 | `src/app/(app)/billing/payment-methods/**`、`src/lib/sales-workspace.ts`、`src/lib/merchant-onboarding.ts` | `src/lib/payment-providers/**`、webhook | C中 R高(Billing) S商家 P billing 閘門 | 閘門與文案一致；有／無核准情境皆不誤導 | targeted＋integration | D-2、D-3、WP-01 | **是** | **獨立深度審查** |
| **WP-03** | F-10 | 移除內部治理語言；版本化政策頁骨架與頁尾 | `src/app/policies/**`、頁尾元件、`src/app/support/**` 文案 | 法律內容本身 | C低 R中(法遵) S公開 P無 | 公開頁無 `DRAFT`／`HUMAN OWNER`／`P0-P2`；有版本與生效日 | targeted＋a11y | D-5 | **是**（內容） | 一般 |
| **WP-04** | F-15 | 註冊排程與心跳、健康檢查、外部 scheduler 文件 | `vercel.json`、`vercel.staging.json`（僅 cron 欄位）、`src/app/api/jobs/**`、`src/app/api/cron/**`、`docs/launch/staging-cron-operations.md` | Production 部署、正式寄信、billing-cycle 實際執行 | C中 R高(Billing/Email) S基礎設施 P production 設定 | 非 production：排程可呼叫且有心跳；端到端確認信＋提醒（Sandbox） | integration＋staging | D-6 | **是** | **獨立深度審查**（billing-cycle 部分） |
| **WP-05** | F-08、F-21（表單） | 原生 POST 失敗回原頁；收斂 3 套報名表單 | `src/app/api/form-submissions/route.ts`、`src/components/landing-pages/funnel-webinar-experience.tsx`、`funnel-page-document-renderer.tsx`、`src/components/lead-form.tsx` | Email 確認規則本身 | C中 R中 S公開 P PII | 400/403/429/503 皆 303 回原頁保留欄位；aria-live 一致 | targeted＋E2E＋a11y | 無 | 否 | 一般 |
| **WP-06** | F-05、F-06 | 修死連結；補「我的夥伴頁」「LINE 整合」入口 | `src/components/app-shell.tsx`、`src/lib/vendor-feature-toggles.ts`、`src/app/(app)/settings/**` | 權限邏輯 | C低 R低 S商家 P無 | 導覽逐項點擊無 404；兩頁可由導覽到達；角色過濾測試通過 | targeted＋E2E smoke | 無 | 否 | 一般 |
| **WP-07** | F-20 | 修 seed；DB 落後自檢；DB 測試命名分層 | `prisma/seed.ts`、`vitest.config.ts`、`scripts/local-database-safety.ts`、需 DB 的測試 | schema、migration | C低中 R低 S開發 P本機 DB | 全新 DB：`migrate deploy`＋`db seed` exit 0 並可登入；落後時啟動前提示；命名與實際相符 | targeted | 無 | 否 | 一般 |
| **WP-08** | F-11 | 工作區與 Dashboard 中文化；導覽與頁名一致 | `src/components/landing-pages/**`、`src/components/landing-page-workspace.tsx`、`src/app/(app)/dashboard/**`、`src/components/app-shell.tsx`、`src/app/(app)/**/page.tsx` 標題 | 資料層識別字 | C中 R低 S商家 P無 | 無英文標題／內部識別字；對照表快照測試 | targeted＋a11y | WP-06 | 否 | 一般 |
| **WP-09** | F-12 | 新增銷講／課程主題模板 | `src/lib/funnel-template-gallery.ts`、`src/components/landing-pages/**` | 既有模板 | C中 R低 S商家 P無 | 名單／Webinar 各 ≥3 個銷講模板可套用並發布 | targeted＋E2E | 內容 | 否 | 一般 |
| **WP-10** | F-17 | platform_admin 未註冊 MFA 禁止進 `/admin/*` | `src/lib/auth.ts`、`src/app/admin/**`、`src/app/mfa/**` | session 儲存格式 | C中 R高(Auth) S平台 P security | 未註冊者導向註冊；已註冊流程不變 | targeted＋E2E | 無 | 否 | **獨立深度審查** |
| **WP-11** | F-18、F-19 | 統一 IP 解析；magic link／voucher 兩段式；補無限流端點 | `src/lib/rate-limit.ts`、`src/lib/request-client-ip.ts`、`src/app/portal/**/access/**`、`src/app/api/automation/vouchers/**`、`src/app/r/**`、`src/app/api/live-admission/**` | 付款路由行為 | C中 R高(Security) S公開 API P security | 偽造標頭無法繞過；兩段式兌換 | targeted＋integration | 部署拓撲 | 否 | **獨立深度審查** |
| **WP-12** | F-16 | 選供應商實作電子發票 adapter，或對外隱藏 | `src/lib/taiwan-electronic-invoice*.ts`、`src/app/api/jobs/electronic-invoices/**`、`src/app/(app)/billing/electronic-invoices/**` | 付款流程 | C高 R高(Billing/稅務) S帳務 P billing | Sandbox 開立並回寫；或 UI 顯示尚未開放 | integration（Sandbox） | D-6 | **是** | **獨立深度審查** |
| **WP-13** | F-23 | 報名→LINE 綁定→開播提醒；模板啟用 LINE；Rich Menu 同步 | `src/lib/line-*.ts`、`src/app/api/webhooks/line/**`、`src/components/message-template-form-client.tsx`、`src/app/(app)/settings/line/**` | 憑證加密邏輯 | C高 R中 S商家＋報名者 P PII | Sandbox 端到端送達；webhook 處理 follow／unfollow | integration＋E2E | WP-04 | **是**（憑證） | 一般 |
| **WP-14** | F-09 | 報名後即時 LINE／行事曆提醒並 A/B 比較二次確認 | `src/app/verify-registration/**`、`src/lib/form-submission-verification*.ts`、funnel A/B | token 安全性 | C中 R中 S公開 P PII | A/B 可設定、指標可讀；token 測試仍通過 | targeted＋E2E | WP-05、WP-13 | 否 | 一般 |
| **WP-15** | F-13、F-14 | 新商家首屏簡化、任務卡預設收合、行動導覽、對比與目標尺寸 | `src/app/(app)/dashboard/**`、`src/components/app-shell.tsx`、`funnel-operations-panel.tsx` | 資料查詢邏輯 | C中 R低 S商家 P無 | axe 0 serious；行動版首屏即主要表單 | a11y＋E2E smoke | WP-08 | 否 | 一般 |
| **WP-16** | F-21、F-24 | 拆分 `actions.ts`；單一路徑；layout 查詢合併 | `src/app/actions.ts`、`src/app/actions/**`、`src/app/(app)/layout.tsx` | 行為變更 | C高 R中 S全站 P無 | 無行為變更；測試不降 | 全量 targeted | WP-01～08 | 否 | 一般 |
| **WP-17** | F-01、F-04、F-26 | **一場即上線**：選影片＋時間表→自動產生報名／感謝／播放頁與提醒；缺項在背景檢查 | `src/app/(app)/lives/new/**`、`src/lib/evergreen-webinar.ts`、`src/lib/funnel-webinar.ts`、`src/lib/landing-page-service.ts`、`src/lib/sales-workspace.ts` | 付款、webhook | C高 R中 S商家＋公開 P無 | 新商家 ≤3 次決策得到可公開、可報名、可播放網址；未就緒不顯示「已發布」 | targeted＋E2E | WP-01 | 否 | 一般 |
| **WP-18** | F-26 | 新增「結帳未完成」trigger＋3 套一鍵追銷範本（未到場／看完未下單／未付款） | `src/lib/automation-workflow.ts`、`src/app/api/payments/checkout/**`（僅發事件）、`src/app/(app)/settings/automations/**` | 價格與冪等邏輯 | C中 R中(Email/Billing 事件) S商家 P事件 | 沙盒：待付款訂單依規則排入信件／LINE；去重與退訂有效 | integration（Sandbox） | WP-04 | 否 | **獨立深度審查**（觸及結帳事件部分） |
| **WP-19** | F-26 | 補 SMS adapter 與計量，或在 UI／文件明示僅 Email＋LINE | `src/lib/message-template.ts`、新增 SMS adapter、`src/components/message-template-form-client.tsx` | 付款 | C中 R中(PII/成本) S商家 P成本 | 供應商 Sandbox 送達與退訂；點數記錄 | integration | D-4 | **是**（供應商） | 一般 |
| **WP-20** | F-26 | 場次分析：報名率、到場率、完看率、平均觀看時長、看完下單率 | `src/app/(app)/lives/[id]/analytics/**`、`src/lib/dashboard-read-model.ts` | 事件寫入邏輯 | C中 R低 S商家 P無 | 指標與資料表一致（合成資料對賬） | targeted | 無 | 否 | 一般 |

---

## 7. 並行／序列與建議批次

- **Batch 0（基礎線，scope 不相交，可並行）**：WP-07、WP-06、WP-05、WP-03（內容需 D-5）。
- **Batch 1**：WP-01 →（D-1 後）WP-17；並行：WP-10、WP-11（各自獨立審查）；WP-04（需 D-6 與授權）。
- **Batch 2**：WP-18、WP-20、WP-08（WP-06 後）；WP-02（需 D-2、D-3）。
- **Batch 3**：WP-13、WP-19（D-4）、WP-12（D-6）、WP-09、WP-14（WP-05、WP-13 後）、WP-15（WP-08 後）。
- **Batch 4**：WP-16（所有行為變更完成後）。
- **單一 writer 約束**：`src/components/app-shell.tsx` 依 WP-06 → WP-08 → WP-15；`src/lib/sales-workspace.ts` 與 `src/lib/landing-page-service.ts` 依 WP-01 → WP-02 → WP-17；`src/app/api/payments/checkout/**` 僅 WP-18 以「發事件」方式觸及且須獨立審查。

---

## 8. 驗收與證據標準

- 每個 WP 完成須有 sanitized evidence（命令、結果、環境身分），未執行不得標 PASS。
- Task READY 經 MCP `assess_task`／`assess_acceptance` gate；路由、handoff、provider 完成不等於驗收。
- 影響公開流程的 WP 須有 E2E（Playwright）與 axe 結果；影響付款／授權的 WP 須有獨立深度審查 findings（BLOCKER／MAJOR／MINOR／NIT）。
- 全新 DB 驗證：`prisma migrate deploy`＋`prisma db seed` exit 0 並可用 seed 帳號登入（WP-07 之後成為所有 WP 的前置 smoke）。

---

## 9. Goal Plan 的期望輸出

Codex 讀完本文件後，請產出**一份 Goal Plan 文件**（建議路徑 `docs/launch/goal-plan-20261011-product-audit.md`，與既有 `goal-plan-20260924.md` 並列），至少包含：

1. Goal 名稱、範圍、不在範圍；基底 `origin/master@efb8b7e9`。
2. 批次（Batch 0～4）與每批的 WP、並行／序列關係、單一 writer 表。
3. 每個 WP 的 task signals（complexity、risk、context、task type、surface、production／security／data impact）、ownership、scope 檔案、驗收條件、驗證方式、依賴、是否需要額外授權與獨立深度審查。**不指定模型**，交由 router。
4. 需人類決策項（D-1～D-6）的狀態與阻擋關係；缺輸入時標 `WAITING_AUTHORIZATION`，不得假設。
5. 風險、停止條件（同一根因無改善即停）、回滾方式、evidence 路徑。
6. 對 `.ai-team/state/goal-state.json` 的初始狀態建議（`IN_PROGRESS`／`WAITING_AUTHORIZATION`）；**僅提出建議，不要在製作計畫階段開始實作任何 WP**。

---

## 10. AI_TEAM_HANDOFF（Plan-only）

```text
AI_TEAM_HANDOFF
CURRENT_TASK_STATUS: COMPLETE
CURRENT_WORK_ITEM: CelebrateDeal 產品審視整合版報告（基底 origin/master@efb8b7e9）
ACTUAL_RESULT: 完整版 docs/reviews/2026-10-11-product-audit.md；整合版 docs/reviews/2026-10-11-product-audit-consolidated.md；證據 docs/reviews/2026-10-11-product-audit/；未修改產品程式碼、未推送、未部署
EVIDENCE: tsc PASS；migrate deploy 96/96 PASS；db seed FAIL(prisma/seed.ts:316)；vitest 179 failed/5257 passed（DB 落後與缺 .git 為主，未逐項歸因）；axe 13 頁 0 違規、Funnel 工作區命中對比／目標尺寸；發布鏈 404 實測；eslint/e2e/audit/secret:scan 未執行
NEXT_ACTION: 由 ai-team-pro 讀取整合版報告並製作 Goal Plan（plan-only，不實作）
ROLLBACK: 本輪僅新增 docs/reviews/** 文件；刪除即可還原
SAFETY_STATUS: PASS
PLAN_REVIEW_STATUS: NOT_REQUIRED
GIT_PROMOTION_STATUS: NOT_REQUESTED
PRODUCTION_DEPLOYMENT: NOT_AUTHORIZED
COPY_TO_NEW_TASK: YES
NEXT_PROMPT_BEGIN
請使用 ai-team-pro。基底為 origin/master（efb8b7e9），不要在使用者目前有未提交變更的工作樹上操作（不得 checkout／reset／clean／stash／restore／rebase 該工作樹）。
任務是「讀取並製作 Goal 任務計畫」，不是實作：
1. 先閱讀 AGENTS.md、docs/ai-team/GOAL-PROTOCOL.md、docs/ai-team/ROUTING.md、docs/ai-team/handoff-schema.md、.ai-team/config/routing-policy.json。
2. 完整閱讀 docs/reviews/2026-10-11-product-audit-consolidated.md；需要細節時再讀 docs/reviews/2026-10-11-product-audit.md 與 docs/reviews/2026-10-11-product-audit/（working-notes.md、screenshots/）。
3. 依整合版報告第 9 節的要求，產出 Goal Plan 文件 docs/launch/goal-plan-20261011-product-audit.md：批次、WP 的 task signals／ownership／scope／驗收／驗證／依賴、單一 writer 表、需人類決策項（D-1～D-6）與阻擋狀態、風險與停止條件、回滾方式、evidence 路徑。不指定實作模型，交由 router 決定；僅對符合 Critical security／Auth／Permission／Payment／Billing／Production data／Migration 的 WP 標示需要獨立深度審查。
4. 製作計畫階段不得實作任何 WP、不得改動產品程式碼、不得推送或部署；缺少授權或外部輸入的項目標示 WAITING_AUTHORIZATION，不得自行假設。
5. 只使用本機／Preview／staging／固定 Sandbox／disposable PostgreSQL 與合成資料；不得讀取或輸出 .env*、Token、Cookie、私鑰、正式 Secret 或正式客戶／付款資料；不得 Production 部署或對正式資料庫操作。
6. 完成後依 handoff-schema.md 的精簡格式回報，未驗證項目如實標示，不得標成 PASS。
NEXT_PROMPT_END
```
