# WP-167 — Vercel Preview redeploy 與 staging alias freshness

## 結果

`WP167_PREVIEW_REDEPLOY_AND_ALIAS_FRESHNESS_VERIFIED`

- 使用既有 READY Preview deployment 作為 remote redeploy source；未上傳本機 workspace。
- 新 deployment 建立於 WP-164 Preview environment provisioning 之後，target 為 Preview，終態為 READY。
- 新 deployment 的 `/api/health` HEAD 回 200 後，才將指定 staging alias 從舊 deployment 切至新 deployment。
- 切換後 alias metadata 指向新 deployment，staging `/api/health` HEAD 再次回 200。
- `STAGING_DATABASE_URL` 名稱與 Preview target 仍存在；未讀取 value。
- 沒有 Production、DB、PayUni、payment、refund、callback 或 Git mutation。

## Freshness 結論

Vercel 的 environment variable 更新只會套用到新 deployment；本次採 post-provision remote redeploy，且新 deployment 時間晚於 WP-164，因此可將 `STAGING_DEPLOYMENT_ENV_BINDING_FRESHNESS` 標為已驗證。

本證據不代表 staging DB identity、synthetic pending reservation 或 PayUni Sandbox reconciliation 已完成；CAT04 與總分均不變。

AGY Fast 依上限執行兩次唯讀 QA，但兩次皆未在時限內產生輸出，保存為 `TOOL_BLOCKED / FIRST_OUTPUT_TIMEOUT`；它沒有被當成 PASS，也沒有取代 deterministic gates。

## Rollback

舊 READY deployment 保留。若日後發現 staging route regression，可將唯一 staging alias 指回 receipt 保存的舊 deployment；本次 post-cutover checks 均通過，因此未執行 rollback。

## Ownership

WP-167 只新增 runner、runner tests、sanitized receipt 與本 evidence。所有既有 dirty changes、WP-164／165／166 artifacts、產品 source、config、package／lockfile與 Prisma 均為 `PRESERVE_ONLY`。
