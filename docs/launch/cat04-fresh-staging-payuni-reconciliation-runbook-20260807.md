# CAT04：Payment Reconciliation Gate 可選執行包

狀態：`READY_FOR_AUTHORIZED_OWNER_EXECUTION`

治理版本：`solo-founder-launch/v1`；決策來源：[ADR-2026-08-13 Solo Founder Owner Model](../decisions/ADR-2026-08-13-solo-founder-owner-model.md)

目的：提供一條可選的、可追溯且已去識別的 non-Production PayUni reconciliation 實作路徑。
這份 runbook 本身不是 CAT04 requirement source，也不會因未照此流程而直接判定 payment
reconciliation failure。CAT04 的 hard blocker 是 outcome：目前 CelebrateDeal payment state
與 PayUni provider state 必須一致。

## 目前分數與硬性邊界

- CAT04 目前：`6.0/10`。
- 必要 outcome：environment identity、PayUni provider account／environment identity、order
  identity、provider reference、amount、payment status、refund status、callback／local state
  consistency，以及 signature／idempotency safety boundary 均可驗證且一致。
- 本 runbook 的 fresh execution、fresh transaction、fresh lineage、staging 名稱與固定 receipt
  欄位是 implementation option／defense-in-depth，不是唯一 hard blocker。
- 預設採最小副作用的唯讀 reconciliation；本包不要求重新付款、退款或重播 callback。
- 只能使用非 Production 的受控 provider test environment；不能使用真實卡號、真實客戶或
  正式金流。環境不必以 `staging` 命名，但 environment identity 與 provider account／
  environment identity 必須可驗證。
- owner reference、authorization record 與 ticket 是可選的 audit evidence；不具備特定
  形式時不能單獨使 CAT04 FAIL。單一真人可以同時擔任多個責任。
- `stagingOwnerRef == payUniOwnerRef` 是合法狀態；只有 provider、法律、tracked project
  requirement、accepted security decision 或 direct production risk 明確要求時，才可要求第二位真人。

## 禁止重跑與禁止沿用

本次不得執行或包裝成下列任何工作的 retry：

1. FIN-08AA 的 route-manifest／build-output capability attestation，包含
   `scripts/fin08aa-preview-route-manifest-attestation.mjs` 與 WP-187 marker route。
2. WP-196 的 final runner、`HEAD /api/health` freshness probe、既有 binding preflight、
   既有 deployment baseline、既有 candidate 或既有 provider query attempt。
3. WP-197 的 staging lineage runner、Vercel `inspect`、marker／probe 或 parent
   contamination gate。
4. 目前 CAT04 probe 的失敗命令 `node scripts/payuni-sandbox-external-qa.mjs`。

不要把上述工作的 deployment ID、alias、order、trade number、raw output 或失敗 receipt
當成目前成功證據。歷史 transaction 可以重用，但必須重新驗證 current environment、provider
account、local order binding 與完整 state；無法驗證時標記 `BLOCKED`，不可猜測成 PASS。

## 可選執行前：owner authorization 與 provenance

若採用本 runbook，owner 可在受控核准系統記錄以下去識別內容；不要把 URL、環境值、credential、
Token 或 Cookie 貼到聊天或 repository：

| 欄位 | 建議 evidence |
|---|---|
| `authorizationRecordRef` | 受控系統的 opaque reference |
| `stagingOwnerRef` | 不含姓名／email 的 owner reference |
| `payUniOwnerRef` | 不含姓名／email 的 owner reference |
| `sameHumanMultipleRoles` | `true` 或 `false`；允許 `true` |
| `ownerRoles` | `staging_owner`、`payment_provider_owner` 或等價責任集合 |
| `environment` | 可驗證的 non-Production environment identity |
| `providerEnvironment` | 可驗證的 PayUni test environment identity |
| `nonProduction` | `true` |
| `newExecutionApproved` | `true` |
| `priorLineageReuse` | `false` |
| `endpointReuseCheck` | `true`；確認本次 staging／provider receipt source 未呼叫 FIN-08AA、WP-196、WP-197 已實際執行的 endpoint |
| `forbiddenProbeReuse` | `false` |

