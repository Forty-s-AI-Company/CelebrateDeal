# CelebrateDeal 全漏斗十步黃金旅程最終驗收報告

日期：2026-09-08

模式：`ai-team-lite`／`PRELAUNCH_DEV_AUTONOMOUS`

範圍：本機 deterministic integration rehearsal；未連線 Production、正式付款、正式資料庫、正式發票或銀行服務。

## 驗收結論

`src/lib/golden-webinar-funnel-journey.test.ts` 已擴充為連貫的 10 個步驟，使用同一 synthetic 學員、同一 `vendorId` 與逐步累積的 journey state，串接漏斗報名、常青偽直播、互動、觀看自動化、諮詢、360 CRM、ECPay、電子發票、推廣結算與商家功能開關。

最終結果：**LOCAL REHEARSAL PASS**。10/10 步驟與所有指定全庫品質門檻均通過。本結果證明本機程式契約與 deterministic lifecycle 成立，不代表 Production readiness，也不代表正式第三方服務已完成交易驗證。

## 十步黃金旅程結果

| 步驟 | 驗證內容 | 結果 |
| --- | --- | --- |
| Step 1 漏斗建置 | 高客單範本、輪播、倒數、三欄價格卡；同一 idempotency key 不重複建立報名 | PASS |
| Step 2 常青偽直播 | JIT 5 分鐘倒數、固定 cohort、`1800.5` 秒精確 offset、快轉與倍速播放 fail closed | PASS |
| Step 3 互動套件 | 投票百分比、deterministic 抽獎、HMAC/hash 核銷碼、只顯示脫敏姓名的買家跑馬燈 | PASS |
| Step 4 觀看與自動化 | 合法心跳累積 1,800 秒，觸發 `webinar_attended_duration_gte`、9 折券、LINE 動作與「高意向潛客」標籤 | PASS |
| Step 5 諮詢預約 | 產生可用時段、保存問卷快照、已預約時段不再出現在可用清單 | PASS |
| Step 6 學員 360 CRM | 聚合報名、觀看、自動化、券、標籤、預約問卷、顧問備註，並保存 `closed_won` 成交狀態 | PASS |
| Step 7 ECPay 金流 | SHA-256 `CheckMacValue`、constant-time 簽章驗證、付款成功 callback normalization | PASS |
| Step 8 B2C 電子發票 | 手機條碼／自然人憑證校驗、5% VAT 四捨五入、防偽加密 envelope 與跨租戶拒絕 | PASS |
| Step 9 佣金與出款 | 第六筆套用 20% 階梯佣金、10% 所得稅、2.11% 二代健保、勞報核准、CSV 公式注入防護 | PASS |
| Step 10 模組開關 | 五大受控模組映射、導航自適應隱藏、直接路由顯示未啟用邊界、跨模組 Prisma 契約 | PASS |

## 安全、租戶隔離與 PII 指標

- 所有 journey 資源均以 `vendor-golden` 串接；Prisma 契約檢查涵蓋 `@@unique([vendorId, id])` 與核心模型存在性。
- 自動化客戶識別使用 vendor-bound HMAC；同一 email 不以明文作為跨模組 durable identity。
- 發票請求、身分證字號與銀行帳號以 tenant-bound encryption envelope 保存；換用其他 `vendorId` 解密會 fail closed。
- 抽獎兌獎碼僅以 hash 比對；測試明確確認 envelope/hash 不包含原始敏感值。
- 買家跑馬燈只採脫敏姓名，不含 synthetic email；CSV 對 `= + - @` 起始字元加上 apostrophe，避免試算表公式注入。
- ECPay callback 先驗證 `CheckMacValue`，再正規化為付款事件；本次只使用公開 sandbox 測試參數，未讀取或輸出任何 `.env*`、Token、Cookie 或正式 Secret。
- **無 PII 外洩聲明：**測試僅使用 `example.test`、合成姓名、合成帳號與測試用加密材料；沒有讀取、傳送或寫入正式客戶資料，輸出紀錄亦未包含正式 PII。

## 實際驗證紀錄

| 命令 | 結果 |
| --- | --- |
| `npx vitest run src/lib/golden-webinar-funnel-journey.test.ts` | PASS，1 file／10 tests |
| `npm run test:interactions` | PASS，27 files／280 tests |
| `npm run test:contracts` | PASS，924/924 tests |
| `npm run typecheck:strict-index` | PASS |
| `npm run typecheck` | PASS |
| `npm run secret:scan` | PASS，`secret_scan_passed` |
| `npx eslint src/lib/golden-webinar-funnel-journey.test.ts src/app/api/affiliates/payouts/export/route.ts` | PASS |

## 變更摘要、風險與回滾

- 黃金旅程由舊版 6 步＋契約檢查，改為明確的 10 個 sequential journey steps。
- `src/app/api/affiliates/payouts/export/route.ts` 僅將既有 `csvCell` 匯出，讓黃金旅程直接驗證正式 CSV 防公式注入邏輯；函式行為未改變。
- 本次沒有執行 Production deployment、正式金流、正式發票、正式寄信、migration write 或外部資料異動。
- 回滾時可反向套用本 checkpoint commit；若只回滾本次擴充，需同步還原黃金旅程、驗收報告與 `csvCell` export，避免測試引用失效。
