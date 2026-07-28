# CelebrateDeal Code Review Report

最後更新：2026-07-25 22:21（Asia/Taipei）

## Findings

### CR-001 — E2E DB isolation 未 fail-closed

- 嚴重度：P1
- 狀態：Resolved
- 範圍：`playwright.config.ts`
- 證據：設定先讀取 `.env.local`，僅在 URL 缺少或為 `file:` 時才使用本機 PostgreSQL。
- 風險：若開發者把 `.env.local` 改指 Staging/Production，含資料寫入的 E2E 可能誤碰外部 DB。
- 重現：目前僅驗證當下兩個 URL 是 loopback；設定沒有拒絕非 loopback。
- 修正：新增共用 `scripts/local-database-safety.ts`，Vitest 與 Playwright 啟動前拒絕非 loopback／非專用 DB。
- 驗證：10 個單元案例通過；remote fixture 被拒絕；例外只含安全 category，不含 URL/credential。

### CR-002 — E2E／Next 子程序 lifecycle 尚未證明 deterministic

- 嚴重度：P1
- 狀態：Closed — not reproducible after complete wait
- 範圍：`playwright.config.ts`、E2E scripts
- 證據：前序基準曾留下 Playwright/Next 子程序並造成 `.next/lock`；本輪起始狀態已乾淨。
- 風險：CI 或本機 release gate 偶發卡死、後續 build 不可重現。
- 結論：Playwright 1.61 在 Windows 使用精確 process-tree termination。本輪完整等待命令結束後未出現 orphan；未增加多餘 kill wrapper。
- 驗證：三次連續 25/25 E2E→owned child=0→listener=0→lock=false→build success；依賴更新後另一次完整回歸也通過。

### CR-003 — 執行環境文件不一致

- 嚴重度：P2
- 狀態：Resolved
- 範圍：`README.md`
- 證據：README 為 WSL-first；本次工具鏈校正為 Windows 原生且完整可用。
- 風險：新進協作者選錯 shell/路徑，重現方式分裂。
- 修正：README 將 Windows PowerShell 標為已驗證主路徑，WSL 改為替代路徑；同步 Next 版本與必要驗證。
- 驗證：Windows 原生 lint/typecheck/unit/E2E/build/audit 全部通過。

### CR-004 — Vulnerable PostCSS lock resolution

- 嚴重度：P1
- 狀態：Resolved
- 範圍：`package-lock.json`
- 證據：`npm audit --omit=dev` 指出 PostCSS path traversal，依賴鏈經 Next/Sentry。
- 修正：保留既有 `^8.5.16` override，只將 lock resolution 更新至 8.5.23；未採用破壞性的 `audit fix --force`。
- 驗證：production audit=0；完整 lint/typecheck/unit/E2E/build 通過。

### CR-005 — Codex Security standard scan candidate pool requires validation

- 嚴重度：P1
- 狀態：Candidate
- 範圍：repository-wide
- 證據：Codex Security standard scan completed for revision `35d8f59341bcb776e548c69fe874a3f4d1fe2528` with 52 reportable candidates: high 25, medium 12, low 15, all medium confidence.
- 風險：若其中 high candidates 可達，可能影響 auth/MFA、payment/refund/webhook、tenant isolation、logging/secrets、frontend/browser 或 supply-chain posture。
- 限制：scan 是 static candidate output；尚未完成逐項可達性、檔案行號重現、攻擊路徑與回歸測試。
- 分布：authentication 11、authorization 12、availability 1、business-logic 15、operational-safety 2、sensitive-data-exposure 4、vulnerable-dependency 1、webhook-validation 6。
- 下一步：先驗證 authentication/MFA 與 payment/refund/webhook high candidates，逐項分類為 Validated、Invalid、Needs Decision 或 Manual Exception；沒有可重現證據不得改成 confirmed finding。
- 驗證：候選池摘要已寫入 `reports/quality/20260725T094618Z-continuation-baseline.md` 與 `reports/quality/20260725T095345Z-security-candidate-summary.md`。

### CR-006 — Password reset token consume race

- 嚴重度：P1
- 狀態：Validated → Patched locally, DB concurrency regression passed
- 範圍：`src/lib/password-reset.ts`
- 證據：原實作先 `findUnique` 檢查 token，再於 transaction 內更新 user、token、session；token consume 沒有以 `usedAt: null` 的 conditional update 原子 claim。
- 風險：併發請求可能在競態中重複通過前置檢查，造成同一 reset token 被重複使用。
- 修正：改為 transaction callback，先以 `updateMany({ id, usedAt: null, expiresAt > now })` claim token；`count !== 1` 時 fail closed。
- 驗證：isolated PostgreSQL 上 sequential replay 與 concurrent consumer atomic-claim regression 通過；最終只有一個密碼生效、一個 token 被 consume。

