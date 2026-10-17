# WP-20 無來源證據的 covered 標記

狀態：修正讀取與寫入的暫時信任邊界；完整 visits／viewing producer 尚未完成，不能將此修正視為五項統計完成。

## 實際重現

在全新 canonical 124-migration disposable DB，以合成 scope 加入兩筆 visits／viewing covered audit，頁面、intent、visit、session 都是零筆，原 reader 仍回 complete。`unproven-coverage-reproduction.json` 記錄此錯誤行為，狀態為 REPRODUCED；不是指標驗收 PASS。原 reader 完整 source 與原始 CRLF byte hash 另行保存。

目前尚無這兩類的可信正向 producer，不能把任意 auditDigest 或 collectionEnabled 當作完整來源證明。新 reader 同時在 SQL 與 TypeScript 排除其 covered 標記；gap 紀錄照常保留。registrations／orders 仍依既有 typed proof、revision 與 provenance 條件讀取。

## 125 migration 與舊報表

新 trigger 拒絕新增無來源證據的 visits／viewing covered，但不刪舊 audit，不拒絕 gap，也不改既有報名／訂單 proof。既有 `LiveMetricCoverageAudit_guard` 已禁止 audit UPDATE，所以不能把舊 covered 改成新 revision，或把 gap 改成 covered；本次新增直接 SQL 回歸驗證。

只對含有**當前 revision** 未支援正向標記的版本推進 structural revision。既有 version trigger 會使受影響的報表 result／lease 失效，projection 依原 revision binding 失效。舊 reader 即使尚未更新，也因 audit.sourceRevision 不同而忽略舊標記。僅有可信報名／訂單證據的版本不被這次 UPDATE 影響。

同一受影響版本上的其他可信證據也可能因 structural revision 推進而失效，必須由實際 producer 重新對帳，不複製舊 proof 欄位續用。所有原始來源與 audit 保留。Migration 為單一交易，lock timeout 5 秒、statement timeout 30 秒；正式規模與持續流量未驗證。

## 驗證界線

`scripts/wp20-unproven-coverage-disposable.mjs` 在 owned loopback DB 執行：

- canonical 125 migrations／schema validate；
- 只移除本次新增的 trigger／function，建立與 124 差異等同的合成舊狀態；完整存檔的舊 reader 重現錯誤，新 reader 拒絕；
- 以同一份 125 SQL 重播有資料的相容性情境，強制中途失敗確認 DDL／報表變動一起回滾，再驗證成功套用；
- 受影響版本只增加一次 revision、清除快取及租約；支援版本保持原 revision／ready，兩筆舊 audit 原封保留；
- 原 finish 租約拒絕，舊／新 reader 都忽略 legacy positive，新 covered 寫入及兩種 audit UPDATE 拒絕；
- gap 仍讀為 evidence_gap；混合 gap／無效 covered 批次全數回滾，包含前一筆 gap 造成的租約變動；
- 真實 registration／order producer 對完整空來源產生的證據仍可讀 complete，沒有用任意 proof fixture 取代。

相容性重播使用 runner 已驗證的 DB marker 定位**該次自建 container**，只核對 ID／marker，不列舉 container environment 或原始 log。Prisma migration metadata 未被改寫；這不是另一輪有資料的 Prisma CLI 124→125 升級驗證，該項仍未驗證。最初 harness hash 比對因 Python newline normalization 與原檔 CRLF 不同而失敗，後續用原始 byte hash 綁定存檔文字，失敗收據保留。

單元測試保留範圍聯集、gap、隔離、租約與上限斷言；正向聯集改用已有可信 producer 的 registrations。新增測試即使 backend 錯誤回傳不可信正向資料，TypeScript 仍不能認證 visits／viewing。原單體 DB fixture 若任意寫 covered，不再是有效正向來源；未跳過／降低其斷言，也不宣稱該完整單體套件本輪通過。完整正向端到端案例仍要由可信 producer 落地後驗證。

## 後續與回滾

暫時 gate 必須與可信來源 reconciliation／proof／原子 fence／reader 一起被精確替換，不能只刪 trigger 或重開 covered。缺資料仍不可計算，沒有永久改寫五項指標需求。

下一個具體來源缺口是 standalone form 與 funnel 的報名入口；目前 `LiveMetricVisit` 只接 `/live/[slug]`。先補伺服器能唯一確定場次的報名入口，再完成完整來源對帳。多場次未選定、legacy／快取與無法歸屬保留 unknown，不向每個場次扇出計數。

回滾僅依 manifest 反向程式與此次 gate 的明確 scope；不降低已推進 revision、不復活舊 result／lease、不刪原始 audit 或缺漏證據。所有測試僅在自建 disposable DB，未對既有或正式資料庫操作、未推送或部署。
