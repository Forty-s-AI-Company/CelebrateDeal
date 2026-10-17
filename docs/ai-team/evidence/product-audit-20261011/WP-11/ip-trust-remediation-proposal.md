# WP11 限流修正範圍提案

狀態：WAITING_AUTHORIZATION。這是可審查的修正方案，尚未實作，不假設實際部署拓撲。

## 擬核准範圍

只修四類既有WP11入口：學生登入連結、優惠券確認、推薦連結、直播入場／離場。新增可注入明確信任設定的共用wrapper，透過既有request-client-ip解析器取得已驗證IP，再以既有rateLimitRequestWithIdentity重建限流metadata；保留原request供body/確認流程使用。無有效來源身分時回503且不得進入DB或兌換動作，不以所有人共用unknown桶代替安全驗證。

本機HTTP adapter提供真實socket來源，固定loopback proxy以合成proof驗證；僅此測試環境可先確立。部署端必須另提供明確信任設定，不能由RATE_LIMIT_PROVIDER推論代理；未取得部署設定不啟用或宣稱雲端完成。

## 單一writer與精確候選檔案

主代理唯一writer。新增 src/lib/trusted-entry-rate-limit.ts 及同名.test.ts；調整以下四個route.ts及各自route.test.ts：

- src/app/portal/[vendorSlug]/access/
- src/app/api/automation/vouchers/redeem/
- src/app/r/[code]/
- src/app/api/live-admission/

若設定接線需要以上以外檔案，先盤點再修訂scope。既有src/lib/rate-limit.ts、付款／checkout路由、schema、付款發布閘門均不改。本機驗證harness與對應evidence由主代理持有。

## 為何不直接改全域limiter

目前共用checkRateLimit亦用於src/app/api/payments/checkout/route.ts、payments/checkout/recovery/route.ts、payments/checkout/admission/route.ts與checkout/upsell/route.ts。全域更改會超出WP11排除的付款路由行為。新wrapper只在上述四入口接入，付款caller維持原狀。

## 驗收與風險

同一來源輪換所有候選IP標頭仍使用同一桶；可信代理覆寫有效；缺失／錯誤proof拒絕；偽造與多段標頭不得換桶；GET預覽不消耗憑證；POST單次兌換、遺失回應重試、並發與live admission租約行為保持。限流數值與窗口不變。付款來源檔hash不得改動。

必要驗證：wrapper矩陣與四route targeted tests、242次HTTP重現案例、既有兌換DB／瀏覽器回歸、lint/typecheck、Critical獨立審查、同snapshot acceptance。未知部署設定可能使入口不可用，這是必須先確認設定且不得直接發布的原因。合成proof不作正式憑證。

Task signals：medium complexity、critical risk（Security/Auth）、cross_module；router決定實作模型，Critical獨立深度審查。不得沿用舊snapshot驗收。

## 授權界線與回滾

核准本提案只授權本機隔離實作與驗證，不代表選定雲端供應商、建立真實secret、Production操作、推送、部署或解除D2～D6。未核准前不修改上述產品檔案。

回滾僅撤回本wrapper及四caller精確patch，保留先前已驗收的兩段兌換與lease修正；不使用整棵工作樹reset/restore。完整WP11仍須實際入口設定與適用環境整合證據。
