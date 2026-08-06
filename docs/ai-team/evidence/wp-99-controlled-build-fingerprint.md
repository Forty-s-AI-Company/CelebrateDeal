# WP-99 — 受控建置失敗的單一安全指紋診斷路徑

日期：2026-07-30  
類別：CAT-09 部署、環境、Release 與回滾  
狀態：`ACCEPTED_NO_SCORE`

## 目的與邊界

WP-98 的 controlled no-env build 已證明環境隔離與 mirror cleanup，但只有廣義 `SOURCE_QUALITY_FAILURE`，且不保存 raw child output。本包不修正 source，而是新增受限診斷 runner，將一次 build 壓縮為 allowlist-only 的單一 fingerprint。

唯一新增路徑：

- `scripts/build/controlled-build-fingerprint.mjs`
- `scripts/build/controlled-build-fingerprint.test.mjs`

WP-98 config、runner、package、source、Next config 與 lockfile 均為 preserve-only。

## Fingerprint contract

唯一允許格式：`v1|<category>|<error_code>|<source_file>|exit=<exit_code>`。

- source file 僅接受 workspace-relative 的 `src`、`app`、`pages`、`components`、`lib` 或 `scripts` 路徑；絕對路徑、traversal、query、fragment、磁碟代號或行列資訊均拒絕。
- 沒有安全來源路徑時使用 `<none>` 與 `owner=UNRESOLVED`，不猜測 owner。
- child output 只在受限記憶體 buffer 中解析；JSON evidence 不保存 raw output。
- controlled build attempt counter 固定為最多一次。

## Deterministic evidence

- WP-99 fingerprint runner tests：4 passed。
- WP-98/WP-99 combined Node tests：8 passed。
- scoped ESLint、`npx tsc --noEmit`、diff check：PASS；staged index 為空。
- controlled no-env webpack build：恰好一次，exit 1。
- sanitized receipt：`v1|SOURCE_QUALITY_FAILURE|TYPESCRIPT_TYPE_ERROR|<none>|exit=1`。
- receipt 明確記錄 `raw_output_saved=false`、`output_truncated=false`、`mirror_cleanup=PASS`。
- AGY Fast：`OK`，確認 single attempt、allowlist、path validation、bounded capture 與 cleanup；無安全缺口。
- Sol High：`ACCEPT`、score impact 0。

## Score boundary 與 deferred

CAT-09 維持 `6.5`。本包移除了 source-quality failure 的安全診斷證據阻塞，但沒有成功完成 production build，因此不能加分。

後續需在獨立、具有明確 source ownership 的 WP 定位 `TYPESCRIPT_TYPE_ERROR` 的實際 source file 與 owner，才可考慮修復。