### CR-007 — MFA recovery code replay race and backslash redirect fallback

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/app/actions.ts`
- 證據：原實作先讀取未使用 recovery codes、在記憶體驗 hash，再以 `update({ id })` 標記使用；同時 `safeInternalPath` 未拒絕 `"/\\"` prefix。
- 風險：併發 recovery code request 可能重複完成 MFA；部分 user agent／proxy 對反斜線 URL normalization 可能形成外部導向風險。
- 修正：recovery code 改為 `updateMany({ id, userId, usedAt: null })` conditional claim；`count !== 1` 時 fail closed。`safeInternalPath` 新增 `"/\\"` fallback。
- 驗證：`npm test -- --run src/app/actions.test.ts` 94/94 通過；`npm run typecheck` 通過。

### CR-008 — Late payment callback state regression

- 嚴重度：P1
- 狀態：Validated → Patched locally, DB regression passed
- 範圍：`src/lib/payment-webhooks.ts`、`src/lib/payment-webhook-invariants.ts`
- 證據：原實作直接以 callback event type 覆寫 transaction status；晚到的 failed／paid callback 可能讓 `paid`、`partially_refunded` 或 `refunded` 狀態倒退。
- 風險：帳務狀態與退款 ledger 不一致，後續流程可能重複收款或退款。
- 修正：新增 monotonic status resolver；已付款／退款狀態拒絕被晚到 callback 倒退。
- 驗證：pure invariant 與 isolated PostgreSQL late-callback regression 全部通過。

### CR-009 — Refund callback amount/currency/remaining invariants incomplete

- 嚴重度：P1
- 狀態：Validated → Patched locally, DB regression passed
- 範圍：`src/lib/payment-webhooks.ts`、`src/lib/payment-webhook-invariants.ts`
- 證據：原 callback path 未在同一 transaction 內完整綁定原交易幣別、gross amount、剩餘可退款額與 partial/full refund 語意。
- 風險：錯幣別、超額退款或不一致 duplicate refund 可能污染 ledger。
- 修正：在 SERIALIZABLE transaction 內驗證 transaction existence、currency、gross amount、remaining amount 與 duplicate event invariants；不再以 clamp 隱藏 over-refund。
- 驗證：10 個 pure invariant tests 與 isolated PostgreSQL mismatch／over-refund／cross-month ledger regression 通過。

### CR-010 — Webhook retry lacked an atomic claim

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/lib/webhook-retry.ts`、`src/app/api/webhooks/payments/route.ts`
- 證據：原 retry worker 讀取 pending event 後處理，缺少 status/retryCount conditional claim；兩個 worker 可能同時處理同一事件，失敗 worker 亦可能覆蓋已 processed 狀態。
- 風險：重複 provider side effect、錯誤 retry state 或已成功事件被回寫為失敗。
- 修正：使用 conditional `updateMany` claim/finalize；lease 遺失回傳 `claimed_elsewhere`；route failure update 不得覆寫 processed。
- 驗證：`src/lib/webhook-retry.test.ts` 與 payment webhook route targeted regression 通過。

### CR-011 — Concurrent logical-order callbacks could create duplicate payment rows

- 嚴重度：P1
- 狀態：Validated → Patched locally, DB concurrency regression passed
- 範圍：`src/lib/payment-webhooks.ts`
- 證據：原實作在 transaction 外依 logical order 查找 payment row，兩個 callback 可能同時觀察「不存在」後各自建立。
- 風險：同一 order 出現重複 transaction、重複 commission 或狀態分裂。
- 修正：將 logical-order predicate re-read 移入 SERIALIZABLE transaction，後續 mutation 只使用 transaction 內 snapshot。
- 驗證：isolated PostgreSQL concurrent callback test 通過，單一 logical-order transaction。

### CR-012 — Affiliate commission check-then-create race

- 嚴重度：P1
- 狀態：Validated → Patched locally, DB concurrency regression passed
- 範圍：`src/lib/payment-webhooks.ts`
- 證據：原 commission existence check/create 位於 payment transaction 之外，併發 callback 可能同時通過檢查。
- 風險：同一 payment transaction 產生重複 commission。
- 修正：commission existence check/create 移入與 payment mutation 相同的 SERIALIZABLE transaction。
- 驗證：同一 isolated PostgreSQL concurrent callback test 同時驗證單一 transaction 與單一 commission。

