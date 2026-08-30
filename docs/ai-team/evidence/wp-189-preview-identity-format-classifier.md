# WP-189 — Preview environment identity format classifier

## 結果

- 終態：`WP189_CLASSIFICATION_COMPLETE`
- 主要分類：`EMPTY_BINDING`
- 主要綁定：`STAGING_DATABASE_URL`
- CAT04：`6.0 → 6.0`
- 總分：`72.5 → 72.5`
- 本工作包只定位 Preview environment binding 問題，不支持 DB、PayUni reconciliation 或分數提升。

## Fresh staging 與一次性執行

- WP-187 已驗收的 Preview deployment、source digest、alias marker 與 health lineage 均匹配。
- Vercel project、deployment、Preview target 與 READY 狀態均匹配。
- Alias marker 匹配，`/api/health` 的 bodyless HEAD 為 200。
- Preview broker：1 次；retry：0；child record：1 筆且 schema 合法。
- 執行前從隔離 child 移除固定七個目標名稱；父程序未讀取其值，隔離後 presence count 為 0。

## 遮罩化分類

固定布林 schema 證明：

- `STAGING_DATABASE_URL` 名稱存在但內容為空，因此優先分類為 `EMPTY_BINDING`。
- `NEXT_PUBLIC_SUPABASE_URL` 與 `NEXT_PUBLIC_APP_URL` 亦為名稱存在但內容為空。
- `PAYUNI_ENV` 為非空且精確符合 sandbox 語意。
- `PAYUNI_MERCHANT_ID`、`PAYUNI_HASH_KEY`、`PAYUNI_HASH_IV` 名稱存在但內容為空，因此 PayUni binding 不完整。

Receipt 不保存原始值、URL、host、path、username、password、長度、hash、prefix、suffix、parser message 或 broker raw output。

## Deterministic evidence

- Node tests：8/8 PASS。
- ESLint：PASS，0 warning。
- TypeScript：PASS。
- Strict receipt readback：PASS。
- `git diff --check`：PASS；只有既有 line-ending warnings。
- Staged index：empty。
- Existing dirty ownership：`PRESERVE_ONLY`；`UNKNOWN=0`、`MIXED_HUNKS=0`。
- Temp cleanup：PASS，residual path absent。

## Side effects

- DB connect/query/write：0。
- PayUni query/payment/refund/callback：0。
- Deployment、environment mutation、alias/DNS mutation：0。
- Production 與 Git mutation：0。

## AGY Fast QA

最多兩次已用盡。第一次為 wrapper 的空行參數綁定錯誤；第二次 process 正常啟動但在取得第一個輸出前 timeout，process tree 已清理。狀態如實保存為 `TOOL_BLOCKED_AFTER_MAX_ATTEMPTS`，沒有 QA verdict，也未以 deterministic evidence 偽裝成 AGY 通過。

## 結論與下一邊界

WP-188 的 `ENVIRONMENT_IDENTITY_PARSE_FAILED` 根因已縮小為 Vercel Preview 中必要 binding 名稱存在、實際內容為空，而非已證明的 DB parser、DB 連線或 PayUni provider 問題。任何修正都需要新的 Sol 計畫，以安全方式重新綁定 Preview environment values；本工作包不得重跑 broker，也不得直接開始下一包。
