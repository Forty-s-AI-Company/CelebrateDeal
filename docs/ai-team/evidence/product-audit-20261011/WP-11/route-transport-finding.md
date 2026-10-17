# WP11 本機應用路由整合結果

狀態：FAIL。2026-10-14 新增可重跑合成驗證，不修改產品程式。

## 已證實

`verify-route-transport.mjs` 使用實際 live-admission POST、api-security 與 memory rate limiter，透過本機 HTTP adapter 呼叫。固定空物件 payload 會在 getDb 前退出；child environment 不繼承資料庫 URL、供應商憑證或載入 .env。這不是完整 Next server E2E，也不是雲端入口驗證。

同一來源變更 cf-connecting-ip，經既有 loopback ingress 時，120次400後第121次429，PASS；直接進 adapter 時，121次皆400而無429，FAIL。HTTP伺服器已清理。來源摘要保存在 route-transport-result.json。

## 根因與範圍

src/lib/rate-limit.ts 的 clientIp 直接採用 cf-connecting-ip 或 x-forwarded-for，未呼叫 request-client-ip.ts 的可信來源解析。先前 resolver 的6項PASS不能證明共用 limiter 防偽造有效。此結果證明應用路徑在可直連條件下可換桶，不能證明實際雲端允許直連。

## 後續條件

確定本WP可用的入口信任模式、來源IP覆寫及直接origin限制；現有本機代理只證明本機cloudflare-compatible header contract。不可假設遠端已具備相同保護。共用limiter修正必須保留付款路由排除範圍，先列出精確caller影響，再決定可分離的WP11範圍，重路由、Critical獨立審查與同snapshot驗收。

本輪沒有變更信任政策、付款路由、schema或任何資料。此發現屬原WP11未完成驗收條件，不撤銷已驗收的兩段兌換與lease子項，也不將整包標為READY。
