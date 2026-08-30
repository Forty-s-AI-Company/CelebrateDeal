# FIN-14 — Platform referral domain boundary and subscription attribution closure

日期：2026-08-07  
結果：`COMPLETE_LOCAL_DOMAIN_BOUNDARY`；這不是平台 commission／payout 完成證據。

## 修正

- 新增獨立 `PlatformReferralCode`、`PlatformReferralClick` 與 `PlatformReferralAttribution`；商家 `Affiliate`／`AffiliateCommission` 仍只服務 vendor-scoped 商家產品，不被方案推薦共用。
- `GET /r/[code]` 僅接受 active platform code，寫入 server-side click，設定 HttpOnly/Lax/30-day click cookie，再導向 `/billing/plans`。
- vendor 選擇方案後，server action 讀取 HttpOnly click cookie，重新驗證 code active、expiry、owner、rate，並把 code／owner／rate snapshot 綁到 `VendorSubscription`；前端不能帶入佣金比例或 vendor identity。
- 缺少、過期、停用或非法 rate 的 referral 都 fail closed。

## 重要邊界

目前方案流程是月底月結的方案選擇，尚沒有可驗證的 subscription payment callback。因此 FIN-14 不建立 commission、refund reversal 或 payout，也不把 plan selection 誤報成付款；平台 commission／payout 必須等獨立 payment callback 與正式授權後另行完成。

## 可追溯驗收結果

- referral helper／entry route／plan action：3 files，14 passed，0 failed，0 skipped。
- inventory／architecture／Prisma／payout contracts：6 files，22/22 passed。
- API registry：29/29 route handlers 已登錄，29/29 有同路徑 tests。
- full Vitest：174 files，1272 passed，0 failed，0 skipped。
- full `npm run test:coverage`：Vitest 174 files／1272 passed，Node TAP 620/620，0 skipped；combined global statements／branches／functions／lines 為 38.62／44.54／46.95／58.82，低於既有 63／57／60／65，故如實標示 `FAIL_REMAINING_SOURCE_INVENTORY`。scripts attribution 為 27.15／35.48／33.23／46.52，src attribution 為 81.87／74.66／82.25／84.36；未修改 threshold、inventory、exclude、skip 或 assertion。
- `tsc --noEmit`、Prisma validate／generate、full ESLint、`git diff --check`：PASS；ESLint 僅有既存 2 個 warning，0 errors。
- loopback disposable PostgreSQL：17/17 migrations，`Database schema is up to date!`；沒有使用 staging／Production DB。
- 最新 `npm audit --omit=dev --json`：total/high/critical 均為 0；最新 local release verify：`verified`；readiness reconciliation：`PASS`、total 73.5、10 categories、SANDBOX_READY=false、PRODUCTION_READY=false。

## 邊界與評分

本包沒有執行 staging、PayUni Sandbox、Production、正式付款／退款或寄信，也沒有讀取 `.env*`、Token、Cookie 或 Secret。CAT04 維持 6.0、CAT06 7.0、CAT10 4.5、總分 73.5；必要 subscription payment callback、staging/provider 與人工法律／財務／release owner evidence 仍 pending。FIN-08AA、WP-196、WP-197 均未重試，staged index 維持空白。

證據檔：`.ai-team/reports/fin14-platform-referral-boundary-closure.json`。
