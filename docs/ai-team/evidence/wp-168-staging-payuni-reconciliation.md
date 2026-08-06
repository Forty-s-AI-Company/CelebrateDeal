# WP-168 — Staging DB＋PayUni Sandbox live reconciliation

## 結果

`WP168_EXACT_NO_GO_SECRET_OR_RECEIPT_SAFETY`

唯一一次 `vercel env run -e preview` 外部執行在 child 啟動階段明確回報載入 workspace `.env.local` 與 `.env`。這違反 WP-168 的 agent-blind Preview broker contract，因此 fail closed：

- Vercel Preview env value 未輸出或保存。
- Agent 未讀取 env file 內容，但執行工具鏈自動載入了 env files，故 `environmentFileRead=true`。
- DB connection／read-only transaction 各有一次未完成 attempt；application SELECT 為 0。
- Synthetic reservation count 未查詢。
- PayUni Sandbox query、payment、refund、callback 均為 0。
- DB write、row lock、deployment、environment mutation與 Production 均為 0。
- CAT04 維持 6.0，total 維持 71.5。

AGY Fast 依上限執行兩次唯讀 QA，兩次皆為 `FIRST_OUTPUT_TIMEOUT`，保存為 `TOOL_BLOCKED`；未當成 PASS，也未取代 deterministic evidence。

## 根因與下一步

目前 blocker 是 workspace cwd 下的 Vercel／runtime env autoload，而不是缺少 Vercel Preview binding。下一個 WP 應只修 broker isolation：在不含 `.env*` 的 fresh OS-temp cwd，以 linked project metadata與絕對 runner path執行 Preview env broker preflight；先以無 DB／provider side effect的 presence／identity harness證明沒有 env-file autoload。不得在 WP-168 重試 DB 或 PayUni。

## Ownership

WP-168 僅新增 runner、tests、sanitized receipt與本 evidence。WP-162／165／167、產品 source、PayUni adapter、package／lockfile、Prisma與全部既有 dirty changes均為 `PRESERVE_ONLY`；staged index維持空。