### CR-013 — Inactive vendor member remained eligible for attribution ownership

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/lib/team-funnel-attribution.ts`
- 證據：attribution lookup 原本只檢查 TeamMembership `ACTIVE/leftAt`，未檢查其 VendorMember 或 User 已停用。
- 風險：已被租戶停權的成員仍可取得新 lead/conversion attribution。
- 修正：membership query 同時要求 VendorMember active、未 deactivated，且 User active。
- 驗證：team-funnel attribution targeted unit 通過。

### CR-014 — Global visitor ID enabled cross-tenant pseudonymous linking

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/lib/visitor-id.ts`、`src/components/live-playback.tsx`
- 證據：所有商家頁面共用同一 localStorage key，且 vendor analytics UI 顯示 raw visitor ID。
- 風險：同一瀏覽器跨商家瀏覽可被不同租戶以 pseudonymous ID 關聯。
- 修正：storage key 改為 vendor-scoped；空白 scope 僅產生 ephemeral ID、不持久化。
- 驗證：visitor ID unit 與 live playback component tests 通過。

### CR-015 — Team template could bind another member's webinar

- 嚴重度：P2
- 狀態：Validated → Patched locally, integration regression pending
- 範圍：`src/app/actions/team-funnel-template-actions.ts`
- 證據：原 selected webinar query 只限制 vendor/team，未限制 seminar owner 為目前 actor。
- 風險：同團隊成員可把自己的來源頁綁定到另一成員 webinar，破壞 ownership boundary。
- 修正：lookup 要求 seminar owner 為目前 VendorMember 的 active membership。
- 驗證：typecheck/lint 通過；尚待 release E2E mutation-negative case。

### CR-016 — Duplicate submission could claim attribution for an existing lead

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/app/api/form-submissions/route.ts`
- 證據：duplicate 與 P2002 concurrent-conflict branch 會對既有 submission 呼叫 attribution upsert。
- 風險：知道既有 email/form/live 的匿名請求可替未歸因 lead 指定攻擊者選擇的 attribution。
- 修正：既有或競態產生的 submission 維持 immutable attribution，不再由 duplicate request 補寫。
- 驗證：route duplicate/concurrent regression 通過。

### CR-017 — Unpublished, disabled, or expired page could still claim attribution

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/lib/team-funnel-attribution.ts`
- 證據：resolver 原本只按 vendor/live/slug 載入頁面，不檢查 share publication state。
- 風險：已停用或過期的來源頁仍可產生新 lead attribution。
- 修正：要求 share 為 PUBLIC、enabled 且未過期，否則 fail closed。
- 驗證：unpublished/disabled/expired parameterized tests 通過。

### CR-018 — Public partner page ignored webinar lifecycle

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/lib/team-funnel-public-page.ts`
- 證據：原頁面只檢查 webinar/form ownership，draft 或 ended 且 replay disabled 仍可公開與接受報名。
- 風險：未發布內容外洩、不可回放活動仍持續收集個資。
- 修正：只允許 scheduled、live，或 replayEnabled 的 ended webinar。
- 驗證：draft、ended/no-replay、archived regression 通過。

### CR-019 — Inactive product checkout URL remained public

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/lib/team-funnel-public-page.ts`、`src/lib/team-funnel-product-slots.ts`
- 證據：public query/product resolver 原本未載入或判斷 Product `isActive`。
- 風險：下架商品仍可透過夥伴頁進入 checkout。
- 修正：public/internal slot query 皆載入 active state；inactive product URL fail closed。
- 驗證：product-slot 與 public-page targeted regression 通過。

### CR-020 — Team member could open another member's template edit content

