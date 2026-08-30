# CAT10-LOCAL-02：公開政策、客服與商家 onboarding 入口

日期：2026-08-07（Asia/Taipei）  
狀態：`COMPLETE_LOCAL_PRODUCT_ENTRYPOINTS_MANUAL_EXTERNAL_PENDING`

## 本輪產品實作

新增公開可瀏覽的產品入口：

- `/policies`：政策與協助中心。
- `/policies/terms`：使用條款草稿。
- `/policies/privacy`：隱私與資料請求草稿。
- `/policies/refunds`：退款與付款支援政策草稿。
- `/support`：P0／P1／P2 目標回應矩陣、安全受理與升級連結草稿。
- `/merchant-onboarding`：八階段 onboarding 與 owner handoff 摘要。

登入頁與已登入商家 AppShell footer 均提供上述公開資訊連結。所有頁面明確標示 `DRAFT`、`HUMAN REVIEW REQUIRED` 或 `OWNER ACCEPTANCE REQUIRED`，並說明不構成法律意見、正式政策或 release sign-off。

## 驗證結果

- 新增與既有入口 targeted tests：6 files／17 passed／0 failed／0 skipped。
- 完整 Vitest：186 files／1327 passed／0 failed／0 skipped。
- Node contracts：622／622 passed。
- `npm run typecheck`：PASS。
- `npm run lint`：PASS；僅 2 個既有 warning，位於 `scripts/wp130-cloudflare-stream-webhook-contract-runner.mjs`。
- `npm run secret:scan`：`secret_scan_passed`。
- `git diff --check`：exit 0；僅既有換行格式警告。
- `node scripts/readiness-truth-reconciliation.mjs`：PASS，total `73.5`、category count `10`、`production_ready=false`、score change `0`。
- `npm run release:verify:local`：`verified`；敏感環境 availability 全部為 `false`。

## 不可外推的驗收邊界

這輪只證明 local product entrypoints 可 render、可導覽且保留人工核准邊界，不證明：

1. 真人商家 onboarding rehearsal 或 merchant owner acceptance。
2. 客服／財務 SLA、值班與升級責任已由真人接受。
3. 條款、隱私通知、退款政策、資料保存與請求流程已完成法務／政策 owner review。
4. Sentry／PostHog／Cloudflare 等外部 monitoring receiver 已交付並可告警。
5. Release owner 已完成正式 go/no-go、Production scope 與 rollback acceptance。

因此 CAT10 維持 `4.5`、canonical total 維持 `73.5`，未套用分數提升；`PRODUCTION_READY=false`、`SANDBOX_READY=false`。Goal 維持 `IN_PROGRESS`。

## 安全與禁止重試

本輪未讀取 `.env*`、憑證、Token、Cookie、正式 Secret、正式客戶資料或付款資料；未操作正式資料庫、付款、退款、寄信、外部網路或 Production。未重試 FIN-08AA、WP-196、WP-197，也未重試既有 PayUni Sandbox probe command。
