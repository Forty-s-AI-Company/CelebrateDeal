# REL-20260821：本機 Browser performance gate 穩定化

日期：2026-08-21（Asia/Taipei）  
Source RC：`6e3eddb`  
範圍：loopback Docker PostgreSQL、Chromium、單 worker；不含 staging、Production、Cloudflare、Resend、Sentry、PostHog、durable rate limit 或 PayUni。

## 結果

本次確認 Dashboard performance gate 的原始失敗是量測競速，不是把門檻調低：AppShell 的 Next.js background prefetch 可能在 document `load` 後才出現，原測試將這些非初始導覽資源算入 `resourceCount`，導致同一個 case 在 focused suite 中出現 `83 > 80`，單獨重跑則為 `68` 並通過。

已在 `tests/e2e/performance.spec.ts` 將 release performance measurement 限定為 `resource.startTime <= navigation.loadEventEnd`，並讓 resource count、transfer bytes 與 script transfer bytes 使用相同的初始導覽集合。原有 budget 數值未修改。

| 驗證 | 結果 |
|---|---|
| 修正後 Dashboard focused case | `1 passed`；resource count `10`、total transfer `243,283` bytes、script transfer `226,862` bytes |
| Loading＋影片＋Dashboard focused suite | `11 passed` |
| `npm run e2e:performance` | `5 passed` |
| `npm run lint` | exit `0` |
| `npm run typecheck` | exit `0` |
| `git diff --check` | PASS |

## 安全與證據邊界

- Browser server 使用 loopback `E2E_BASE_URL` 與 isolated `celebratedeal_test`，Docker PostgreSQL readiness 正常；fixture 只限本機測試資料。
- 測試設定保留 synthetic loopback secret，外部 telemetry key 維持空值；本次沒有 network provider smoke、正式寄信、付款、退款、staging deployment 或 Production 操作。
- 本證據只代表 current RC 的本機 Browser performance／loading／video regression；不代表 staging Browser matrix、真實 Cloudflare media、外部 telemetry 或商業販售放行。

## Readiness 影響

本 checkpoint 強化 local engineering evidence，沒有改變：

```text
PAYMENT_RECONCILIATION_READY=false
SANDBOX_READY=false
PRODUCTION_READY=false
releaseDecision=NO_GO
```

Staging lineage、migration、backup／restore、rollback、remote CI、外部服務、PayUni Sandbox reconciliation、政策 review 與真人 owner acceptance 仍須取得新的 sanitized receipt 後才可更新。
