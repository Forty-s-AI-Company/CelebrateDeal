# M2 Security／Authorization Canonical Candidate Inventory

日期：2026-07-29
Work Package：WP-24
Current HEAD：`8a78acd1b6cf22978a71eff4d7448a3730006d44`
Historical scan baseline：`35d8f59341bcb776e548c69fe874a3f4d1fe2528`

## 結論

歷史 security summary 宣稱 52 個 candidate findings，但 repository 只保留 20 個具名候選與類別統計；`findings.json`、`results.sarif`及完整 scanner report 不在目前 repository。從歷史 baseline 到 current HEAD，`src`、`prisma`、package metadata與 E2E 範圍已有 133 個檔案變更，因此 52 不再是 current candidate count。

本次只做靜態 current-HEAD reconciliation，沒有執行產品測試、runner、Codex Security、npm audit、外部工具、正式服務或正式資料。Inventory 找到：

- 具名歷史候選：20
- `MITIGATED_CURRENT_SNAPSHOT`：17
- `REJECTED_CURRENT_SNAPSHOT`：2
- `EXTERNAL_MANUAL`：1
- Current authorization residuals：6，其中1項 `OPEN_LOCAL`、1項 `INSUFFICIENT_EVIDENCE`、4項 `PRODUCT_DECISION_REQUIRED`
- 未具名歷史細節：32，只保留一列 `HISTORICAL_DETAIL_UNAVAILABLE`

以上數量是 inventory 分類，不是 confirmed defect count。沒有由本次靜態盤點確認的可達 Critical／High finding。

## Evidence authority

1. Current source與tests at HEAD `8a78acd`
2. WP-08 canonical run `20260729050408559`
3. WP-07／17／18／19／20 canonical receipts
4. `docs/codex-goal/CODE_REVIEW_REPORT.md` 與 `AUTHORIZATION_MATRIX.md`
5. Historical security candidate summary；只用來辨認具名候選，不繼承 verdict

## Current surface manifest

### Route handlers

- Count：27
- Canonicalization：repo-relative slash paths，以Unicode ordinal排序，UTF-8／LF串接且無結尾換行
- Manifest SHA-256：`9D59340983AD0F1FBC5CE9920D4237CA98324D74A8BA83CA057A3FB0D92878BB`

```text
src/app/(app)/billing/invoices/export/route.ts
src/app/admin/billing/payouts/[id]/csv/route.ts
src/app/api/admin/ops/cloudflare/direct-upload/route.ts
src/app/api/admin/ops/cloudflare/live-input/route.ts
src/app/api/admin/ops/test-analytics/route.ts
src/app/api/admin/ops/test-email/route.ts
src/app/api/admin/ops/test-monitoring/route.ts
src/app/api/admin/preflight/route.ts
src/app/api/affiliate-clicks/route.ts
src/app/api/analytics/route.ts
src/app/api/auth/password-reset/confirm/route.ts
src/app/api/auth/password-reset/request/route.ts
src/app/api/cloudflare/direct-upload/route.ts
src/app/api/cloudflare/live-inputs/route.ts
src/app/api/cloudflare/stream-webhook/route.ts
src/app/api/form-submissions/route.ts
src/app/api/health/route.ts
src/app/api/jobs/webhook-retry/route.ts
src/app/api/payments/checkout/route.ts
src/app/api/security/csp-report/route.ts
src/app/api/team-funnel/copies/route.ts
src/app/api/team-funnel/pages/route.ts
src/app/api/team-funnel/partner-profile/route.ts
src/app/api/team-funnel/product-slots/route.ts
src/app/api/team-funnel/shares/route.ts
src/app/api/team-funnel/templates/route.ts
src/app/api/webhooks/payments/route.ts
```

### Server Actions

- Modules：5
- Textual exported async actions：50
- Canonicalization：每列為`repo-relative-module-path::exportName`，以Unicode ordinal排序，UTF-8／LF串接且無結尾換行
- Manifest SHA-256：`398B911F6812946A489ACB3CCB1A63232A2DB11FBC6B016D312ECDF04E682713`
- 舊 authorization matrix 的47項已漂移；root wrapper與domain implementation可能同名，50只表示exported surface，不表示50個獨立權限政策。

