# 10 Findings 總表（E-01 前置）

> 基線 `review-baseline-2026Q4` = `78621ca3`（分支 `codex/goal-review-2026q4` = origin/master）。產出日 2026-10-19。全程唯讀：只讀 `docs/review-2026Q4/01～04`（摘要與判讀）、`11～21` 全文、`docs/goal-plan-review-research-skills-20261017.md` §2.3／§2.4／§9 與市場研究報告的功能模組決策；沒有改動既有檔案、沒有 git 寫入、沒有讀 `.env*`。
> 本表只整理原報告已有的 finding，沒有新增問題；估工沿用原報告數字，原報告沒有的標「未估」。

## 0. 先講結論

1. Phase B 十一條軸線共 **203 筆原始 finding**（另有 A-04 靜態掃描的 4 項判讀），依根因去重後是 **174 列（F-001～F-174）**，其中 33 列由兩個以上來源合併。
2. 去重後的嚴重度分布：BLOCKER 7、MAJOR 65、MINOR 81、NIT 20、未分級 1（合併列取各來源中最高者）。
3. 7 列 BLOCKER：F-024（B02-01、B03-09、B08-03、B11-02）；F-037（B03-01、B08-02）；F-038（B03-02、B08-04（測試部分））；F-039（B03-03、B08-04（測試部分））；F-042（B03-06、B09-01）；F-058（B04-01）；F-101（B07-01）。
4. 任務指定的六組重複都已合併：admin MFA（F-024）、排程缺口（F-042）、加密金鑰（F-031）、JOB_SECRET 與 ops 端點（F-016）、CSP（F-156）、`actions.ts` 退款死碼（F-003）。其餘合併見第 3 節。
5. 每列的「Backlog 層級」是本次依「封測客戶會不會卡住、錢會不會算錯、資料會不會外洩或無法復原」重新判定的結果，與原報告的「封測前必修」欄並列，兩者不一致處在 `23-remediation-backlog.md` 說明理由。

## 1. 讀法

| 欄位 | 說明 |
|---|---|
| ID | 本表流水號，依主來源（第一個來源 ID）的軸線與編號排序 |
| 來源 ID | 原報告的 finding ID；括號註明只合併該 finding 的某一部分 |
| 軸線 | B01＝架構、B02＝租戶授權、B03＝金流財務、B04＝資料 migration、B05＝Next.js 慣例、B06＝效能成本、B07＝UX／a11y／文案、B08＝測試品質、B09＝觀測／CI／供應鏈、B10＝死碼殘留、B11＝開啟中 PR、A-04＝靜態掃描判讀 |
| 嚴重度 | 沿用原報告；合併列取最高者並保留原報告的條件說明 |
| 估工 | 原報告的數字與單位（人天、人日、天、S／M／L、小時）。B-07 定義 S ≤ 0.5 天、M 0.5–2 天、L > 2 天，B-02、B-05、B-06 的 S／M／L 比照；加總時的換算規則見 `23-remediation-backlog.md` §1.4 |
| 需 owner 決策、封測前必修 | 原報告欄位原文（合併列並列各來源的說法） |
| 修復類別 | `engineer-hard＋reviewer`（付款、checkout、退款、佣金、auth／權限、租戶邊界、migration）、`engineer`、`docs`、`owner 外部`、`設定`；可並列 |
| Backlog 層級 | L0＝封測前必修（2026-11-01 前）、L1＝封測期間可修、L2＝公開上線前、L3＝之後／重構；L0 再分「核心」「可繞過」「設定」，見 `23-remediation-backlog.md` |
| 模組 | 對應 `22-architecture-debt-map.md` 的模組分群 |

## 2. 總表

