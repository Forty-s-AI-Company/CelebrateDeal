# G7-16 固定功能 scorecard 與 canonical reconciliation

- 結果：`LOCAL_FUNCTION_INVENTORY_AT_OR_ABOVE_7`
- 執行模式：`PRELAUNCH_DEV_AUTONOMOUS`
- Goal：`ACTIVE`

## Current truth

固定 inventory 仍為 12 項，沒有縮減：商家 onboarding／設定、商品、媒體、直播 Studio、表單、互動角色／虛擬使用者、Email、checkout／付款、訂單／履約、退款／客服、聯盟／課程／settlement／payout、團隊漏斗／Stream／營運後台。

| 固定功能 | local candidate |
|---|---:|
| 商家 onboarding／設定 | 8.0 |
| 商品管理 | 8.0 |
| 圖片／影片媒體 | 8.0 |
| 直播 Studio | 8.0 |
| 報名表單 | 8.0 |
| 互動角色／虛擬使用者 | 8.0 |
| Email 通知 | 7.0 |
| Checkout／付款 | 7.0 |
| 訂單／履約 | 8.0 |
| 退款／客服 | 8.0 |
| 聯盟／課程／settlement／payout | 7.0 |
| 團隊漏斗／Stream／營運後台 | 8.3 |

完整五維 rubric、evidence path 與 SHA-256 位於 `docs/launch/current-function-scorecard-20260809.json`。

## Deterministic verification

- `node --test scripts/g7-function-scorecard-reconciliation.test.mjs`：4/4 PASS。
- inventory 必須精確等於固定 12 項，順序、唯一性與項目名稱均受測試保護。
- 每項 core 必須至少 2、fresh evidence 必須大於 0、五維加總必須等於候選分數、總分必須至少 7。
- 每份 G7 evidence 均重新計算 SHA-256；任一檔案漂移即 FAIL。
- `node scripts/readiness-truth-reconciliation.mjs`：PASS，10 categories、total 73.5、G1 CLOSED、SANDBOX_READY=false、PRODUCTION_READY=false。
- scoped ESLint：PASS。
- 獨立 reviewer：`NO_P0_P1_FINAL`。

## Canonical 與 blocker

- CAT01 7.5、CAT02 8.0、CAT03 8.0、CAT04 6.0、CAT05 8.5、CAT06 7.0、CAT07 9.0、CAT08 7.5、CAT09 7.5、CAT10 4.5，合計 73.5。
- 低於 7 的項目只有 CAT04 與 CAT10。
- CAT04 需要 fresh authorized staging／PayUni Sandbox provider 與 reconciliation evidence；FIN-08AA、WP-196、WP-197 的既有 terminal 路徑禁止重跑。
- CAT10 需要真人法律、隱私、退款、財務、客服 SLA、release acceptance 與 external monitoring delivery。AI 不代簽。

## 下一 lane 與邊界

- 固定產品功能已全數達本地 7 分門檻，下一個可自主推進 lane 為 `QUAL_CLOSURE`，先取得 current full coverage truth，再依 source attribution 補 deterministic tests。
- 本 WP 沒有改寫 canonical 分數，沒有執行 staging、PayUni Sandbox、Production、正式付款／退款／寄信，也沒有讀取 `.env*` 或 secret。
- 沒有 stage、commit、push、merge 或 deploy。回滾範圍限於 scorecard、reconciliation test 與 G7-16 evidence artifacts。

