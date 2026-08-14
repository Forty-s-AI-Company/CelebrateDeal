# ADR-2026-08-13：Solo Founder Owner Model

狀態：`ACCEPTED`

生效日：2026-08-13（Asia/Taipei）

## Decision

CelebrateDeal 採用 Solo Founder Owner Model。具備實際系統與業務控制權的同一位真人，可以同時擔任：

```text
merchant_owner
support_operator
finance_owner
privacy_policy_owner
release_owner
staging_owner
payment_provider_owner
```

正式治理旗標：

```text
sameHumanMultipleRoles=true
```

CAT04 中允許：

```text
stagingOwnerRef == payUniOwnerRef
```

這代表 responsibility 可以重疊，不代表可以省略 payment、security、policy、recovery 或 provider evidence。

## Rationale

CelebrateDeal 由單一主要 owner 開發、維運與準備販售。角色數量不是安全控制本身；真正的控制是付款 reconciliation、權限隔離、資料保護、provider boundary、政策責任與可恢復性。沒有明確 provenance 時，不能把企業常見的 separation of duties 自動轉成 solo founder 的 hard launch blocker。

## Risks

- 單一 owner 可能漏看自己的錯誤或延遲處理事故。
- 同一人管理 staging 與 Sandbox 時，可能把 environment identity 或 receipt lineage 混淆。
- privacy self-review 不能取代適用法律要求的專業意見或外部核准。

## Compensating controls

- 每個 responsibility 都要有明確的 SOP、owner reference、狀態與 sanitized evidence。
- CAT04 必須完成 payment reconciliation outcome：environment／provider identity、order、reference、amount、payment／refund／callback state、signature 與 idempotency safety 均需可驗證且一致；transaction 可重用，provider read-only query 可 bounded retry，evidence 格式可等價替換。
- 所有 release blocker 必須符合 [Hard Blocker Provenance Rule](../launch/solo-founder-launch-standard.md#hard-blocker-provenance)。
- Release decision 必須明確記錄 `GO`、`HOLD` 或 `NO_GO`，但不等於 Production deployment authorization。
- 保留 unknown owner、unknown decision、敏感輸入與 production claim 的 fail-closed 驗證。

## Conditions requiring a second human

只有下列 provenance 存在時，才可要求不同真人：

```text
EXTERNAL_PROVIDER
LEGAL_REGULATION
TRACKED_PROJECT_REQUIREMENT
ACCEPTED_SECURITY_DECISION
DIRECT_PRODUCTION_RISK
```

每次要求第二人，必須在 blocker record 中填寫：`source`、`reason`、`risk_if_missing`、`provenance`。若找不到上述 provenance，要求必須降級為 warning／follow-up，並記錄 migration rationale。

## Historical integrity

此 ADR 只影響生效日後的新 governance version。WP-195、WP-196、WP-197 既有 evidence 的當時結果不修改、不重跑，也不回溯改標為 PASS。
