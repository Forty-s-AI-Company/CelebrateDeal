# CelebrateDeal Requirements Traceability Matrix

最後更新：2026-07-25 22:21（Asia/Taipei）

## 使用方式

- 本矩陣把權威需求、實作邊界、自動化測試與原始證據串成單一可追溯鏈。
- `自動通過` 只代表目前 revision 已有可重現證據；不替代 Production 外部平台簽核。
- `部分通過` 表示程式／本機 Gate 已通過，但仍有明列的人工或外部證據。
- `待產品決策` 不視為 defect，也不允許工程端擅自擴張產品範圍。

## 核心需求追溯

| ID | 使用者／營運需求 | 權威來源 | 主要實作 | 自動化證據 | 外部／人工證據 | 狀態 |
|---|---|---|---|---|---|---|
| R-001 | 只有有效登入 session 可進入商家後台 | README、安全規則、MVP | `src/lib/auth.ts`、受保護 layout | `src/lib/auth.test.ts`；Playwright unauthenticated redirects | 無 | 自動通過 |
| R-002 | Platform admin 進入敏感後台前須完成 MFA setup/verify | `docs/admin-mfa-recovery-sop.md` | `src/lib/mfa.ts`、`src/app/mfa/*`、admin guard | `src/app/actions.test.ts`、`src/lib/auth.test.ts`；a11y admin MFA journey | Recovery code 實體保管為人工責任 | 部分通過 |
| R-003 | Password reset 不洩漏帳號存在性、token 只能使用一次、完成後撤銷 sessions | password reset runbook | `src/lib/password-reset.ts`、auth reset routes | reset route tests；`src/lib/password-reset.test.ts` sequential＋concurrent atomic consume | Production email delivery 在 M05/G05 | 部分通過 |
| R-004 | Vendor、member、content 與財務資料不得跨 tenant 存取 | Goal threat model、MVP tenant model | auth/member predicates、composite tenant FK migration、scoped queries | authorization matrix；tenant ledger `P2003` negative DB test；team-template edit test | Production catalog/ACL 另由 G03 | 自動通過 |
| R-005 | Server Actions 必須具 CSRF／same-origin 保護 | Goal security boundary | `src/lib/csrf.ts`、47 actions guard | `src/lib/csrf.test.ts`；authorization matrix inventory | 無 | 自動通過 |
| R-006 | 公開 JSON POST 不得接受未受信 client 或 cross-origin side effects | 安全規則 | `src/lib/api-security.ts`、public POST routes | API security unit tests；Playwright trusted-client/cross-origin negative cases | 無 | 自動通過 |
| R-007 | Request body 必須有大小上限，錯誤不可回傳敏感 provider detail | 安全規則 | bounded JSON/form/text readers、safe error mapping | `src/lib/api-security.test.ts`、provider route error tests | 無 | 自動通過 |
| R-008 | 公開端點需要可重現的限流，Production 禁用 memory provider | production infra/runbook | `src/lib/rate-limit.ts`、env validation | rate-limit unit tests；Playwright 5 個 invalid-payload 429 cases；env tests | Production durable-provider 429 為 G05 人工證據 | 部分通過 |
| R-009 | 公開直播頁只顯示可公開 lifecycle 與有效商品 | MVP live-commerce | public live resolver、product binding | smoke public live；form/click/analytics lifecycle tests；product-slot tests | Product presentation decisions 另見 D-005/D-006 | 自動通過 |
| R-010 | 公開表單可建立 lead，但重送須冪等且不得跨 tenant attribution | Team Funnel/MVP | form submission route、deterministic identifier、scoped attribution | public form E2E；route unit；isolated DB concurrent duplicate test | 無 | 自動通過 |
| R-011 | Team Funnel 分享、複製、partner override 與 attribution 必須保留 ownership lineage | Team Funnel 規格 | sharing/access/attribution/product-slot services | sharing、access、attribution、public-page、product-slot suites；browser acceptance | Email／analytics／referral trust 決策見 D-001～D-003 | 部分通過 |
| R-012 | Checkout 金額必須由 server-side 商品價格決定，不信任 client amount | PayUni checkout runbook | checkout route、product lookup | checkout route tests；Playwright client-amount tampering case | Production merchant/callback gate | 部分通過 |
| R-013 | PayUni callback 必須驗簽、scope 到 vendor/provider/order，重送冪等 | PayUni runbook | PayUni adapter、payment webhook route/service | PayUni adapter tests；webhook 29-test scoped regression；DB concurrency suite | Production PayUni 非敏感簽核 | 部分通過 |
| R-014 | 退款不得超額、狀態不可倒退、同 event 不得建立第二筆 RefundRecord | PayUni refund acceptance | payment invariants、refund transaction | refund invariant tests；payment webhook concurrency；Staging QA artifact | Production 真實金流不在自動範圍 | 部分通過 |
| R-015 | 庫存最後一件不得超賣，付款／失敗／完整退款的庫存轉移必須一次性 | Commerce integrity | `src/lib/inventory-reservations.ts` | inventory 5-test concurrency suite；payment webhook integration | 無 | 自動通過 |
| R-016 | Webhook retry 只能由一個 worker claim，失敗必須安全分類並有上限 | Operations runbook | `src/lib/webhook-retry.ts`、job route | atomic-claim/retry-limit tests；JOB_SECRET E2E | Production alert delivery 在 M05/G05 | 部分通過 |
| R-017 | Cloudflare UID/status/stream key 為 provider-owned，callback 不可被 stale event 降級 | Cloudflare checklist | Cloudflare ops、status resolver、webhook route | pure/action/component 110-test batch；isolated DB stale/recovery regression | Production exact token/account binding | 部分通過 |
| R-018 | Health／operational monitoring 只回安全 database/category/code，runtime 錯誤不可洩密 | Production health gate | health route、安全 Prisma diagnostics、safe monitoring wrapper | health route tests；monitoring message/meta/URL/password exclusion tests；release E2E health | Production health freshness與 alert delivery在 G04/G05 | 部分通過 |
| R-019 | Supabase Data API 對應用 tables 採 default deny，未授權 role 無 DML | Data API hardening plan | security migration、RLS/GRANT policy | migration static tests與既有 security artifact | residual default ACL=36 需 owner 處理 | 部分通過 |
| R-020 | Billing、commission、settlement、payout 狀態與退款調整必須一致 | Billing MVP | billing/payout/payment services、tenant FKs | billing、payout-state、payment webhook、tenant ledger tests | Production aggregate/read-only evidence在 G04 | 部分通過 |
| R-021 | Web UI 必須具鍵盤操作、可見 focus、skip link、reduced motion、行動 touch target | WCAG/Goal | app shell、UI components、CSS | release axe 8/8；31 static＋14 dynamic＋admin journeys | 人工 screen-reader MA-006 | 部分通過 |
| R-022 | 關鍵 account/dashboard 路徑需維持固定 release performance budget | Goal performance gate | Next release build、Playwright budgets | performance 2/2 | Public live field CWV 尚缺 | 部分通過 |
| R-023 | Production 備份需加密、異地 checksum、無明文殘留、可隔離還原 | backup runbook | `ops/backup/*` | PS7/PS5 static checks；既有 backup/restore evidence | 排程、retention、alert 人工驗收 | 部分通過 |
| R-024 | CI 必須執行 lint、typecheck、coverage、DB migration、release E2E、build、audit、secret scan | Goal DoD | `.github/workflows/ci.yml` | 本機所有 Gate 通過；coverage threshold 8/8 | workflow candidate 尚未 push／runner 執行 | 部分通過 |
| R-025 | Repository 不得提交 credential、private key、runtime archive 或 provider payload | 安全規則 | `.gitignore`、safe scanner | scanner unit 4/4；repository scan 0 findings | Git history scan/SBOM 後續 | 部分通過 |
| R-026 | 商家可在合理步驟內完成 onboarding、建立第一場直播並預覽／發布；公開頁不得曝光 draft／inactive content | UX audit、MVP | actionable dashboard checklist、8-step guarded live flow、preview route、public lifecycle/catalog guard、global pending feedback | onboarding/stepper/public-draft smoke、a11y、performance、112 files／880 tests | Template/import、跨步常駐 preview、time-to-first-live 仍待產品決策與真人驗收 | 部分通過 |
| R-027 | 正式收費前需有 PayUni、Sentry、WAF、Cloudflare、Resend、PostHog 完整簽核 | go-live checklist | 外部 adapter與 ops routes | fixtures／safe ops route tests | MA-001～MA-005 與 G05 | 人工阻塞 |

