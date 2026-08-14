# QUAL-2026-08-07-04：Coverage source inventory diagnostic

日期：2026-08-07（Asia/Taipei）  
狀態：`DIAGNOSTIC_COMPLETE_GATE_REMAINS_OPEN`

## 結果

本輪只讀檢查既有 `coverage/coverage-summary.json`，沒有重跑已失敗的
`npm run test:coverage`，也沒有執行外部服務。最新 global coverage 是：

| 指標 | 實際 | 門檻 | 還需要的 covered units（約） |
|---|---:|---:|---:|
| Statements | 39.42% | 63% | 7,211 |
| Branches | 45.15% | 57% | 2,939 |
| Functions | 47.80% | 60% | 575 |
| Lines | 59.74% | 65% | 929 |

最大 script statement gaps 集中在 WP153／WP155 public-unavailable runners、
FIN-08 legacy reconciliation runners、WP156 readiness diagnostic 與 WP170
staging readonly runner。這不是少數遺漏測試即可完成的 gate；也不能用降低 threshold、
exclude、skip 或弱化 assertion 解決。

## 分數邊界

Coverage 是品質 gate，不是 CAT04 PayUni provider receipt，也不是 CAT10 真人法律、
客服、財務或 release owner acceptance。因此本輪 score impact 為零：CAT04 `6.0`、
CAT06 `7.0`、CAT10 `4.5`、total `73.5`。Goal 維持 `IN_PROGRESS`。

## 安全與禁止重試

- 只讀既有 coverage artifact；沒有讀取 `.env*`、credential、Token、Cookie、正式 Secret、正式資料或付款資料。
- 沒有重試相同 PayUni command、FIN-08AA、WP-196 或 WP-197。
- 沒有改動 coverage threshold、source inventory、exclude、skip 或 assertion。
- 沒有外部、Production、付款、退款、寄信、部署或 Git side effect。

下一個 QUAL 工作只能選定明確的非 terminal source family 做 deterministic tests；若目標是增加販售分，仍必須先取得 CAT04 外部 provider evidence 或 CAT10 真人 owner／法務／客服／財務／release acceptance。
