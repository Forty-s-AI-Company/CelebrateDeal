# CelebrateDeal Solo Founder Launch Standard

版本：`solo-founder-launch/v1`

生效日：2026-08-13

決策來源：[ADR-2026-08-13 Solo Founder Owner Model](../decisions/ADR-2026-08-13-solo-founder-owner-model.md)

## 目標

Launch readiness 的判準是：一個負責任的 solo founder 是否已經足以讓真實客戶安全付款、取得服務、申請退款並獲得支援，而不是是否具備大型公司的多人部門。

## Owner model

同一真人可以承擔多個 responsibility。`sameHumanMultipleRoles=true` 是合法狀態，不是自動通過安全檢查的捷徑。

每個 responsibility 都必須記錄：

- responsibility 與 SOP
- 實際 owner reference
- 目前狀態與未完成風險
- 對應 sanitized evidence

## Hard Blocker Provenance

任何 `BLOCKED`、`NO_GO`、`FAIL` 或會阻止 release 的 score deduction，都必須具備：

```text
source
reason
risk_if_missing
provenance
```

只有以下 provenance 可以單獨形成 hard blocker：

```text
EXTERNAL_PROVIDER
LEGAL_REGULATION
TRACKED_PROJECT_REQUIREMENT
ACCEPTED_SECURITY_DECISION
DIRECT_PRODUCTION_RISK
```

以下預設只能是 `WARNING`、`FOLLOW_UP` 或 `POST_LAUNCH_ACTION`：

```text
AI_TEAM_BEST_PRACTICE
ENTERPRISE_BEST_PRACTICE
AUDIT_PREFERENCE
DEFENSE_IN_DEPTH
```

找不到 provenance 時不得直接刪除既有 blocker；應保留原始條件、記錄 migration rationale，再將它重新分類。

## Release-critical controls

以下控制不能因 solo founder 身份移除：

- server-side payment amount、order identity、provider reference 與 status reconciliation
- refund amount、duplicate、partial、over-refund 與 ambiguous state 的 fail-closed handling
- authentication、authorization、MFA、tenant isolation、RLS／ACL
- secret、Token、Cookie、PII、付款資料與 raw provider payload protection
- production configuration、HTTPS、CSRF、rate limit 與 webhook signature
- migration、backup、restore、rollback 與重大故障復原
- 適用的 privacy、terms、refund、retention 與 data request obligations
- 核心付款、交付、退款與權限流程的 deterministic QA
- 至少一條可執行的 error observability 與 support／escalation path

### CAT04 payment reconciliation gate

CAT04 的 hard blocker 是 outcome，不是特定執行包：正式販售前必須以可信、可追溯的 evidence 證明目前 CelebrateDeal payment state 與 PayUni provider state 一致。必要欄位包含 environment identity、provider account／environment identity、order identity、provider reference、amount、payment status、refund status、callback／local state consistency，以及 signature／idempotency safety boundary。

`MISMATCH`、`UNKNOWN` 或 `UNVERIFIABLE` 任一必要欄位都會使 `PAYMENT_RECONCILIATION_READY=false` 與 `PRODUCTION_READY=false`。

fresh transaction、fresh lineage、`staging` 命名、exactly-once query、禁止 read-only retry、固定 receipt schema、特定 authorization record 與目前 CAT04 runbook 都是 implementation option、defense-in-depth 或 audit preference；它們不能在沒有額外 release-critical provenance 時單獨形成 hard blocker。若已有 transaction 能證明目前 environment generation、PayUni test account、local order binding 與完整 reconciliation，應優先重用，不為了 freshness 重新付款。

Provider query 必須是 read-only、bounded、auditable；可以有 bounded retry，但 payment／refund mutation 不得 retry 或產生新的付款副作用。Evidence 格式不限，可使用 redacted audit record、allowlisted JSON、provider-issued receipt、digest＋source reference 或等價受控 evidence；仍不得保存 secret、API key、Token、Cookie、raw payment credential、不必要 PII 或 raw sensitive provider payload。

## Warning / defense in depth

除非另有 provenance，以下不得單獨阻擋上線：

- 五位不同真人或五筆獨立 approval
- 獨立 release manager、finance person 或 legal person
- CAT04 distinct owners
- 完整 external monitoring delivery packet（最低 production error observability 仍保留）
- 完整 screen-reader matrix（基本 keyboard、focus、semantic accessibility 仍保留）
- analytics dashboard evidence
- AGY／Sol／AI acceptance
- 為 canonical score 完成度建立的 evidence 數量

## Readiness states

三種狀態不可互相代替：

### ENGINEERING_READY

代表本機工程證據已足夠：核心流程、auth／security、migration／recovery、tests、lint、typecheck、build 與必要 contract 均有目前可追溯結果。它不代表 Sandbox 或 Production 已驗證。

### SANDBOX_READY

代表 payment reconciliation outcome 已通過；不要求特定 fresh transaction、fresh lineage、staging 名稱或固定 receipt schema。可重用目前仍可驗證 binding 的既有 transaction。CAT04 任一 amount、status、reference、identity 或安全條件未知／不一致，都維持 `false`。

### PRODUCTION_READY

代表所有 release-critical、provider-required、適用 legal／policy、Production configuration、backup／restore／rollback 與 release decision 均完成。分數不得覆蓋任一 hard blocker。

## Release decision

單一 release owner 可以記錄：

```text
GO
HOLD
NO_GO
```

`GO` 只代表 release decision，不自動授權 Production deployment。
