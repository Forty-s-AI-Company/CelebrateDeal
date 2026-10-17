# WP-20 本機報表排程 host

狀態：本機獨立程序已有合成資料實測；完整 WP-20、Preview/staging 持續排程、實際部署角色與正向 coverage 尚未驗收。

## 執行邊界

此入口沒有 HTTP listener。啟動程序的 OS owner 與注入的資料庫工作階段提供執行權限，JSON 明確列出可處理的 vendor/live/version。每個列入的 scope 允許處理該版本既有佇列；`startAt`/`endAt` 只限制新建立的工作，並非既有佇列的期間權限過濾器。

Launcher 僅接受 `127.0.0.1/celebratedeal_test`，並核對 owned disposable PostgreSQL marker。它不適用於一般開發 DB、Preview/staging 遠端 DB 或 Production。部署至其他環境仍需對應的工作階段身分、scope allowlist、資料隔離與 runtime binding 驗證，不能用本機 marker 取代。

`DATABASE_URL` 只能由核准 process environment 注入。入口不載入 `.env*`、不列舉環境或 Secret Store、不輸出連線值。生成的 Prisma SDK 若仍有 dotenv 探索路徑，啟動會失敗。

## 建置與設定

```powershell
npm run build:metric-host
npm run metrics:host:local -- C:/path/to/metric-host-config.json
```

建置使用已列入專案的 TypeScript，固定 source/dependency allowlist，產物位於 `.metric-worker/`。Worker 不取得 DB 或主程序環境。啟動時只使用固定本機 artifact，不接受來自設定或 URL 的 worker 路徑。

設定必須是一般 JSON 檔案，最多 32 KiB；以下只有合成範例 ID，並非可直接執行的場次設定：

入口使用同一個檔案 descriptor 檢查身分／型別並限制讀取量，檔案在檢查後成長也不會無限制讀取。所有 host 與 worker 產物由共用清單逐一檢查，建置前以 AST 核對 runtime dependencies；這是可信專案來源的建置 gate，不是任意 JavaScript 的安全 sandbox。

```json
{
  "entries": [
    {
      "vendorId": "synthetic-vendor",
      "liveId": "synthetic-live",
      "versionId": "synthetic-version",
      "startAt": "2026-10-01T00:00:00Z",
      "endAt": "2026-10-02T00:00:00Z",
      "retentionSeconds": 3600
    }
  ],
  "cadenceMilliseconds": 60000,
  "maxCycles": 2,
  "jobsPerCycle": 1,
  "admissionMilliseconds": 45000
}
```

每次最多 16 個 entry、4 次工作嘗試，`maxCycles` 為 1～10000。週期間隔為 1 秒～1 小時，從上一輪完全結束後開始等待；不重疊或補跑過時 tick。scope 逐輪輪替，避免較後的 scope 永遠拿不到工作額度。入場預算只阻止啟動新工作，已開始的 bounded DB/worker 操作會等待收尾。

## 生命週期與輸出

每輪執行固定期間 enqueue，然後依 allowlist scope 執行既有 scheduler。相同 generation 不重建；當前來源的 failed 工作不會藉由重建重設五次 attempt cap。完整性錯誤會停止 host；contention 延至下一輪，不在同輪無限重試。

SIGINT、SIGTERM 或 stdin 的 `stop` 加換行會停止新工作，等待進行中的操作結束後 disconnect。Windows 自動驗證採 stdin 指令，避免把作業系統的強制終止誤稱為 graceful stop。

控制管線 EOF／close 也會停止排程；輸入／輸出錯誤會停止新工作並抑制後續輸出。訊號處理涵蓋啟動至 disconnect／terminal，重複訊號仍等待收尾。Terminal 在 disconnect 後才發送，cleanup 失敗只回固定原因與非零 exit code。每輪的 `partial` 只標記實際略過剩餘工作的停止或入場時間預算截斷；完成最後工作後才用完預算不會誤標。它不代表整個佇列是否已清空。

stdout 只有 `started`、`cycle`、`terminal` 事件及計數，不包含 scope、report/person/browser ID、SQL、設定內容或憑證。`recorded` 只代表報表結果已儲存；來源未完整時五項指標仍可都是 `unavailable/missing_data`。

## 驗證與回滾

```powershell
node scripts/wp20-report-host-disposable.mjs
```

驗證自行建立與清理 owned disposable PostgreSQL，以實際 child process、真實 worker 與真實計時測試兩輪去重、啟動 guard，以及 row-lock 等待中的停止。它沒有外部部署或正式資料操作。完整證據與未驗證項目見 `product-audit-20261012-handoff.md` 最新 host checkpoint。

建置前與執行前都核對固定產物清單。遇到殘留 `node_modules`、未知檔案、連結或非一般檔案會拒絕；建置器不會自動刪除這些項目，也不沿著連結覆寫目標。

建置先撤銷舊的完成標記，全部寫入後才建立包含各產物 SHA256 的 `build-seal.json`；啟動前逐檔核對。中斷建置或內容損壞不能靠檔名完整而通過。這是本機單一 writer 的建置完成檢查，不是數位簽章；建置與執行不得同時進行。

回滾先停止 host，再停用新啟動入口。保留已排隊／已完成報表、來源與失敗 attempt；不刪除資料、不倒填 coverage、不更改既有 payment／SSI gate。
