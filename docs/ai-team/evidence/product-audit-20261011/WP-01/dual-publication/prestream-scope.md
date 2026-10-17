# D-1 嚴格404修正範圍

為既有 D-1 公開不可用驗收新增精確 scope：src/proxy.ts、src/proxy.test.ts、src/lib/public-landing-page-status.ts 與 test，及既有 landing-page-service 的純讀 projection 選項。只處理 /lp GET/HEAD，不改其他 matcher、marker、POST 或訪客識別語意。唯一 writer 主代理。依 security 重新路由 Critical／獨立深度審查；不改 schema、專案 gate、全站 loading。

公開讀取既有判斷後回 generic404／錯誤503；不輸出商家診斷或 raw DB error。不快取發布狀態，避免取消發布仍可存取。額外 DB 查詢成本必須實測／review；skip presentation enrichment 只省商品／諮詢展示，不跳過既有公開判斷。
