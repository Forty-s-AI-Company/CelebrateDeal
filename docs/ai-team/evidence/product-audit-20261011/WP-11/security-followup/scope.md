# WP-11 已知 MINOR 與缺漏 limiter 收尾

唯一 writer 主代理。精確改動7檔：confirmation cookie 使用既有 purpose-separated HMAC，保持 portal/voucher API與retry語意；補擷取表單偽造cookie拒絕測試及原正向流程；referral GET與live-admission DELETE在DB動作前補既有checkRateLimit。使用相互獨立key；DELETE與POST同120/min，referral60/min，過量429/provider失效503原樣回傳。沒有變更IP解析、schema、付款/退款、正式資料。

這是前一子項獨立review新發現的cookie弱點與原WP11剩餘端點工作；前兩次review與MAJOR結案紀錄保留。新scope重新snapshot/route，Critical獨立審查，不把舊receipt當新版本驗收。既有portal不符合资格恢復仍保留非阻擋MINOR。

驗證：擷取body+自行計算原SHA256cookie跨contextPOST必須拒絕，正常重試仍可用；兩個limiter實際memory provider達上限、429/503不得寫DB，同來源驗證不降級。Chromium/Firefox voucher+portal回歸，DB邊界，lint/typecheck。IP header防偽造仍WAITING_AUTHORIZATION，不能以本子項宣稱完成。

- src/lib/capability-confirmation.ts
- src/lib/capability-confirmation.test.ts
- src/app/portal/[vendorSlug]/access/route.test.ts
- src/app/r/[code]/route.ts
- src/app/r/[code]/route.test.ts
- src/app/api/live-admission/route.ts
- src/app/api/live-admission/route.test.ts
