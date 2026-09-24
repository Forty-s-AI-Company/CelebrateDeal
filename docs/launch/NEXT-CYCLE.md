# CelebrateDeal 下一輪清單

更新：2026-09-24。此清單只記錄本輪尚未驗收或可延後的事項；未執行項目均非 PASS。每次 Goal checkpoint 依當時使用者影響更新。

1. **完整 PayUni Sandbox 財務閉環**：在核心成功訂單驗證後，補 SaaS checkout、partial/full refund、對帳、佣金沖銷與結算的外部證據。維持固定合成資料與非 Production 資源。
2. **舊 PR 的獨有功能**：PR #210/#211 仍有衝突及未移植的學員入口、LINE 圖文選單、聯盟入口與部分商品頁差異。先依 [路徑與風險盤點](integration-inventory-20260924.md) 分批確認需求、租戶權限、schema 與測試，再用小型 PR 整合；不能以整棵舊分支覆寫 master。
3. **非核心功能與使用細節**：依實際 staging 操作結果排定，優先修會造成資料遺失、卡住或無法完成任務的問題，再處理視覺細節。
4. **Production 準備**：正式服務設定、法務/客服流程、備份演練及正式金流另做獨立驗收。本輪 staging 通過不能直接推論 Production READY。

本輪 Git/CI/staging 未完成的硬阻擋屬於 [現況入口](CURRENT.md) 的 `CURRENT`，不可移到此頁當成已延後完成。
