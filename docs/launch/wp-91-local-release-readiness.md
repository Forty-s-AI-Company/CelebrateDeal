# WP-91 本機 Release Readiness 與 Rollback Rehearsal

## 範圍

這是本機、可重跑的 release artifact 驗證與 rollback metadata rehearsal；不部署、不登入雲端、不讀取 `.env*`，也不代表 Production rollout 或 Production rollback 已驗證。

## 驗證內容

`release:verify:local` 會檢查：

- `package.json` 的既有 build／start scripts、`next.config.ts`、`vercel.json` 與 health route 是否存在且可解析；
- `.next` artifact 的 `BUILD_ID`、`required-server-files.json` 與 app route manifest；
- 排除 cache／trace 後的穩定檔案清單、大小與 SHA-256 checksum；
- 必要 runtime environment 的 key name 與 presence boolean，絕不輸出值、長度、hash 或前後綴。

缺檔、無效 deployment config 或預期 checksum 不符時會回傳固定錯誤代碼並以非零 exit fail closed。

## 指令

```powershell
npm run test:release-readiness
npm run release:verify:local
```

Rollback rehearsal 只接受兩個已驗證的本機 artifact 目錄；它先暫時將 candidate 標記為 active，再注入 candidate activation failure，最後確認 active metadata 已恢復 previous checksum。這是 metadata／artifact 切換演練，不會對 Vercel、DNS、Production database 或使用者流量做任何操作。

## 成功與失敗判讀

- `status=verified`：本機 artifact 與 repository deployment source-of-truth 一致。
- `status=rollback-rehearsed`：注入失敗後的 active metadata checksum 已回復 previous。
- `RELEASE_*`：本機 release gate 失敗；必須先修正 artifact 或 config，不能把失敗 candidate 視為可發布。

## 保留的上線前缺口

- Production deployment／traffic switch／cloud rollback receipt。
- 正式 secret injection 與外部 observability delivery。
- PayUni Sandbox 真實付款、退款與對帳 receipt。
- 正式資料庫 migration window 與回復授權。
