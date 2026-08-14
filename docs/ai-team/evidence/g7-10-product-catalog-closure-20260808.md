# G7-10：商品目錄與 checkout policy snapshot closure

狀態：`COMPLETE_LOCAL_FUNCTIONAL_FIX`；Browser matrix 尚未完成，因此不是 staging／release acceptance。

## 實際完成

- 商品建立／編輯改為可保留輸入的 Server Action state；錯誤不再 redirect 後清空表單。
- 新商品預設草稿；售價改用商家可理解的主要貨幣單位，server 仍以 cents 儲存與驗證。
- 圖片拖拉／上傳若未完成，儲存按鈕停用，server 也 fail closed；既有 URL 只保留為進階 fallback。
- 商品清單新增名稱／Slug 搜尋、草稿／上架／售罄篩選、庫存、訂單數、編輯／預覽／商品訂單入口。
- 新增 tenant-scoped 商家預覽；未上架、零庫存、未確認交付與外部 checkout 都有明確狀態。
- Product 新增 revision CAS；checkout 扣庫存、失敗／逾期／退款回補都同步推進 revision，舊表單不能覆寫最新庫存。
- Slug 唯一性由全平台改為商家內唯一；不同商家可使用相同 Slug。
- 外部 checkout 商品的直播、checkout page、付款 API 三層一致：直播走安全外部 URL、頁面 redirect、內部付款 API 409 fail closed。
- 課程 checkout 將 F owner、G share、policyVersion 寫入 server-owned transaction metadata 與 canonical order item snapshot；paid webhook 不再讀 webhook 當下商品 policy。

## 驗證

- Targeted／相鄰回歸：13 files、127 tests，全部 PASS。
- Scoped ESLint：`--max-warnings 0` PASS。
- TypeScript：`tsc --noEmit --incremental false` PASS。
- Controlled production build：PASS，`inheritedApplicationEnvironment=false`。
- Disposable PostgreSQL：41 migrations；validate／deploy／status／8 constraints／7 inventory tests／2 course policy tests 全部 PASS；container 與 temp root cleanup PASS。
- DB receipt：`.ai-team/reports/g7-10-product-catalog-disposable-20260808.json`，SHA-256 `e990763cc47d9c897a64b5c5fef6f118e0ac06bc5f719dfa5d8a2754ed6ce389`。
- Source manifest：`docs/ai-team/evidence/g7-10-product-catalog-source-manifest-20260808.txt`。
- 獨立 reviewer 首輪找出 2 個 P1；修復後複核結果：`NO_P0_P1`。

## 未完成與如實失敗

- Browser：`NOT_RUN`。IAB 已連線並 finalize，但 127.0.0.1:31023 沒有安全的隔離登入伺服器，既有本機 DB schema 過舊；本輪沒有把未知本機資料接入 Browser，也沒有把單元測試冒充 desktop/mobile/keyboard 證據。
- 首次直接執行既有 inventory DB tests 時，35 tests PASS、6 tests 因舊本機 schema 缺少 `fulfillmentType` 失敗；未重跑同一條命令，改用全新 disposable PostgreSQL 後 7/7 PASS。
- 一次受控 Prisma mirror helper 使用錯誤回傳欄位，Prisma 未執行；後續以正確 helper 成功生成。該次留下的 no-env temp mirror `C:\Users\eden\AppData\Local\Temp\celebratedeal-controlled-build-x67U7o` 清理被本機政策攔下，未繞過政策；它不含 `.env*`，但仍列為 cleanup 待辦。
- Coverage 本包未重跑，沒有降低 threshold、exclude、inventory、assertion 或新增 skip。

## 分數與邊界

- 此包真實改善商品建立、商家成功率、交易一致性與課程分潤不可變性，但 Browser UX matrix 尚未完成，因此不宣稱完整 UX acceptance。
- Canonical CAT01～CAT10 與總分維持 73.5；CAT04 仍 6.0、CAT10 仍 4.5，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。
- 沒有 staging／PayUni Sandbox／Production、正式付款／退款／寄信、外部服務或真人簽核；FIN-08AA、WP-196、WP-197 沒有重試。

## 回滾範圍與下一步

- 回滾範圍限於本 manifest 中的 G7-10 source、migration、tests 與 evidence；沒有 stage、commit、push、merge 或 deploy。
- 下一個最高價值工作：建立 disposable authenticated IAB fixture，補商品建立失敗保留、草稿預覽、desktop/mobile、keyboard、loading 與外部 checkout 導向矩陣；完成後再轉向「虛擬使用者／互動角色」必做流程盤點與 closure。
