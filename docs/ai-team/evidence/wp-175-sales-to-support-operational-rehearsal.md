# WP-175 Sales-to-Support Local Operational Rehearsal

## 範圍

本工作包只建立本機、無網路、無資料庫、無付款副作用的營運演練。它把既有方案與用量產品來源、WP-122 onboarding contract、付款退款支援 SOP 串成八階段的可執行交接矩陣。

## 安全邊界

- 不讀取 `.env*`、Secret、Token、Cookie 或 raw payload。
- 不連線 PayUni、Vercel、資料庫或其他外部服務。
- 不建立帳號、不寄信、不付款、不退款、不重送 callback、不部署。
- 所有既有 dirty changes 均為 `PRESERVE_ONLY`。
- offboarding／資料請求因尚無完成的法律與人工流程，固定為 `PROCESS_GAP_BLOCKED`。

## 驗證結果

- `node --test scripts/wp175-sales-to-support-operational-rehearsal.test.mjs`：4 passed、0 failed、0 skipped。
- runner：18 個情境（8 positive、10 fail-closed）全部符合預期。
- strict receipt readback、重複執行一致性、scoped ESLint、TypeScript、static executable deny、`git diff --check`：PASS。
- 八個 protected source digest 前後一致；staged index empty；`UNKNOWN=0`、`MIXED_HUNKS=0`。
- AGY Fast：attempt 2 成功，唯讀 verdict `PASS`；residual risk 為人工商家、客服、法務／隱私、Release owner 與外部整合仍待驗收。
- side effects：network、DB read/write、payment、refund、callback、message、deployment、Production 全為 0。

Sol High acceptance verdict：`ACCEPT`。加分依據為新增跨方案說明、用量、onboarding、客服、退款、事故與 offboarding 的 executable owner-handoff／fail-closed evidence，不是測試數量；CAT10 `3.5 → 4.0`，總分 `71.5 → 72.0`。Gate 維持 `G1=CLOSED`、`G2=LOCAL_REHEARSAL_PASS`、`G3–G6=NOT_VERIFIED`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。

未取得人工商家演練、客服 owner、法務／隱私或 Release owner 驗收，不得宣稱可販售或 `PRODUCTION_READY`。
