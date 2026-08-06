# WP-91 — 本機 Release Readiness 與 Artifact Rollback Rehearsal

## 結論與範圍

- 類別：CAT-09 部署、環境、Release 與回滾
- 執行前分數：5.0／10
- 本包的分數候選：最多 6.5／10；是否調分只由 Sol acceptance 決定。
- 只驗證本機 artifact／metadata；沒有 deployment、cloud release、DNS、Production database 或 Production rollback 操作。

## 新增本機 gate

- `npm run release:verify:local`：驗證 repository release source-of-truth、Next artifact 必要檔、穩定 checksum，並只輸出 runtime environment key 的 presence boolean。
- `npm run test:release-readiness`：涵蓋合法 artifact、缺 artifact、無效 deployment config、checksum mismatch、injected candidate activation failure 的 rollback、以及 secret sentinel 不進輸出。
- `node scripts/release-local-readiness.mjs rehearse .next`：使用實際 local candidate artifact 與 temporary synthetic previous slot，確認 candidate metadata switch 後的注入失敗會恢復 previous checksum。

## Deterministic evidence

- `node --check scripts/release-local-readiness.mjs`：PASS。
- `npm run test:release-readiness`：PASS，4 tests。
- ESLint（release runner 與 test）：PASS。
- `npm run release:verify:local`：PASS；既有 local `.next` artifact 驗證 3,096 files、366,297,638 bytes，normalized checksum 可重複。
- `rehearse .next`：PASS；candidate activation failure 被明確注入，recovered checksum 等於 synthetic previous slot checksum。
- `git diff --check`：PASS（全工作區僅 CRLF conversion warnings）；staged index empty。

## Fresh build 的如實狀態

為避免讀取 workspace `.env*`，本包在 OS temp mirror（不含 `.env*`）嘗試新的 Next production build：

1. Turbopack 拒絕指向 workspace 外的 `node_modules` junction；這是 build-tool isolation failure。
2. webpack fallback 未產生可驗收的 `BUILD_ID`，因此不是成功 build receipt。

上述兩次都不是產品功能 PASS，也不支援「新鮮 local build」主張。現有 `.next` 是真實 local artifact，但其建立時間／source freshness 沒有在本包重新證明；因此本包不得把 CAT-09 提到 7.5。

Temporary source mirror 已透過本包的受控 cleanup command 完成清理。命令先確認唯一目標為 OS temp 下的 `celebratedeal-wp91-release`，並確認其 `node_modules` junction 指向現有 workspace 的 `node_modules`，才只移除該 temp mirror；後續唯讀檢查確認 mirror 不存在，repository 內沒有檔案被移除。

## 不代表

- 不代表 Production deploy、traffic switch、Vercel rollback、正式 secret injection 或雲端 health check。
- 不代表 PayUni Sandbox／Production payment receipt。
- 不以 fixture rollback 冒充 Production rollback。
