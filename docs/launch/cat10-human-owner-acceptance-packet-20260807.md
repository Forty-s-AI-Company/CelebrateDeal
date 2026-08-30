# CAT10：Solo Founder operational responsibility acceptance packet

治理版本：`solo-founder-launch/v1`

決策來源：[ADR-2026-08-13 Solo Founder Owner Model](../decisions/ADR-2026-08-13-solo-founder-owner-model.md)

狀態：`READY_FOR_HUMAN_EXECUTION`

目的：驗證商家、客服、財務、privacy／policy 與 release responsibilities 是否真的可執行。這份 packet 不要求五位不同真人，也不把 AI、synthetic fixture 或本機測試偽裝成真人 approval。

## Owner model

同一真人可以承擔以下 responsibility：

```text
merchant_owner
support_operator
finance_owner
privacy_policy_owner
release_owner
```

正式旗標：

```text
sameHumanMultipleRoles=true
```

每個 responsibility 都要留下 role、holder reference、scope、時間、結果與 sanitized evidence。只有在 [Hard Blocker Provenance Rule](solo-founder-launch-standard.md#hard-blocker-provenance) 成立時，才可要求不同真人。

## Responsibility checks

| responsibility | required checks | evidence |
|---|---|---|
| `merchant_owner` | `owner_role_confirmed`、`onboarding_handoff_reviewed`、`merchant_impact_reviewed` | 商家設定、商業責任、影響與 rollback scope |
| `support_operator` | `support_queue_defined`、`severity_path_reviewed`、`escalation_owner_confirmed` | 客服入口、SLA expectation、P0/P1/P2 escalation |
| `finance_owner` | `sandbox_boundary_reviewed`、`refund_handoff_reviewed`、`reconciliation_gap_acknowledged` | CAT04 receipt、退款／付款 SOP、mismatch stop condition |
| `privacy_policy_owner` | `privacy_review_assigned`、`data_request_path_reviewed`、`retention_review_assigned` | privacy notice、terms、refund policy、retention／data request |
| `release_owner` | `responsibilities_reviewed`、`blockers_aggregated`、`release_decision_recorded` | owner ledger、hard blockers、rollback scope、`GO`／`HOLD`／`NO_GO` |

## Privacy and legal wording

若沒有法律要求獨立律師，不得把 owner self-review 稱作法律意見。receipt 應明確記錄：

```text
legal_compliance_self_review=true
not_independent_legal_counsel=true
```

若適用法律、provider 或 tracked project requirement 要求專業人士，該要求必須單獨附上 provenance，不得用 solo founder 身份取消。

## Operational acceptance

1. Owner 閱讀 current runbook、WP-122 onboarding contract、WP-175 sales-to-support handoff、付款／退款 SOP 與本 packet。
2. 對每個 required check 記錄 `ACCEPTED`、`REJECTED`、`BLOCKED` 或 `PENDING`，並綁定 opaque evidence reference。
3. 同一 `holderRef` 可以出現在多個 responsibility；不得因 holder 相同而自動產生 blocker。
4. Release owner 最後記錄 `GO`、`HOLD` 或 `NO_GO`。`GO` 不等於 Production deployment authorization。

## Minimum observability

最低 production error observability 仍是 direct production risk，不能取消。至少要能：

- 安全分類錯誤，不保存 raw exception、付款資料、Token、Cookie 或 PII。
- 讓 owner 知道核心付款、退款、webhook、資料庫或服務故障。
- 依 SOP 建立 support／escalation path。

完整 external monitoring delivery／ack／recovery packet 若沒有 provider、法律或 tracked requirement provenance，分類為 warning／follow-up，不單獨阻擋 solo founder launch。

## Sanitized receipt contract

```json
{
  "schemaVersion": "celebratedeal-cat10-solo-founder-responsibility/v1",
  "packetId": "opaque packet reference",
  "responsibilities": [
    {
      "roleId": "merchant_owner|support_operator|finance_owner|privacy_policy_owner|release_owner",
      "holderRef": "opaque holder reference",
      "sameHumanMultipleRoles": true,
      "decision": "ACCEPTED|REJECTED|BLOCKED|PENDING",
      "checks": [
        { "checkId": "contract required check", "status": "PASS|FAIL|BLOCKED", "evidenceRef": "opaque reference" }
      ],
      "sanitized": true,
      "sensitiveDataPersisted": false
    }
  ],
  "legalComplianceSelfReview": true,
  "notIndependentLegalCounsel": true,
  "releaseDecision": "GO|HOLD|NO_GO",
  "productionApproval": false
}
```

上述只是欄位契約，不得直接填成 PASS。實際缺口必須保持 `PENDING`／`BLOCKED`。

## CAT10 aggregation

CAT10 responsibility acceptance 可在以下條件成立時送交 scoring owner：

- 五個 responsibility role 各有可追溯 holder reference；holder 可以是同一真人。
- 每個 required check 都有實際結果與 sanitized evidence reference。
- 適用的 privacy／terms／refund／retention／data request obligations 已接受或明確標為 blocker。
- support、finance、merchant 與 release SOP 可由 owner 執行。
- Release decision 已記錄為 `GO`、`HOLD` 或 `NO_GO`。
- 任何 hard blocker 都有完整 provenance；enterprise preference 不得單獨 block。

缺少真人或外部 evidence 時，仍要如實維持 CAT10／readiness 的實際狀態；本文件不自行套分，也不把 `GO` 寫成 `PRODUCTION_READY=true`。