- 嚴重度：P2
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/app/(app)/team-templates/[id]/edit/page.tsx`
- 證據：原 edit page 只限制相同 vendor/team，未限制最新版本的 `contentOwnerMembershipId` 為目前 actor；頁面同時列出同隊其他成員 webinar。
- 風險：同團隊成員可透過已知模板 ID 讀取他人不可公開的模板版本內容與 webinar metadata，即使 mutation 最終另有 ownership guard。
- 修正：模板 outer predicate 與 included version 都要求目前 actor membership ownership；webinar 清單也只載入目前 actor 擁有項目。
- 驗證：page query regression、typecheck、lint 通過。

### CR-021 — Anonymous analytics authenticity policy requires product decision

- 嚴重度：P2
- 狀態：Needs Decision
- 範圍：`src/app/api/analytics/route.ts`、`src/lib/client-analytics.ts`
- 證據：public endpoint 會驗證 same-origin marker、rate limit、schema 與 vendor/live 關係，但 `visitorId` 與 event type 仍由 browser 提供。
- 風險：同源惡意腳本或自動化請求可膨脹 funnel metrics；這不是 tenant data read/write IDOR，但會降低商業分析可信度。
- 決策：需在「best-effort anonymous analytics」與「server-issued signed event session／cookie」之間選擇；詳見 `DECISIONS_NEEDED.md`。

### CR-022 — Referral source proof policy requires product decision

- 嚴重度：P2
- 狀態：Needs Decision
- 範圍：`src/app/api/affiliate-clicks/route.ts`、`src/lib/team-funnel-attribution.ts`
- 證據：新 click 可依 query/legacy referral code 與 same-origin Referer 衍生 source page；後續 checkout 已使用 server-issued signed attribution cookie。
- 風險：若產品把首次 click 也視為財務級證據，攻擊者可自行開啟合法 referral URL 製造 click attribution；若它只是公開連結的預期語意，則屬設計而非漏洞。
- 決策：需定義首次公開 referral link 是否即為充分證據，或必須增加 server-issued landing nonce；詳見 `DECISIONS_NEEDED.md`。

### CR-023 — Public partner contact email disclosure requires privacy decision

- 嚴重度：P2
- 狀態：Needs Decision
- 範圍：`src/lib/team-funnel-public-page.ts`、`src/components/team-funnel-public-page.tsx`
- 證據：公開夥伴頁資料包含 promoter account email，UI 可直接呈現。
- 風險：若帳號 Email 未明確同意作為公開聯絡資訊，會造成個資曝光與 harvesting 風險。
- 決策：需選擇 explicit public contact field、遮罩/聯絡表單，或保留現況並建立明確 opt-in；詳見 `DECISIONS_NEEDED.md`。

### CR-024 — Public form submission ignored webinar lifecycle

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/app/api/form-submissions/route.ts`
- 證據：帶 `liveId` 的提交原本只驗證 vendor/form binding，未限制 draft、archived 或 ended 且 replay disabled。
- 風險：UI 已不可見的直播仍能透過 API 收集姓名、Email 與電話。
- 修正：live lookup 只接受 scheduled、live，或 ended 且 replay enabled。
- 驗證：form-submissions route 13/13 tests、typecheck、lint 通過。

### CR-025 — Public click and analytics endpoints ignored webinar lifecycle

- 嚴重度：P2
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/app/api/affiliate-clicks/route.ts`、`src/app/api/analytics/route.ts`
- 證據：兩個 public routes 原本只驗 vendor/live pair，未限制公開 lifecycle。
- 風險：未發布或不可回放活動仍可寫入 click／analytics，污染營運指標並保留不應產生的追蹤資料。
- 修正：live lookup 使用相同 fail-closed lifecycle predicate。
- 驗證：affiliate／analytics route regressions 通過。

### CR-026 — Product-click analytics accepted an unbound product

- 嚴重度：P2
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/app/api/analytics/route.ts`
- 證據：`product_click` 原本只驗 live，payload 中任意 product ID 都會寫入 DB/PostHog。
- 風險：跨商家、下架或未綁定商品可污染導購漏斗，破壞報表完整性。
- 修正：server-side 要求 product 為該 live 的關聯商品、同 vendor 且 active。
- 驗證：analytics product-binding negative regression、typecheck、lint 通過。

### CR-027 — Stale Cloudflare callback could regress a terminal video state

- 嚴重度：P1
- 狀態：Validated → Patched locally, DB route regression passed
- 範圍：`src/app/api/cloudflare/stream-webhook/route.ts`、`src/lib/cloudflare-video-status.ts`
- 證據：原 webhook 依 callback arrival order 直接覆寫 `status`／ready flag；較舊的 processing 或 error callback 可把已 ready 影片降級。
- 風險：已可播放影片被標記為處理中或失敗，造成錯誤營運狀態與播放中斷。
- 修正：加入單調狀態轉移規則，並以目前狀態 conditional `updateMany` claim 防止 concurrent stale overwrite。
- 驗證：pure state-machine 8/8、相關 action/component batch 4 files／110 tests、typecheck、lint，以及 isolated PostgreSQL ready-terminal／error-recovery route regression 全部通過。

