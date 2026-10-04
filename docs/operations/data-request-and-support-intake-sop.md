# 資料請求與客服入口 SOP（非正式環境草案）

狀態：`DRAFT_LOCAL_ONLY`；privacy／support／release owner acceptance：`PENDING_HUMAN`。本文件定義接案與安全停止條件，不授權讀取、匯出、修改或刪除正式客戶資料。

## 入口與分級

支援入口為產品的 `/support`。支援人員只建立事件編號、請求類型（access、correction、export、deletion、payment／refund、security）、收到時間及去識別參照。正式身分驗證方式、回覆時限、適用地區與保存期限仍由 privacy owner 決定；目前不向請求人承諾具體法定期限。

| 等級 | 判斷 | 首次處置 | 升級 |
|---|---|---|---|
| P0 | 疑似未授權資料揭露、跨租戶存取、批量付款或身分事件 | 停止相關寫入與轉傳，保留最小去識別事件，通知平台與 release owner | 由事件指揮者決定隔離、通知及恢復 |
| P1 | 身分歸屬不明、資料刪除與交易／稽核保存衝突、退款或 provider 狀態不明 | 凍結資料變更；分類待核對欄位與 owner | privacy owner；涉及帳務時加 finance owner |
| P2 | 一般使用說明與無敏感資料的狀態詢問 | 用既有公開資訊回覆並記錄結果 | 需要私有資料或政策判斷時升 P1 |

既有 [付款退款事件 SOP](payment-refund-support-incident-sop.md) 的時限是營運草案，正式 SLA 仍待真人核准。

## 資料請求處理

1. **接案。** 只記請求類型、環境、時間、短雜湊參照與回覆渠道類別。勿將姓名、email、電話、Cookie、Token、原始 payload 或完整付款資料複製到工單、聊天或 repository。
2. **確認主體與租戶。** 身分與代理權的正式驗證方法需 privacy owner 核准。未確認前只回覆「已受理、待驗證」，不提供資料存在性或內容。
3. **盤點資料類別。** 分別記帳號、商家、公開互動、訂單與付款參照、稽核、安全事件、第三方 processor；對每類記系統 owner、保存規則、例外、export／correction／deletion 能力及 UNKNOWN。
4. **判斷衝突。** 交易、退款、發票、稽核或安全事件若需要保留，標為 `PENDING_HUMAN`，由 privacy 與 finance owner 決定可執行範圍。不得以刪除請求直接移除帳務或安全證據。
5. **執行前 gate。** 需有已核准的請求人身分、資料範圍、環境、操作預覽、回復點、雙人審查與 release owner 授權。正式資料的匯出、修改和刪除在此 gate 前均停止。
6. **結案。** 保存去識別 decision、處置範圍、例外、驗證與回覆時間；不在收據中放原始資料或密鑰。

## 可直接使用的去識別交接欄位

```text
事件參照：opaque:<short-digest>
環境：local / sandbox / staging / production
類型：access / correction / export / deletion / payment / refund / security
等級：P0 / P1 / P2
主體與租戶驗證：UNVERIFIED / VERIFIED_BY_APPROVED_PROCESS
資料類別與系統 owner：
保存／刪除例外：UNKNOWN / PENDING_HUMAN / APPROVED_REFERENCE
目前允許的下一步：
禁止或未執行操作：
privacy／finance／support／release owner 決議參照：
結案與回覆參照：
```

此模板只記決議參照，不是核准本身。公開 Terms／Privacy／Refund 草稿與 [CAT10 review matrix](../launch/cat10-policy-review-matrix-20260821.md) 仍須真人確認版本、生效日期、適用地區、資料保存和退款資格。
