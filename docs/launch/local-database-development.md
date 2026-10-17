# 本機資料庫與測試啟動

`npm run dev` 現在會先執行唯讀 schema 檢查。請由已核准的工作階段環境注入本機 `DATABASE_URL`，再啟動；此 preflight 不載入 `.env*`，避免工具間載入順序不同而檢查錯誤的資料庫。只放在 `.env` 的設定會得到明確的注入提示，Next.js 尚未啟動。不要把正式連線交給這個命令。

允許 loopback 的 `celebratedeal_dev`、`celebratedeal_test`、`celebratedeal_e2e`、`celebratedeal_ci` 及既有 WP CI 名稱；不接受遠端主機。先用 `npm run db:check` 確認目標。檢查只讀取 migration metadata，不自動 migrate 或 seed。

若缺 migration、校驗碼不符、出現其他版本或套用未完成，請使用本 revision 的全新 disposable DB 建立基線；不要對已有殘留資料的 dev/test DB 自動套用。此次 efb8b7e9 的 migration inventory 為 95，之後以當前原始碼 inventory 為準，不固定數字。

測試命令：

- `npm test`：先檢查 DB，保留原完整 Vitest 測試集合。
- `npm run test:unit`：只排除已明確命名的 `.db.test.ts`；不代表完整驗收。
- `npm run test:db`：先檢查 DB，再跑 `.db.test.ts`。
- `npm run test:db:concurrency`：既有獨立 race tests，仍須另外執行。
- `npm run test:contracts`：既有 Node TAP contracts，仍須另外執行。

pretest 與 Vitest 共用相同 URL 解析器。未注入 test URL 或沿用舊 `file:` 值時使用既有 loopback test 預設。有注入 `DATABASE_URL` 時，測試會沿用該設定，包括允許的本機 dev DB；從開發切換到測試前，必須在工作階段注入專用 disposable test URL，不能沿用互動開發資料庫。所有測試與 coverage assertions 維持原有強度。任何單層成功都不能代替完整 CI 或 WP 驗收。
