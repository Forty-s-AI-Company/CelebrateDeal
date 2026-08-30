# Affiliate gross／net reference local product evidence

日期：2026-08-07（Asia/Taipei）  
狀態：`LOCAL_PRODUCT_CLOSURE_EVIDENCE`

## 本輪完成

`AffiliateCommission` 現在明確保存兩個不同概念：

- `commissionBaseAmountCents`：付款成立時的 gross 售價快照，佣金仍只依此計算。
- `netReferenceAmountCents`：只供對帳畫面參考的 provider-net 值，計算為「provider net − 已退款本金 + 明確退回的金流／平台費」，退款後會同步更新。

佣金原始金額、append-only ledger、payout 與 gross commission base 不會被 net reference 改寫。既有資料 migration 會由 `orderAmountCents` 回填 gross base，並從同一付款交易及已處理退款費用回填可追溯的 net reference。

目前沒有 authoritative tax 欄位，因此沒有臆測稅額；稅務仍是 CAT04／CAT10 的外部或人工財務項目。

## 驗證結果

- loopback disposable PostgreSQL：22 migrations deploy，`migrate status` up to date。
- `payment-webhooks.test.ts`：38/38 PASS，涵蓋 paid snapshot、partial refund、full refund、重送退款與既有 accounting regression。
- net reference／兩個聯盟頁面／Prisma inventory：9/9 PASS。
- `npm run typecheck`、`prisma validate`、scoped ESLint（0 errors）、`npm run secret:scan`：PASS。
- readiness reconciliation：命令 PASS，但 canonical total 仍為 73.5，`score_change=0`。

## 為什麼分數沒有增加

這是本機產品 closure 證據，不是 CAT04 的外部 staging／PayUni receipt，也不是 CAT10 的真人 owner 簽核。canonical readiness snapshot 只有在必要 evidence predicate 真的成立時才更新 CAT 分數；因此本輪只能改善產品與可追溯性，不能把 6.0／4.5 未驗收項目改成 PASS。

本證據不代表 staging、Production、付款、退款、部署或人工簽核已完成。
