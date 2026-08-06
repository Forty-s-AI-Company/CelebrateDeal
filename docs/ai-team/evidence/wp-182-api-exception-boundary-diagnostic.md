# WP-182 — API exception-boundary 唯讀診斷

## 結果

`WP182_PREVIEW_ENV_RUN_API_BOUNDARY_VERIFIED`

Vercel CLI `58.4.4` source hash與 debug safety contract通過。Offline allowlist sanitizer fixtures `5/5` 通過。唯一一次 read-only Preview `env run` 從 workspace 外的乾淨 OS temp cwd 執行，dotenv candidates=`0`；API env-pull 邊界回傳 `2xx`、固定常數 child marker出現，最終 exit code=`0`。

因此，WP-177～181 所追蹤的「Preview env-run 在 child 啟動前 exit 1」阻塞已由新鮮 runtime evidence解除。這次沒有證明登入或 challenge 問題；`LOGIN_REQUIRED=false`，不得再要求使用者為此重新登入或提供 credential。

## 安全與副作用

Raw stdout／stderr僅在程序記憶體解析後丟棄。URL、request ID、status text、headers、response body、env records與env values均未保存或輸出。Child只印固定常數，不讀取環境值、filesystem、network、DB或PayUni。

Login/challenge response、env mutation、deployment、alias、DB、PayUni、Production、DNS與Git mutation全部為`0`。既有 dirty changes維持`PRESERVE_ONLY`；`UNKNOWN=0`、`MIXED_HUNKS=0`、staged index空。

## Readiness boundary

本包只解除 Vercel Preview env-run broker能力阻塞，不是 staging DB identity、PayUni Sandbox provider query或退款後對帳證據。CAT04維持`6.0/10`、總分維持`72.0/100`；`SANDBOX_READY=false`、`PRODUCTION_READY=false`。下一個工作包必須由Sol重新依value-first規則規劃，不得在WP-182內啟動DB或PayUni操作。

## AGY Fast QA

兩次唯讀QA額度已用完：第一次遭wrapper empty-line parameter binding error，第二次在structured output前發生`FIRST_OUTPUT_TIMEOUT`。依規則保存為`TOOL_BLOCKED`；沒有外部副作用，也不取代deterministic evidence。
