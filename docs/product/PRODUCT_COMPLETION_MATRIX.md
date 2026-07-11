# CelebrateDeal Product Completion Matrix

更新日期：2026-07-11  
判定規則：只有 schema／API 或 action／UI／權限／錯誤狀態／tests 都有證據時才標 `Done`。

| Domain | Capability | Status | Evidence / gap |
| --- | --- | --- | --- |
| SaaS | Authentication、DB session、password reset、MFA | Done | `src/lib/auth.ts`、`src/lib/password-reset.ts`、`src/lib/mfa.ts`、相關 tests |
| SaaS | Platform admin 與 vendor finance 隔離 | Done | `requirePlatformAdmin`、admin guards、authorization tests |
| SaaS | Workspace membership | Done | 工作區切換、邀請單次 token、owner MFA step-up、last-owner 併發保護與測試 |
| SaaS | Onboarding | Done | 持久化 onboarding 狀態、首次登入導向與 workspace 建立流程 |
| SaaS | Trial／到期／停權 entitlement | Done | `src/lib/entitlements.ts`；active/trialing、到期、停權、取消與 UI 錯誤狀態 |
| SaaS | Usage／quota／plans | Partial | runtime upload/live publish/event/affiliate gate 已有；真實 provider 用量回填仍為 External required |
| SaaS | Audit log | Done | Auth、billing、webhook、MFA 等敏感操作已有 audit |
| SaaS | Notification delivery | Done | Transactional outbox、delivery attempts、atomic monthly quota、recipient daily limit、Resend/fixture adapter、retry worker、PII audit 與 tests |
| Live commerce | Live/VOD、商品、表單、CTA、互動腳本 | Done | `/lives/**`、`/live/[slug]`、Cloudflare mapping、interaction timeline |
| Live commerce | 課程／Lesson／Session／Enrollment | Done for staging MVP | 免費銷講／活動報名垂直切片含 DB、actions/API、公開頁、名單權限、通知與 tests；依 A010 不宣稱付費 LMS 存取權 |
| Live commerce | 發布狀態機與 entitlement validation | Done | VOD 必須綁 ready video；live 必須有 Live Input UID 與 mapping；公開頁對歷史不完整資料 fail closed |
| Attribution | Referral candidate／click tracking | Done | `/api/affiliate-clicks` 驗 affiliate/live/vendor |
| Attribution | Server-side attribution snapshot | Done | 30-day last-touch signed HttpOnly cookie；tamper/expiry/vendor tests |
| Attribution | Lead 與 paid conversion 語意 | Done | `leadAt` 僅記報名；`convertedAt` 只由可信 paid webhook 根據 immutable click snapshot 寫入；退款先到不會誤標成交 |
| Attribution | First／last-touch selectable policy | Done | vendor tracking 設定 1–90 天窗口；first-touch 保留首筆 signed attribution，後續 click 仍記錄；last-touch 更新最新有效來源 |
| Attribution | Cross-device attribution | External required | 需登入 identity 或可信 CRM/訂單 identity，不以 browser cookie 假裝完成 |
| Commission | Pending commission／refund adjustment／void | Done | DB unique constraints、unknown order rejection、concurrent refund tests |
| Commission | Pending／approved／locked／paid／reversed ledger | Done | immutable payout relation、唯一 vendor/affiliate/month、advisory lock、人工 adjustment、付款前沖銷、paid 後退款負向 adjustment、audit 與 concurrency tests |
| Billing | Settlement／lock／payout／CSV／audit | Done | 逐交易 paymentMode、signed refund/carry ledger、generate/adjust/lock period advisory lock、immutable fee snapshot、payout state、CSV、audit、atomic rollback 與 concurrency tests |
| External storefront | Safe product/CTA URL | Done | HTTPS allowlist、read/write defense、table-driven tests |
| External storefront | Affiliate-specific product URL | Done | HTTPS 個人連結、有效歸因優先、商品預設回退與跨租戶 tests |
| External storefront | External order evidence/manual confirmation | Done | 商家證據提交、平台管理員審核、快照佣金、冪等與 audit；Click 不視為 purchase |
| Quality | lint/typecheck/unit/build/preflight | Done locally | CI 與本機 quality gate |
| Quality | Multi-tenant/payment/adversarial tests | Done for current core scope | Platform/payout/relation/provider/ledger、course PII、external evidence、attribution與 direct upload 負向測試已補；持續擴充仍屬日常品質工作 |
| Quality | Visual/a11y/performance | Done locally | 32 個 desktop/laptop/tablet/mobile comparisons、7 個 axe cases；Lighthouse 0.79/1/1/1 |
| Staging | Repo-local deployment/runbook | Done locally | 25 個 migrations、preflight、external smoke、CI staging workflow、atomic rollback/fail-closed drills 與 release docs |
| Staging | Real provider validation | External required | Supabase、Cloudflare、PayUni、Resend、Sentry、PostHog、Upstash、GitHub dashboard |

## Release Gate Rule

- `Missing` 的核心安全、付款、租戶隔離、佣金正確性項目會阻擋 Staging QA。
- Product expansion 可在核心旅程不受影響且有清楚 scope 時標 `Partial`，但不可宣稱完整 SaaS。
- `External required` 必須真的需要帳密、付費、真人驗證或外部 dashboard；repo 內可完成的 fixture、adapter、tests 和 runbook 不能留白。
