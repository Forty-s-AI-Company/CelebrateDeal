# Staging 首次成功路徑 runner 與合成商家清理（O-13／R-10）

## 1. runner 做什麼

`.github/workflows/staging-first-success.yml`（手動觸發，只限受保護的 `master`）在固定 staging alias 上，用合成資料走一次 O-13 首次成功路徑：邀請 → 註冊 → 歡迎問卷 → 商品 → 報名表 → 影片 → Email 模板 → 直播（排在 3 天後）→ 專案發布 → 匿名報名 → 買家 Email 確認。程式在 `scripts/staging-first-success.mjs`，ops 端點是 `JOB_SECRET` 保護的 `/api/admin/ops/first-success/invite` 與 `/status`（`src/lib/staging-first-success.ts`）。信箱一律是 Resend 測試信箱：

- 商家 owner：`delivered+cdfs-owner-<run id 24 位小寫 hex>@resend.dev`
- 買家：`delivered+cdfs-buyer-<run id>@resend.dev`
- 工作空間：`Synthetic workspace <run id 前 10 碼>`，註冊後的 slug 是 `synthetic-workspace-<run id 前 10 碼>-<uuid>`

觸發方式（`<sha>`、`<host>` 與 staging browser smoke 相同，見 `docs/domain-workflows.md`「Staging browser smoke」）：

```
gh workflow run staging-first-success.yml --ref master -f source_sha=<sha> -f deployment_host=<host>
```

## 2. 為什麼要清理

每跑一次就留下一個合成商家、owner 帳號、已發布專案、3 天後的直播與一筆已驗證報名。之後 staging email job 會在開播前寄提醒信到 resend.dev 測試信箱，吃掉每輪寄送額度；商家清單也越來越長。

## 3. 清理機制（R-10）

程式：`src/lib/staging-first-success-cleanup.ts`、`POST /api/admin/ops/first-success/cleanup`、`scripts/staging-first-success-cleanup.mjs`、`.github/workflows/staging-first-success-cleanup.yml`。

### 3.1 只認 runner 自己的資料

一個商家必須**同時**符合以下條件才會被處理，而且在改動它的那個交易裡、鎖住商家列後再檢查一次：

1. 商家登入 Email 完全等於 `delivered+cdfs-owner-<run id>@resend.dev`（沿用 `FIRST_SUCCESS_OWNER_EMAIL` 的錨定 regex，大小寫、長度、前後綴都不能差）。
2. 商家 slug 是同一個 run id 推導出的 `synthetic-workspace-<run id 前 10 碼>-<uuid>`。
3. 只有一位成員：狀態 active 的 owner，其 User 的 Email 與商家相同，而且這個 User 沒有其他商家的成員身分。
4. 沒有任何財務紀錄：訂單、退款、付款交易、庫存保留、收款帳號、付款方式、訂閱、發票／電子發票／折讓、月結與調整、出款、佣金（聯盟、課程、平台推薦）、聯盟結帳快照、付款 webhook、客服退款交接。runner 從不結帳；有這些紀錄的商家**跳過並在收據回報**，不改動。

不以名稱、標題或其他文字比對。名稱相似、Email 不同、slug 不同、多了成員或有訂單的商家都不會被動到（PostgreSQL 測試逐一驗證）。

### 3.2 先停用，再刪除

- **停用（`deactivate`，預設）**：用既有的 F-036 商家凍結（`Vendor.suspendedAt`），`suspendedReason` 固定為 `staging_first_success_cleanup`，同一交易撤銷該商家的學員 portal token，並寫一筆 `vendor_suspended` 稽核（actor `job:staging-first-success-cleanup`）。效果與平台凍結相同：email 與 LINE job 不寄、不 claim（列維持 queued）、直播／報名表／專案公開頁 404。資料不刪。
- **刪除（`delete`，只能手動）**：只處理「由這個清理停用、而且停用滿 7 天」的商家（`FIRST_SUCCESS_CLEANUP_RETENTION_DAYS`）。每個商家一個交易：鎖住商家列、重新檢查 3.1 全部條件、刪除商家（直播、報名、專案、寄送紀錄等依 FK cascade 一起刪除），再刪除那位 owner User；任何一步失敗（例如某個 FK 拒絕）整個商家回滾、計為 `failed`，繼續下一個。商家的稽核紀錄保留（`vendorId` 變成 NULL），另寫一筆 `staging_first_success_vendor_deleted`。
- 平台管理員自己凍結的商家（原因不是上面的固定值）永遠不會被刪除；停用模式也不會改它的原因。
- 每次呼叫最多處理 25 個商家，多的留到下一次（收據 `truncated: true`）。重複執行是冪等的：已停用的不再停用，已刪除的不會再出現。

