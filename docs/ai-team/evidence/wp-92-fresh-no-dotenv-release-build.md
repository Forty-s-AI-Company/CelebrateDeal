# WP-92 — Fresh no-dotenv Release Build 證據建立

## 結論

- 類別：CAT-09 部署、環境、Release 與回滾
- 執行前分數：6.5／10
- 結果：`BLOCKED_BY_REQUIRED_PRODUCTION_CONFIGURATION`
- 分數：維持 6.5／10；沒有 fresh no-dotenv build receipt，不得主張 7.0 或 7.5。

## 隔離與安全邊界

- 使用唯一 OS temp mirror `celebratedeal-wp92-fresh-build`，複製目前 candidate（含既有 dirty source），但排除 `.git`、`.env*`、`node_modules`、`.next`、coverage、reports、測試輸出與常見私鑰副檔名。
- mirror 掃描結果：`.env*`／私鑰類檔案數為 0；沒有讀取任何被排除檔案內容。
- install 與 build 都在 child process 最小環境執行：17 個 OS/runtime key、`NODE_ENV=production`、`CI=1`、`NEXT_TELEMETRY_DISABLED=1`；沒有 PayUni、Production 或虛構的應用程式 secret。
- workspace pre/post dirty inventory SHA-256 相同：`8024978759f18d9cf5ff404ff06155b06a8dc2d950b90d095c3a00a11264d6ce`；staged index 一直為空。

## Deterministic receipt

- candidate commit：`a06fe1720b2e9d4eb17b59bdd67ebe5b9281f466`。
- mirror manifest SHA-256：`1f1344cdd061ea93db605ff5968cd6945449599d525e1ed4e5e5ffe19270a839`。
- 第一次 `npm ci` 在 `NODE_ENV=production` 下未安裝 build preflight 所需的 `tsx`；這是隔離 install 設定問題，不是產品 build receipt。
- 以 frozen `npm ci --include=dev` 重新安裝後，mirror 內 `tsx` 存在、install stderr 為空，且 `package-lock.json` SHA-256 為 `703704e89a563af6b9b937a2cd3f49542294b4a14aa5c5237edf46407e5c6ceb`。
- 最終 `npm run build` exit code 為 1、耗時 1472ms、沒有 `.next/BUILD_ID`；stdout/stderr 僅以 SHA-256 保存，不公開原始 log。
- preflight fail-closed：缺少資料庫、公開 URL、job/CSRF、mail、observability、payment-provider 與 distributed rate-limit 等 production configuration；沒有以 placeholder 或假 secret 繞過。

## 清理與不代表

- cleanup command 先驗證唯一目標位於 OS temp，名稱精確為 `celebratedeal-wp92-fresh-build`、本體為非 symlink directory，才移除；後續檢查 mirror 不存在。
- 不代表 Production deploy、cloud config、資料庫、mail、PayUni、observability 或正式 secret 已驗證。
- 此 fail-closed receipt 是有效阻擋 evidence，但不是成功 fresh build evidence。

## Deferred

要取得 CAT-09 的 fresh build receipt，需要受控、非 Production 的 release configuration source／injection 機制，能提供 preflight 所需的非 secret 或受控 secret 設定，且仍不可讀取 workspace `.env*`。Production deployment、traffic switch、health check 與 rollback 仍需要另行授權。
