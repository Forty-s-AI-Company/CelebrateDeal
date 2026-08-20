# CelebrateDeal current release gate handoff

日期：2026-08-21（Asia/Taipei）  
狀態：`READY_FOR_AUTHORIZED_NON_PRODUCTION_EXECUTION`  
Source RC：`77dcef6`
權威 gap map：[`current-release-completion-audit-20260821.md`](./current-release-completion-audit-20260821.md)

這份 handoff 把目前尚未完成的 staging、external provider、PayUni Sandbox 與人工 acceptance 工作整理成一次可控的 non-Production 執行包。它只授權準備與去識別 evidence 收集，不授權 Production、正式付款、退款、寄信、資料庫寫入或部署。

## Current truth

```text
ENGINEERING_READY=true
PAYMENT_RECONCILIATION_READY=false
SANDBOX_READY=false
PRODUCTION_READY=false
releaseDecision=NO_GO
canonicalTotal=75.5/100
```

目前已有 local／disposable 證據：source quality gates、Node TAP `763/763`、combined coverage `404 files passed／1 skipped`、`3084 passed／1 skipped`、`test:release-readiness` `5/5`、readiness truth reconciliation `PASS`、staging migration evidence contract `5/5`、external smoke output safety `12/12`、58-migration disposable backup／restore、local rollback rehearsal、local provider contracts、PayUni deployment-boundary env preflight 與 staging read-only health probe。這些證據不能直接升級為 actual staging、external provider、PayUni reconciliation 或人工 acceptance。

## Remote CI state

2026-08-21 的唯讀查詢顯示遠端 `codex/one-stop-webinar-flow` branch head 仍為舊提交 `c2aa2201`；最新列出的 `ci.yml` run `32209974601` 的 `Production dependency audit` step 為 `failure`。目前沒有 `77dcef6` 的 GitHub Actions run，所以 current RC 的 remote CI 仍是 `NOT_PROVEN`。本次未 push、未 dispatch workflow，也未進行 deployment 或其他外部 mutation。

## Owner authorization boundary

執行前只在受控 broker 或 ticket 系統記錄下列去識別欄位。不要把 URL、connection string、credential、Token、Cookie、customer data、付款資料或 raw provider response 複製到 repository、聊天或 CI artifact。

| 欄位 | 必要值／限制 |
|---|---|
| `authorizationRecordRef` | opaque reference |
| `environment` | 可驗證的 non-Production identity |
| `providerEnvironment` | 可驗證的 test／sandbox identity |
| `nonProduction` | `true` |
| `ownerRef` | 不含姓名、email 或 token 的 opaque reference |
| `newExecutionApproved` | 僅在需要新的受控 non-Production action 時為 `true` |
| `forbiddenProbeReuse` | `false`；不得重跑 WP-196／WP-197 或 FIN-08AA 禁止路徑 |

若 owner 無法提供受控 identity，該 gate 維持 `NOT_PROVEN` 或 `PENDING_EXTERNAL`，不以舊 receipt、健康檢查或推測補成 `PASS`。

## Execution matrix