### CR-028 — Vendor forms could overwrite provider-owned Cloudflare identifiers and state

- 嚴重度：P1
- 狀態：Validated → Patched locally, targeted regression passed
- 範圍：`src/app/actions.ts`、`src/components/video-form.tsx`、`src/components/live-stepper-form.tsx`、`src/app/(app)/lives/[id]/edit/page.tsx`
- 證據：一般 vendor manager 表單可提交 Stream UID、Live Input UID、Playback ID、provider ready/status 與 playback URL。
- 風險：知道其他 provider UID 的租戶可製造 ambiguous mapping／callback denial，或偽造自身影片 provider 狀態；provider-owned state 不應以使用者表單為權威。
- 修正：新影片固定建立為 external URL；Cloudflare mapping/state 只由 job-secret Cloudflare ops 與簽章 webhook 寫入。編輯 Cloudflare 影片只允許 human-managed metadata，直播表單不再接受手動 UID。
- 驗證：action 負向測試確認 forged provider fields 被忽略；VideoForm／LiveStepperForm 確認沒有 writable provider control；4 files／110 tests、typecheck、lint 通過。

### CR-029 — Financial ledger relations did not enforce tenant identity at the database layer

- 嚴重度：P1
- 狀態：Validated → Patched locally, isolated DB negative regression passed
- 範圍：`prisma/schema.prisma`、`prisma/migrations/20260725112500_harden_tenant_ledger_foreign_keys/migration.sql`
- 證據：RefundRecord、AffiliateCommission、AffiliatePayout 與 PayoutItem 原本只以 resource ID 建立單欄 FK；`vendorId` 是獨立欄位，資料庫可接受 vendor A ledger 指向 vendor B payment／affiliate／settlement。
- 風險：若任何 future write path 漏掉 service-layer tenant predicate，帳務 ledger 可能跨 tenant 關聯，影響退款、分潤與結算完整性。
- 修正：改用 `[vendorId,resourceId]` composite foreign key；Settlement 補 supporting `[vendorId,id]` unique。Migration 僅調整 FK/index，沒有資料刪除、table drop、rename 或 DML。
- 驗證：local read-only mismatch aggregates 全為 0；candidate migration 已在 loopback-only PostgreSQL 套用；四個 same-tenant writes 通過，四個 cross-tenant writes 均被 PostgreSQL 拒絕並回 Prisma `P2003`。
- 外部界線：尚未對 Production／Staging 執行 aggregate preflight 或 migration；未獲授權前不套用。

### CR-030 — Scoped payment webhook lookup ignored provider identity

- 嚴重度：P1
- 狀態：Validated → Patched locally, isolated DB regression passed
- 範圍：`src/lib/payment-webhooks.ts`、`src/lib/payment-webhooks.test.ts`
- 證據：webhook 有 vendor identifier 時，原本以 `vendorId + orderNumber` 查找交易；transaction 內 re-read 也使用相同 predicate。若同 vendor 在不同 provider 出現相同 order number，callback 可能更新另一 provider 的交易。
- 風險：錯誤交易可被標為 paid/refunded、錯誤建立 commission 或套用 inventory transition，屬財務完整性與 provider boundary 問題。
- 修正：scope resolution 與 SERIALIZABLE transaction re-read 都要求 `vendorId + providerName + orderNumber`。
- 驗證：isolated DB 建立相同 vendor/order、不同 provider 的兩筆情境；demo callback 只建立／更新 demo transaction，另一 provider transaction 維持 pending。完整 payment webhook suite 29/29、typecheck、targeted ESLint 通過。

### CR-031 — Account and app-shell accessibility gates exposed contrast and obscured targets

- 嚴重度：P1
- 狀態：Validated → Patched locally, release browser regression passed
- 範圍：`src/app/globals.css`、`src/components/app-shell.tsx`、`src/components/ui.tsx`、account pages、dashboard、interaction-role controls
- 證據：首次 release-mode axe 執行回報 serious color-contrast／target-size；桌面固定登出區覆蓋下方導覽，mobile brand target 只有 24px，部分 icon-only controls 沒有 accessible name。
- 風險：低視力、鍵盤、螢幕閱讀器與觸控使用者可能無法辨識或可靠操作主要導覽與帳號流程。
- 修正：AA 對比 token、44px target、可捲動 sidebar、skip link、focus-visible、reduced-motion、ARIA label/pressed/live regions 與 autocomplete。
- 驗證：`npm run e2e:a11y` 最終 8/8；public account、31 static owner routes、14 dynamic owner/public commerce routes、platform-admin MFA/operations、keyboard/focus、skip link、reduced-motion、mobile overflow/touch target 均通過；`npm run e2e:performance` 2/2。
- 剩餘界線：尚未涵蓋所有複雜 error/loading/destructive/provider-specific states 與人工 screen-reader journey，不標示全站 100。

