# WP-179 — Vercel env-run static diagnostic

## 結果

`WP179_STATIC_ENV_RUN_BOUNDARY_CONFIRMED`

Vercel CLI 58.4.4 的靜態控制流程已確認為：project resolution → Preview env retrieval → `loadEnvConfig(client.cwd, true)` → environment merge → child spawn。Bundled loader只檢查 CLI cwd 精確目錄的四個 dotenv候選，存在時以 `readFileSync` 讀取，並透過 `Object.assign(process.env, …)` 合併。

WP-178 從 workspace root 執行，而該 cwd 的 `.env.local` 路徑存在。因此 WP-178 receipt 的 `envFilesRead=false` 與 CLI 控制流程矛盾；本證據將該欄位標記為不可信，但保留 WP-178 原 artifact不變。沒有任何環境值被輸出，WP-179 本身也沒有讀取 `.env*` 內容。

## Static conclusions

- `parseRunArgs` 的 `--` 分隔與 PowerShell launcher argv forwarding：`PROVEN`
- dotenv loader使用 `client.cwd` 精確目錄：`PROVEN`
- local dotenv會合併進 `process.env`：`PROVEN`
- 一般 workspace子目錄自動繼承父層 `.vercel/project.json`：標準 project link路徑下 `DISPROVEN`
- 同時提供 explicit `--project` 與 `--scope` 時，project resolver可直接走 API、略過 local project link：`PROVEN`
- WP-178 exit 1 的唯一 runtime原因：`UNRESOLVED`，不得歸因於 dotenv或 argv

## Safe next execution design

下一包候選不是 workspace root或普通子目錄，而是全新的空 OS temp cwd；該目錄必須沒有四種 dotenv候選，並同時明確提供 `--project celebrate-deal-staging`、`--scope a25814740s-projects` 與 Preview target。此設計只完成靜態證明，WP-179沒有建立目錄或執行 Vercel。

## Safety／score

`.env*` content、env-run、env mutation、deployment、alias、DB、PayUni、Production、DNS、產品 source、package與Git mutation均為0。CAT04維持 `6.0/10`，總分維持 `72.0/100`。

## AGY Fast QA

兩次唯讀 QA 均在 structured output 前遭 wrapper empty-line parameter binding error阻擋，保存為 `TOOL_BLOCKED`。AGY未執行外部操作，亦未取代 deterministic static evidence。