| Gate | 一次安全執行要取得的最小 evidence | 成功條件 | 目前結果 |
|---|---|---|---|
| Exact staging lineage | deployment／environment 的 names-only identity、短 source digest、`nonProduction=true` | 能證明 actual staging 使用 current RC lineage | `NOT_PROVEN` |
| Staging migration | expected／applied migration count、status enum、DB identity class | current staging migration status 與 RC 一致 | `NOT_PROVEN` |
| Staging backup／restore | platform／target 類型、checksum、migration status、aggregate compare、cleanup result | actual staging platform backup／restore 或明確核准的隔離 target drill 完成 | `PASS_LOCAL_ONLY` |
| Staging rollback／forward | current／previous deployment opaque identity、rollback／forward result | staging rollback 後可回到 current RC，兩個 identity 可追溯 | `PASS_LOCAL_ONLY` |
| Cloudflare Stream | account mapping class、scope class、direct upload／Live Input／ready webhook 結果 | direct upload、Live Input 與 real VOD ready callback 全部通過 | `PENDING_EXTERNAL` |
| Resend | sender domain verification class、delivery receipt、message reference digest | staging smoke mail delivered | `PENDING_EXTERNAL` |
| Sentry | issue／alert／notification 的 opaque references | synthetic issue 可見且 alert notification delivery 可驗證 | `PENDING_EXTERNAL` |
| PostHog | project identity class、synthetic event name、PII boundary result | non-Production `production_smoke_test` event 可驗證且無敏感資料 | `PENDING_EXTERNAL` |
| Durable rate limit | provider class、route class、bounded attempt count、429／edge block result | selected Cloudflare WAF 或 Upstash enforcement 實際生效，不使用 memory fallback | `PENDING_EXTERNAL` |
| PayUni Sandbox | environment／provider binding、order／reference digest、amount／status／refund／callback match enums | local projection 與 provider read-only result exact match | `PENDING_EXTERNAL` |
| Policy／support／owner | role、holder ref、每項 check 結果、政策版本、release decision | 真人完成政策、客服、退款、財務與 release responsibility acceptance | `PENDING_HUMAN` |

## PayUni execution boundary

CAT04 預設採 read-only reconciliation。執行順序固定為：

1. 證明 non-Production environment 與 PayUni test account binding；local preflight 也必須確認 Preview 使用 `sandbox`，Production 使用 `production`。
2. 選擇可綁定 current environment 的既有 transaction；不足時才由 owner 明確核准建立一筆 test transaction。
3. 只讀取站內去識別 projection。
4. 執行 bounded provider read-only query，記錄 query type、attempt count 與 allowlisted result enum。
5. 比對 order identity、provider reference、金額、payment status、refund status 與 callback／local state。
6. 只在全部欄位 exact match 時產生 `RECONCILIATION_CONSISTENT`；任何 unknown 或 mismatch 都保留 `BLOCKED`／`FAILED`。

沒有另外的 payment／refund mutation authorization 時，必須保持：

```text
providerWriteRequests=0
paymentRequests=0
refundRequests=0
callbackReplays=0
productionOperations=0
```

禁止執行或包裝成 retry：FIN-08AA route-manifest／marker path、WP-196 final runner／health freshness／binding／provider query、WP-197 lineage runner／Vercel inspect／marker／probe，以及既有 `node scripts/payuni-sandbox-external-qa.mjs` 失敗路徑。

## Sanitized receipt minimum

每個 gate 只保存下列類型的結果：

```text
workPackage
runId
executedAtUtc
authorizationRecordRef
environmentClass
providerEnvironmentClass
result: PASS | FAILED | BLOCKED | PENDING_EXTERNAL | PENDING_HUMAN
attemptCount
sideEffectCounters
evidenceRefs: opaque references only
sanitized=true
credentialsPersisted=false
tokensPersisted=false
cookiesPersisted=false
customerDataPersisted=false
productionOperations=0
```

禁止保存完整 URL、deployment ID、order number、PayUni trade number、raw response、email、IP、user-agent、cookie、Token、connection string、付款資料或正式客戶資料。

## Stop conditions and release update

- environment identity、provider binding 或 source lineage 無法驗證：停止，結果為 `BLOCKED`。
- 任一 provider 回傳 authentication、account mapping、signature、delivery 或 durable enforcement failure：保留實際分類，不重試同一死路。
- 發現 Production identity、正式付款／退款／寄信、非核准 DB write 或 deployment mutation：立即停止，receipt 記為安全事件，不得計入 readiness。
- 所有 local gate 維持通過，不能抵銷 `PENDING_EXTERNAL` 或 `PENDING_HUMAN`。

只有在 sanitized receipt 經 current completion audit 對照後，才可更新 readiness truth。沒有新的可驗證 evidence 時，維持 `PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false` 與 `releaseDecision=NO_GO`。
