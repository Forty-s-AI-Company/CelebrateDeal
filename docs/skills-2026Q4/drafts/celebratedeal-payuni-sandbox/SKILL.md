---
name: celebratedeal-payuni-sandbox
description: 處理 PayUni 付款、回呼 Notify／Return、退款、Token 綁卡，或要執行／解讀 PayUni Sandbox 驗證 runner 與收據時使用；規範真實欄位語意、既有 runner 入口與禁止在對話出現卡號或金鑰。
---

# CelebrateDeal PayUni Sandbox

## 何時用
修改 `src/lib/payment-providers/payuni*.ts`、`payment-webhooks.ts`、`payment-method-setup.ts`、退款或對帳程式；規劃或執行 Sandbox 驗證；撰寫 PayUni 相關收據。

## 必讀文件
- `docs/review-2026Q4/13-payments-finance.md`（B03-01、04、12、13、17）與 `14-data-migration.md` B04-13。
- `docs/launch/payuni-token-contract-20260929.md`（Token 申請前提）。
- `docs/launch/sandbox-payment-only-runner.md`、`secure-staging-runner.md`、`sandbox-payment-receipt-20260928.md`。
- `docs/domain-workflows.md`「歸因與佣金」。

## 檢查清單
- [ ] 回呼的外層 `Status`（通訊結果）與 `TradeStatus`（交易結果：0 取號、1 已付、2 失敗、3 取消、4 逾期、9 未付）是兩件事；只看 `Status=SUCCESS` 會把失敗交易當成功（B03-01）。依官方文件與 adapter 測試為準，不以舊註解為準。
- [ ] 真實 PayUni 回呼沒有 `EventType`、`EventId`、`NetAmount`、`GatewayFee`；缺漏時要明確處理（不可把 0 當成實際手續費，B03-04）。測試固定樣本必須用真實欄位格式，不能只用合成的 `EventType`／`EventId`。
- [ ] 事件冪等鍵不可只用 TradeNo 而吞掉同一交易的後續退款／爭議通知（B04-13）。
- [ ] 金額、幣別只來自伺服器紀錄；回呼金額與既存交易比對。
- [ ] 既有入口：`npm run qa:payuni:sandbox`（`scripts/payuni-sandbox-external-qa.mjs`）與 `npm run secure:staging:wp4`（`scripts/mvp-payuni-sandbox-e2e.mjs`）；受保護 runner 只經 GitHub `Secure staging validation` 與 Environment 注入密鑰。不得自創繞過。
- [ ] Token 綁卡前提：信用卡 Token API 與幕後功能需向 PayUni 申請（07、05 號申請書，含綁定 IP），Sandbox 商店是否已開通須先在後台核對；`CreditToken`、`CreditHash`、商店金鑰、`BuyerToken` 不可混用；首次綁定走真實首次交易，不是零元 setup。
- [ ] 收據格式：schema 名稱、environment=sandbox、result、failure 分類、各關卡 passed/failed/unknown、refund/reconcile 計數；只含允許清單欄位。

## 禁止事項
- 不在對話、文件、log、收據貼卡號、CVV、HashKey／HashIV、MerKey、Token 或簽章原文；不讀 `.env*`。
- 不對 Production 商店或正式環境付款／退款；不重送結果未明的來源訂單，不把未知結果改判失敗。
- 不用正式商店的截圖或設定推論 Sandbox 狀態。

## 完成證據
runner 收據檔路徑與 schema、run id 或本機命令與 exit code、單元測試清單；外部 Sandbox 沒跑就寫「未執行」，本機契約測試不得宣稱為外部 PASS。
