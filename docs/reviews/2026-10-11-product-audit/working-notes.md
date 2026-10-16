# 產品審視 working-notes（2026-10-11）— 審視基底：origin/master

> 續跑用：只讀本檔，從「未完成階段」接著做。證據標註：【實測】【程式碼】【文件宣稱】【推論】【待驗證】。
> 前一輪（錯誤基底 `codex/one-stop-webinar-flow`）的筆記已改名為 `superseded-one-stop-flow-notes.md`，僅供對照，不作為結論來源。

## 環境與基底確認
- 模型：Sonnet 5.5（claude-sonnet-5-5）；推理程度：unknown（環境未揭露對應檔位）。
- 使用者工作樹：branch `codex/one-stop-webinar-flow`、HEAD `60132971`、約 274 個未提交變更。未 checkout／reset／stash／clean，審視前後保持不動。
- 基底決定（使用者於本次對話指示，並經唯讀核對）：
  - `git ls-remote`：`origin/master` = `efb8b7e9`（#422，2026-10-11）【實測】。
  - 本地 `master` ref 為 `584632fc`（過期）；`origin/master` 追蹤 ref 已是 efb8b7e9。
  - 使用者目前分支與 master：merge-base 為 2026-07-19（#117）；master 多 263 commit、該分支多 553 commit；tree diff 1,888 檔（+60k/−155k 行）— master 內容遠大於該分支【實測】。
  - 遠端 `codex/one-stop-webinar-flow` = `b7956d80`（比本地 HEAD 多 1 commit，#214 test 穩定化）。
  - 未合併分支：`codex/notifications-main-20261011` (c1b694ce，PR #420，四渠道通知；master 多 3 commit、該分支多 38 commit，149 檔)、`codex/server-tracking-webhooks-20261007` (831a2bf2，PR #384，Meta 追蹤；master 多 32、該分支多 8)。
  - 結論：與 Codex 回覆一致，`origin/master@efb8b7e9` 是目前最完整、已整合交付的基底；沒有單一分支完成全部 Goal。
  - master 比一頁分支多：7 個 merchant/公開頁（affiliates access/remuneration/policy/payout-policy、products lessons/community、portal/learn community 等）、16 個 API route、20 個 migration；master 缺少 `settings/commissions`、`settings/page`、`affiliate-portal/login`、`checkout/upsell` page 與 `docs/marketing/*`、`docs/product/webinar-funnel.md`（只在一頁分支）。
- 審視方法：`git archive efb8b7e9` 匯出到 scratchpad `master-src`（無 .git、不碰 repo）；依賴在該目錄 `npm ci`（不污染原 node_modules）。報告引用的檔案行號以 master 快照為準。
- 注意：master 的 package.json 為 Next 16.3.8（一頁分支 16.3.5）。

## 已完成階段
- [ ] Phase 1 專案全貌與覆蓋表（master 版）— 進行中：Explore ×2 背景盤點
- [ ] Phase 2 靜態流程與技術審視 + 針對性測試
- [ ] Phase 3 啟動環境與介面實測
- [ ] Phase 4 競品研究（外部事實已先取得，見下）
- [ ] Phase 5 功能取捨與改善排序
- [ ] Phase 6 最終報告與 Codex 交接包

## 舊分支（一頁分支）上已取得、與基底無關的證據（僅作對照，需在 master 重驗）
- 【實測，一頁分支】`tsc --noEmit` exit 0；4 個針對性 vitest 檔 150 tests pass。
- 【實測，一頁分支】完整 `vitest run`：11 files failed / 78 tests failed（4,460 passed、40 skipped）；可見失敗原因含 `RegistrationForm.pageBlocks does not exist in the current database` → 本機 dev DB schema 落後程式（env 漂移）。這會同時阻擋該 DB 上的介面實測。
- 外部競品官方價格頁（WebFetch 2026-10-11）：
  - Systeme.io https://systeme.io/pricing：Free $0／Startup $17／Webinar $47／Unlimited $97；evergreen webinar 在 Webinar 方案；0% 交易費；全方案含 affiliate；未提直播串流。
  - WebinarJam https://home.webinarjam.com/pricing：Starter $49($39 年)／Basic $99($79)／Pro $299($229)／Enterprise $499($379)；全方案含 automated webinar；Basic+ 含 EverWebinar；100/500/2000/5000 人。
  - Demio https://demio.com/pricing：Starter $63 月／$45 年（50 人）；Premium $196/月/host；Growth 未顯示價格；automated 在 Growth+Premium。
  - 在地：幫賣 Bombmy 官網與價格查不到；SHOPLINE 直播僅媒體報導，價格未知（WebSearch standard，無官方頁）。
- 一頁分支才有的產品定位文件 `docs/marketing/audience-and-positioning.md`（2026-08-30）：首波 ICP＝有推廣夥伴的講師／教練／知識型團隊、代理／經銷團隊；非目標＝一般零售／低客單新手；Release 狀態 NO-GO。（master 無此檔，屬【文件宣稱，非 master】）

## 待辦
- 等 Explore #A（merchant 盤點）、#B（公開頁／API／整合／授權）→ 寫入 Phase 1 覆蓋表。
- npm ci 完成後在 master-src 跑 tsc、針對性 vitest、eslint 範圍。
- Phase 3 需使用者決策：dev DB schema 落後（甚至落後一頁分支），master 另有 8~20 個 migration；不經授權不 migrate dev DB、不複製 .env*。

## Phase 2（進行中）發現草稿 — 基底 origin/master@efb8b7e9（路徑為 master 快照內相對路徑）
- 【實測】master 快照 `npm ci` OK；`prisma generate` OK；`tsc --noEmit --incremental false` exit 0。完整 vitest 在快照內執行中（無 .env，DB 測試會 fail-closed／失敗，輸出於 scratchpad/vitest-master.out）。
- D-01（活化斷點，MAJOR）專案發布閘門：`src/lib/sales-workspace.ts:130-140` `canPublishSalesProject` 要求 已定價商品＋啟用中「報名表單」(hasFunnelTemplate=registrationForm.count，`sales-workspace-actions.ts:114`)＋verified PaymentMethodReference＋(直播場次｜諮詢服務+時段)；而 Funnel 公開頁要求所屬專案 published（`src/lib/landing-page-service.ts:249,627`）。`publishLandingPage` 成功訊息「版本 vN 已發布。」（`src/app/actions/landing-page-actions.ts:137-141`）不檢查／不提示專案未發布。【文件宣稱】docs/launch/CURRENT.md：staging 實際出現 publicSurface=NOT_FOUND、專案 DRAFT。【待驗證】UI 是否有其他提示（Phase 3 受 DB 阻擋）。
- D-02（外部依賴，MAJOR）發布閘門中的 verified PaymentMethodReference 需 PayUni 卡片綁定能力；master 已有 setup 方法（`payment-providers/payuni.ts:760-800`），但 docs/launch/CURRENT.md、payuni-token-contract-20260929.md 記載 Token／IP 核准「不確定／尚未申請」且 form_post 尚未支援【文件宣稱，9/29】→ 新商家可能無法完成「發布」。【待驗證】。
- D-03（公開旅程，MAJOR）原生表單 POST 錯誤處理：`src/components/landing-pages/funnel-webinar-experience.tsx:44-52` 以 `method="post" action="/api/form-submissions"`；`src/app/api/form-submissions/route.ts:389-586` 錯誤（400/403/404/429/503，含「Verification email unavailable」）一律回 JSON，只有成功才 303（:607-609）→ 報名者看到原始 JSON、無返回路徑；503 時資料可能已寫入。【程式碼】【待驗證：實測】。
- D-04（資訊揭露／信任，MINOR）報名需 Email 二次確認（`app/verify-registration/page.tsx`；`form-submissions/route.ts`），僅 VERIFIED 可被歸因、收提醒、聊天（`lib/live-chat.ts`、`live-notification-delivery.ts`、`api/payments/checkout/route.ts` verifiedLiveRegistration…）。確認頁品牌為「CelebrateDeal」非商家。【程式碼】；對到場率的影響【待驗證】。
- D-05（重複實作，MINOR）報名表有 3 套實作：`components/lead-form.tsx`、`landing-pages/funnel-page-document-renderer.tsx:300-325`、`funnel-webinar-experience.tsx:44-52`；錯誤播報／欄位屬性不一致（僅 lead-form 與 renderer 有 aria-live／role=alert；webinar 版無）。aria-invalid 全站僅 4 檔（form-builder-client、interaction-script-form、media-upload-field、rich-text-editor）；10/11px 文字 28 處。【程式碼 grep】
- D-06（效能，MINOR）`src/app/(app)/layout.tsx:16-49` 每次伺服器渲染需 ≥4 個串行 DB 往返（subscription → projects/preference → states → counts）。【程式碼】【推論】；docs 記載 staging 曾因跨區延遲 Dashboard 逾時（CURRENT.md）。
- D-07（正向）付款：checkout 價格伺服器端決定、冪等鍵、provider 就緒 fail-closed（`api/payments/checkout/route.ts`）；webhook 簽章→事件冪等 claim→重試（`api/webhooks/payments/route.ts:140-302`）；checkout recovery 只回不可變條款（`api/payments/checkout/recovery/route.ts`）；私訊聊天含 CSRF／同源／限流（`api/live-chat/private/route.ts`）。【程式碼】
- D-08（策略，待驗證）資金流：`Settlement`（grossRevenue→payoutable→finalPayout，schema.prisma:1482）與 `PaymentAccount.mode default "byo"`（:1562）；PAYMENT_PROVIDER 為部署級單一設定。若平台代收商家款項再出款，涉及代收轉付／信託等法遵；master docs 對 代收／信託／第三方支付／電子支付機構 搜尋 0 筆（docs/**）。【推論】【待驗證：法遵】。
- D-09（正向，觀眾端）腳本互動揭露：`components/live-playback.tsx:1053-1058` 固定提示「官方互動為商家預先設定的腳本…」；但字級 11px、白 85% 於半透明黑底（MINOR）。互動角色可選「一般觀眾外觀」（`components/interaction-roles-workbench.tsx:415-416,679-680`）。【程式碼，一頁分支檔案，需在 master 重驗】
- 競品補充（官方頁，2026-10-11）：Accupass Online（https://campaign.accupass.com/advanced-services/accupass-online.html）：直播＋售票報名、上架免費、付費活動低金流手續費、頁面未提回放／提醒；Accupass 部落格：付費票 5%+NT$10/張（https://blog.accupass.com/why-using-accupass.html，搜尋結果摘要）。Zoom Webinars（https://www.zoom.com/en/products/webinars/）：品牌化報名頁、Simulive 預錄、CRM 整合；價格頁抽取無金額（搜尋摘要 $79 起/500 人，未驗證方案對應）。

## Phase 1（master）商家端盤點 — Explore #A（已抽查採用）
- 導覽：navGroups 7 組／42 項（`src/components/app-shell.tsx:15-93`）；owner/admin 六模組全開側欄 5 組 19 項，「設定」17 項移入帳號選單；平台管理員 6 項；support 僅 2 項。預設新商家看不到「諮詢預約」。
- 【已驗證】`/settings/commissions`（nav :76、:171）在 master 無對應路由、next.config 無 redirect（`src/app/(app)/settings` 僅 automations/brand/features/line/security/team/tracking）→ affiliate_program（預設開啟）商家點「分潤規則」404。實際頁為 `/affiliates/policy`。
- 【採信 CONFIRMED】`/partner-pages`、`/settings/line` 無導覽入口（partner-pages 只能從公開 `/team-template` 認領後 redirect 進入）；諮詢模式不啟用 consultation_booking；`PAYMENT_PROVIDER ?? "demo"` 共 7 處；訊息模板 LINE/SMS/購買追蹤 disabled；商家不能直接退款只能交接（commerce-order-detail.tsx:203,231,315）；專案無編輯／封存（sales-workspace-actions.ts 僅 create:78／publish:99）。
- 【REFUTED】超額計費文案矛盾（`mvp-billing-notice.tsx` 在 master 不存在；plans/usage 頁一致「目前未啟用自動超額扣款」）。
- 額外：`/billing/payouts`（nav「稅務匯出」）為唯讀清單、無匯出入口；`/onboarding` 5 步只針對直播流程，諮詢專案建立後仍被導向（merchant-onboarding.ts:46-49）。
- 新模組（master 獨有）：affiliates access／remuneration／policy／payout-policy（COMPLETE）；products lessons（PARTIAL：無刪除／重排、只能貼外部 HTTPS 影片網址）、products community（PARTIAL：商家只能管理、不能回覆）；lives presenter／私訊（COMPLETE）；interaction-scripts upsert（新 API route；舊 server action 仍保留＝重複路徑）。
- 最大檔：`src/app/actions.ts` 2498 行（商家、安全、影片、聯盟、平台財務混合）、live-playback.tsx 1838、payment-webhooks.ts 1293、live-stepper-form.tsx 1233、email-delivery.ts 1220、interaction-actions.ts 1155、media-upload-field.tsx 1127、checkout/route.ts 1061。
- grep（(app) 範圍）TODO／FIXME／coming soon／mock 無命中；「尚未」皆空狀態文案。

## Phase 1（master）公開頁／API／整合／授權 — Explore #B（已抽查採用）
- 公開／參與者路由：(viewer)/live、lp/**（含 play 授權導向）、form、p、checkout（含 @checkout、result、upsell）、portal/**（新增 portal 首頁與 start.html PWA 入口、community）、support/**、affiliate-portal（含 [vendorSlug]/[affiliateId]/remuneration）、r/[code]。API route 共 101 支（admin/ops/payuni 24 支皆走 authorizeWp4Ops＋JOB_SECRET）。
- 【已驗證】vercel.json 無 crons（僅 framework 與 git.deploymentEnabled.master=false）；vercel.staging.json `crons: []`；`.github/workflows` 無 schedule（子代理）。→ Email／LINE／webhook-retry／billing-cycle／inventory 釋放全需外部排程；docs/launch/staging-cron-operations.md 標 PENDING_EXTERNAL。
- 【已驗證】電子發票：`api/jobs/electronic-invoices/route.ts:8-14` 無 adapter → 202、發票永遠 queued（註解自承「No production provider is silently selected」）。
- 【已驗證】LINE Rich Menu 在 master 僅 DB 草稿，無任何對 LINE 的 richmenu API 呼叫；UI 誠實標示「同步至 LINE 的功能尚未開放」（components/line-rich-menu-studio.tsx:29）；LINE webhook 僅驗簽、不處理事件（api/webhooks/line/[vendorId]/route.ts:22-35）。Push／Login 為真實 HTTP。
- 【已驗證】Meta CAPI 伺服器端追蹤在 master 不存在（對應未合併的 PR #384）；只有 settings/tracking 的 pixel id 與 GTM。SMS/WhatsApp 無實作。Stripe 不存在；ecpay-like 為佔位（checkoutReadiness 恆 unavailable）；PayUni 為唯一真實 provider。
- 【已驗證】`rate-limit.ts:26-32` clientIp 直接信任 cf-connecting-ip／x-forwarded-for；僅 live-chat 走 request-client-ip 的 ingress 證明。`cloudflare_waf` 模式應用層直接放行；production env check 對 memory 判 fail（env.ts:330-335）。
- 【已驗證】學員 magic link 以 GET 消耗（portal/[vendorSlug]/access/route.ts:9-31），無限流；信件掃描器可能提前消耗單次 token（【推論】）。vouchers/use 為 POST+CSRF（REFUTED 一頁分支的 GET 疑慮），但導向的 `/api/automation/vouchers/redeem?token=` 為 GET 兌換（限流 60/分）。
- 無限流寫入：`/r/[code]` GET 寫 DB、live-admission DELETE、email/unsubscribe POST（靠 HMAC）。
- MFA：僅已註冊 factor 者才驗證；`requireFinanceAdmin`（lib/auth.ts:320-336）只做 requireAuth＋isPlatformAdmin；登入後僅 `if (auth.user.mfaFactor)` 才導向驗證（auth-security-actions.ts:131）→ 未註冊 MFA 的 platform_admin 可直達 /admin 財務頁（:229 的 setup 導向只在特定敏感流程）。【待驗證】實際敏感頁是否另有 requireVendor*Mfa／平台層強制。
- 小問題：media/videos/status/route.ts:23 角色清單含 `manager`（全域管理角色僅 owner/admin）。
- 租戶隔離：純應用層 vendorId where；單一 PrismaClient；RLS 僅封閉 Supabase Data API，非租戶邊界（schema 64 處複合唯一鍵輔助）。

## 目前 Phase 狀態
- Phase 1：靜態盤點完成（商家端＋公開／API／整合／授權）；介面實測待 Phase 3。
- Phase 2：靜態審視大致完成，針對性測試：tsc PASS；完整 vitest（master 快照、無 .env）執行中。
- Phase 3：受阻擋 — 需 DB schema 對齊 master 的 dev 環境；見「待決策」。

## Phase 3（完成）介面實測 — 基底 master 快照，一次性 DB
- 方法：master-src `npm run dev`（port 31023，已於結束時停止；Next 於快照內改寫 AGENTS.md 屬預期，未碰你的 repo）。DB：在本機可拋棄 Postgres(54329) 另建 `celebratedeal_dev_audit_master_20261011`，`prisma migrate deploy` 96 個 migration 全部成功；`prisma db seed` 在 `prisma/seed.ts:316`（live.create）失敗 "Unknown argument vendorId"，但 Vendor/User/Product/Form 已建立→可登入。實測結束已 DROP 該 DB。
- 登入限流：連續登入觸發 `error=rate_limited`（產品功能）；重啟 dev server 後以 storageState 重用 session。
- 實測重點：F-01（Funnel 已發布但公開 404；將合成專案手動標 published 後頁面出現）、F-03（已發布名單頁顯示「此 Funnel 尚未綁定可公開使用的報名表」）、F-04（/landing-pages/new 無專案時只有一句話）、F-06（/settings/commissions 404）、F-07（/consultations 預設隱藏）、F-10（/policies 暴露內部治理草稿）、F-11/F-12（Funnel 工作區英文＋範本全為公益主題）。
- axe（wcag2a/aa/21/22aa）：13 頁×桌機／行動 0 違規；Funnel operations 頁 color-contrast(serious, 8 nodes, 桌機+行動)，Funnel editor target-size(serious,1)／行動 color-contrast(1)。
- 未實測：直播觀看頁、結帳／付款、學員中心、聯盟入口、LINE、Email 寄送（seed 缺 Live、無外部服務）。
- 收尾核對：repo HEAD=60132971、branch=codex/one-stop-webinar-flow、changes=275（原 274＋docs/reviews）。

## 狀態
- Phase 1–3 完成；Phase 4 外部事實已取得（Systeme/WebinarJam/Demio/Zoom/Accupass 官方頁，2026-10-11）；Phase 5–6 撰寫報告。

## 最終狀態
- [x] Phase 1 PHASE 1 DONE（master 盤點）
- [x] Phase 2 PHASE 2 DONE（tsc／vitest／migrate／seed）
- [x] Phase 3 PHASE 3 DONE（公開頁＋商家端實測、axe、發布鏈流程）
- [x] Phase 4 PHASE 4 DONE（Systeme／WebinarJam／Demio／Zoom／Accupass 官方頁，2026-10-11）
- [x] Phase 5 PHASE 5 DONE（取捨表、改善排序）
- [x] Phase 6 PHASE 6 DONE（報告 `docs/reviews/2026-10-11-product-audit.md`、Codex 交接包）
- 截圖中的 dev 預填帳密區域已遮蔽；證據目錄不含 `.env*` 或任何 Secret。
- 未完成／未驗證：直播觀看頁、結帳、學員中心、LINE、Email 實寄、eslint、e2e、npm audit、secret:scan。
