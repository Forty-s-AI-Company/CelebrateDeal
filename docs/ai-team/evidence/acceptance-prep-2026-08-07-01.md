# ACCEPTANCE-PREP-2026-08-07-01：CAT04／CAT10 驗收 packet

日期：2026-08-07（Asia/Taipei）  
狀態：`READY_FOR_AUTHORIZED_EXTERNAL_AND_MANUAL_ACCEPTANCE`

這份 packet 是交接與驗收輸入規格，不是 PASS，也不會替真人簽核。它把目前 73.5 尚未加分的必要條件固定成可追溯欄位，避免再用 local tests、coverage 或 synthetic fixture 代替外部／人工 evidence。

## CAT04：目前缺的是真正外部證據

要從 `6.0` 成為至少 `7.0`，需要同一個新鮮且授權的非 Production scope 同時留下：

1. staging／Preview identity、ready state、source lineage 與 sanitized digest。
2. 一次 read-only database reconciliation，證明候選筆數、交易狀態與零寫入／零 lock 副作用。
3. Official PayUni Sandbox receipt，證明 checkout／退款狀態、金額相符、idempotency 與 exactly-one refund record。
4. Provider 與 CelebrateDeal ledger reconciliation closure，以及 cleanup proof。

WP-188、WP-196、WP-197 都已如實保留 no-go；Vercel 唯讀 connector 目前是 authorization-blocked，不能被分類為 provider PASS，也不會重試相同路徑。

## CAT10：目前缺的是真人與外部 owner evidence

五個不可由 AI 代簽的 owner 是：`merchant_owner`、`support_operator`、`finance_owner`、`privacy_legal_owner`、`release_owner`。需要留下：

- 真實授權商家的八階段 onboarding rehearsal。
- Support／finance SLA、退款 handoff、升級與 rollback 邊界接受。
- 條款、隱私、退款政策的 privacy/legal／finance／support review。
- 非 Production scope 的 external monitoring receiver 與 alert-delivery receipt。
- Release owner 的 go/no-go 與 rollback acceptance。

目前 WP-195 只有 synthetic five-owner contract；`/policies`、`/support`、`/merchant-onboarding` 仍明確標示 `DRAFT`／`HUMAN REVIEW REQUIRED`，因此 CAT10 維持 `4.5`。

## 安全限制

本 packet 不保存姓名、email、credential、Token、Cookie、付款資料、原始 provider payload 或正式客戶資料。未執行付款、退款、Production、部署或正式資料庫操作；未重試 FIN-08AA、FIN-08AB、WP-196、WP-197 或其他 terminal path。只有在上述 evidence 真實存在並通過 release reconciliation 後，才可改變 score。