## Gate 對照

| Gate | 需求 ID | 目前證據 |
|---|---|---|
| Unit／coverage | R-001～R-026 | 112 files／880 tests；完整來源 coverage thresholds 通過 |
| Integration／DB | R-003、R-004、R-010、R-013～R-017、R-020 | loopback-only PostgreSQL；DB concurrency、tenant FK negative、provider state regression |
| Release browser | R-001、R-002、R-006、R-008～R-012、R-021、R-022、R-026 | 39/39：28 smoke＋8 a11y＋3 performance |
| Supply chain／secret | R-024、R-025 | production audit=0；safe repository scan=0 |
| External／manual | R-008、R-012～R-014、R-017～R-023、R-027 | `MANUAL_ACTIONS.md` |
| Product decisions | R-011、R-026 | `DECISIONS_NEEDED.md` |

## 未封閉的追溯缺口

1. R-026 需要產品方決定 onboarding template、常駐 preview 與 first-live acceptance，不能由 code review 自行定義。
2. R-027 需要各外部平台含日期、Production、結果、方法與簽核角色的非敏感證據。
3. R-019 的 residual platform-owner default ACL 需要 Supabase owner/support 權限。
4. R-021 仍需要人工 screen-reader journey。
5. R-024 的 workflow candidate 需要明確 push 授權後取得 GitHub-hosted runner 證據。
