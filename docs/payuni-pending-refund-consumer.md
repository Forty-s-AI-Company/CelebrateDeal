# 精確 PENDING_REFUND 交接

來源：分支整合 Q1 指定 `35d8f59341bcb776e548c69fe874a3f4d1fe2528`。保留原始付款 handoff，使用現行 canonical vNext 工作流程執行下列單一 QA command；不恢復舊 launcher、router 或排程。

此 consumer 不建立付款、不挑最新交易、不直接呼叫退款 provider。退款透過目前平台管理員 UI、原有 session、MFA、CSRF 與退款 reservation／accounting 契約進行。

## 執行條件

- 固定 `celebrate-deal-staging.carry-digital-nomad.in.net`；部署為 Preview，PayUni 為 sandbox，executor 已啟用，並通過目前 staging 專案／資料庫身分檢查。
- 精確 candidate source SHA，以及固定 WP4 synthetic vendor、buyer purpose、目前 source metadata 的交易。三個 handoff reference、金額與 processed 付款 callback 必須完全匹配。
- handoff 為最近 24 小時建立的已付款 PENDING_REFUND；尚無退款紀錄。歷史交接缺少目前來源證明時拒絕接手，不能選另一筆代替。
- 平台管理員與有效 MFA；商家 owner session 不足以操作退款。交易必須仍在 dashboard 的目前範圍；找不到就停止。
- 使用核准方式注入 `JOB_SECRET`、`PAYUNI_SANDBOX_MERCHANT_ID`、`PAYUNI_SANDBOX_HASH_KEY`、`PAYUNI_SANDBOX_HASH_IV`、`PAYUNI_QA_FINANCE_EMAIL`、`PAYUNI_QA_FINANCE_PASSWORD`。必要時注入當次六碼 `PAYUNI_QA_FINANCE_OTP`；不使用 recovery code。
- `PAYUNI_ENV=sandbox`、`PAYUNI_SANDBOX_QA_ENABLED=true`、`PAYUNI_SANDBOX_REFUND_ENABLED=true`。不讀取 `.env*`、不輸出注入內容、不匯出 cookies 或 browser traces。

```sh
node scripts/payuni-sandbox-pending-refund-consumer.mjs \
  --handoff-name <既有交接檔名> \
  --transaction-id <精確合成交易ID> \
  --order-number <同筆合成訂單號碼> \
  --source-sha <已驗證部署的完整40碼SHA>
```

檔名僅接受固定 `.ai-team/reports/payuni-payment-handoff` 中的原始 timestamp-reference JSON。原始 handoff 不覆寫；通過後以 exclusive create 寫入新的去識別化 completion receipt。

## 完成與停止

同一 browser context 先開兩個分頁保留同筆真實表單。第一頁提交，等待指定交易全額 refunded、唯一 processed RefundRecord、非空 provider identity 與相符付款 callback，再以簽章 sandbox query 確認全額退款狀態 `1`。部分退款 `2` 與未知狀態 `8` 不通過。

第二頁重送原始同筆表單，必須回到 `refund_already_processed`，且權威資料庫證據仍是同一金額、同一筆退款。任何 pending、對帳、權限、MFA、來源、環境或 provider 異常都停止，不重新退款。失敗只回封閉 stage，不能把 provider response、交易 ID、登入資料寫進證據。

本輪目前已通過 unit／route 及 disposable DB 回歸；provider 傳輸替身僅證明本機帳務，不等同外部整合。真實 staging browser、sandbox query 與完整 Q1 acceptance 仍待核准注入與指定現行交易實際執行，整體 Goal 保持 IN_PROGRESS。
