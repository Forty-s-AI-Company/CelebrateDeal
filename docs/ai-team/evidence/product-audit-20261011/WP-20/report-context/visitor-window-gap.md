# 訪客時間窗缺口（尚未修復）
已核准契約以 [S,T) 內造訪的不同瀏覽器作 V。LiveMetricVisitor 的 scope/browser 唯一索引與 immutable firstVisitedAt 僅能表達整個版本首次造訪。
反例：同一瀏覽器在 S 前造訪，於 [S,T) 再訪。只按 firstVisitedAt 篩選會漏算 V，不能直接拿此表作完整期間訪客事實。
下一步：在已核准 M2 scope 內設計可冪等、具時間與租戶版本歸屬的造訪紀錄，保留穩定 visitor identity；新增資料庫與邊界測試，更新 snapshot adapter 與失效邏輯。涉及 migration 必須獨立深度審查。此文件不是驗收 PASS，也不更動指標公式。
