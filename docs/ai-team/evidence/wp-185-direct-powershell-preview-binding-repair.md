# WP-185 — Direct PowerShell Preview binding repair

## 結果

`WP185_PROBE_FAILED_SENSITIVE_ROLLBACK_VERIFIED`

Synthetic direct-call fixture完整通過：exact `vercel.cmd`、PowerShell call operator、argument array與stdin marker均正常，explicit cmd wrapper=false。Fresh OS-temp位於workspace外、reparse=0、dotenv candidates=0。

唯一Preview non-sensitive upsert exit0。唯一boolean-only `env run` probe exit1且child records=0；依核准計畫立即執行唯一explicit `--sensitive` rollback，exit0。沒有重試upsert、probe或rollback。

正式after state為`SENSITIVE_RESTORED`，不再是WP-183的`UNVERIFIED`；但runtime exactSandbox仍為`NOT_VERIFIED`。Upsert與rollback成功、inline probe未產生child record的組合，將剩餘根因縮至`env run`後inline `node -e` child argument/quoting boundary；本包沒有猜測env值或將rollback冒充成功probe。

## 安全與readiness

預期值只經PowerShell memory/stdin傳遞，未出現在argv、檔案、raw output或evidence。Raw CLI output只在記憶體分類後丟棄；`.env*`內容未讀取。

Deployment、alias、DB、PayUni、Production、DNS與Git mutation皆0；現有staging不得宣稱包含最新dirty workspace。既有dirty changes維持`PRESERVE_ONLY`，staged index空。

CAT04維持`6.0/10`、總分維持`72.0/100`，`SANDBOX_READY=false`、`PRODUCTION_READY=false`。下一步只能另規劃以marker-owned OS-temp child script避開inline `node -e` quoting的修復；WP-185不得重試。

## AGY Fast QA

AGY Fast第二次唯讀嘗試輸出`PASS`，確認direct fixture、attempt budget、rollback恢復、零禁止操作與不加分邊界一致。AGY沒有執行外部操作，也不取代Terra deterministic evidence。
