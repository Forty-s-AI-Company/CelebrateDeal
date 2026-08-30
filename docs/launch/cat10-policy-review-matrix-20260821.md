# CAT10 政策、退款與客服 review matrix

日期：2026-08-21（Asia/Taipei）  
Source RC：`dbbffcf`
狀態：`PENDING_HUMAN`  
適用範圍：non-Production release readiness evidence preparation

這份 matrix 將公開政策、退款處理、資料請求與客服 escalation 的真人 review 欄位集中化。它是簽核準備文件，不是法律意見，也不代表任何 policy、provider 或 release owner 已核准。

## Acceptance rule

每一列在送交 owner 前，都必須有：

- policy／SOP 版本、文件來源與變更摘要；
- 生效日期或明確的 `PENDING_HUMAN`；
- 適用環境、商家／使用者範圍與 jurisdiction boundary；
- 對應 owner role、opaque holder reference、review decision 與 sanitized evidence reference；
- privacy／legal self-review 是否完成，以及 `notIndependentLegalCounsel=true`；
- 退款、資料請求、客服事件的停止條件與 escalation owner。

結果採 fail-closed：任何必要欄位是 `PENDING`、`UNKNOWN` 或沒有 evidence reference 時，該列保持 `PENDING_HUMAN`；任何 `REJECTED` 或 `BLOCKED` 會保持 blocker。全部列完成真人 review 也只代表 CAT10 candidate，不能單獨把 `PRODUCTION_READY` 改為 `true`。

## Review matrix

| Item | 目前來源 | 必要 review 內容 | 目前結果 | 缺少的可驗證證據 | 下一個安全動作 |
|---|---|---|---|---|---|
| Terms／使用條款 | `/policies/terms`、`src/lib/public-policy-content.ts` | 服務範圍、帳號與商家責任、內容／授權、停用與變更、申訴／聯絡方式、版本、生效日、適用範圍 | `PENDING_HUMAN` | 最終文字、版本與生效日、privacy／legal self-review、release owner acceptance | 由 policy owner 逐段 review，留下 opaque receipt；需要專業法律意見時另附 provenance |
| Privacy／隱私通知 | `/policies/privacy`、`src/lib/public-policy-content.ts` | 資料類型、用途、必要性、第三方 processor、跨境／資料流、保存期限、刪除例外、資料請求、事件通知與聯絡方式 | `PENDING_HUMAN` | retention／deletion matrix、data request process、provider scope、真人 privacy review | 由 privacy owner 完成資料分類與流程 review；未核准前不承諾法定期限或法律結論 |
| Refund／退款政策 | `/policies/refunds`、`docs/operations/payment-refund-support-incident-sop.md` | 全額／部分／重複／不明狀態、資格與例外、付款方式差異、處理時限、退款通知、爭議與升級責任 | `PENDING_HUMAN` | finance／support／policy owner 的決定、版本、生效日、PayUni reconciliation scope | 以 Sandbox／local evidence 支持流程描述，真人決定正式政策與適用例外 |
| Retention／data request | `src/lib/public-policy-content.ts`、`docs/launch/wp175-sales-to-support-operational-contract.json` | 各資料類別保存與刪除規則、export／correction／deletion routing、例外、回覆 owner、禁止承諾的 legal deadline | `PENDING_HUMAN` | 可執行的 request intake、retention schedule、privacy owner receipt | 先完成 process map 與停止條件；不得執行正式資料刪除、匯出或修改 |
| Customer support／escalation | `docs/operations/payment-refund-support-incident-sop.md`、`docs/launch/wp175-sales-to-support-operational-contract.json` | 客服入口、P0／P1／P2 定義、首次回應目標、升級 owner、付款／退款停止條件、客戶溝通模板、結案證據 | `PASS_LOCAL_ONLY`；真人 acceptance `PENDING_HUMAN` | support owner、finance owner、release owner 對 SLA expectation 與 escalation path 的 acceptance | 依 CAT10 packet 留下 holder／scope／decision receipt；未完成前維持封閉試用邊界 |

## Sanitized owner review template

以下是欄位模板，不是已完成的 receipt：

```json
{
  "itemId": "terms|privacy|refunds|retention_data_request|support_escalation",
  "sourceRef": "opaque:policy-review-source",
  "documentVersion": "PENDING_HUMAN",
  "effectiveAt": "PENDING_HUMAN",
  "scopeRef": "opaque:non-production-policy-scope",
  "ownerRole": "privacy_policy_owner|finance_owner|support_operator|release_owner",
  "holderRef": "opaque:human-holder",
  "decision": "PENDING",
  "evidenceRef": "opaque:human-review-evidence",
  "legalComplianceSelfReview": true,
  "notIndependentLegalCounsel": true,
  "sanitized": true,
  "sensitiveDataPersisted": false
}
```

## Current release boundary

這份 matrix 完成後，仍然只能把 CAT10 的 review work 變成可追蹤的 `PENDING_HUMAN`。目前不改變：

```text
PAYMENT_RECONCILIATION_READY=false
SANDBOX_READY=false
PRODUCTION_READY=false
releaseDecision=NO_GO
```

沒有真人 receipt 前，不把政策草稿、local SOP、synthetic owner matrix 或 AI review 當作 legal approval、客服 acceptance、PayUni reconciliation 或 Production release authorization。文件不保存姓名、email、電話、Token、Cookie、付款資料、raw provider payload 或其他正式客戶資料。
