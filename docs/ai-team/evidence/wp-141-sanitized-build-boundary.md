# WP-141 — Single-Attempt Sanitized Next Build Boundary

## 結果

WP-141 已消耗且僅消耗一次新的 OS-temp hermetic `next build --webpack` 嘗試。建置輸出由預先固定的 streaming sanitizer 以 pipe 接收，沒有寫入檔案、receipt、console 或交給 Agent；workspace 的 `.next`、source、config、package、lockfile 與既有 dirty changes 均未被修改。建置完成後，runner 在寫入 sanitized receipt 前誤將合法的 `rawOutputPersisted=false` 欄位判為不安全，因而未能保存本次執行結果。

這是 **`SANITIZED_RECEIPT_WRITE_FAILURE_EXACT_NO_GO`**，不是 build PASS，也不是 root-cause mapping。為遵守 single-attempt 契約，修正欄位 guard 後沒有重跑建置；既有 temp mirror 與 node_modules junction 已在 guard failure 前清除。

## 可驗證範圍

- sanitizer、Windows/POSIX 相對路徑遮罩、symbol/span allowlist、長行界限、network-denial preload 與 fail-closed classification self-tests：8/8 PASS。
- scoped ESLint：PASS。
- `git diff --check`（WP-141 owned runner/test）：PASS。
- staged index：空。
- raw build output、source snippet、absolute path、`.env*`、secret、cookie、token 與 generated content：未保存。
- 第二次 build：未執行；`noRetry=true`。

## 限制與分數

由於 receipt guard failure 發生在記錄 execution result 前，exit code、normalized diagnostic fields、pre/post dirty fingerprint、repository `.next` metadata 與 network-denial marker 均採 fail-closed `NOT_AVAILABLE`，不得從缺失證據推論。CAT09 維持 **6.5/10**，CAT06 維持 **7.0/10**，總分維持 **71/100**；任何 Gate、Sandbox 或 Production readiness label 均不變。

## 修復與 rollback

同一 WP 已修正 receipt guard：只拒絕精確 raw 欄位名稱，允許必要的布林遮罩欄位。修復沒有重新執行 build。Rollback 僅移除 WP-141 新增 runner、test、receipt 與本 evidence；不得觸碰既有 artifacts、repository `.next` 或其他 dirty paths。

## 後續停止條件

本 WP 不再重跑 build。若需要新的 diagnostic result，必須由 Sol 另行規劃新 WP，並重新定義一次性執行與 receipt-failure recovery contract；在此之前不得宣稱 CAT09 7.5、build readiness、deployment readiness 或 Production readiness。

## AGY Fast

AGY Fast 兩次均無 structured output，最後狀態為 `FIRST_OUTPUT_TIMEOUT`，已保存為 `TOOL_BLOCKED`。這不能取代 deterministic evidence，也不會把本 WP 的 fail-closed 結果改成通過。
