# 產品審視 working-notes（2026-10-11）

> 續跑用：只讀本檔，從「未完成階段」接著做。所有證據標註：【實測】【程式碼】【文件宣稱】【推論】【待驗證】。

## 環境
- 模型：Sonnet 5.5（claude-sonnet-5-5）；推理程度：unknown（環境未揭露對應檔位）
- Branch：`codex/one-stop-webinar-flow`；HEAD：`60132971f60dbad83aae48ffa6f15d3f57682c6e`
- 工作樹：274 個未提交變更（含 AGENTS.md、.ai-team、docs、scripts、src 等）；審視以工作樹為準，不 reset／clean／stash／restore／checkout。
- Next.js 16.3.5（node_modules 版）；README 寫 16.2.11（文件漂移，MINOR）。

## 已完成階段
- [x] Phase 1 專案全貌與覆蓋表（見下）
- [ ] Phase 2 靜態流程與技術審視 + 針對性測試
- [ ] Phase 3 啟動環境與介面實測
- [ ] Phase 4 競品研究
- [ ] Phase 5 功能取捨與改善排序
- [ ] Phase 6 最終報告與 Codex 交接包

## Phase 1 摘要

### 產品定位【文件宣稱】PRODUCT.md、docs/marketing/audience-and-positioning.md
- 自稱「Cloudflare-first 直播導購 SaaS」（PRODUCT.md）；行銷文件進一步收斂為「靠說明會／銷講影片／直播成交、並需多位夥伴複製同一套內容的台灣小型團隊」（講師、教練、代理／經銷團隊）。
- 差異點（文件宣稱）：影片／直播＋報名＋商品＋互動腳本成一條可追蹤成交流程；受控團隊模板與夥伴頁；夥伴頁歸因；訂單／履約／退款／佣金／課程分潤同一後台。
- 發布狀態：`NO_GO`（docs/report-3、docs/launch/manual-blockers.md）；正式付款、PayUni 對帳證據、Supabase ACL、法遵與 owner 驗收未閉環。

### 規模【實測：指令計數】
- src TS/TSX 1,352 檔、約 10 萬行非測試程式；測試／spec 檔 829；Prisma 約 115 個 model、88 個 migration；(app)+公開頁 page.tsx 131 個、API route.ts 98 個。
- docs 追蹤檔 2,122 個，其中 157 個 `branch-integration-*` 檔；scripts 315 個。治理／證據文件量遠大於產品文件。

### 角色
- 商家端：owner／admin／accountant／support（VendorMember.role）；平台：platform_admin；推廣者：affiliate-portal；學員：portal/[vendorSlug]；匿名報名者／觀眾；購買者（support/orders）。

### 導覽結構【程式碼】src/components/app-shell.tsx:14-91
- navGroups 約 41 項；新商家（預設 5 個 feature module）側欄約 18 項，另 17 項藏在帳號選單。
- 「諮詢預約」不在預設模組內（schema.prisma:108），onboarding 選諮詢模式不會啟用該模組（sales-workspace-actions.ts:40-59）。

### 子代理 #1（商家端 src/app/(app) 盤點）— 已驗證採用的重點
- 【程式碼，已抽查】`/partner-pages` 與 `/settings/line` 沒有任何導覽或內部連結入口（grep：src 全域 `href="/partner-pages"` 僅在頁面自身；`/settings/line` 僅在 revalidatePath）。
- 【程式碼，已抽查】訊息模板 LINE／SMS 渠道 disabled（message-template-form-client.tsx:72-73），但 /settings/line 與 LINE 通知 cron 已存在。
- 【程式碼，已抽查】`PAYMENT_PROVIDER ?? "demo"`（billing/payment-methods/page.tsx:23）。
- 【程式碼，已抽查】超額計費文案矛盾：mvp-billing-notice.tsx:6「已正式啟用」vs billing/plans/page.tsx:217「目前未啟用自動超額扣款」。
- 【程式碼】商家無法直接退款，只能「退款交接給平台財務」（commerce-order-detail.tsx:203，未重驗）。
- 【程式碼】專案頁無編輯／封存（projects/page.tsx，未重驗）。
- 模組狀態：絕大多數 COMPLETE，無硬編碼 demo 資料頁；limited：funnel rawHtml／tracking／affiliate 區塊 disabled（lib/funnel-page-document.ts:113-120）、reCAPTCHA unverified。

### 其他已確認【程式碼】
- 報名需 Email 二次確認（verify-registration/page.tsx；form-submissions/route.ts:296-360）；僅 VERIFIED 名單可聊天、收提醒、被歸因到場次（live-chat.ts:302/597/610；live-notification-delivery.ts:171/274/416/683；payments/checkout/route.ts:1122）。
- 報名 API 有同源檢查、rate limit（10/min）、Email 驗證排程（form-submissions/route.ts:379-385）。
- proxy.ts 只處理 /lp/ 訪客 cookie 與指紋 marker；授權在 (app)/layout.tsx → requireVendorContext。
- (app)/layout.tsx 每次頁面請求執行約 6～10 次 DB 查詢＋把 href 以 `includes` 字串規則映射（layout.tsx:9-38）。
- 測試 harness 路由 /browser-qa/funnel-elements 在 NODE_ENV!=="development" 時 notFound（已確認）。

### 已執行檢查
- `npx tsc --noEmit --incremental false`：exit 0（無型別錯誤）【實測】。

## 覆蓋表（狀態：已審／部分／未審）
| 模組 | 程式 | 實測UI | 備註 |
|---|---|---|---|
| Dashboard／onboarding | 已審（子代理） | 待 Phase 3 | |
| 專案／Funnel／表單 | 部分 | 待 | |
| 直播（建立/presenter/viewer） | 部分 | 待 | |
| 商品／結帳／訂單 | 部分 | 待 | |
| 夥伴／團隊模板／夥伴頁 | 部分 | 待 | 夥伴頁無入口 |
| 帳務／結算／出款 | 部分（子代理） | 待 | |
| 客服／CRM／諮詢 | 部分（子代理） | 待 | |
| 公開頁（lp/live/form/p/checkout/portal/support/affiliate-portal） | 待子代理 #2 | 待 | |
| 認證／租戶隔離／MFA | 待子代理 #2 | — | |
| 整合（PayUni/LINE/Email/Cloudflare） | 待子代理 #2 | — | |

## 外部研究（Phase 4 預備）
- Systeme.io 官方價格頁（WebFetch 2026-10-11）：Free $0／Startup $17／Webinar $47／Unlimited $97；Evergreen webinar 在 Webinar 方案；0% 交易費；affiliate 全方案；未提及直播串流。
- WebinarJam 官方價格頁（WebFetch 2026-10-11）：Starter $49 / $39(年)；Basic $99/$79；Pro $299/$229；Enterprise $499/$379；全方案含 automated webinars；Basic+ 含 EverWebinar。
- Demio 官方價格頁（WebFetch 2026-10-11）：Starter $45(年)/$63(月)，50 人；Premium $196/月/host；Growth 未顯示價格；automated 在 Growth+Premium。
- 在地：幫賣 Bombmy 官網與價格查不到（WebSearch standard 無結果）；repo 內 docs/bombmy_analysis 為內部觀察紀錄（【文件宣稱】）；SHOPLINE 直播功能僅有媒體報導，價格未知。

## 未完成／下一步
- 等子代理 #2 回報（公開路由／API／整合／授權）→ 補覆蓋表。
- Phase 2：抽查付款 checkout、webhook、退款、租戶隔離程式；執行針對性 vitest（auth、form-submissions、checkout、live-chat 等）與 eslint 範圍檢查。
