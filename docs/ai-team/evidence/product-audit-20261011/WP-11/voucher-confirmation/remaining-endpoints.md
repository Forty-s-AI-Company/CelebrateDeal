# WP-11 下一個獨立子項盤點

唯讀核對：src/app/r/[code]/route.ts 的 GET 尚未呼叫 checkRateLimit，會寫入 referral click；src/app/api/live-admission/route.ts 的 POST 已有限流120/min，DELETE 在 same-origin 驗證後直接 release，尚無 limiter。

候選精確 scope：以上2 route 與各自 test，沿用既有 provider contract；不可修改 Billing/付款行為或降低 assert。尚未修改或驗收。IP header trust 統一仍等非 Production 拓撲，不能以新增呼叫宣稱防偽造標頭完成。