| ID | 來源 ID | 軸線 | 嚴重度 | 一句問題 | 檔案 | 估工 | 需 owner 決策 | 封測前必修（原報告） | 修復類別 | Backlog 層級 | 模組 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F-001 | B01-01 | B01 | MAJOR | 功能模組的「隱藏」只是客戶端遮罩；伺服器元件、Server Action、API 仍可觸及，`funnel_builder`、`live_webinar`、`consultation_booking`、`analytics_advanced` 完全沒有伺服器端檢查 | `src/components/feature-access-boundary.tsx:1`、`src/components/app-shell.tsx:317`、`src/lib/vendor-feature-toggles.ts:1` | 3–4 人天 | 是：「隱藏」要多嚴格、哪些入口要關 | 是 | engineer-hard＋reviewer | L1（owner 若定義隱藏＝不可觸及，升 L0） | auth／tenant |
| F-002 | B01-02、B07-23（隱藏模組部分） | B01、B07 | MAJOR | 封測要隱藏的課程、billing、Funnel 綁卡沒有任何旗標；綁卡閘門散落 ≥8 個檔案；新商家預設仍看到 payout、既有商家因 normalize 規則全開；6 個帳務導覽項無旗標 | `src/lib/vendor-feature-toggles.ts:1`、`prisma/schema.prisma:82`、`src/lib/landing-page-service.ts:728-753`、`src/lib/live-quota-admission.ts:8`、`src/app/actions.ts:595-613`、`src/components/app-shell.tsx:64-69` | 4–6 人天（含 migration；B07-23 的隱藏部分含在內） | 是：封測模組清單、既有商家是否回填、綁卡閘門關閉後能否繞過配額 | 是 | engineer-hard＋reviewer | L0（可繞過） | billing／settlement |
| F-003 | B01-03、B03-14 | B01、B03 | MAJOR | `refundPaymentTransactionAction` 留有約 182 行不可達的舊 PayUni 退款實作；非 PayUni 交易退款只在本地記帳、不呼叫 provider | `src/app/actions.ts:2156-2454`、`src/lib/payment-providers/index.ts:6-11` | 1–1.5 人天（B03-14 的刪死碼 0.5 小時含在內） | 是：production 是否還有非 PayUni 的正式交易或 provider | 是（B01-03） | engineer-hard＋reviewer | L1 | checkout／payments |
| F-004 | B01-04 | B01 | MAJOR | 限流與審計的來源 IP 優先信任 `cf-connecting-ip`；若流量不經 Cloudflare 代理，攻擊者可偽造標頭繞過登入、註冊、重設密碼、客服、諮詢的 per-IP 限流 | `src/lib/rate-limit.ts:26-32`、`src/app/actions/auth-security-actions.ts:56`、`registration-actions.ts:30` 等 7 處 | 1–1.5 人天 | 是：正式網域 DNS 是否經 Cloudflare 代理、是否強制所有流量經 Cloudflare | 是 | engineer-hard＋reviewer | L0（可繞過） | auth／tenant |
| F-005 | B01-05、A04-判讀3 | B01、A-04 | MAJOR | `src/app/actions.ts` 2,472 行／51 個 export，財務區段約 990 行與一般 CRUD 同檔；債務上限 2,500 只剩 28 行；`payment-webhooks.ts`、checkout route 同為高頻改動大檔 | `src/app/actions.ts`、`scripts/architecture-boundaries.test.ts:185-199` | 約 10–14 人天（5 階段） | 否 | 否 | engineer-hard＋reviewer（階段 0、3）／engineer（階段 1、2、4） | L3（階段 0＝F-003 列 L1） | billing／settlement |
| F-006 | B01-06 | B01 | MAJOR | `src/lib` 340 個頂層檔沒有目錄分層與內部相依規則，最長相依鏈 15 層，資料存取、領域規則、框架耦合混在同一層 | `src/lib/`、`scripts/architecture-boundaries.test.ts` | 規則 1–2 人天；搬移隨各模組工作進行 | 否 | 否 | engineer | L3 | infra／CI |
| F-007 | B01-07、B10-02 | B01、B10 | MAJOR | WP4 Sandbox harness 編進正式 auth、結帳、發票、方案頁；`createWp4PreviewMfaVerifiedSession` 可建立已通過 MFA 的 session，只靠環境變數組合保護 | `src/lib/auth.ts:1-2,142-166`、`src/lib/platform-plan-checkout.ts`、`src/app/api/payments/checkout/route.ts:63,255`、`src/app/actions/invoice-actions.ts:17,181,241`、`src/lib/wp4-runtime-boundary.ts`、`src/lib/wp4-sandbox-fixture.ts` | 2–3 人天 | 是：staging PayUni QA 是否仍需 `wp4-session`（B10-02） | 否（建議 beta 結束前；B10-02 建議列入封測前清單） | engineer-hard＋reviewer | L2 | admin ops |
| F-008 | B01-08 | B01 | MAJOR | PayUni adapter 為一個 zod schema 值匯入 1,302 行的 `payment-webhooks.ts`，載入 adapter 的傳遞閉包 50 個檔案、9 個模組 | `src/lib/payment-providers/payuni.ts:2`、`src/lib/payment-providers/types.ts:2` | 1 人天 | 否 | 否 | engineer-hard＋reviewer | L3 | checkout／payments |
| F-009 | B01-09 | B01 | MAJOR | `processPaymentWebhookOnce` 347 行（complexity 61）在單一交易內扇出佣金、課程分潤、訂閱、推薦、發票、庫存、追蹤等領域 | `src/lib/payment-webhooks.ts:934-1281`、`eslint.config.mjs:39-41` | 8–12 人天 | 否 | 否 | engineer-hard＋reviewer | L3 | checkout／payments |
| F-010 | B01-10 | B01 | MAJOR | 結帳 route 1,100 行包辦驗證、價格、庫存、歸因、冪等、發票、provider、追蹤，含 7 處內聯 Prisma | `src/app/api/payments/checkout/route.ts` | 5–8 人天 | 否 | 否 | engineer-hard＋reviewer | L3 | checkout／payments |
| F-011 | B01-11 | B01 | MINOR | 144 個 page／layout 中 92 個直接查 Prisma（245 處），讀模型只覆蓋 5 處頁面 | `src/app/(app)/lives/[id]/analytics/page.tsx`、`lives/[id]/edit/page.tsx`、`billing/usage/page.tsx`、`admin/billing/dashboard/page.tsx` | 3–5 人天 | 否 | 否 | engineer | L3（layout 部分見 F-089） | 跨模組（共用 UI／殼層） |
| F-012 | B01-12 | B01 | MINOR | 兩個付款相關 webhook route 各自內聯一套 `WebhookEvent` 認領／冪等邏輯，形狀不同，有漂移風險 | `src/app/api/webhooks/payments/route.ts:148,225-290`、`src/app/api/webhooks/payment-methods/route.ts:252,301` | 2 人天 | 否 | 否 | engineer-hard＋reviewer | L2 | checkout／payments |
| F-013 | B01-13、B05-06 | B01、B05 | MINOR | lib 沒有 `server-only` 護欄；客戶端元件為一個常數匯入會 `getDb()` 的模組；2 個 components 直接查 DB | `src/components/form-submissions-workbench.tsx:11`、`src/lib/form-submission-search.ts:1-3`、`src/lib/db.ts`、`src/components/verified-registration-share.tsx:3,11` | 0.5 人天（B01-13）／S（B05-06） | 否 | 否 | engineer | L2 | infra／CI |
| F-014 | B01-14 | B01 | MINOR | `LandingPage.draftContent` 同一欄位存三種格式（Puck v1、PageDocument、FunnelStepPages），靠鍵嗅探與解析順序判別 | `src/lib/landing-page-service.ts:422`、`src/components/landing-pages/workspace-editor.tsx:14-15`、`src/lib/landing-page-content.ts:3-4,136-153` | 1–2 人天 | 是：production 是否存在 Puck 格式草稿／已發佈版本 | 否 | engineer | L3 | forms／funnel／landing |
| F-015 | B01-15、B05-04、B06-04 | B01、B05、B06 | MAJOR | `/lp/*` 每個 GET（含 RSC 預取）都在 proxy 讀整份已發布 content；同一請求 content 讀取解析 3 次、訪客寫入阻擋 TTFB，每次瀏覽至少 6 次 DB 往返 | `src/proxy.ts:34-47`、`src/lib/public-landing-page-status.ts:122-143`、`src/lib/landing-page-service.ts:613-680`、`src/lib/funnel-runtime.ts:100-134`、`src/app/lp/[slug]/page.tsx:55` | 量測 0.5；重構 2–3 人天（B05-04 M／B06-04 M） | 否 | 建議量測（B01-15）；有廣告流量就必修（B06-04） | engineer-hard＋reviewer | L1（量測）／L2（重構；封測導入廣告流量則升 L1） | forms／funnel／landing |
| F-016 | B01-16、B02-09、B03-21、B10-01 | B01、B02、B03、B10 | MAJOR | 28 條 `/api/admin/ops/**` 隨正式 bundle 部署；其中 5 條（test-email、test-analytics、test-monitoring、cloudflare×2）與 `/api/cloudflare/*` 只靠與 cron 共用的 `JOB_SECRET`，可帶任意 vendorId；先回 401 再判斷環境 | `src/app/api/admin/ops/**`、`src/app/api/cloudflare/direct-upload/route.ts:5-16`、`src/lib/api-security.ts:30-32`、`src/lib/wp4-runtime-boundary.ts:20-24`、`src/proxy.ts` | ①proxy 正式環境 404：0.5；②獨立 `OPS_SMOKE_SECRET`：1；③建置期排除：2（B01-16）／0.5–1（B03-21）；B02-09：S | 是：正式環境是否仍需 smoke 端點；Vercel 各環境 `JOB_SECRET` 是否不同 | 建議（B10-01①、B02-09） | engineer-hard＋reviewer；設定 | L0（①，可繞過）／L2（②③） | admin ops |
| F-017 | B01-17 | B01 | MINOR | 文件宣稱「Cloudflare-first」，實況是 Vercel＋Supabase、Cloudflare 只有 Stream 與 R2；Turnstile、Workers、WAF 在程式中無證據 | `PRODUCT.md:16`、`README.md:3`、`docs/production-infrastructure-plan.md:7,32` | 0.2 人天 | 是：改不改宣稱、是否保留 Cloudflare 代理 | 否 | docs | L1 | infra／CI |
| F-018 | B01-18、B10-06、B07-33 | B01、B10、B07 | MINOR | knip 未使用檔案中 9 個可直接刪（`funnel-blocks/*` 5 檔、`interaction-role-form`、`interaction-role-label`、`funnel-templates`、`wp4-payuni-sandbox-checkout`，約 490 行），另有 fixture 放錯位置 | `src/components/funnel-blocks/*`、`src/components/interaction-role-form.tsx`、`src/lib/funnel-templates.ts`、`src/lib/wp4-payuni-sandbox-checkout.ts` | 0.5 人天（B10-06）／1 人天（B01-18 涵蓋全部 19 檔） | 是（B01-18：funnel-blocks 是否還有計畫） | 否 | engineer | L2 | forms／funnel／landing |
| F-019 | B01-19、B10-08 | B01、B10 | MINOR | 4 個 lib 只被自己的測試引用；其中常青直播設定可在後台儲存，但排程狀態機沒有正式程式呼叫（推論，未實測） | `src/lib/evergreen-webinar.ts`、`src/components/evergreen-webinar-settings.tsx`、`src/app/(app)/lives/[id]/edit/page.tsx:32-66`、`src/lib/ab-testing.ts`、`src/lib/ai-funnel-assistant.ts`、`src/lib/interaction-card-media.ts` | 0.5 人天（B01-19 確認＋隱藏）＋0.25 人天（B10-08 決定後） | 是：保留、接線或隱藏；是否為路線圖功能 | 建議（B01-19 確認即可） | engineer | L0（常青設定，可繞過）／L2（其餘 3 個 lib） | live／interaction |
| F-020 | B01-20、B04-23、B10-12 | B01、B04、B10 | MINOR | `docs/codex-goal/*` 停在 7～8 月：ARCHITECTURE_BOUNDARIES 數字過期且 `actions.ts` 上限只升不降；PRISMA_INVARIANTS 重複矛盾；DOCUMENT_AUTHORITY 指向過期快照 | `docs/codex-goal/ARCHITECTURE_BOUNDARIES.md`、`docs/codex-goal/PRISMA_INVARIANTS.md`、`docs/codex-goal/API_CONTRACT_REGISTRY.md`、`docs/DOCUMENT_AUTHORITY.md`、`scripts/architecture-boundaries.test.ts:198` | 0.5（B01-20）＋0.5（B04-23）＋1.5（B10-12，部分重疊）→ 1.5–2.5 人天 | 否 | 否 | docs | L2 | infra／CI |
| F-021 | B01-21 | B01 | NIT | #261 的功能開關相關 7 個檔案被壓成單行，diff、blame、行號引用全部失效 | `src/components/vendor-feature-management.tsx`、`src/lib/vendor-feature-toggles.ts`、`src/components/feature-access-boundary.tsx`、`src/app/(app)/settings/features/page.tsx` | 0.1 人天 | 否 | 與 B01-01 同時 | engineer | 隨 F-002（L0 可繞過）／F-001（L1）先做 | auth／tenant |
| F-022 | B01-22 | B01 | NIT | `auth.ts` 429 行同時含 session、12 個授權 guard、密碼驗證、MFA secret 讀取與 WP4 | `src/lib/auth.ts` | 1 人天 | 否 | 否 | engineer-hard＋reviewer | L3 | auth／tenant |
| F-023 | B01-23、B10-05、B10-14、B04-24 | B01、B10、B04 | NIT | 倉庫殘留：已追蹤的 tmp PNG、SQLite migration archive、舊 AI Team 交接檔；本機空資料夾、`error.log`、`prisma/dev.db` | `tmp/pdfs/agy-review/*.png`、`prisma/migrations_sqlite_archive/`、`reports/manual-handoff/*`、`src/app/__test/`、`src/app/sentry-example-page/` | 0.2＋0.25＋0.1 人天＋1 分鐘 ≈ 0.6 人天 | 否（本機 `dev.db`、`error.log` 由 owner 刪除） | 否 | engineer | L2 | infra／CI |
| F-024 | B02-01、B03-09、B08-03、B11-02 | B02、B03、B08、B11 | BLOCKER | 沒有 MFA factor 的平台 admin 可直接進 `/admin/**`、執行正式退款、月結、出款、解密銀行帳號匯出；現有測試把漏洞釘為預期；修正 PR #436 與 master 衝突（CRLF 假衝突） | `src/lib/auth.ts:242,320-336`、`src/app/admin/layout.tsx:5`、`src/lib/auth.test.ts:224-229`、`tests/e2e/wp88-direct-url-guard-matrix.spec.ts` | S（B02-01）／0.5–1（B03-09）／0.5（B08-03）／0.5 小時（B11-02）→ 0.5–1 人天 | 否（已有 PR #436；合併需 owner 說 OK） | 是 | engineer-hard＋reviewer | L0 | auth／tenant |
| F-025 | B02-02 | B02 | MAJOR | 夥伴入口與團隊上下線只能授權給既有 VendorMember，沒有最小權限的 partner 角色：accountant 可看全部夥伴佣金並標記任何出款、support 可讀全部買家客服 PII | `src/app/actions/vendor-member-actions.ts:17`、`src/lib/affiliate-portal.ts:27`、`src/lib/auth.ts:16,338-355`、`src/app/(app)/affiliates/commissions/page.tsx:27`、`src/app/actions.ts:1739-1741` | M–L | 是：產品身分模型 | 是，若封測包含 affiliate portal 或團隊漏斗 | engineer-hard＋reviewer | L0（可繞過） | affiliate |
| F-026 | B02-03、B04-08 | B02、B04 | MINOR | 7/24 之後新增的 77 張表沒有開 RLS；DB 層無任何租戶隔離，Supabase Data API 能否讀到訂單、客服、付款參考等 PII，取決於預設權限是否真的收回 | `prisma/migrations/20260724150000_harden_supabase_data_api/migration.sql`、`20260808110000`、`20260808220500` 等後續 migration | S（B02-03）／0.5 人天（B04-08） | 否（唯讀查詢需 owner 授權連 staging／production） | 建議是（B02-03）；查到 anon／authenticated 有權限即升 BLOCKER（B04-08） | engineer-hard＋reviewer | L0（唯讀驗證；有權限則同日補 migration）／L1（CI catalog 測試） | auth／tenant |
| F-027 | B02-04 | B02 | MINOR | 商家 owner／admin／accountant 的 MFA 是選用；綁卡、成員管理、銀行資料、憑證、PII 匯出只靠密碼；`requireVendor*Mfa` 名稱有 MFA 卻不強制 | `src/lib/auth.ts:298-318,338-378` | M | 是 | 視封測商家規模決定 | engineer-hard＋reviewer | L1 | auth／tenant |
| F-028 | B02-05 | B02 | MINOR | `RATE_LIMIT_PROVIDER=cloudflare_waf` 時 app 內所有限流直接放行，包括以 userId 為鍵的 MFA 驗證與復原碼重產；preflight 卻視 WAF 為合格 | `src/lib/rate-limit.ts:151-154`、`src/lib/env.ts:329-341`、`src/app/actions/auth-security-actions.ts:224-235` | S–M | 是：確認 production 實際 provider | 建議是 | engineer-hard＋reviewer | L1 | auth／tenant |
| F-029 | B02-06 | B02 | MINOR | 「新增成員」可跨租戶探測 email（是否為平台 admin、是否停權），並直接把他租戶的有效使用者加成 active 成員，沒有邀請接受流程 | `src/app/actions/vendor-member-actions.ts:58-66,92-93` | M | 否 | 否 | engineer-hard＋reviewer | L2 | auth／tenant |
| F-030 | B02-07 | B02 | MINOR | 學員 portal session 是 30 天無狀態 bearer，伺服器端無法撤銷，登出只刪 cookie | `src/lib/student-portal-auth.ts:16-19,283-347` | M | 否 | 否 | engineer-hard＋reviewer | L2 | courses／portal |
| F-031 | B02-08、B04-03 | B02、B04 | MAJOR | MFA secret、LINE／Meta 憑證、PII envelope 等加密與 HMAC 金鑰都由 `CSRF_SECRET` 衍生（非 production 退回 `JOB_SECRET`），envelope 無 key id：輪替即全部密文不可解，還原備份時沒保存當時的 secret 也不可讀 | `src/lib/sensitive-data.ts:6-19`、`src/lib/env.ts:87-98`、`docs/staging-production-env-vars.md:21`、`docs/production-backup-restore-runbook.md` | ①文件註明根金鑰 0.5；②③獨立 keyring＋re-encrypt＋移除 fallback 3–4（B04-03）／M（B02-08） | 是：金鑰保管與輪替政策 | ①是；②③否（越晚改越貴） | docs（①）；engineer-hard＋reviewer（②③） | L0（①）／L2（②③） | infra／CI |
| F-032 | B02-10 | B02 | NIT | 兩個 route 以請求 `Origin` 當 303 轉址 base（目前因 CSRF 先擋而不可利用） | `src/app/api/interaction-scripts/upsert/route.ts:11-13`、`src/app/api/orders/shipping/route.ts:4-17` | S | 否 | 否 | engineer | L2 | auth／tenant |
| F-033 | B02-11 | B02 | NIT | Origin 與 Referer 都缺（或 Origin 為 null）時 origin 檢查直接放行 | `src/lib/csrf.ts:65-68`、`src/lib/api-security.ts:102` | S | 否 | 否 | engineer-hard＋reviewer | L2 | auth／tenant |
| F-034 | B02-12 | B02 | NIT | `"use server"` 檔匯出非 action helper，成為公開端點（`reserveConsultationBooking` 繞過 CSRF；`getConsultationSlots` 無限流） | `src/app/actions/consultation-actions.ts:381,442`、`interaction-actions.ts:893`、`funnel-operations-actions.ts:7` | S | 否 | 否 | engineer | L2 | auth／tenant |
| F-035 | B02-13 | B02 | NIT | 推薦短連結 `/r/[code]` 沒有限流，每次 GET 寫一筆 `PlatformReferralClick` | `src/app/r/[code]/route.ts:9-29`、`src/lib/platform-referral.ts:32` | S | 否 | 否 | engineer | L2 | affiliate |
| F-036 | B02-14、B09-20 | B02、B09 | NIT | 平台無法凍結整個租戶；session cookie 無 `__Host-` 前綴、`secure` 綁 `NODE_ENV`；admin session 14 天且敏感操作無 step-up | `prisma/schema.prisma:68-84`、`src/lib/auth.ts:14,42-51` | M（B02-14）／2 小時（B09-20） | 是 | 否 | engineer-hard＋reviewer | L2 | auth／tenant |
| F-037 | B03-01、B08-02 | B03、B08 | BLOCKER | PayUni 付款回呼只看 `Status`，不檢查 `TradeStatus`／`PaymentType`：刷卡失敗、取消、ATM／超商剛取號都被記為 paid（開通課程、算佣金、計入月結）；測試 fixture 全是自創欄位，所以抓不到 | `src/lib/payment-providers/payuni.ts:876-884,959-1002`、`src/lib/payment-providers/payuni.test.ts:636-690`、`src/lib/payment-providers/payuni-fixtures.ts` | 1–1.5 人天（B03-01）＋1–2 人天（B08-02 真實格式 fixture） | 是：正式商店開了哪些付款方式；需 Sandbox 實際回呼樣本 | 是 | engineer-hard＋reviewer | L0 | checkout／payments |
| F-038 | B03-02、B08-04（測試部分） | B03、B08 | BLOCKER | 月結把商家付給平台的方案費與帳單款（`billingPurpose` 為 `platform_subscription_checkout`／`invoice_payment`）算成商家營收，經撥款全額退回商家；沒有回歸測試 | `src/lib/billing.ts:203-209,294,309-311`、`src/lib/platform-plan-checkout.ts:412-420`、`src/app/actions/invoice-actions.ts:165-178`、`src/lib/billing.test.ts` | 0.5–1 人天（B08-04 的 2 天測試含在 B-03 修復工時內） | 否 | 是（如果封測會做商家撥款） | engineer-hard＋reviewer | L1（封測免費且最早月結在 12 月；開始撥款前必修） | billing／settlement |
| F-039 | B03-03、B08-04（測試部分） | B03、B08 | BLOCKER | 退款歸屬月份由表單決定、預設原銷售月（通常已鎖定），下月月結也不納入；超過當月營收的退款被 `Math.max(0, …)` 吃掉，跨月退款成為平台淨損失 | `src/app/admin/billing/dashboard/page.tsx:173`、`src/app/actions.ts:2146`、`src/lib/billing-cycle.ts:116`、`src/lib/billing.ts:210-221,295` | 1.5–2 人天 | 是：負餘額結轉還是向商家請款 | 是（如果封測會做商家撥款） | engineer-hard＋reviewer | L1（開始撥款前必修） | billing／settlement |
| F-040 | B03-04 | B03 | MAJOR | 真實 PayUni 回呼沒有 `NetAmount`／`GatewayFee`，每次 paid 都把 `netAmountCents` 覆寫成 0：月結不扣手續費、佣金與課程撥款的 netReference 全為 0 | `src/lib/payment-providers/payuni.ts:987-989`、`src/lib/payment-webhooks.ts:991-999`、`src/lib/billing.ts:296-298,310` | 1 人天 | 是：金流費由誰負擔、費率怎麼算 | 是 | engineer-hard＋reviewer | L1（首次月結前；封測期間資料之後依費率回算） | checkout／payments |
| F-041 | B03-05、B08-04（測試部分） | B03、B08 | MAJOR | 商品可設任意 3 碼幣別，checkout 仍把 `priceCents/100` 當台幣送 PayUni（USD 50.00 只收 NT$50）；月結跨幣別直接加總 | `src/app/actions/product-actions.ts:153,165`、`src/components/product-form-client.tsx:309`、`src/app/api/payments/checkout/route.ts:897`、`src/lib/payment-providers/payuni.ts:159-168` | 0.5 人天 | 否 | 是 | engineer-hard＋reviewer | L0（可繞過） | checkout／payments |
| F-042 | B03-06、B09-01 | B03、B09 | BLOCKER | repo 內沒有任何排程驅動 9 個 `/api/cron`、`/api/jobs` 端點（測試還禁止 `vercel.json` 加 crons）：交易信、開播提醒、LINE、學員通知、付款 webhook 重試、庫存保留釋放、月結都不會自動執行；4 個 job 只收 POST＋`JOB_SECRET`，Vercel Cron 無法直接驅動 | `vercel.json`、`vercel.staging.json`、`.github/workflows/*`、`src/app/api/jobs/email-deliveries/scheduler-config.test.ts:5-14`、`src/app/api/jobs/webhook-retry/route.ts:38-60` | 1–2 人天（B09-01）／0.5 人天＋owner 選定方案（B03-06） | 是：排程平台與頻率；repo 外是否已有排程 | 是 | engineer-hard＋reviewer；owner 外部 | L0 | infra／CI |
| F-043 | B03-07 | B03 | MAJOR | 庫存保留過期後才收到 paid 且商品已售完時，整筆付款交易 rollback、重試後 exhausted：買家已被扣款、訂單停在未付，沒有自動退款或告警 | `src/lib/inventory-reservations.ts:9,445-456`、`src/lib/payment-webhooks.ts:1069-1074`、`src/lib/payment-providers/payuni.ts:876-884` | 1–1.5 人天 | 是：超賣時自動退款還是人工處理 | 是（和 B03-06 一起修） | engineer-hard＋reviewer | L0（可繞過） | checkout／payments |
| F-044 | B03-08 | B03 | MAJOR | 月結先從商家撥款扣除聯盟佣金，但聯盟出款設計為商家自付後回報、平台沒有撥給聯盟的路徑（`payoutItemId` 從未寫入）：商家被扣兩次，或款項沒有出口 | `src/lib/billing.ts:222-231,310`、`src/app/actions.ts:1614-1705,2058-2060` | 0.5 人天（方案 b 商家自付）／5 人天以上（方案 a 平台代扣代付） | 是：二選一 | 是（影響「只累計不出款」） | engineer-hard＋reviewer | L1（開始撥款前必修） | affiliate |
| F-045 | B03-10 | B03 | MINOR | 後台 PayUni 退款路徑不釋放庫存、也不排電子發票作廢／折讓（webhook 退款路徑都會） | `src/lib/payuni-refund-execution.ts:138-205` | 0.5 人天 | 否 | 否 | engineer-hard＋reviewer | L1 | checkout／payments |
| F-046 | B03-11 | B03 | MINOR | 結果不明的退款保留在 PayUni 確認「沒有退款」後無法標為 failed，該交易從此不能再退款 | `src/lib/payuni-refund-reconciliation.ts:160-165`、`src/lib/payuni-refund-execution.ts:124-135` | 0.5 人天 | 否 | 否 | engineer-hard＋reviewer | L1 | checkout／payments |
| F-047 | B03-12 | B03 | MINOR | 外層 Status 非 SUCCESS 的已簽章回呼被當 invalid_payload（400），不建 WebhookEvent、不標 failed、不保留錯誤碼 | `src/lib/payment-providers/payuni.ts:63-77`、`src/app/api/webhooks/payments/route.ts:208-220` | 0.5 人天 | 否 | 否 | engineer-hard＋reviewer | L1 | checkout／payments |
| F-048 | B03-13 | B03 | MINOR | 未知訂單的 paid 回呼只要帶 vendorId 或 slug 就建立權威付款，並以 payload 的 referralCode／commissionRateBps 產生佣金（需驗證） | `src/lib/payment-webhooks.ts:304-306,981-983,1044-1060,1170` | 0.5 人天 | 否 | 否 | engineer-hard＋reviewer | L1 | checkout／payments |
| F-049 | B03-15 | B03 | MINOR | 退款金額與月結 adjustment 的解析很寬鬆（`1e3`、`12abc` 會被接受），adjustment 理由可空、無上限、單人操作 | `src/app/actions.ts:144-149,1530-1552` | 0.5 人天 | 是：覆核門檻 | 否 | engineer-hard＋reviewer | L1 | billing／settlement |
| F-050 | B03-16（唯一鍵部分）、B04-06 | B03、B04 | MAJOR | 訂單號 `CD-<秒>-<Math.random 6 碼>` 沒有 DB 唯一約束；PayUni 回呼以 `(providerName, orderNumber)` 跨租戶反查且無索引：撞號時已付款訂單永遠無法入帳，量大時每筆回呼全表掃描 | `prisma/schema.prisma:1755,1785`、`src/app/api/payments/checkout/route.ts:147-151`、`src/app/actions/invoice-actions.ts:68-72`、`src/lib/platform-plan-checkout.ts:218-221`、`src/lib/payment-webhooks.ts:237-251` | 1 人天（B04-06；B03-16 唯一鍵部分含在內） | 否（D-005 已有方向） | 是（B04-06） | engineer-hard＋reviewer | L1（封測交易量低，碰撞機率可忽略；公開上線前必修） | checkout／payments |
| F-051 | B03-17 | B03 | MINOR | 綁卡時的 NT$1 授權（自動請款）不退回、也不記成交易，PayUni 對帳單與系統 ledger 不一致 | `src/lib/payment-providers/payuni.ts:910-923` | 0.5–1 人天 | 是 | 否 | engineer-hard＋reviewer | L2 | billing／settlement |
| F-052 | B03-18 | B03 | MINOR | 商家出款政策停用（預設）時仍可把聯盟出款標為 paid、不需扣繳快照；沒有平台層開關落實「封測不出款」 | `src/lib/affiliate-remuneration-quotes.ts:119`、`src/app/actions.ts:1802` | 0.5 人天 | 是 | 是（若要落實「不出款」） | engineer-hard＋reviewer | L0（可繞過） | affiliate |
| F-053 | B03-19 | B03 | MINOR | 付款 webhook 沒有 rate limit，每次簽章失敗都寫一筆 AuditLog，可被放大寫入 | `src/app/api/webhooks/payments/route.ts:198-205`、`src/app/api/webhooks/payment-methods/route.ts:230-237` | 0.5 人天 | 否 | 否 | engineer-hard＋reviewer | L2 | checkout／payments |
| F-054 | B03-20 | B03 | MINOR | 作廢已鎖定的佣金時不重算 pending AffiliatePayout，出款卡在 conflict；已 paid 佣金退款後負餘額無追回或下期扣抵 | `src/app/actions/affiliate-actions.ts:31-56`、`src/lib/payment-refund-accounting.ts:120-123` | 0.5 人天 | 是：追回政策 | 否 | engineer-hard＋reviewer | L2 | affiliate |
| F-055 | B03-22、B04-14（重試部分） | B03、B04 | MINOR | Serializable 交易 65 處沒有共用重試，庫存保留 3 次、webhook 2 次且無退避／jitter；直播快閃熱點商品大量 502（需壓測驗證） | `src/lib/inventory-reservations.ts:11,159-177`、`src/lib/payment-webhooks.ts:1291-1301` | 1 人天（B03-22）／1.5 人天（B04-14，含連線池 preflight，該部分見 F-090） | 是：預期最高併發 | 否 | engineer-hard＋reviewer | L1 | checkout／payments |
| F-056 | B03-23 | B03 | NIT | checkout route 沒有明確斷言 `checkoutAmountCents > 0` 且等於伺服器報價，靠下游擋 | `src/app/api/payments/checkout/route.ts:860-862` | 0.5 小時 | 否 | 否 | engineer-hard＋reviewer | L2 | checkout／payments |
| F-057 | B03-24 | B03 | NIT | PayUni Token 契約文件說 disposition 會拒絕 form_post，與現行程式不符 | `docs/launch/payuni-token-contract-20260929.md:20` | 0.5 小時 | 否 | 否 | docs | L2 | billing／settlement |
| F-058 | B04-01 | B04 | BLOCKER | Production 從來沒有備份或還原證據；唯一真實來源還原演練是 07-22（58 條 migration，現為 108）；runbook 寫 Supabase Free（無 managed backup、無 PITR）；staging 加密恢復 runner 缺金鑰仍 BLOCKED | `docs/production-backup-restore-runbook.md`、`docs/production-go-live-checklist.md:99-100`、`.github/workflows/staging-backup-recovery.yml` | 1–2 人日（不含方案採購） | 是：Supabase 方案與費用、RPO／RTO、備份保管人 | 是（若封測不收真實款項可降為 MAJOR） | owner 外部；engineer-hard | L0 | infra／CI |
| F-059 | B04-02 | B04 | MAJOR | 財務與帳務表對 Vendor 的 FK 全是 ON DELETE CASCADE（全 schema 192 個 Cascade）：一次刪除 Vendor 會清掉付款、退款、結算、發票、佣金；AuditLog 對 Vendor 是 SetNull | `prisma/schema.prisma:1561,1592,1771,1826,2459-2460,2511,2657`、baseline `migration.sql:851-887` | 1.5 人日 | 是：商家終止時的資料保存政策 | 否（封測後、正式收費前） | engineer-hard＋reviewer | L2 | infra／CI |
| F-060 | B04-04 | B04 | MAJOR | schema 與 DB 實際索引漂移（4 個 partial unique、3 個 trgm GIN、3 個一般索引、3 處名稱不符），CI 沒有 drift 檢查；任何人跑一次 `migrate dev` 就可能產生 DROP INDEX，拔掉防重複預約與防重複抵扣的唯一性 | `prisma/schema.prisma`、`.github/workflows/ci.yml:87-91`、`package.json:40` | 1–1.5 人日 | 否 | 是（CI 檢查） | engineer-hard＋reviewer | L0（可繞過） | infra／CI |
| F-061 | B04-05 | B04 | MAJOR | seed 第 8 行拒絕所有非 loopback DB，`SEED_MODE=production-bootstrap` 成為死碼，repo 內沒有建立 Production `BillingPlan` 的途徑；bootstrap 重跑還會把已調整的價格蓋回 seed 值 | `prisma/seed.ts:8,76-99`、`docs/production-database-runbook.md:141-160` | 0.5–1 人日 | 是：正式方案價格與 code | 是（若封測要商家付費訂閱） | engineer-hard＋reviewer | L2（封測免費；若封測跑 Production 且配額依方案則升 L0） | billing／settlement |
| F-062 | B04-07、B03-16（CHECK 部分） | B04、B03 | MAJOR | 核心帳務表（PaymentTransaction、RefundRecord、Settlement、PayoutItem 等）CHECK 為 0、status 為自由字串，付款狀態預設竟是 `"paid"`；`RefundRecord.providerEventId` 不唯一 | `prisma/schema.prisma:1757-1763` | 1.5 人日（B04-07）／1 人天（B03-16） | 否 | 否（正式收費前） | engineer-hard＋reviewer | L2 | checkout／payments |
| F-063 | B04-09 | B04 | MINOR | 18 個 migration 的名稱順序與實際合併順序不一致，CI 沒有單調性檢查，staging 與全新環境的 DDL 套用順序不同 | `prisma/migrations/` | 0.5 人日 | 否 | 否 | engineer-hard＋reviewer | L2 | infra／CI |
| F-064 | B04-10 | B04 | MINOR | Production migration 只有手動指令：沒有 workflow、沒有 lock／statement timeout、沒有 P3009 失敗 SOP、deploy 前不備份；所有 migration 未用 CONCURRENTLY／NOT VALID | `docs/production-database-runbook.md` §5、§8、`.github/workflows/staging-migrate.yml` | 1.5 人日 | 是：誰能核准 Production migration | 否（第一次 Production migration 前必修） | engineer-hard＋reviewer；owner 外部 | L1（若封測使用 Production，升 L0） | infra／CI |
| F-065 | B04-11 | B04 | MINOR | `db:migrate`（migrate dev）沒有目標 DB 防護且自動載入 `.env.local`；拉了遠端環境變數後執行可能提示重設遠端 DB；staging buildCommand 會退回 `DATABASE_URL` | `prisma.config.ts:6-17`、`package.json:40-41`、`vercel.staging.json` | 0.5 人日 | 否 | 否 | engineer-hard＋reviewer | L1 | infra／CI |
| F-066 | B04-12 | B04 | MINOR | PayoutItem 對 `(vendorId, settlementId)` 沒有唯一約束，只靠 CAS 防重複撥款 | `prisma/schema.prisma:1618-1644`、`src/app/actions.ts:1936-1968` | 0.25 人日 | 否 | 否 | engineer-hard＋reviewer | L2 | billing／settlement |
| F-067 | B04-13 | B04 | MINOR | 回呼 eventId 實際退化為 TradeNo（一筆交易一個 ID）：若 PayUni 對同一 TradeNo 推送退款或爭議通知，會被當重複事件吞掉 | `src/lib/payment-providers/payuni.ts:974`、`src/app/api/webhooks/payments/route.ts:224-255` | 0.5 人日 | 否 | 否（確認 PayUni 會推送退款通知則升 MAJOR） | engineer-hard＋reviewer | L1 | checkout／payments |
| F-068 | B04-15 | B04 | MINOR | Settlement、PayoutBatch 等聚合金額是 int4，單月或單批超過約 NT$2,147 萬即 `integer out of range`，月結或出款卡住 | `prisma/schema.prisma:1576-1580,1604` | 1 人日 | 否 | 否 | engineer-hard＋reviewer | L2 | billing／settlement |
| F-069 | B04-16 | B04 | MINOR | 423 個 DateTime 都是 timestamp without time zone，正確性完全依賴 DB session TimeZone=UTC，沒有檢查 | `prisma/schema.prisma`、`src/lib/dashboard-read-model.ts:223-232` | 0.25 人日 | 否 | 否 | engineer | L2 | infra／CI |
| F-070 | B04-17 | B04 | MINOR | 隱私政策承諾人工處理刪除，卻沒有 runbook 或工具；FormSubmission PII 明文且被 Restrict 參照；WebhookEvent、AuditLog、AnalyticsEvent 沒有保存期限 | `src/lib/public-policy-content.ts:140-141,155`、`prisma/schema.prisma:614-650` | 2–3 人日 | 是：保存期限 | 否（封測前至少完成 runbook） | docs（runbook）＋engineer-hard＋reviewer（去識別化腳本） | L1（runbook 建議封測第一週內完成，未單獨估工） | infra／CI |
| F-071 | B04-18 | B04 | MINOR | 高頻查詢缺索引或欄位順序不合（AffiliateClick、InteractionEvent、CommerceOrder 等，推估） | 見 `14-data-migration.md` 索引建議表 | 1 人日 | 否 | 否 | engineer-hard＋reviewer | L2 | infra／CI |
| F-072 | B04-19 | B04 | MINOR | 刪除 LandingPage 會串聯刪除 FunnelVisit 與 FunnelSubmission（來源與歸因紀錄），刪除前不檢查是否已有流量 | `prisma/schema.prisma:3837,3856`、`src/lib/landing-page-service.ts:553` | 1 人日 | 是：產品行為 | 否 | engineer-hard＋reviewer | L1 | forms／funnel／landing |
| F-073 | B04-20 | B04 | MINOR | 沒有任何寫入 PaymentAccount 的 app 路徑，商家撥款帳號只能人工 SQL 建立並寫入明文 legacy 欄位；backfill 單一交易易逾時 | `prisma/schema.prisma:1655-1658`、`src/lib/bank-account.ts:229-240`、`scripts/backfill-bank-account-encryption.ts:176-218` | 1 人日 | 否 | 否（若封測需撥款給商家則是） | engineer-hard＋reviewer | L1（開始撥款前） | billing／settlement |
| F-074 | B04-21 | B04 | MINOR | `pg_trgm` 未指定 schema、`gin_trgm_ops` 未限定，9/29 的還原曾因此失敗，還原流程不可重現 | `prisma/migrations/20260810051000_g7_54_form_submission_search_indexes/migration.sql:4-13` | 0.25 人日 | 否 | 否 | docs＋engineer-hard | L0（隨 F-058 還原演練） | infra／CI |
| F-075 | B04-22 | B04 | MINOR | `billingPurpose`、`platformSubscriptionId`、`sourceLiveId` 等業務身分放在 `PaymentTransaction.metadata` JSON，沒有 FK、沒有索引 | `prisma/schema.prisma:1767`、`src/lib/live-purchase-broadcasts.ts:37-46` | 2 人日 | 否 | 否 | engineer-hard＋reviewer | L3 | checkout／payments |
| F-076 | B04-25 | B04 | NIT | `production-database-runbook.md` 過時：仍寫保留 dev.db、版本不一、§6.2 失效、§7 未提加密金鑰 | `docs/production-database-runbook.md` | 0.25 人日 | 否 | 否 | docs | L1 | infra／CI |
| F-077 | B05-01 | B05 | MAJOR | 3 個 error boundary 用 16.3.8 已不存在的 `unstable_retry` prop，「重新載入」呼叫 undefined；測試手動塞 prop 所以全綠 | `src/app/(app)/billing/error.tsx`、`src/app/admin/billing/error.tsx`、`src/app/(app)/messages/deliveries/error.tsx`、`src/components/billing/finance-route-states.test.tsx:42,58` | S（約 1 小時） | 否 | 是 | engineer | L0（可繞過） | billing／settlement |
| F-078 | B05-02 | B05 | MAJOR | 5 個 error boundary 用 `reset`（不向伺服器重取資料），Dashboard 逾時、結帳頁與付款結果頁出錯時按「重試」無效（需實測） | `src/app/(app)/dashboard/error.tsx`、`src/app/(app)/billing/usage/error.tsx`、`src/app/admin/billing/stream-reconciliation/error.tsx`、`src/app/checkout/[vendorId]/[productId]/error.tsx`、`src/app/checkout/result/error.tsx` | S | 否 | 是（與 B05-01 同一批） | engineer | L0（可繞過） | 跨模組（共用 UI／殼層） |
| F-079 | B05-03、B07-08、B05-07（not-found 部分） | B05、B07 | MAJOR | 觀眾端直播頁查無／未發布時 `notFound()` 落到 Next 預設英文 404（沒有根層與 `(viewer)` 的 not-found）；`global-error` 與 `p/[slug]/error` 沒有重試或返回動作 | `src/app/(viewer)/live/[slug]/page.tsx:49,64`、`src/app/global-error.tsx:7-24`、`src/app/p/[slug]/error.tsx:3-12` | S | 否 | 是（B07-08） | engineer | L0 | live／interaction |
| F-080 | B05-05 | B05 | MINOR | 報名頁與結帳頁首屏的 `<Image priority>` 在 Next 16 已棄用 | `src/app/form/[slug]/page.tsx:85`、`src/components/commerce-checkout-entry.tsx:146` | S | 否 | 否 | engineer | L2 | 跨模組（共用 UI／殼層） |
| F-081 | B05-07 | B05 | MINOR | `/live/[slug]`、`/p/[slug]` 沒有 `generateMetadata`，貼到 LINE／FB 的分享預覽顯示平台英文描述而非活動標題與封面 | `src/app/layout.tsx:7-10`、`src/app/(viewer)/live/[slug]/page.tsx`、`src/app/p/[slug]/page.tsx` | S–M | 是：是否要做分享預覽／SEO | 建議 | engineer | L1 | live／interaction |
| F-082 | B05-08 | B05 | MINOR | 有 `loading.tsx` 的段落 `notFound()` 一律回 HTTP 200＋noindex，外部監控與 LINE 預覽爬蟲看不到 404 | `src/app/(viewer)/loading.tsx`、`src/app/checkout/loading.tsx`、`src/app/support/loading.tsx` | S | 否 | 否 | engineer | L2 | 跨模組（共用 UI／殼層） |
| F-083 | B05-09 | B05 | MAJOR | 12 個檔案的表單用裸 `<button>`，沒有 pending、防重送；含推廣夥伴「簽署提領」與方案結帳等金流相鄰操作 | `src/app/affiliate-portal/[vendorSlug]/[affiliateId]/remuneration/page.tsx:25-41`、`src/components/billing-plan-checkout-form.tsx:15-25`、`src/app/(app)/consultations/mobile/page.tsx:63-73`、`src/app/checkout/result/page.tsx:137-139` | S（0.5–1 天） | 否 | 是（金流相鄰 4 處）；其餘建議 | engineer（金流相鄰部分 engineer-hard＋reviewer） | L1（金流相鄰的方案結帳與出款在封測關閉） | 跨模組（共用 UI／殼層） |
| F-084 | B05-10 | B05 | NIT | 專案停在 previous caching model；日後啟用 `cacheComponents` 時 19 個 `dynamic` 與 2 個 `revalidate` 都要先移除 | 19 個 `dynamic = "force-dynamic"` 檔案、`src/app/policies/page.tsx:12` | M（1–2 天） | 是：是否走 Cache Components | 否 | engineer | L3 | infra／CI |
| F-085 | B05-11 | B05 | MINOR | 14 處 `revalidatePath("/", "layout")`，建立專案、改商品、存表單都讓整個商家殼層重算 | `src/app/actions/sales-workspace-actions.ts:70,95,139`、`src/app/actions/consultation-actions.ts:216,238,256`、`src/app/actions.ts:1397` | S | 否 | 否 | engineer | L2 | 跨模組（共用 UI／殼層） |
| F-086 | B05-12 | B05 | MINOR | 未確認 Vercel Skew Protection 與固定的 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`；直播進行中或表單填到一半遇到部署，Server Action 會 Failed to find | repo 內無設定 | S（設定） | 是：Vercel 方案與設定 | 建議 | 設定 | L0（設定） | infra／CI |
| F-087 | B05-13 | B05 | NIT | 7 個 route 檔有冗餘的 `export const runtime = "nodejs"` | `src/app/api/media/**`、`src/app/api/live-studio/drafts/route.ts:11` | S | 否 | 否 | engineer | L3 | infra／CI |
| F-088 | B06-01 | B06 | MAJOR | `getCurrentAuth()` 沒有 `React.cache`，商家頁硬載入時 layout、page、details API 各查一次深度 include（每次 7～9 條 SQL），還載入 MFA 密文與全部復原碼雜湊 | `src/lib/auth.ts:183-262`、`src/app/(app)/layout.tsx:10`、`src/app/api/dashboard/details/route.ts` | S–M（0.5～1 天） | 否 | 是 | engineer-hard＋reviewer | L0（可繞過） | auth／tenant |
| F-089 | B06-02、B01-11（layout 部分） | B06、B01 | MAJOR | 商家殼層 `(app)/layout.tsx` 約 4 段依序、10 餘條查詢（含 onboarding 計算），`loading.tsx` 遮不住，硬載入與 layout 級 revalidate 都要先等它 | `src/app/(app)/layout.tsx:10-53` | M（1 天） | 否 | 是 | engineer | L0（可繞過） | 跨模組（共用 UI／殼層） |
| F-090 | B06-03、B04-14（連線池部分） | B06、B04 | MAJOR | Production 的函式區域、DB 區域、連線池參數都不在 repo 也沒有文件，preflight 不檢查；若沿用美東預設而 DB 在東京，將重現 Dashboard 逾時；`new PrismaClient()` 無池參數 | `vercel.json`、`src/lib/db.ts:8-12`、`scripts/preflight.ts`、`docs/launch/CURRENT.md:13` | S（程式）＋owner 確認 | 是：production 區域、方案與 pooler | 是 | engineer；owner 外部 | L0 | infra／CI |
| F-091 | B06-05 | B06 | MAJOR | 觀眾每人每分鐘約 53 次請求、185 條 SQL（聊天 3 秒、互動 2 秒），沒有可見性閘門與 since；300 人約 900 SQL/s；市場研究的請求量低估約 9 倍 | `src/components/live-chat-panel.tsx:9,197`、`src/components/live-advanced-interactions.tsx:182`、`src/lib/live-chat.ts:416-472`、`src/app/api/live-interactions/route.ts:216-244` | M（(1)(3) 約 2 天；(2) 約 3 天） | 是：目標同時在線人數、Supabase 方案 | 是（若封測場次 >50 人同時在線） | engineer（(1)(2)）；engineer-hard＋reviewer（(3) 簽章入場） | L1（(1)(3)；預期 >50 人同時在線則升 L0）／L2（(2)） | live／interaction |
| F-092 | B06-06 | B06 | MAJOR | 用量心跳在 Serializable 交易內掃整月帳本，多人同時心跳的序列化衝突被轉成 `stream_minutes_exhausted`（429），觀眾端暫停播放、該分鐘不入帳 | `src/lib/stream-usage.ts:78-80,118-122,148-152,389`、`src/lib/stream-usage-client.ts:57-66`、`src/lib/stream-usage.test.ts:398` | M–L（2～4 天） | 否 | 是（若封測有 ≥20 人同時在線的場次） | engineer-hard＋reviewer | L0（可繞過） | live／interaction |
| F-093 | B06-07 | B06 | MAJOR | Cloudflare Stream 播放網址公開、永久有效、無簽章，任何人可不經入場、不計額度地觀看；用量靠客戶端心跳自報，遞送費記在平台帳上 | `src/lib/cloudflare-stream.ts:99-106`、`src/lib/cloudflare-stream-webhook-handler.ts:47,69`、`src/lib/live-playback-source.ts:65-69` | M（2～3 天） | 是：是否要保護付費／限時內容 | 建議（若封測包含付費回放） | engineer-hard＋reviewer | L1 | live／interaction |
| F-094 | B06-08 | B06 | MINOR | 封存只改 DB 狀態、不刪 Stream 資產；Live Input 預設自動錄影，儲存只增不減，容量用完後無法上傳或開播 | `src/lib/cloudflare-stream.ts:173`、`src/components/video-lifecycle-actions.tsx:35` | M | 是：保留政策與商家溝通 | 否 | engineer；owner 外部 | L2 | live／interaction |
| F-095 | B06-09 | B06 | MAJOR | 瀏覽器直播（WHIP／WHEP）依賴自架媒體伺服器，沒有部署、容量、頻寬文件，清理 job 無排程；單點且無 CDN | `src/app/api/live-media/route.ts:1-90`、`src/lib/live-media-provider.ts:3-12`、`src/app/api/cron/live-media/route.ts` | 依決策 | 是：封測是否使用 browser_live | 是（若在範圍內） | owner 外部；engineer | L0（決策；不納入封測則 UI 隱藏，未估） | live／interaction |
| F-096 | B06-10 | B06 | MINOR | 每次媒體心跳（每位觀眾每 20 秒）都先跑帶 5 個 include 的 `live.findFirst`，才進入只需 `updateMany` 的分支 | `src/app/api/live-media/route.ts:55` | S | 否 | 否（隨 B06-09） | engineer | L2 | live／interaction |
| F-097 | B06-11 | B06 | MINOR | 351 個 `findMany` 中 211 個沒有 `take`；佣金頁整表載入後在 JS 加總；`lives/new` 9 個查詢串行並全部序列化進 client props | `src/app/(app)/affiliates/commissions/page.tsx:30-49`、`src/app/(app)/lives/page.tsx:9-13`、`src/app/(app)/lives/new/page.tsx:65-122`、`src/lib/customer-crm.ts:197-220` | M（各頁 S，合計 2～3 天） | 否 | 否 | engineer | L2 | 跨模組（共用 UI／殼層） |
| F-098 | B06-12 | B06 | MINOR | Sentry `tracesSampleRate: 0.1` 對全部 route 一視同仁，直播輪詢會吃光交易額度、稀釋結帳與付款 trace | `sentry.server.config.ts:15`、`sentry.edge.config.ts:16`、`src/instrumentation-client.ts:14` | S | 否 | 建議 | engineer | L1 | infra／CI |
| F-099 | B06-13 | B06 | MINOR | 根 layout 對所有頁面（含買家頁）載入 `AnnouncementCenter` 與公告資料；`tus-js-client` 靜態匯入卻只在 >200 MB 影片使用 | `src/app/layout.tsx:2,27`、`src/components/announcement-center.tsx:115-119`、`src/lib/media-upload-client.ts:1` | S | 否 | 否 | engineer | L2 | 跨模組（共用 UI／殼層） |
| F-100 | B06-14 | B06 | NIT | 圖片相關取捨：R2 物件未設長快取 `Cache-Control`；縮圖一律 JPEG，PNG／GIF 透明度遺失 | `next.config.ts:31`、`src/lib/r2-images.ts:6,118-122` | S | 否 | 否 | engineer | L3 | 跨模組（共用 UI／殼層） |
| F-101 | B07-01 | B07 | BLOCKER | 買家結帳頁的必勾選項寫著「這些文件在正式上線前仍需真人 owner 核准」，內部備註直接顯示給每位買家 | `src/components/commerce-checkout-form.tsx:506` | S | 是：條款何時定稿 | 是 | engineer | L0 | checkout／payments |
| F-102 | B07-02 | B07 | MAJOR | 「建立草稿並預覽」導向的預覽頁是死路（無回到編輯、發布、複製連結），內容是欄位清單與 Live Input UID；步驟 8 的手機預覽是寫死的假畫面 | `src/app/(app)/lives/[id]/preview/page.tsx:16-47`、`src/app/actions.ts:1398`、`src/components/live-stepper-form.tsx:396-406` | M | 否 | 是 | engineer | L0（可繞過） | live／interaction |
| F-103 | B07-03 | B07 | MAJOR | 新建互動角色預設不是「排程角色」，腳本編輯器的角色下拉因此是空的且沒有空狀態；勾選框說明與現況不符 | `src/components/interaction-roles-workbench.tsx:276,697-701`、`src/components/interaction-script-form.tsx:106-115,308` | S | 否 | 是 | engineer | L0 | live／interaction |
| F-104 | B07-04 | B07 | MAJOR | owner 10-18 選定封測開放「不標示」虛擬使用者，但角色頁、暖場控制台、彈幕、條款都寫「會標示」，聊天室仍輸出必填 `label`（空白時 fallback「一般觀眾」），用詞五種：目前做不到真正不標示 | `src/components/interaction-roles-workbench.tsx:415,550,680`、`src/components/scripted-roles-control.tsx:51`、`src/lib/public-policy-content.ts:65`、`src/lib/live-chat-contract.ts:83`、`src/components/live-chat-panel.tsx:293-298` | M | 是：已選不標示版（方案 A）；商家服務條款需律師審閱 | 是 | engineer；owner 外部（律師） | L0 | live／interaction |
| F-105 | B07-05 | B07 | MAJOR | 觀眾端彈幕元件 `LiveDanmaku` 沒有任何頁面掛載、也沒有 CSS，但講師控制台可「開啟全場彈幕」「手動發送」並顯示成功，觀眾什麼也看不到 | `src/components/live-danmaku.tsx:55-140`、`src/components/live-interaction-studio.tsx:262`、`src/components/scripted-roles-control.tsx:41-62` | M | 是：隱藏或交付 | 是 | engineer | L0（可繞過） | live／interaction |
| F-106 | B07-06 | B07 | MAJOR | 直播間、儀表板、影片、客服等頁的狀態徽章直接輸出資料庫列舉值（`draft`、`scheduled`、`vod`、`ready`…） | `src/app/(app)/lives/page.tsx:29`、`src/app/(app)/dashboard/dashboard-details-view.tsx:42`、`src/components/video-form.tsx:68`、`src/app/(app)/support-cases/page.tsx:99` | S | 否 | 是 | engineer | L1（不會卡住；建議與 F-110 同 PR 順手） | live／interaction |
| F-107 | B07-07 | B07 | MAJOR | 直播必填英文「Slug」、不從標題帶入、全站唯一卻無事先檢查；重複時 `tx.live.create` 的 P2002 未攔截，可能整頁錯誤且無返回按鈕（推論，需實測） | `src/components/live-stepper-form.tsx:907`、`prisma/schema.prisma:672`、`src/app/actions.ts:816` | M | 否 | 是 | engineer | L0 | live／interaction |
| F-108 | B07-09 | B07 | MAJOR | 報名雙重確認完成頁沒有「前往直播間」「加入行事曆」；連結過期頁沒有連結也沒有「重寄確認信」 | `src/lib/registration-submission-client.ts:30`、`src/app/verify-registration/page.tsx:28-37`、`src/components/lead-form.tsx:205-209` | M | 是：雙重確認是否保留 | 是（至少加下一步連結） | engineer | L0（可繞過） | forms／funnel／landing |
| F-109 | B07-10 | B07 | MAJOR | 「報名成功 Email」是發布必要條件，但新增模板時主旨與內容全空白、沒有範本 | `src/components/message-template-form-client.tsx:20-23`、`src/lib/live-publish-readiness.ts:55-58` | M | 否 | 是 | engineer | L0（可繞過） | LINE／notifications |
| F-110 | B07-11 | B07 | MAJOR | `formatDateTime` 沒指定 `timeZone`，伺服器元件依執行環境（Vercel 預設 UTC）輸出：講師排 20:00 的場次在列表顯示 12:00；欄位標籤直接寫「Asia/Taipei」「轉成 UTC」（推論，需 staging 實測） | `src/lib/format.ts:9-16`、`src/app/(app)/lives/page.tsx:27`、`src/app/(app)/lives/[id]/analytics/page.tsx:391`、`src/components/live-stepper-form.tsx:161-163` | S | 否 | 是 | engineer | L0 | 跨模組（共用 UI／殼層） |
| F-111 | B07-12 | B07 | MAJOR | 封測主線頁面大量工程術語（ref 追蹤、immutable usage ledger、fail closed、heartbeat、payment provider reference、Workspace、basis points…），且商品表單暴露封測隱藏的課程分潤欄位 | `src/components/live-stepper-form.tsx:494,517,527`、`src/app/(app)/dashboard/dashboard-kpis.tsx:94,124`、`src/components/product-form-client.tsx:309,328`、`src/app/register/page.tsx:9` | M | 否 | 是（限主線頁面） | engineer | L1（不會卡住；創辦人導入時口頭說明） | 跨模組（共用 UI／殼層） |
| F-112 | B07-13 | B07 | MAJOR | LINE 綁定頁沒有逐步教學、錯誤訊息泛用；三個檔案用了不存在的色票 `text-muted-foreground`、`text-destructive`，錯誤不會變紅；模板頁又寫 LINE「尚未串接」 | `src/components/line-official-account-form.tsx:34-70,85,108`、`src/components/line-rich-menu-studio.tsx:29,61`、`src/app/(app)/settings/line/page.tsx:68-75`、`src/components/message-template-form-client.tsx:72-73` | M | 是：封測 LINE 提供推播、登入還是只有 Email | 樣式修正必修；教學建議 | engineer | L0（樣式，可繞過）／L1（教學與錯誤分類） | LINE／notifications |
| F-113 | B07-14 | B07 | MAJOR | 直播只要綁商品，發布前就必須有已發布的互動腳本；上線導引也把啟用角色、發布腳本列為完成條件：不想用虛擬使用者的講師被迫建立腳本 | `src/lib/live-publish-readiness.ts:59-61`、`src/lib/merchant-onboarding.ts:45-48`、`src/components/live-stepper-form.tsx:76` | M | 是：銷售直播是否強制互動腳本 | 是（決策） | engineer | L0 | live／interaction |
| F-114 | B07-15 | B07 | MAJOR | 商家註冊頁沒有條款與隱私連結、沒有同意紀錄，也沒有專屬商家服務條款；之後無法證明商家同意「虛擬使用者責任歸商家」 | `src/app/register/page.tsx:9`、`src/app/login/page.tsx:78`、`src/lib/public-policy-content.ts:53` | M | 是：條款定稿與接受紀錄設計 | 是 | engineer-hard＋reviewer；owner 外部（律師） | L0 | auth／tenant |
| F-115 | B07-16 | B07 | MAJOR | 側欄固定顯示綠色閃爍圓點與「系統連線正常」，沒有連到任何健康檢查；另有英文「Live Commerce OS」「Beta」 | `src/components/app-shell.tsx:206,208,241` | S | 否 | 是 | engineer | L1（不會卡住；可與 F-106 同 PR） | 跨模組（共用 UI／殼層） |
| F-116 | B07-17 | B07 | MAJOR | 儀表板 10 個 KPI 沒有「已付款訂單數／金額」，只有含未付款的「近 7 天訂單建立」 | `src/app/(app)/dashboard/dashboard-kpis.tsx:93-104` | S | 否 | 建議（創辦人可暫時手動看 /orders） | engineer | L1 | 跨模組（共用 UI／殼層） |
| F-117 | B07-18 | B07 | MAJOR | 共用 `Field`／`TextArea`／`SelectField` 沒有 error、hint、`aria-invalid` 插槽；商品、直播、角色的伺服器錯誤只在頂端顯示泛用訊息、不聚焦欄位 | `src/components/ui.tsx:98-205`、`src/components/product-form-client.tsx:97-110`、`src/components/live-stepper-form.tsx:523-537` | L | 否 | 否（分批） | engineer | L1 | 跨模組（共用 UI／殼層） |
| F-118 | B07-19 | B07 | MAJOR | 直播 8 步 stepper 在 390px 寬先堆約 510px 的步驟按鈕，控件 40px 高；步驟切換不移焦點、不通知螢幕閱讀器 | `src/components/live-stepper-form.tsx:1131,1136-1150,1204-1207` | M | 否 | 否 | engineer | L1 | live／interaction |
| F-119 | B07-20 | B07 | MINOR | 直播草稿版本衝突時只能重新整理，本分頁的修改被鎖定並丟棄 | `src/components/use-live-studio-draft.ts:64,85,201` | M | 否 | 否 | engineer | L2 | live／interaction |
| F-120 | B07-21 | B07 | MINOR | 金額顯示三種格式（「$1,234」「$12,345.00」「NT$」），「$」在台灣可能被誤認為美元 | `src/lib/format.ts:1-8`、`src/components/commerce-checkout-form.tsx:57`、`src/app/checkout/result/page.tsx:59` | S | 否 | 否 | engineer | L1 | checkout／payments |
| F-121 | B07-22 | B07 | MINOR | 78 處 `outline-none` 蓋掉全域焦點樣式；輸入框邊框對白底 1.29:1；`text-slate-400` 小字 2.56:1 | `src/app/globals.css:44-47`、`src/components/ui.tsx:131,170,201`、`src/components/app-shell.tsx:254,263` | M | 否 | 否 | engineer | L1 | 跨模組（共用 UI／殼層） |
| F-122 | B07-23（手機導覽部分） | B07 | MINOR | 手機導覽把所有群組攤平成約 35–40 顆橫向膠囊、無「更多」；客服與政策連結只在桌機帳號選單 | `src/components/app-shell.tsx:64-69,302-308` | M | 是：封測要隱藏哪些（隱藏部分併入 F-002） | 隱藏模組：是（見 F-002）；手機導覽：否 | engineer | L1 | 跨模組（共用 UI／殼層） |
| F-123 | B07-24 | B07 | MINOR | 共有五套引導（問卷、側欄任務、`/onboarding`、商家使用指南、建立專案引導），步驟內容與數量互不相同 | `src/app/(app)/onboarding/page.tsx`、`src/app/welcome/page.tsx`、`src/components/onboarding-task-panel.tsx:29` | M | 否 | 否 | engineer | L1 | 跨模組（共用 UI／殼層） |
| F-124 | B07-25 | B07 | MINOR | 內建腳本範本含稀缺與主張性文案（「限量清倉」「售完後不一定會補」），套用後可能構成不實表示 | `src/components/interaction-script-form.tsx:45-69` | S | 是：範本文案由誰審 | 否 | engineer；owner 外部（律師） | L2 | live／interaction |
| F-125 | B07-26 | B07 | MINOR | 播放器沒有 `<track>` 字幕軌，也沒有字幕上傳欄位（WCAG 1.2.2） | `src/components/live-playback.tsx:1750-1756` | L | 是：排程 | 否 | engineer | L2 | live／interaction |
| F-126 | B07-27 | B07 | MINOR | a11y 測試只攔 critical／serious，沒掃 `/register`、`/onboarding`、`/checkout/*`、`/verify-registration`、`/lp/*` 等，stepper 只掃第 1 步 | `tests/e2e/accessibility.spec.ts:276-497` | M | 否 | 否 | engineer | L1 | infra／CI |
| F-127 | B07-28 | B07 | MINOR | 外部連結對話框關閉後未還原焦點；帳號選單沒有 Escape、外點關閉與 `aria-controls` | `src/components/live-playback.tsx:880-925`、`src/components/app-shell-account-menu.tsx:15-46` | S | 否 | 否 | engineer | L1 | 跨模組（共用 UI／殼層） |
| F-128 | B07-29 | B07 | MINOR | 「報名資料未能送出」頁的「回首頁」帶觀眾去商家登入頁；403 文案要求重新整理，與「內容仍保留」衝突 | `src/app/registration-error/page.tsx:8`、`src/lib/registration-submission-client.ts:19` | S | 否 | 否 | engineer | L1 | forms／funnel／landing |
| F-129 | B07-30 | B07 | MINOR | 講師互動台含抽獎（範例獎項 iPhone 16）、快閃搶購、紅包、問答審核，使用紫紅漸層，超出封測五模組也沒有 beta 隱藏 | `src/components/live-interaction-studio.tsx:34-292` | S | 是 | 否 | engineer | L2 | live／interaction |
| F-130 | B07-31 | B07 | MINOR | 付款結果頁只認開始結帳的同一個瀏覽器；LINE 內建瀏覽器跳外部付款時可能看不到訂單（推論，需 Sandbox 實測） | `src/app/checkout/result/page.tsx:51-52,103-105` | M | 否 | 否（先實測） | engineer | L2（實測併入 T2） | checkout／payments |
| F-131 | B07-32 | B07 | MINOR | 所有政策頁與客服聯絡方式使用個人 Gmail | `src/lib/public-policy-content.ts:6-9` | S | 是 | 否 | engineer；owner 外部 | L2（信箱申請見 owner 清單） | 跨模組（共用 UI／殼層） |
| F-132 | B07-34 | B07 | NIT | 載入文案混用「…」與「...」；按鈕與標題內嵌 emoji | `src/components/lead-form.tsx:201,208`、`src/app/verify-registration/page.tsx:29` | S | 否 | 否 | engineer | L3 | 跨模組（共用 UI／殼層） |
| F-133 | B08-01 | B08 | MAJOR | 4 個測試檔 7 個 case 只讀原始碼做 `toContain`（39 ms 通過、從未執行被測程式），剛好是處理 PII 與租戶範圍的 CRM 與行動諮詢 | `src/app/actions/customer-crm-actions.test.ts:5-20`、`src/app/actions/mobile-consultation-actions.test.ts:5-23`、`src/app/(app)/customers/page.test.tsx:5-15`、`src/app/(app)/consultations/mobile/page.test.tsx:5-20` | 1.5–2 天 | 否 | 是 | engineer | L1 | 跨模組（共用 UI／殼層） |
| F-134 | B08-05 | B08 | MAJOR | 高風險 server action 缺第二租戶負向案例（`vendor-member-actions` 無測試檔；payout outcome、payout policy、course curriculum、affiliate portal、PII 搜尋等） | `src/app/actions/team-membership-actions.test.ts`、`12-tenant-auth.md`「第二租戶測試缺口」12 項 | 3–4 天 | 否 | 是（金流、PII 相關 6 項）；其餘封測後 | engineer | L1 | auth／tenant |
| F-135 | B08-06 | B08 | MINOR | 覆蓋率門檻三處重複、全域分母含 423 個 scripts 檔、`src/lib` 專屬百分比沒有輸出、高風險路徑沒有獨立下限 | `vitest.config.ts:60-88`、`scripts/run-combined-coverage.mjs:22-23,299-315` | 1 天 | 否 | 否 | engineer | L2 | infra／CI |
| F-136 | B08-08 | B08 | MINOR | 兩個已知 flaky 的根因未證實，CI reporter 連測試名稱都不輸出，重試蓋住問題 | `tests/e2e/member-billing-plans-direct-url.spec.ts:216-395`、`tests/e2e/helpers/direct-url-guard.ts:78-335`、`scripts/playwright-ci-reporter.ts` | 1–2 天 | 否 | 否 | engineer | L2 | infra／CI |
| F-137 | B08-09、B09-12、B08-07 | B08、B09 | MINOR | CI 單一 job 串行約 33 分鐘：完整 Vitest 與 Node TAP 各跑兩次、數次 `next build`；`vitest.synthetic-db-coverage.config.ts` 名稱有 coverage 但門檻從不評估 | `.github/workflows/ci.yml`、`vitest.synthetic-db-coverage.config.ts`、`package.json:18` | 1.5–2 天（B08-09）／1–2 天（B09-12）／0.5 天（B08-07） | 否 | 否 | engineer | L2 | infra／CI |
| F-138 | B08-10 | B08 | MINOR | 8 個 vitest／prisma 設定檔無任何 runner 參照；其餘 20 個 vitest 設定高度同形、playwright 約 10 個同一樣板 | `vitest.g7-*-db.config.ts`（4）、`prisma.g7-*-disposable.config.mjs`（4） | 3–4 天 | 是：孤兒是否保留 | 否 | engineer | L3 | infra／CI |
| F-139 | B08-11 | B08 | MINOR | 97 個測試以讀 workflow、SQL、runner 原始碼的字串斷言為主，與行為測試混在一起 | `scripts/g7-commerce-browser-qa.test.mjs`、`scripts/secure-staging-workflow-contract.test.mjs` 等 | 持續性（2 天分類與命名） | 否 | 否 | engineer | L3 | infra／CI |
| F-140 | B08-12 | B08 | NIT | 全專案 72 處 `toBeDefined`、18 處 `toBeTruthy` 等弱斷言 | `src/lib/env.test.ts`、`src/components/live-stepper-form.test.tsx` | 0.5 天 | 否 | 否 | engineer | L3 | infra／CI |
| F-141 | B09-02 | B09 | MAJOR | 4 個 job（LINE、live-media、tracking、payuni probe）失敗分支只回 503、沒送 Sentry；沒有任何 heartbeat 或 Cron Monitor | `src/app/api/cron/line-notifications/route.ts:39`、`src/app/api/cron/live-media/route.ts:11`、`src/app/api/jobs/tracking-deliveries/route.ts` | 0.5～1 天 | 否 | 是 | engineer | L0（可繞過） | infra／CI |
| F-142 | B09-03 | B09 | MAJOR | `/api/health` 只做 `SELECT 1`，沒有 job lag、migration 版本或外部相依，綠燈不代表可用 | `src/app/api/health/route.ts:76-95` | 0.5 天 | 否 | 是 | engineer | L1 | infra／CI |
| F-143 | B09-04 | B09 | MAJOR | Sentry 只關了 `userInfo` 與 `httpBodies`，cookies、headers、query params、stack frame 變數預設都收集，也沒有 `beforeSend`；PII 可能經海外 DSN 外流 | `sentry.server.config.ts:17-20`、`sentry.edge.config.ts:39-42`、`src/instrumentation-client.ts:18-21` | 1 天 | 否 | 是 | engineer | L0 | infra／CI |
| F-144 | B09-05 | B09 | MINOR | `replaysOnErrorSampleRate` 沒有 `replayIntegration` 不生效、`enableLogs` 未使用；日後加 replay 會在無遮罩下啟用 | `src/instrumentation-client.ts:16-17` | 1 小時 | 否 | 否 | engineer | L2 | infra／CI |
| F-145 | B09-06 | B09 | MINOR | Sentry 的 webpack 專屬選項在 Turbopack build 不生效、未設 `release.name`，source map 上傳路徑未驗證 | `next.config.ts:55-76`、`package.json:7` | 0.5 天 | 否 | 否 | engineer | L2 | infra／CI |
| F-146 | B09-07 | B09 | MAJOR | `quality` job 沒有 `timeout-minutes`（預設 360 分鐘），公開 repo 可被濫用 runner 時間 | `.github/workflows/ci.yml:8` | 10 分鐘 | 否 | 是 | engineer | L1（10 分鐘，可隨任一 L0 PR 順手） | infra／CI |
| F-147 | B09-08 | B09 | MINOR | CI 對所有分支 push＋pull_request 雙觸發、沒有 concurrency，同一 PR 每次更新跑兩輪 | `.github/workflows/ci.yml:3-5` | 15 分鐘 | 否 | 否 | engineer | L1（與 F-146 同 PR） | infra／CI |
| F-148 | B09-09 | B09 | MINOR | `ci.yml` 沒有 `permissions:`，checkout／setup-node 用 tag 而非 SHA pin | `.github/workflows/ci.yml` | 15 分鐘 | 否 | 否 | engineer | L2 | infra／CI |
| F-149 | B09-10 | B09 | MAJOR | fork PR 核准政策只擋首次貢獻者，曾貢獻過的外部帳號 fork PR 可直接跑 workflow | repo 設定 `fork-pr-contributor-approval` | 5 分鐘 | 是 | 是 | 設定（owner） | L0（設定） | infra／CI |
| F-150 | B09-11 | B09 | MINOR | CI 依賴歷史 PR 的 `refs/pull/277/head` 並比對固定 SHA，該 ref 不可取得時整個 CI 紅燈 | `.github/workflows/ci.yml:65-70` | 0.5 天 | 否 | 否 | engineer | L2 | infra／CI |
| F-151 | B09-13 | B09 | MINOR | 23 個 `workflow_dispatch` 中有從未執行、最近失敗與綁定 10 月固定來源的歷史工具，每個都能讀 staging secret | `.github/workflows/q1-*`、`f2-*` | 0.5 天 | 是 | 否 | engineer | L2 | infra／CI |
| F-152 | B09-14 | B09 | MAJOR | GitHub `Production` 與 `Preview – celebrate-deal` 環境完全無保護、沒有 workflow 使用；staging `buildCommand` 每次部署都跑 `db:migrate:deploy`，變數誤填即直接改 Production schema（含接手事項 T7） | GitHub environments、`vercel.staging.json` | 0.5 天 | 是 | 是（若封測使用 Production） | 設定（owner）＋engineer | L0（設定；封測用 Production 時） | infra／CI |
| F-153 | B09-15 | B09 | MAJOR | 公開 repo 的 secret scanning、push protection、Dependabot security updates 全部關閉，也沒有 `dependabot.yml` | repo 設定 `security_and_analysis` | 0.5 小時＋持續處理 | 是 | 是 | 設定（owner） | L0（設定） | infra／CI |
| F-154 | B09-16、A04-判讀2 | B09、A-04 | MINOR | braces ≤3.0.3 high advisory 沒有修補版，5 個 high 全來自 dev 工具鏈（`eslint-config-next`），production audit 為 0 | `package-lock.json`、`package.json:84-99` | 1 小時 | 是：記錄例外與到期日 | 否 | docs | L2 | infra／CI |
| F-155 | B09-17、A04（overrides 待確認） | B09、A-04 | MINOR | 4 項 overrides 沒有文件說明；9 個套件有 install script，CI 用會執行 script 的 `npm ci` | `package.json` overrides、`.github/workflows/ci.yml:78-79` | 0.5 天 | 否 | 否 | engineer | L2 | infra／CI |
| F-156 | B09-18、A04-判讀4 | B09、A-04 | MAJOR | CSP 只有 Report-Only 且 `script-src` 含 `unsafe-inline`／`unsafe-eval`；回報端點收下後直接回 204，部署以來蒐集到的違規資料為零 | `src/app/api/security/csp-report/route.ts:7-17`、`next.config.ts:4-16` | 3～5 天 | 否 | 否（建議公開上線前完成） | engineer-hard＋reviewer | L2 | infra／CI |
| F-157 | B09-19 | B09 | MINOR | HSTS 為 `includeSubDomains`，若正式網域下有未啟 HTTPS 的子網域會被擋 | `next.config.ts:42` | 1 小時 | 是 | 否 | docs | L2 | infra／CI |
| F-158 | B09-21 | B09 | NIT | jobs／cron 未設 `maxDuration`，`email-deliveries` 單次循序處理 9 段工作，逾時會讓後段長期餓死 | `src/app/api/jobs/*`、`src/app/api/cron/*` | 2 小時 | 是 | 否 | engineer | L2 | infra／CI |
| F-159 | B09-22 | B09 | NIT | payuni live probe 文件說每 5 分鐘排程，workflow 實際只有手動觸發 | `docs/launch/payuni-live-one-time-probe.md` | 15 分鐘 | 否 | 否 | docs | L2 | infra／CI |
| F-160 | B10-03、B01-16（指紋端點部分） | B10、B01 | MINOR | `/__celebratedeal_wp187_fingerprint.json` 由 proxy 公開回應、無環境閘門，洩漏內部工作包代號；同名 `route.ts` 是不可達死副本但仍有測試 | `src/proxy.ts:7,36`、`src/app/__celebratedeal_wp187_fingerprint.json/route.ts`、`src/lib/preview-lineage.ts` | 0.5 天 | 否 | 否 | engineer | L2 | admin ops |
| F-161 | B10-04、B01-16（browser-qa 部分） | B10、B01 | MINOR | 兩個 browser-qa 頁面以 `NODE_ENV` 守門有效，但 harness 元件仍編進正式 bundle、出現在正式路由表 | `src/app/browser-qa/funnel-editor/page.tsx:3-6`、`src/app/browser-qa/funnel-elements/page.tsx:3-6` | 1 天 | 否 | 否 | engineer | L3 | admin ops |
| F-162 | B10-07、B01-18（方案 action 部分） | B10、B01 | MINOR | 方案選擇 Server Action 與按鈕已無入口（頁面改走 `/api/billing/plans/select` 原生 POST），其測試讓人誤以為仍有覆蓋，帳務相鄰 | `src/app/(app)/billing/plans/actions.ts`、`src/app/(app)/billing/plans/plan-submit-button.tsx` | 0.25 人天 | 否 | 否 | engineer-hard＋reviewer | L2 | billing／settlement |
| F-163 | B10-09 | B10 | MINOR | 155 個 WP／FIN 編號的一次性 runner 仍在 `scripts/`，其 TAP 測試每次 CI 都跑並撐大覆蓋率分母 | `scripts/wp*`（131 檔）、`scripts/fin*`（24 檔） | 2 天 | 是：是否保留舊 runner 供稽核重現 | 否 | engineer | L3 | infra／CI |
| F-164 | B10-10 | B10 | MAJOR | `docs/` 1,885 個檔案中約 1,725 個（91.5%）是可封存的收據與一次性報告，搜尋、審查與新人閱讀被淹沒 | `docs/ai-team/evidence/**`、`docs/remaining-capabilities-*.json`、`docs/branch-integration-*` | 2 天 | 是：封存位置與是否保留 PNG | 否 | docs | L2 | infra／CI |
| F-165 | B10-11 | B10 | MAJOR | 43 個 `docs/` 檔案被測試或 CI 以固定路徑讀取（含 readiness 快照的 30 個），直接搬動會讓 CI 變紅 | `scripts/readiness-truth-reconciliation.mjs:8-10,130-135`、`scripts/api-contract-registry.test.ts:6`、`scripts/prisma-invariant-inventory.test.ts:7` | 1.5 天 | 是：08-02 快照驗證是否退役 | 否 | engineer | L2 | infra／CI |
| F-166 | B10-13 | B10 | MINOR | 9 個 worktree 中 7 個可移除（1 個需先補 tag、2 個需 owner 看）；`~/.codex/worktrees` 另有 23 個未登記目錄；本機殘留數 GB（含接手事項 T5） | `git worktree list`、`C:\Users\eden\.codex\worktrees\*` | 0.5 天 | 是：commission policy 分支與 staging 回復點 | 否 | 設定（主對話 git 操作）＋owner | L2 | infra／CI |
| F-167 | B10-15 | B10 | MINOR | 133 個 scripts 引用 `.ai-team`（CI 內 11 個都只當輸出資料夾，沒有壞）；9 個歷史 runner 讀舊收據，單獨執行會壞 | `scripts/build/controlled-production-build.mjs:10`、`scripts/readiness-truth-reconciliation.mjs:24` | 1 天 | 否 | 否 | engineer | L3 | infra／CI |
| F-168 | B11-01 | B11 | MAJOR | staging 財務 QA 帳號沒有 MFA factor，4 個 PayUni 退款／復原 runner 只處理 `/mfa/verify`：#436 合併後整條 Sandbox QA 鏈停在 `/mfa/setup` | `scripts/q1-original-refund-runner.mjs:77`、`scripts/payuni-sandbox-pending-refund-consumer.mjs:190`、`scripts/payuni-issued-recovery-runner.mjs:232`、`scripts/payuni-current-source-refund-qa.mjs:218`、`src/lib/staging-qa-finance-bootstrap.ts` | 0.5～1 天 | 否 | 是（阻擋 staging Sandbox 驗證） | engineer-hard | L0（F-024 的前置） | admin ops |
| F-169 | B11-03 | B11 | MAJOR | 沒有因子的 admin 帳號「誰先用密碼登入誰就能登記 TOTP」，`mfaVerifiedAt` 也沒有與因子 `enabledAt` 綁定；bootstrap 密碼外洩即可搶先登記 | `src/lib/mfa-enrollment.ts`、`src/app/mfa/setup/`、`scripts/bootstrap-platform-admin.ts` | 1～2 天 | 是 | 是 | engineer-hard＋reviewer | L0（可繞過） | auth／tenant |
| F-170 | B11-04 | B11 | MINOR | 沒有測試保證新增的 `/admin/**` route handler 一定經過 `requireFinanceAdmin`（wp88 規格只涵蓋 page） | `requireFinanceAdmin()` 呼叫面、`tests/e2e/wp88-direct-url-guard-matrix.spec.ts` | 2 小時 | 否 | 否 | engineer | L2 | auth／tenant |
| F-171 | B11-05 | B11 | MINOR | repo 沒有 `.gitattributes`，CRLF／LF 混用造成整檔假衝突（#436 即是） | repo 根目錄 | 1 小時 | 是 | 否 | engineer | L2 | infra／CI |
| F-172 | B11-06 | B11 | NIT | 沒有因子的 admin 登入後多一次轉址 | `src/app/actions/auth-security-actions.ts:128` | 15 分鐘 | 否 | 否 | engineer | L3 | auth／tenant |
| F-173 | B11-07 | B11 | NIT | 兩個 admin route handler 以 307 轉址回 HTML，日後被 fetch 呼叫會拿到 HTML | `src/app/admin/billing/payouts/[id]/csv/route.ts`、`reconciliation/route.ts` | 1 小時 | 否 | 否 | engineer | L3 | auth／tenant |
| F-174 | A04-判讀1 | A-04 | 未分級 | 本機 Prisma Client 過期，使 `npm run typecheck`／`typecheck:strict-index` 在此工作樹失敗（313／125 個錯誤，程式本身無型別缺陷） | 本機 `node_modules/.prisma`、`prisma/schema.prisma` | 未估 | 否 | 否 | 設定 | L0 前置（工程環境） | infra／CI |

## 3. 去重對照（合併列）

合併原則：同一個根因、修在同一處程式或同一個決策時合併為一列；只是互相關聯（例如測試缺口對應某個缺陷、或同一 PR 順手做）而修法不同者，維持分列並在「依賴」中互相引用。合併列的估工取各來源中涵蓋最完整的數字，不重複相加；互補部分另在 backlog 拆成不同層級。

| ID | 合併來源 | 合併理由 |
|---|---|---|
| F-002 | B01-02、B07-23（隱藏模組部分） | 同一件事：封測要隱藏的模組沒有旗標（B07-23 只合併「隱藏模組」部分，手機導覽另列） |
| F-003 | B01-03、B03-14 | 同一段不可達退款碼（`actions.ts:2178-2359`） |
| F-005 | B01-05、A04-判讀3 | A-04 判讀 3 指出的大檔熱點即 B01-05 的拆分對象 |
| F-007 | B01-07、B10-02 | 同一批 WP4 harness 編進正式 auth／結帳路徑 |
| F-013 | B01-13、B05-06 | 同一個 `server-only` 護欄缺口與同一條客戶端→DB 路徑 |
| F-015 | B01-15、B05-04、B06-04 | 同一個 `/lp` proxy 讀整份 content 的設計，三軸各從架構、Next 慣例、效能角度提出 |
| F-016 | B01-16、B02-09、B03-21、B10-01 | 同一組 ops 端點與共用 `JOB_SECRET`（B01-16 的指紋端點與 browser-qa 部分分別併入 F-160、F-161） |
| F-018 | B01-18、B10-06、B07-33 | 同一批 knip 死碼（B07-33 的 `interaction-role-form` 即其中之一） |
| F-019 | B01-19、B10-08 | 常青直播半接線（B01-19）是 B10-08 四個 lib 之一 |
| F-020 | B01-20、B04-23、B10-12 | `docs/codex-goal/*` 文件漂移（B04-23 的 PRISMA_INVARIANTS、B01-20 的 ARCHITECTURE_BOUNDARIES 都在 B10-12 範圍內） |
| F-023 | B01-23、B10-05、B10-14、B04-24 | 同一批倉庫殘留（tmp PNG、空資料夾、SQLite archive、舊交接檔） |
| F-024 | B02-01、B03-09、B08-03、B11-02 | 同一個漏洞：`requireFinanceAdmin` 不強制 MFA；B08-03 是釘住漏洞的測試、B11-02 是修正 PR 的衝突，都在同一個 PR 內處理（B11-01 為前置，分列） |
| F-026 | B02-03、B04-08 | 同一個 RLS 缺口 |
| F-031 | B02-08、B04-03 | 同一個根因：資料加密金鑰由 `CSRF_SECRET` 衍生且無 key id |
| F-036 | B02-14、B09-20 | 同一組 session 強度問題（B09-20 的 `__Host-` 前綴即 B02-14 的一部分） |
| F-037 | B03-01、B08-02 | B08-02 的不真實 fixture 正是 B03-01 抓不到的原因，修法要求同批補真實格式 fixture |
| F-038 | B03-02、B08-04（測試部分） | B08-04 的回歸測試缺口（只合併對應 B03-02 的部分） |
| F-039 | B03-03、B08-04（測試部分） | B08-04 的回歸測試缺口（只合併對應 B03-03 的部分） |
| F-041 | B03-05、B08-04（測試部分） | B08-04 的回歸測試缺口（只合併對應 B03-05 的部分） |
| F-042 | B03-06、B09-01 | 同一個排程缺口；B09-01 補充了 4 個 POST-only job 無法被 Vercel Cron 驅動 |
| F-050 | B03-16（唯一鍵部分）、B04-06 | 同一個 `(providerName, orderNumber)` 無唯一鍵；B03-16 的 CHECK 部分併入 B04-07 列 |
| F-055 | B03-22、B04-14（重試部分） | 同一個 Serializable 無退避重試問題；B04-14 的連線池部分併入 B06-03 列 |
| F-062 | B04-07、B03-16（CHECK 部分） | 同一個「帳務表無 CHECK」問題（B03-16 的 CHECK 部分） |
| F-079 | B05-03、B07-08、B05-07（not-found 部分） | 同一個「錯誤／404 頁無繁中與出口」問題（B05-07 只合併 not-found 部分，metadata 另列） |
| F-089 | B06-02、B01-11（layout 部分） | B01-11 的 `(app)/layout` 部分即 B06-02 |
| F-090 | B06-03、B04-14（連線池部分） | B04-14 的連線池 preflight 部分與 B06-03 相同 |
| F-137 | B08-09、B09-12、B08-07 | 同一個 CI 重複與串行問題（B08-07 的 synthetic-db 重跑即其中一項） |
| F-154 | B09-16、A04-判讀2 | A-04 判讀 2 的 braces advisory |
| F-155 | B09-17、A04（overrides 待確認） | A-04「需 B 階段確認」的 overrides 說明 |
| F-156 | B09-18、A04-判讀4 | A-04 判讀 4 的 CSP |
| F-160 | B10-03、B01-16（指紋端點部分） | B01-16 的指紋端點部分 |
| F-161 | B10-04、B01-16（browser-qa 部分） | B01-16 的 browser-qa 部分 |
| F-162 | B10-07、B01-18（方案 action 部分） | 方案選擇孤兒 action 在 B01-18 附錄 A 與 B10-07 重複 |

另有兩組刻意分列：B11-01（staging QA runner 的 MFA）是 F-024 的合併前置，修法與檔案不同；B11-03（無因子 admin 搶先登記 TOTP）是 #436 之後的殘餘風險，另開 PR。

## 4. 統計矩陣

### 4.1 去重後（依主來源軸線）× 嚴重度

| 軸線 | BLOCKER | MAJOR | MINOR | NIT | 未分級 | 合計 |
|---|---:|---:|---:|---:|---:|---:|
| B-01 架構 | 0 | 12 | 8 | 3 | 0 | 23 |
| B-02 租戶授權 | 1 | 2 | 5 | 5 | 0 | 13 |
| B-03 金流財務 | 4 | 5 | 10 | 2 | 0 | 21 |
| B-04 資料 migration | 1 | 4 | 13 | 1 | 0 | 19 |
| B-05 Next.js 慣例 | 0 | 4 | 5 | 2 | 0 | 11 |
| B-06 效能成本 | 0 | 7 | 5 | 1 | 0 | 13 |
| B-07 UX／a11y／文案 | 1 | 17 | 13 | 1 | 0 | 32 |
| B-08 測試品質 | 0 | 2 | 5 | 1 | 0 | 8 |
| B-09 觀測／CI／供應鏈 | 0 | 8 | 9 | 2 | 0 | 19 |
| B-10 死碼殘留 | 0 | 2 | 6 | 0 | 0 | 8 |
| B-11 開啟中 PR | 0 | 2 | 2 | 2 | 0 | 6 |
| A-04 靜態掃描判讀 | 0 | 0 | 0 | 0 | 1 | 1 |
| **合計** | **7** | **65** | **81** | **20** | **1** | **174** |

### 4.2 原始（未去重，各報告自己的嚴重度）× 嚴重度

| 軸線 | BLOCKER | MAJOR | MINOR | NIT | 未分級 | 合計 | 去重後歸入他列 |
|---|---:|---:|---:|---:|---:|---:|---:|
| B-01 架構 | 0 | 10 | 10 | 3 | 0 | 23 | 0 |
| B-02 租戶授權 | 1 | 1 | 7 | 5 | 0 | 14 | 1 |
| B-03 金流財務 | 3 | 6 | 13 | 2 | 0 | 24 | 3 |
| B-04 資料 migration | 1 | 6 | 15 | 3 | 0 | 25 | 6 |
| B-05 Next.js 慣例 | 0 | 4 | 6 | 3 | 0 | 13 | 2 |
| B-06 效能成本 | 0 | 8 | 5 | 1 | 0 | 14 | 1 |
| B-07 UX／a11y／文案 | 1 | 18 | 13 | 2 | 0 | 34 | 2 |
| B-08 測試品質 | 0 | 5 | 6 | 1 | 0 | 12 | 4 |
| B-09 觀測／CI／供應鏈 | 1 | 8 | 10 | 3 | 0 | 22 | 3 |
| B-10 死碼殘留 | 0 | 4 | 9 | 2 | 0 | 15 | 7 |
| B-11 開啟中 PR | 0 | 3 | 2 | 2 | 0 | 7 | 1 |
| A-04 靜態掃描判讀 | 0 | 0 | 0 | 0 | 4 | 4 | 3 |
| **合計** | **7** | **73** | **96** | **27** | **4** | **207** | **33** |

說明：「去重後歸入他列」＝該軸原始筆數減去以該軸為主來源的列數（併入其他軸為主的列）；某軸 finding 被拆到兩列時（例如 B07-23、B01-16、B03-16、B04-14），此欄會偏小。B05-09 原報告標「MAJOR（金流相鄰 4 處）／MINOR（其餘）」，以 MAJOR 計；B01-01 標「MAJOR（若 owner 定義為不可觸及則 BLOCKER）」，以 MAJOR 計。

### 4.3 Backlog 層級 × 嚴重度（去重後，依列的主要層級）

| 層級 | BLOCKER | MAJOR | MINOR | NIT | 未分級 | 合計 |
|---|---:|---:|---:|---:|---:|---:|
| L0 | 5 | 34 | 5 | 1 | 1 | 46 |
| L1 | 2 | 19 | 25 | 1 | 0 | 47 |
| L2 | 0 | 7 | 43 | 10 | 0 | 60 |
| L3 | 0 | 5 | 8 | 8 | 0 | 21 |

拆成多層的列（例如 F-031 的①在 L0、②③在 L2）以第一段的層級計入本表；各層人日以拆分後的段落加總，見 `23-remediation-backlog.md` §2。

### 4.4 修復類別（去重後，可重複計數）

| 類別 | 列數 |
|---|---:|
| engineer-hard（含 ＋reviewer） | 70 |
| 其中標 reviewer | 67 |
| engineer | 93 |
| docs | 11 |
| owner 外部 | 10 |
| 設定 | 7 |

## 5. 限制

- 本表沒有重新驗證任何 finding；標「需驗證」「推論」者沿用原報告的不確定性（例如 F-026 的 RLS 權限、F-079 的英文 404、F-110 的 UTC 顯示、F-107 的 slug P2002）。
- 「合併」是本表的判斷：若之後修法發現兩個來源其實要分開修，backlog 仍以來源 ID 追蹤，不會遺漏。
- 01～04 只讀摘要與判讀段；A-04 的判讀 1（本機 Prisma Client 過期）屬工程環境問題，列為「未分級」。
- 接手事項 T6（PWA 推播測試偶發失敗、三個後台首次進入無骨架、通知小問題）不是 Phase B 的 finding，沒有列入本表，只在 backlog L1 備註。
