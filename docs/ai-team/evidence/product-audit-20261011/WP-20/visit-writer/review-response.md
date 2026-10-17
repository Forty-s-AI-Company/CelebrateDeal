# 獨立審查初步回應（未結案）
來源 review-current.json，observed claude-opus-5-5，effort unknown。原 findings 不修改；本回應不是 acceptance。

0 MAJOR：審查未收到 scripts/wp20-metric-persistence-disposable.mjs，故「只有 mocks」不符合現有證據。disposable-db-result.json 已含 boundary/staling/immutable/isolation/cross-scope 與 concurrent same-event/replay 測試。惟 visit vs report-finish 的真正並行測試尚缺，保留此部分待補；下一次複審必須附 runner 與收據。
1 MINOR：時間精度風險需統一 visitor provisioning/collection/visit 的毫秒規則並加案例；不可只改為round後讓future guard產生另一個邊界錯誤。
2 MINOR：目前刻意在停用/過期後拒絕重送，未宣稱越過收集生命週期仍可寫入。需明確 receipt replay 契約與測試，不得把拒絕當成功。
3 MINOR：coverage watermark 缺口已知且未接正式指標計算；仍須完成可驗證的覆蓋證明，不能將available snapshot當完整收集。
4/5 MINOR：刪除鎖序與大量刪除成本、RC限制需完成專屬測試及server清理路徑；尚未結案。
6 MINOR：全域client eventId可能互相佔用，需評估server派生或scoped uniqueness，連同cursor/schema/readers一起修正，不降低租戶隔離。
7 NIT：visitor lock可改FOR NO KEY UPDATE並驗證FK並行。
8 NIT：TRUNCATE繞過staling需禁止或明確失效；FK update與immutable規則應一致。

下一步優先處理具體資料完整性與並行風險，再以新snapshot複審。完整WP20仍NOT_READY。