### CR-032 — Default Prisma transaction admission timeout rejected valid concurrent operations

- 嚴重度：P1
- 狀態：Validated → Patched locally, full regression passed
- 範圍：`src/lib/password-reset.ts`、`src/lib/inventory-reservations.ts`
- 證據：完整 suite 與個別重跑都可重現 `P2028 Unable to start a transaction in the given time`；password reset concurrent consume 與 final-unit inventory reservation 於預設 2 秒 admission wait 失敗。
- 風險：Production runtime 刻意使用小型 serverless connection pool；合法並行請求可能在 business invariant 執行前直接失敗，造成密碼重設或結帳可靠性下降。
- 修正：兩個 interactive transaction 明確設定 bounded `maxWait=5s`、`timeout=10s`；沒有放寬 token claim、inventory predicate 或 transaction isolation。
- 驗證：targeted 4/4＋5/5；目前完整 regression 109 files／857 tests；release browser 35/35。

### CR-033 — CI omitted mandatory audit, secret, accessibility and performance release gates

- 嚴重度：P1
- 狀態：Validated → Patched locally, external CI execution pending
- 範圍：`.github/workflows/ci.yml`、`scripts/secret-scan.ts`、`scripts/secret-scan.test.ts`
- 證據：既有 workflow 只有 E2E smoke，沒有 production audit、repository secret/archive scan、axe 或 performance。
- 風險：dependency、credential/archive 與瀏覽器品質退化可在 push 時未被阻擋。
- 修正：CI 加入 production audit、safe secret/archive scan，並將 smoke-only 改為完整 release browser suite。
- 驗證：scanner tests 4/4、相關 batch 56/56、scanner 0 finding、production audit 0、完整 browser 35/35。因本 Goal 禁止 push，GitHub runner 尚未執行本 revision，不提前標記 external CI passed。

### CR-034 — Operational monitoring transmitted raw errors and arbitrary context

- 嚴重度：P1
- 狀態：Validated → Patched locally, full regression passed
- 範圍：`src/lib/monitoring.ts`、`src/lib/monitoring.test.ts`
- 證據：原 wrapper 會在 local console 輸出 raw message/context，並把原始 `Error` 與任意 context 送進 Sentry。
- 風險：provider／database／application error 可能把 URL、credential、payload 或其他敏感 context 帶進長期日誌與外部監控。
- 修正：只保留 safe category、allowlisted Prisma/provider code、environment 與 allowlisted簡單 context；Sentry 改送 generic operational error，不再傳原始 cause/message/meta/stack。
- 驗證：monitoring exclusion/classification tests、完整 112 files／880 tests、lint、雙 typecheck、build、secret scan 全部通過。

### CR-035 — Public live route exposed unpublished or inactive commerce state

- 嚴重度：P1
- 狀態：Validated → Patched locally, full release regression passed
- 範圍：`src/app/live/[slug]/page.tsx`、`src/components/live-playback.tsx`、checkout query tests、Playwright fixtures
- 證據：公開 route 原本只依 slug 取得直播，draft／ended-without-replay 可被直接開啟；巢狀商品與表單也沒有在公開 read boundary 排除 inactive state。
- 風險：未發布內容、停用品項或已關閉報名表可能被使用者直接存取，且公開 UI 無法區分即將直播、直播中與回放。
- 修正：公開 read fail closed 至 scheduled/live/replay-enabled ended，商品與表單依 active state 過濾；UI 顯示真實 lifecycle 與 CTA 失敗；checkout regression 鎖定 vendor scope 與 active product。
- 驗證：page/unit targeted regression、公開 draft 404 browser case、完整 E2E 39/39、axe 8/8、performance 3/3、完整 static/build/security Gates 通過。
- 產品邊界：`Vendor` 尚無全站停權欄位，已列為 D-007，未擅自加入 schema。

## 已檢查但尚未下結論

- Prisma DB-I01、DB-I02、DB-I06～DB-I10 與外部 migration compatibility
- 其餘 API contract replay/error manifest 與 external provider fixtures
- 其餘產品 routes 的 UI/UX、accessibility、visual regression 與 field CWV

這些將依 Runbook Phase 2–5 逐項補證據，不提前標示通過。
