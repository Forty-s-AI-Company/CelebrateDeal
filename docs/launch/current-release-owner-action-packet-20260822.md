# CelebrateDeal current release owner action packet

## 目的

這份 packet 把 current source RC `5fd1c61` 從 local `PASS_LOCAL_ONLY` 推進到可驗證的 non-Production staging／release readiness。它不授權 Production、正式付款、正式退款、正式寄信、正式資料刪除或正式部署。

## Owner 只需要確認的事項

請在受控 broker、ticket 或公司既有授權系統留下以下去識別欄位；不要把 credential、Token、Cookie、connection string、客戶資料或付款資料貼到 Git、聊天或 CI artifact。

| 欄位 | 必要內容 |
|---|---|
| `sourceCommit` | `5fd1c61` |
| `authorizationRecordRef` | opaque reference；不可放 Secret 值 |
| `ownerRef` | opaque owner／release owner reference |
| `scopeRef` | opaque scope reference，明確寫 `staging-and-sandbox-only` |
| `environment` | 可驗證的 non-Production staging identity |
| `providerEnvironment` | Cloudflare／Resend／Sentry／PostHog／rate-limit／PayUni 的 test 或 sandbox identity |
| `newExecutionApproved` | `true`，只限這次 current RC execution |
| `nonProduction` | `true` |
| `forbiddenProbeReuse` | `false` |
| `callbackHost` | 可公開連線的 staging callback host reference；不把完整 URL 或 credential 寫入 repository |

如果上述欄位不完整，現有 validator 應維持 `authorization_missing` 或 `BLOCKED`，不得繞過。

## 授權後由 agent 執行

1. 以 source `5fd1c61` 觸發 remote CI，記錄 workflow run 與每個 gate 的 sanitized result。
2. 驗證 exact staging lineage、migration status、backup／restore 與 rollback／forward identity。
3. 在 non-Production 執行 Cloudflare upload／Live Input／ready webhook、Resend smoke mail、Sentry synthetic issue、PostHog PII-safe event 與 durable rate-limit bounded 429 test。
4. 依 CAT04 runbook 執行 PayUni Sandbox reconciliation：order／provider reference／amount／payment status／refund／callback／duplicate webhook 必須逐項一致；只使用 Sandbox，禁止 Production。
5. 收集 policy、refund、privacy、retention、客服 escalation 與 merchant／finance／support／release owner 的人工 acceptance receipt。
6. 將所有 sanitized receipts 綁定同一 source lineage，重新驗證 current release bundle；任何 `NOT_PROVEN`、`PENDING_EXTERNAL`、`PENDING_HUMAN`、`FAILED` 或 `BLOCKED` 都不能升格為 `GO`。

## 目前不能宣稱的結果

- local／disposable evidence 不能代替 actual staging evidence。
- owner authorization contract PASS 只代表可以進入受控前置檢查，不代表 provider 或 PayUni 已驗證。
- Sandbox reconciliation 未完成前，不能把產品描述為可正式收款。
- policy matrix 與 operational SOP 完成，不等於真人法律、財務或客服簽核完成。

## Resume 指示

完成上述 owner authorization 後，可用以下不含 Secret 的指示 resume：

> 授權 CelebrateDeal current RC `5fd1c61`，範圍限 `staging-and-sandbox-only`；允許執行 remote CI、staging migration／recovery／rollback、外部 provider smoke 與 PayUni Sandbox reconciliation；禁止 Production、正式付款、退款、寄信、資料刪除與部署。

目前 release decision 仍為 `NO_GO`；這份 packet 只是把下一個安全可執行的工作邊界固定下來。
