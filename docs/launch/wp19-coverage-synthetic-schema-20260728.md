# WP-19 — Coverage synthetic schema flag propagation（2026-07-28，COMPLETE）

Canonical run：`wp-19-coverage-synthetic-schema-20260728213657260`
實作 commit：`5c9139c fix(test): propagate synthetic schema to coverage runs`（本次驗證前已在 HEAD；本包沒有技術程式變更）

## 根因與修復

Sol 的根因判定正確。舊 WP-18 runner 清空 coverage child process 的 environment 後，只注入 WP-18 owner 值；因此既有 WP-17 protected DB test 在 `beforeAll` 找不到 `WP17_DISPOSABLE_SCHEMA`。npm、cmd、Node 與 Vitest 沒有移除該 flag。

既有候選修復在 coverage runner 建立互不混用的 `wp17_*`、`wp18_*` disposable schemas，並以 process-scoped bridge variables 傳遞：`WP17_COVERAGE_DATABASE_URL`、`WP17_COVERAGE_DIRECT_URL`、`WP17_COVERAGE_DISPOSABLE_SCHEMA`，以及對應的 `WP18_*` variables。`vitest.synthetic-db-coverage.config.ts` 會 fail-closed 驗證 loopback URL、schema prefix 與 flag/URL identity，再分別注入：

- `wp17-db`：`DATABASE_URL`、`DIRECT_URL`、`WP17_DISPOSABLE_SCHEMA` 都指向同一 `wp17_20260728213657260` schema。
- `wp18-main`：對應值都指向 `wp18_20260728213657260` schema，並排除僅由前一 project 執行的 WP-17 protected DB test。

這保持完整 coverage inventory 與原 threshold，沒有修改 protected test、production source、Prisma schema、migration 或 package scripts。

## Canonical receipts

- `command-receipts.sanitized.json`：npm ci、Prisma validate/generate、兩組 marker/migrate deploy/migrate status、WP-17 targeted、WP-18 targeted、coverage、lint、typecheck、strict-index、secret scan、diff check、雙 cleanup 與 hash gate 均為 `PASS`。
- `coverage-project-schema-identity.sanitized.json`：記錄兩個 project 的 owner flag 與 DATABASE_URL／DIRECT_URL schema identity（只記變數名稱與 synthetic schema，不記資料庫 URL 值）。
- `runner-safety.json`：`source_env_contents_read=false`、snapshot 未複製 `.env*`，僅使用 `127.0.0.1:54329/celebratedeal_ci` 與 synthetic fixture。
- `schema-cleanup.sanitized.json`：wp17、wp18 皆經 marker-gated cleanup，結果為 `PASS`。
- `wp17-protected-manifest.json` 與 `postflight-wp17-protected-manifest.json` byte-identical；protected runner SHA-256 為 `92F5AF5A210A131510D8F51D3B9BCB82656D920FF325338FA02BC9E39EDEE8E8`，protected test SHA-256 為 `3E8B68170BF90352FE71FA0B6C4C7AF9FD27C315B519FBA150F2E5BE5A98BA44`。

## 結果

- WP-17 targeted DB tests：2 files／107 tests，`PASS`。
- WP-18 targeted tests：3 files／110 tests，`PASS`；保留一個正常 redirect、一個 conflict redirect、單一 batch/item/settlement claim、無 orphan 的既有業務驗證語意。
- Coverage：119 files／939 tests，`PASS`；全域 63/57/60/65 與 `src/lib` threshold 未變且達標。
- Schema 建立、migration 與 cleanup：雙 schema 均 `PASS`。
- lint、typecheck、strict-index、Prisma validate/generate、secret scan、`git diff --check`：皆 `PASS`。

因此 TB-16 已解除為 `RESOLVED`；WP-18 為 `COMPLETE`，其 payout batch race 的結論限於 `MITIGATED_CURRENT_SNAPSHOT`。Automatable Readiness 維持 **57/100**，Full Commercial Launch 維持 **45/100**；沒有外推到產品 E2E、部署或外部商業 gate。