| Module | Export count |
|---|---:|
| `src/app/(app)/billing/plans/actions.ts` | 1 |
| `src/app/actions.ts` | 42 |
| `src/app/actions/team-funnel-partner-actions.ts` | 3 |
| `src/app/actions/team-funnel-template-actions.ts` | 1 |
| `src/app/actions/vendor-member-actions.ts` | 3 |

## 20 個具名歷史候選

| candidate_id | origin／current_head | surface | actor_and_preconditions | source_sink_or_resource | authn_authz_tenant_mfa_guards | current_tests_and_receipts | classification | severity_if_confirmed | local_automatability | external_or_product_decision | recommended_next_wp |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M2-H01 Password reset enumeration | Historical auth／current HEAD | Public reset action＋API | Anonymous、valid email syntax、same-origin/rate gate | Account lookup、token與email scheduling | Generic response；work deferred至`after()` | WP-07 matrix；WP-08 password-reset Browser；route known/unknown equality | `MITIGATED_CURRENT_SNAPSHOT` | High | Re-run after auth changes | 外部email timing side-channel未量測 | None |
| M2-H02 Password reset token race | Historical auth／current HEAD | `consumePasswordResetToken` | 持有未過期raw token的兩個consumer | Token conditional claim、password/session mutation | `usedAt:null`＋expiry predicate；single interactive transaction | Disposable PostgreSQL sequential/concurrent tests；WP-08 confirm journey | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | Production transaction behavior未外推 | None |
| M2-H03 MFA recovery code race | Historical auth／current HEAD | `verifyMfaAction` | Authenticated MFA user、相同recovery code | `userRecoveryCode.updateMany`與session verification | CSRF、auth、factor、rate limit、`usedAt:null` conditional claim | WP-17 PostgreSQL一勝一敗；WP-08 single-use Browser journey | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | Production DB未驗 | None |
| M2-H04 MFA redirect validation | Historical auth／current HEAD | `verifyMfaAction next` | MFA user提交attacker-controlled next | Redirect target | `safeInternalPath`拒絕`//`、`/\\`與non-slash | Action negative tests；WP-08 MFA journey | `MITIGATED_CURRENT_SNAPSHOT` | Medium | YES | Proxy/browser normalization不是獨立完整矩陣 | None |
| M2-H05 Late callback state rollback | Historical payment／current HEAD | Payment webhook | 已驗簽但較晚抵達的舊狀態callback | Payment status與ledger | Monotonic status resolver；SERIALIZABLE mutation | Late callback pure＋isolated DB regression；canonical coverage | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | External provider ordering未實測 | None |
| M2-H06 Refund callback binding | Historical payment／current HEAD | Payment webhook/refund invariants | 已驗簽refund callback | Provider/order transaction、amount/currency/refund identity | Provider-scoped lookup、remaining amount與duplicate event checks | Mismatch、over-refund、duplicate、cross-month tests | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | PayUni identifier uniqueness仍屬D-006 | None |
| M2-H07 Payment transaction create race | Historical payment／current HEAD | Checkout＋webhook | 同一logical order併發callback | PaymentTransaction與commission create | SERIALIZABLE re-read、provider/order scope | Concurrent logical-order/commission DB regression | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | Merchant namespace屬D-005 | None |
| M2-H08 Payout batch race | Historical payment／current HEAD | `createPayoutBatchAction` | 兩個finance admin caller讀到相同settlement | Batch/item/settlement claim | Finance admin＋MFA；conditional PostgreSQL claim | WP-18一勝一敗；WP-19 coverage closure | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | Production payout未驗 | None |
| M2-H09 Team funnel source page binding | Historical authorization／current HEAD | Public attribution resolver | Anonymous attribution request | Source page、webinar、vendor/live | API origin derivation；source page須綁submitted webinar | `team-funnel-attribution.test.ts` negative cases | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | Release mutation journey另列M2-A01 | WP-25 only for mutation boundary |
| M2-H10 Attribution ownership | Historical authorization／current HEAD | Team funnel attribution | Query/cookie referral與team member | Content/webinar owner、affiliate attribution | Vendor/team/resource ownership與signed cookie checks | Attribution owner/cross-tenant tests；checkout cookie negatives | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | D-001/D-002可信度政策未決 | None |
| M2-H11 Inactive member attribution | Historical authorization／current HEAD | Team membership lookup | 已停用VendorMember/User | Lead/conversion attribution | Membership、VendorMember與User均須active | Access/attribution inactive-member tests | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | Production lifecycle未外推 | None |
| M2-H12 Visitor ID cross-tenant linkability | Historical privacy／current HEAD | Browser visitor identity | 同一瀏覽器跨vendor | localStorage visitor ID | Vendor-scoped key；blank scope不persist | `visitor-id.test.ts` vendor-isolation cases | `MITIGATED_CURRENT_SNAPSHOT` | Medium | YES | Browser storage政策仍需隱私文件 | None |
| M2-H13 Stream webhook stale state | Historical webhook／current HEAD | Cloudflare Stream webhook | Valid signed stale callback | Video provider status | Monotonic transition＋current-status conditional claim | Pure state tests＋route stale/error recovery DB regression | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | External Cloudflare delivery未驗 | None |
| M2-H14 Manually supplied provider UID collision | Historical webhook／current HEAD | Vendor video forms＋webhook mapping | Vendor manager或ambiguous UID callback | Provider UID/state與Video mapping | Vendor forms不接受provider-owned fields；ambiguous mapping returns409 | Action/form negatives；route multi-tenant collision test | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | Exact provider account binding屬external manual | None |
| M2-H15 Fixture payload trust boundary | Historical webhook／current HEAD | `scripts/cloudflare-webhook-fixtures.ts` | 本機operator且持有webhook secret | Explicit CLI fixture replay | Script-only；runtime route仍要求signature/schema；production fallback fail closed | Static reachability＋route signature/expired/unknown-state tests | `REJECTED_CURRENT_SNAPSHOT` | High | NO | Fixture重播是需另授權的external side effect | None |
| M2-H16 Vercel env pull | Historical ops／current HEAD | External validation runbook | 有Vercel帳號與credential的operator | Env files與正式Secret | Repository runner不讀source `.env*`；外部CLI仍會落地gitignored env file | WP-08 environment safety；本WP未執行Vercel | `EXTERNAL_MANUAL` | High | NO | 需平台owner與Secret handling授權 | External Gate WP |
| M2-H17 DB URL through argv | Historical ops／current HEAD | Local scripts/runners | 本機operator | DB connection strings與process list | Current runners以child environment傳URL並sanitize logs；未找到DB URL argv parser | Static `process.argv`／DB URL reachability review | `REJECTED_CURRENT_SNAPSHOT` | High | YES | 正式CLI操作仍需time-of-use review | None |
| M2-H18 Screenshot visual PII | Historical docs／current HEAD | WP-08 screenshot/trace artifacts | Local Browser QA | Public commerce image/trace | `public_only=true`；synthetic environment；sensitive scan false | Canonical artifact manifest兩份、hash與sensitive flag | `MITIGATED_CURRENT_SNAPSHOT` | Medium | YES | 結論只限WP-08 artifacts，不涵蓋所有歷史圖片 | None |
| M2-H19 Sensitive data weak key setup | Historical sensitive-data／current HEAD | Bank-account envelope/keyring | Runtime operator提供keyring | Encrypted payout bank details | v2 envelope、active/decrypt-only keys、length/shape、AAD vendor binding、fail closed | WP-12 rotation/recovery/idempotency＋build receipts | `MITIGATED_CURRENT_SNAPSHOT` | High | YES | Production key custody/rotation ceremony未驗 | External key-management Gate |
| M2-H20 Brace-expansion advisory reachability | Historical dependency／current HEAD | Production＋dev dependency tree | Build/lint tooling input | `brace-expansion` package chain | Production resolution5.0.8；legacy1.x只在minimatch dev tooling chain | Lockfile static check；歷史 production audit=0 | `MITIGATED_CURRENT_SNAPSHOT` | High | YES, lockfile only | 本WP未重跑npm audit；dev upstream/SBOM仍未驗 | Future supply-chain WP if reprioritized |