若要求第二位真人，authorization record 必須另外記錄：

```text
source
reason
risk_if_missing
provenance
```

`provenance` 必須屬於 `EXTERNAL_PROVIDER`、`LEGAL_REGULATION`、
`TRACKED_PROJECT_REQUIREMENT`、`ACCEPTED_SECURITY_DECISION` 或 `DIRECT_PRODUCTION_RISK`。
沒有這些欄位時，第二人要求只能是 warning，不能單獨使 CAT04 FAIL。

若需要 deployment attestation，可使用 names-only 的 current environment identity、
`nonProduction=true` 與 source digest。這是可選的 equivalent evidence，不是重跑 FIN-08AA、
WP-196 或 WP-197 的 deployment probe；只保留短 digest 或 opaque reference。

## 可選測試流程

若既有 transaction 已能證明目前 environment generation、PayUni test account、local order
binding 與完整 reconciliation，應直接重用，不建立新交易。只有既有 transaction 無法滿足
上述 binding 時，才由 owner 明確授權建立新的 non-Production transaction。Provider query
必須 read-only、bounded、auditable；可有 bounded retry，但 payment／refund mutation 不得
retry，也不得產生新的付款副作用。任何 mismatch、unknown 或 unverifiable 都必須停止並
保留真實 `FAILED`／`BLOCKED` 結果。

1. **選擇 transaction**：先檢查既有 transaction 是否能綁定目前 environment generation、
   PayUni test account、local order 與 provider reference。只有 binding 不足時，才建立一筆
   non-Production test transaction；不為了「fresh」本身重新付款。
2. **讀取 local projection**：只讀取所選 transaction 的去識別站內狀態投影；不直接修改 DB，
   不呼叫歷史工作包禁止的 probe。若沒有 callback／refund state，記為 `UNKNOWN`，不能猜成
   已完成。
3. **執行 provider read-only query**：使用核准的 PayUni test environment 查詢流程；query
   必須 bounded、auditable，並記錄 `attemptCount`、`queryType`、`providerEnvironment`、
   `timestamp`、`resultClassification`。不得 retry payment／refund mutation，也不得將 query
   retry 誤認成 transaction retry。執行前由 owner
   receipt 只保存 `providerStatus` 的 allowlisted enum、短 reference digest 與欄位 match
   結果。
4. **完成站內／provider reconciliation**：比對 order reference、provider reference、
   gross amount、已存在的 refunded amount、payment／refund status、站內唯一 refund
   record（若適用）與 provider query 結果。只有全部為 exact match，且沒有未知欄位，才可
   標示 `RECONCILIATION_CONSISTENT`。
5. **清理與封存**：確認沒有第二筆 candidate、沒有 provider write、沒有額外付款／退款、
   沒有 callback replay、沒有 DB lock／人工改帳；將 raw provider response、完整 URL、
   transaction number、姓名、email、IP、user-agent、cookie、Token 與 credential 從
   evidence 副本移除。

若另有獨立、明確的 Sandbox payment／refund 授權，可以在同一個新 run 內增加最多一次
核准的 payment 或 refund mutation；這不是本包的必要條件，且必須在 authorization
record、attempt counter 與 side-effect receipt 中明確記錄。沒有這項授權時，
`providerWriteRequests=0`、`paymentRequests=0`、`refundRequests=0`。

## Evidence 欄位建議

由執行者在受控系統產生 evidence，再複製最小化、去識別副本。下列只是可選欄位範例，
不是固定 schema，也不是可以直接填成 PASS 的假 receipt：