### 3.3 執行邊界

- route 走 `authorizeWp4Ops`：timing-safe `JOB_SECRET`、`isWp4BoundNonProductionRuntime()`（`VERCEL_ENV=preview`、`PAYUNI_ENV=sandbox`、`WP4_SANDBOX_EXECUTOR_ENABLED=true`、staging 專案 ID、staging origin、staging 資料庫身分）、exact source SHA、不接受 query 與 body。唯一輸入是 `x-celebratedeal-first-success-cleanup-mode` header（`deactivate`／`delete`；沒有時視為 `deactivate`）。
- `runFirstSuccessCleanup` 在任何查詢前再檢查一次 runtime，Production 一律回 REFUSED、不讀不寫（單元與 PostgreSQL 測試都驗證）。
- 腳本先驗 Preview lineage 與 alias（與 runner 相同），通過後才帶 `JOB_SECRET` 打 alias。

### 3.4 收據

route 回傳、腳本寫入 `$RUNNER_TEMP/celebratedeal-staging-first-success-cleanup-<mode>.json` 並上傳 artifact；同一份也寫進 AuditLog（`staging_first_success_cleanup`，`vendorId` NULL）。內容只有模式、結果（`COMPLETED`／`PARTIAL`）、計數（檢查、停用、刪除、已停用、保留期內、各類跳過、失敗、受影響的直播／報名／專案／待寄信件／owner 帳號）與 run id 前 8 碼，不含 Email、名稱、slug、id 或 secret。

## 4. 怎麼用

- **自動停用**：`staging-first-success.yml` 在 journey 步驟之後（不論 journey 成敗，取消時不跑）執行 `node scripts/staging-first-success-cleanup.mjs --mode=deactivate`，所以這一輪與之前留下的合成商家都會被停用，不會再寄提醒信。這一步不刪資料。
- **手動停用或刪除**：

  ```
  gh workflow run staging-first-success-cleanup.yml --ref master -f source_sha=<sha> -f deployment_host=<host> -f mode=deactivate
  gh workflow run staging-first-success-cleanup.yml --ref master -f source_sha=<sha> -f deployment_host=<host> -f mode=delete
  ```

  兩個 workflow 共用 concurrency group `staging-first-success`，清理不會和正在跑的 journey 重疊。刪除前不需要另外備份：只會刪掉停用滿 7 天、沒有任何財務紀錄的合成商家。
- **看結果**：workflow log 的 `staging_first_success_cleanup mode=… result=…` 一行，或 artifact 的 JSON。`failed` 大於 0 時 workflow 以 exit 2 結束；`skipped.financialRecords` 或 `unexpectedMembership` 大於 0 表示有 runner 商家被人用過，請到 `/admin/vendor-features` 人工確認，清理不會碰它。

## 5. 不在範圍內

- `/admin/merchant-invitations` 的邀請紀錄存在 append-only AuditLog，清理不刪除。列表顯示最近 14 天（一般邀請的有效期）內建立的全部邀請（上限 500 筆），更早的只列最近 30 筆歷史；runner 的邀請 30 分鐘就過期、註冊後標為「已註冊」，14 天後自然移出主要清單，不會無限變長。
- 其他 staging 合成資料（#543 盤點的 4 個商家、Stream 影片等，R-08）不符合 3.1 的條件，不會被這個清理動到；它們的處理見 `docs/goal-beta-prep-2026Q4/OWNER-ACTIONS.md`。