## Current authorization residuals

| candidate_id | origin／current_head | surface | actor_and_preconditions | source_sink_or_resource | authn_authz_tenant_mfa_guards | current_tests_and_receipts | classification | severity_if_confirmed | local_automatability | external_or_product_decision | recommended_next_wp |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M2-A01 Webinar owner-boundary release E2E | Current authorization matrix／HEAD | Team template mutation | 同vendor/team的member A嘗試綁member B webinar | Template version/webinar binding | Server predicate要求actor active ownership | Static/action/page tests存在；release-mode mutation-negative Browser缺口仍明列 | `OPEN_LOCAL` | Medium | YES | 無產品決策 | WP-25 |
| M2-A02 Route×role×direct-URL Browser matrix | Current authorization matrix／HEAD | Owner/admin/accountant/platform_admin pages | Authenticated角色直接輸入不應進入的URL | Vendor writes、billing與platform admin routes | Existing role helpers、platform MFA、tenant queries | WP-08只證明unauth redirect與finance cross-area等子集合 | `INSUFFICIENT_EVIDENCE` | High | YES | 完整矩陣應分片，避免單WP過大 | WP-26 candidate |
| M2-A03 Analytics authenticity／D-001 | Current product decision／HEAD | Public analytics API | 同源惡意script或automation | Funnel events與visitor ID | Same-origin、client marker、rate limit、schema與vendor/live relation | Route negatives；不提供financial-grade authenticity | `PRODUCT_DECISION_REQUIRED` | Medium | NO until decision | Server nonce或best-effort定位需owner決定 | Decision packet |
| M2-A04 Referral proof／D-002 | Current product decision／HEAD | Affiliate click/checkout | 使用者自行開合法referral URL | Click attribution與signed cookie | Server-issued cookie才能影響lead/payment | Click/checkout cookie binding tests | `PRODUCT_DECISION_REQUIRED` | Medium | NO until decision | Public link語意與財務證明強度需owner決定 | Decision packet |
| M2-A05 Public contact Email／D-003 | Current product decision／HEAD | Public partner page | Anonymous harvester | Account Email公開展示 | Current UI無獨立public contact consent model | Static current-state review | `PRODUCT_DECISION_REQUIRED` | Medium | NO until decision | opt-in、relay或masking需owner決定 | Decision packet |
| M2-A06 Vendor finance MFA rollout／D-004 | Current product decision／HEAD | Vendor billing/owner security | owner/admin/accountant | Finance與security actions | Platform admin已強制；vendor角色目前optional MFA | Role helpers與MFA tests；規格文件互相衝突 | `PRODUCT_DECISION_REQUIRED` | High | NO until decision | 上線前step-up或MVP延後需owner決定 | Decision packet |

