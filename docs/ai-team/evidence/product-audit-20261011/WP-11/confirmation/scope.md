# WP-11 確認入口子項

主代理唯一 writer；只修改以下4檔。GET 不消耗 magic link、不建立登入 session；POST 經 canonical origin、短效且綁定連結與瀏覽器的確認 challenge，再保留租戶核對與原 consume 原子單次操作。新增共用 helper 是此入口的必要依賴。不改 IP 信任、schema、付款 route、既有加密與簽章條件。僅合成資料、本機 disposable DB。

驗收：GET/HEAD 不消耗；POST 正常／惡意 origin／遺失 challenge／替換連結／過期／錯誤租戶／重放與並發；browser E2E/axe；獨立 Critical review。同 origin 與 challenge 都必須有效，避免 login CSRF。未完成 voucher 與 IP 子項不得標完整 WP11 READY。

檔案：
- src/lib/capability-confirmation.ts
- src/lib/capability-confirmation.test.ts
- src/app/portal/[vendorSlug]/access/route.ts
- src/app/portal/[vendorSlug]/access/route.test.ts