```json
{
  "schemaVersion": "equivalent-controlled-reconciliation-evidence/v1",
  "workPackage": "CAT04-MANUAL-NEW",
  "runId": "由執行系統產生的非敏感 run reference",
  "executedAtUtc": "實際執行時間",
  "authorization": {
    "authorizationRecordRef": "opaque reference",
    "stagingOwnerRef": "opaque reference",
    "payUniOwnerRef": "opaque reference",
    "sameHumanMultipleRoles": true,
    "ownerRoles": ["staging_owner", "payment_provider_owner"],
    "environment": "non-production-test",
    "providerEnvironment": "payuni-test",
    "nonProduction": true,
    "newExecutionApproved": false,
    "priorLineageReuse": true,
    "endpointReuseCheck": null,
    "forbiddenProbeReuse": null
  },
  "hardBlockerProvenance": null,
  "freshness": {
    "newTransactionLineage": false,
    "newEnvironmentBinding": true,
    "deploymentProbeReused": null,
    "failedCommandReused": null
  },
  "flow": {
    "transactionSelection": "REUSED|CREATED|BLOCKED",
    "localProjection": "PASS|FAIL|BLOCKED",
    "providerReadOnlyQuery": "PASS|FAIL|BLOCKED",
    "reconciliation": "CONSISTENT|DIVERGENT|UNKNOWN"
  },
  "matches": {
    "orderIdentity": "MATCHED|MISMATCHED|UNKNOWN",
    "providerReference": "MATCHED|MISMATCHED|UNKNOWN",
    "amount": "MATCHED|MISMATCHED|UNKNOWN",
    "paymentStatus": "MATCHED|MISMATCHED|UNKNOWN",
    "refundStatus": "MATCHED|MISMATCHED|UNKNOWN",
    "callbackLocalState": "MATCHED|MISMATCHED|UNKNOWN"
  },
  "attempts": {
    "transactionSelections": 1,
    "providerReadOnlyQueries": 1,
    "providerWriteRequests": 0,
    "paymentRequests": 0,
    "refundRequests": 0,
    "callbackReplays": 0,
    "retries": 0,
    "redirects": 0
  },
  "sideEffects": {
    "nonProductionOnly": true,
    "productionOperations": 0,
    "deploymentMutations": 0,
    "aliasMutations": 0,
    "providerWrites": 0,
    "paymentRequests": 0,
    "refundRequests": 0,
    "databaseManualWrites": 0
  },
  "safety": {
    "rawProviderPayloadPersisted": false,
    "rawPaymentDataPersisted": false,
    "credentialsPersisted": false,
    "tokensPersisted": false,
    "cookiesPersisted": false,
    "customerDataPersisted": false,
    "sanitized": true
  },
  "evidenceRefs": ["opaque local evidence ref", "opaque provider evidence ref"],
  "result": "PASS_CANDIDATE|FAILED|BLOCKED",
  "scoreImpact": { "CAT04Applied": false, "productionReady": false }
}
```

## PASS 條件與交付

只有以下 outcome 條件全部成立，才能把結果送給 release scoring owner：

- 若使用 owner reference，責任與實際控制權可追溯；不要求特定 authorization record 形式。
- environment／provider account binding 與 non-Production boundary 可驗證。
- provider query read-only、bounded、auditable，且 provider reference、order、金額與狀態
  全部 match；query retry 不得被誤分類為付款或退款 retry。
- callback／local state 與 provider result 一致；refund record 若適用也必須一致。
- evidence 通過 sanitized scan，沒有密碼、Token、Cookie、credential、付款資料、raw
  provider response、完整 URL 或正式資料；格式不限於本頁範例。
- `productionOperations=0`、`scoreImpact.CAT04Applied=false`、`productionReady=false`。
- 若結果是 `FAILED`／`BLOCKED`，任何 release blocker 都必須附上 `source`、`reason`、
  `risk_if_missing`、`provenance`；沒有 release-critical provenance 的條件只能分類為 warning。

任一必要 outcome 未成立都應保留實際的 `FAILED`／`BLOCKED` 結果，不得用本機測試、舊 receipt、
截圖或人工推測補成 PASS。完成後交付：去識別 receipt、副本存放位置、執行者 role、
授權 reference、實際結果與一段明確的 rollback／cleanup 說明。