## Historical details unavailable

| candidate_id | origin | classification | 說明 |
|---|---|---|---|
| M2-HIST-GAP-32 | Historical 52 total minus20 named | `HISTORICAL_DETAIL_UNAVAILABLE` | Repository沒有raw findings、SARIF或完整report；不得把這32項列為current open、rejected或mitigated，也不得發明scanner ID、位置與嚴重度。 |

## External／manual register

以下不計入local residual closure：

| Gate | 狀態 | 所需授權／evidence |
|---|---|---|
| Supabase residual ACL／RLS／grants | `EXTERNAL_MANUAL` | Platform owner；非敏感catalog摘要與ACL/RLS receipt |
| Production Secret與provider account binding | `EXTERNAL_MANUAL` | Secret owner；只驗metadata，不輸出值 |
| PayUni sandbox／Production | `EXTERNAL_MANUAL` | Merchant、callback與付款／退款side-effect授權 |
| Deployment、正式資料、backup／rollback | `EXTERNAL_MANUAL` | Release/data owner與維護窗口 |
| Sentry／PostHog／Cloudflare delivery | `EXTERNAL_MANUAL` | 受控事件與收件端receipt |
| Screen-reader、法務、客服、onboarding | `EXTERNAL_MANUAL` | 人工owner signed checklist |

## Priority and next boundary

1. P0 current reachable finding：本次沒有確認。
2. P1 local authorization evidence：`M2-A01`，建議下一個獨立 WP 為 WP-25 webinar owner-boundary release-mode negative evidence。
3. P1 broad matrix：`M2-A02`，需在 WP-25 完成後由 Sol 再切角色／route範圍。
4. Product decisions：M2-A03～A06不自動進入Terra。
5. External/manual：不得由本機WP執行。

WP-24 完成後必須停止，不自動開始 WP-25。
