# REL-20260821-PAYUNI-CALLBACK-HOST-PREFLIGHT

日期：2026-08-21（Asia/Taipei）
Source RC：`352a3dc`
Environment：non-Production Staging／PayUni Sandbox configuration
Result：`BLOCKED`

Machine-readable receipt：`rel-20260821-payuni-callback-host-preflight-evidence.json`，既有 provider receipt validator 結果為 `PASS`，receipt result 保留為 `BLOCKED`。

## Sanitized receipt

- Check：只讀 staging callback-host health preflight。
- Observed error class：`PayUniCallbackHostError`。
- Network requests：`1`，只用於 callback host 的 `/api/health` reachability check。
- `paymentRequests=0`
- `refundRequests=0`
- `callbackReplays=0`
- `productionOperations=0`
- Raw response、URL、credentials、Token、Cookie、order／trade reference 均未保存或輸出。

## Interpretation

這次 preflight 沒有建立 Sandbox 訂單、付款、退款或 callback replay，因此不能產生 PayUni reconciliation receipt。PayUni Sandbox gate 維持 `PENDING_EXTERNAL`；current staging lineage、migration、backup／restore／rollback 與 provider reconciliation 仍未證明。

同一路徑不重試。下一次執行必須先由 owner 修正或提供可公開連線、明確 non-Production 的 staging callback host，並留下受控 authorization record 與 sanitized evidence。

## Safety boundary

- 未讀取或輸出 `.env*` 內容、密碼、Token、Cookie、正式 Secret、正式客戶或付款資料。
- 未操作 Production、正式付款、正式退款、正式寄信、資料庫寫入、部署或 callback replay。
