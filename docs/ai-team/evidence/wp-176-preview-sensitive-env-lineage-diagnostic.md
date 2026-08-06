# WP-176 Preview sensitive env lineage diagnostic

## Result

Terra deterministic result：`WP176_CONFIRMED_SENSITIVE_ENV_INCOMPATIBLE_WITH_LOCAL_ENV_RUN`。

Sol High acceptance：`ACCEPT`。接受範圍僅為 configuration-type root cause confirmation；不接受為 PayUni reconciliation success，不加分。

WP-173 已驗收 receipt 顯示 `PAYUNI_ENV` 唯一 Preview binding 的 type 是 `sensitive`；WP-174 的 fresh Preview broker child 在 parent target keys 為 0、無 env-file autoload／assignment 的情況下回報 `PAYUNI_NOT_SANDBOX`，並在 DB 與 PayUni attempt 都為 0 時安全停止。

Vercel CLI 58.4.4 local source digest 為 `sha256:44475b2b096b3f20c22014fd68c5b560b4c040713c6d4fdee7666537c136e9e9`。靜態檢查確認 `env run` 從 project pull `records.env`，再以 local/process env overlay；同時 `env ls --json` 會輸出其他 `plain` env values。因此 Sol 原本允許的 metadata observation 沒有執行，attempts 保持 0，沒有 raw output 或 environment value 被讀取／保存。

Vercel 官方文件將 sensitive variables 定義為建立後不可讀，且官方 changelog說其值只可在 build 階段解密。`vercel env run` 是本機 pull-and-inject 流程，不是 Vercel build。參考：[Sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables) 與 [Sensitive environment variables changelog](https://vercel.com/changelog/sensitive-environment-variables-are-now-available)。

## Deterministic evidence

- `node --test scripts/wp176-preview-sensitive-env-lineage-diagnostic.test.mjs`：7 passed，0 failed，0 skipped。
- `npx eslint scripts/wp176-preview-sensitive-env-lineage-diagnostic.mjs scripts/wp176-preview-sensitive-env-lineage-diagnostic.test.mjs`：PASS。
- `npm run typecheck`：PASS。
- `--verify-report` strict readback：PASS。
- WP-173 protected receipt SHA-256：`95DC73292E06CAE0B1F69FD07AA0C45D799152D88CB48C6A5B74071981D7C6EA`。
- WP-174 protected receipt SHA-256：`C67F9C4A854215251D90B04B92EF8853426402EAD86D15E26176FABAA1E270AB`。
- staged index：empty；既有 dirty 與 WP-169～175：`PRESERVE_ONLY`；`UNKNOWN=0`、`MIXED_HUNKS=0`。
- AGY Fast：兩次皆遭 wrapper empty-line parameter binding error，`TOOL_BLOCKED`；未取得 verdict，不取代 deterministic tests。

## Score and Gate impact

- CAT04：`6.0 → 6.0`。
- total：`72.0 → 72.0`。
- `SANDBOX_READY=false`、`PRODUCTION_READY=false`。
- 新證據只確認 configuration-type root cause，不代表 DB identity、PayUni query 或 reconciliation 已通過。

## Side effects and rollback

External metadata、`vercel env run`、`vercel env pull`、DB、PayUni、deployment、env mutation、alias／DNS、Production、Git 與 package side effects 全為 0。Rollback 只需移除 WP-176 新增 artifacts；不得觸碰既有 dirty 或 protected receipts。WP-174 OS temp residual 仍只做 handoff，不繞過 Desktop policy。

## Next remediation boundary

另立新 WP，將非秘密分類旗標 `PAYUNI_ENV` 的 Preview binding 從 `sensitive` 改為可供本機 broker取得的 non-sensitive encrypted variable，重新部署 Preview 並先驗證 freshness/runtime classification；或改用受控 Vercel build/runtime presence-only probe。任何遠端 mutation、部署或新 reconciliation 都不得混入 WP-176。
