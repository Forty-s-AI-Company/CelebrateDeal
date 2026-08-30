# FIN-2026-08-07-29 — Platform referral dispute／chargeback closure

- Recorded at: `2026-08-07T19:26:04+08:00`
- Mode: `PRELAUNCH_DEV_AUTONOMOUS`
- Scope: local product source, deterministic tests, disposable PostgreSQL and sanitized control-plane evidence only。
- Canonical score before／after: `73.5 → 73.5`；本 WP 的 `current_goal_score_change=0`。

## 本輪完成的產品工作

本輪修正一個實際的 finance P1 缺口：平台聯盟佣金原本能處理 paid／refund，但 `dispute_opened`／`dispute_lost` 沒有同步反轉平台 referral payout ledger。現在：

1. 平台 referral ledger 支援 `dispute_opened`、`dispute_released`、`dispute_lost` 三段 dispute lifecycle。
2. dispute entry 必須帶 `disputeCaseId`；ledger identity 與 replay dedup 同時綁定 commission、case 與 entry type。
3. `dispute_opened`／`dispute_released` 是零金額狀態事件；`dispute_lost` 只反轉當下仍可反轉的 ledger balance。
4. 同一 dispute case 的 terminal outcome 重放只回傳既有結果，不會第二次寫入或重複扣款；lost 後 commission 轉為 `void`。
5. payment webhook 會在 merchant commission、course allocation 或 platform referral commission 任一存在時完成 dispute reconciliation，並保留既有 webhook audit／idempotency boundary。
6. Prisma schema 與 migration 新增 `disputeCaseId` 及最小必要索引；未修改既有本機 `celebratedeal_dev` 資料庫。

## 實際驗證結果

| 驗證 | 結果 |
|---|---|
| platform referral domain tests | 7/7 PASS |
| payment webhook integration tests | 40/40 PASS |
| full Vitest | 211 files／1473 tests PASS；0 failed／0 skipped |
| Node contract tests | 679/679 PASS；0 failed／0 skipped |
| disposable PostgreSQL migrations | 28/28 migrations applied PASS |
| disposable container cleanup | PASS；`celebratedeal-fin29-dispute-test` 無殘留 |
| Prisma validate／generate | PASS |
| typecheck | PASS |
| full lint | PASS；0 errors，2 個既有 warnings |
| secret scan | PASS |
| git diff check | PASS |

### Coverage gate

`npm run test:coverage` 的功能測試仍全部通過，但 global coverage gate 如實 FAIL：

| 指標 | 實際 | 門檻 |
|---|---:|---:|
| Statements | 42.15% | 63% |
| Branches | 47.87% | 57% |
| Functions | 50.99% | 60% |
| Lines | 61.34% | 65% |

Exit code 為 `1`，原因是既有 source inventory 尚未完成，不是本輪 dispute product tests 失敗。沒有降低 threshold、擴大 exclude、縮減 inventory、新增 skip 或弱化 assertion。

## 分數與上線邊界

最新 readiness truth 仍為：

- CAT01 `7.5`、CAT02 `8.0`、CAT03 `8.0`、CAT04 `6.0`、CAT05 `8.5`
- CAT06 `7.0`、CAT07 `9.0`、CAT08 `7.5`、CAT09 `7.5`、CAT10 `4.5`
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`
- CAT04 仍需要 fresh authorized staging reconciliation 與 PayUni Sandbox provider receipt。
- CAT10 仍需要 merchant onboarding、客服 SLA、退款政策、隱私／條款、monitoring，以及真人 merchant／support／finance／legal／privacy／release owner evidence。

因此本輪只完成可驗證的本機 finance product closure，不能把本機測試冒充 CAT04／CAT10 的外部或真人 acceptance，也沒有套用任何 canonical score uplift。readiness script 中的歷史 `score_change=0.5` 屬於 WP-195 metadata，不是本輪分數變化。

## 安全與未執行事項

- 未讀取或輸出 `.env*`、credential、token、cookie、正式 secret、正式客戶或付款資料。
- 未操作正式資料庫、正式付款／退款／轉帳／寄信、staging mutation、PayUni Sandbox provider call、deployment、push 或 merge。
- 未重試 FIN-08AA route-manifest attestation，也未重試 WP-196／WP-197 terminal no-go 路徑。
- rollback scope 是本 WP 自有的 source、schema、migration、tests 與 evidence；不使用 reset／clean／stash／restore／checkout 丟棄其他使用者變更。

Goal 維持 `IN_PROGRESS`。下一步應轉往尚未關閉的 P0／P1 product inventory 或取得已授權的 CAT04／CAT10 外部與真人 evidence；不得把 coverage gate 的小幅改善當作產品分數已完成。
