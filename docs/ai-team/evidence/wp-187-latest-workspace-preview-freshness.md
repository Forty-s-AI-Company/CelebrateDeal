# WP-187 — Latest Workspace Preview Freshness

## 結果

目前 deployment-relevant workspace 已由 workspace 外的 marker-owned mirror 建立為一個全新 Vercel Preview。這不是舊 snapshot redeploy。新 deployment 為 Preview／READY，direct URL 與 staging alias 都回傳相同 source fingerprint，`/api/health` 都為 HTTP 200。

## Deterministic evidence

- Source manifest：352 個 regular files、2,209,524 bytes。
- Canonical source digest：`cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34`。
- Mirror：workspace 外；reparse point 0；forbidden path 0；部署檔案 353（含一個非敏感 marker）。
- 明確未部署：所有 `.env*`、`.git*`、`.vercel*`、`.ai-team/**`、`docs/**`、`tests/**`、`tmp/**`、非 preflight scripts，以及 `prisma/dev.db`。
- Vercel dry-run：exit 0、JSON 可解析、forbidden matches 0。
- 新 deployment：`dpl_E3g7ZjYLMd8JDsPybA2Hxz4bKE6W`，target Preview，READY。
- Direct marker digest：MATCH；direct `/api/health`：200。
- Alias CAS precondition：原 alias 仍為 `dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg`。
- Alias switch：1 次、exit 0；post identity 指向新 deployment。
- Alias marker digest：MATCH；alias `/api/health`：200；rollback 0。

## Ownership 與安全

既有 dirty changes 維持 `PRESERVE_ONLY`。本包沒有 commit、push、merge、reset、clean、stash 或 checkout；沒有 Production、DB、PayUni、付款、退款、callback 或遠端 environment value 讀取。部署紀錄只保存非敏感 project／deployment identity、digest、狀態與 HTTP status。

Workspace 外的 marker-owned mirror 在完成驗證後曾做一次精確路徑清理，但被 Codex Desktop policy 於執行前拒絕；未繞過或重試。該 residual 只包含已驗證的 allowlist deployment files 與非敏感 marker，不含 `.env*` 或資料庫檔案。

## Readiness impact

`PREVIEW_SOURCE_FRESHNESS` 從未證明變為已證明。CAT09 候選由 6.5 提升至 7.0，但只有 Sol High `ACCEPT` 後才可套用；CAT04 維持 6.0。本包不代表 Production ready，下一包仍需在這個 fresh deployment 上執行 staging DB／PayUni Sandbox 唯讀 reconciliation。
