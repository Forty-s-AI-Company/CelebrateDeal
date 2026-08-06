# 付款、退款支援與事件升級 SOP（本機營運草案）

狀態：`DRAFT_LOCAL_ONLY`
適用範圍：CelebrateDeal 的付款、退款與付款 webhook 支援事件。
不適用範圍：本文件不是退款條款、法律意見、客服 owner 簽核、商家 onboarding 驗收或正式環境操作授權。

## 1. 安全原則與角色邊界

任何人都不得依客服對話、螢幕截圖或單一通知直接重送退款、重播 provider 操作，或將不明交易標記為已完成。交易、退款或 webhook 狀態不確定時，停止自動重試並升級。

| 角色 | 可以做的事 | 不可以做的事 |
| --- | --- | --- |
| 支援人員 | 建立去識別事件、回覆已受理、蒐集允許證據、通知 owner | 操作 provider、重送退款、要求完整卡號或登入資訊 |
| 財務管理員 | 依已核准流程檢視交易／退款投影、提出退款處理建議 | 在狀態不明時重送退款、越權操作正式 provider |
| 平台管理員 | 判讀 webhook／交易投影、執行已授權的 staging 診斷 | 用未驗證 callback 或客服敘述改寫帳務狀態 |
| Release owner | 核准正式環境操作、風險接受、回滾與結案 | 把本草案當作法律、客服或商家簽核 |

正式環境的付款、退款、provider 操作、資料庫修正或部署，均需 Release owner 的明確授權與對應 runbook；本機或 Sandbox evidence 不能替代它。

## 2. 事件分級與時限

| 等級 | 觸發條件 | 首次回應 | 升級對象 | 目標結案 |
| --- | --- | --- | --- | --- |
| P0 | 多筆可能重複扣款、退款錯帳、權限繞過，或付款服務全面不可用 | 15 分鐘 | 平台管理員與 Release owner | 以事件指揮流程決定 |
| P1 | 單筆金額／狀態不一致、webhook exhausted、退款長時間未完成 | 1 小時 | 財務管理員與平台管理員 | 一個工作日內有可稽核結論 |
| P2 | 一般退款進度詢問、已拒絕的重複操作、可安全重試的受控問題 | 1 個工作日 | 支援人員，再依條件升級 | 三個工作日內回覆或升級 |

P0／P1 必須建立事件紀錄；P2 若涉及任何狀態不確定或個資風險，也升為 P1。

## 3. 付款／退款事件處理矩陣

| 情境 | 判讀 | 允許操作 | 禁止操作 | 升級條件 | 結案證據 |
| --- | --- | --- | --- | --- | --- |
| 成功退款 | CelebrateDeal 與 provider 都顯示退款完成，金額與交易參照一致 | 記錄去識別結果、通知支援可回覆 | 再次送出同筆退款 | 金額、狀態或 audit 不一致 | 去識別交易參照、退款狀態、金額、一次 audit／事件投影 |
| 已完成退款的重複請求 | 終態為 `refunded` 或介面明確拒絕 `refund_already_processed` | 回覆已完成退款、保留拒絕原因分類 | 送出第二次退款、以空欄位繞過驗證 | 沒有明確終態或拒絕訊息 | 終態投影、拒絕分類、沒有新增退款／audit 的證據 |
| 部分退款與超額退款 | 部分退款後 provider 顯示可退款餘額；超額請求應被拒絕且餘額不變 | 只依核准金額提出一次申請、比對 provider 與站內投影 | 把超額失敗標成完成、以多次小額請求規避餘額 | 已退款／可退款金額不一致 | 原金額、已退金額、餘額、拒絕分類與重查結果 |
| provider 已接受、站內完成不明 | provider 與站內 webhook／付款投影不一致，或 callback 尚未可驗證 | 標記 `P1`、保留去識別參照、交平台管理員診斷 | 重播 provider、人工改寫帳務、發放額度或商品 | 超過作業窗口、重複／亂序事件、金額不同 | provider 封閉狀態、站內事件／交易狀態、調查結論與 owner 決定 |
| webhook `failed`／`retrying`／`exhausted` | 依事件狀態、retry count 與相同交易的後續狀態判讀 | `retrying` 期間觀察；`failed`／`exhausted` 建立 P1 並交平台管理員 | 直接重播 payload、略過驗簽、憑客服訊息改成 processed | `exhausted`、重複副作用、終態倒退或驗簽疑慮 | 去識別 event／transaction 參照、狀態、retry 分類、後續處置與無重複副作用證據 |

## 4. 必須停止與升級的條件

立即停止自動操作並升級平台管理員與必要 owner，若：

- 無法確認交易、退款或 webhook 是否為相同去識別參照。
- provider 與站內金額、狀態、退款餘額或 audit 不一致。
- callback 驗簽失敗、來源不明、重複或亂序事件可能影響終態。
- 支援人員被要求取得、傳送或保存完整付款資料、登入資料或原始 provider payload。
- 任何處置需要正式環境 payment／refund、部署、DB 修正、Secret、Token 或第三方設定。

不得因 SLA 壓力略過上述停止條件。

## 5. 證據最小化與資料保護

允許蒐集：事件等級、UTC 時間、環境分類、狀態分類、金額、幣別、短雜湊交易／訂單／event 參照、retry 分類、去識別錯誤分類、owner 與結案決定。

禁止蒐集或貼入工單：Token、Cookie、Authorization、HashKey／HashIV、完整卡號、有效期、CVV、銀行資料、完整 email／電話／姓名、原始 callback body、完整 provider response、IP、user-agent、截圖中的個資。

工單與交接一律以 synthetic 範例或短雜湊參照表示；若收到敏感資料，停止轉傳並依資料處理程序升級。

## 6. 事件紀錄與交接模板

```text
事件編號：
分級：P0 / P1 / P2
環境：local / sandbox / staging / production（production 需 owner 授權）
短雜湊參照：order / transaction / trade / webhook event
目前狀態：
金額與幣別：
已確認證據：
禁止或未執行操作：
升級角色與時間：
下一個安全檢查：
結案判定與 owner：
```

交接人必須說明「已知」、「未知」、「禁止重試的原因」及「下一位 owner 可安全做的唯一操作」。不得以「應該已退款」或「看起來成功」作為交接結論。

## 7. 結案與事後檢討

只有當處理結果與允許證據一致、沒有未處理的狀態衝突、必要 owner 已承接正式風險後才可結案。P0 與 P1 需在五個工作日內檢討：時間線、使用的去識別證據、重複副作用防護、客戶溝通、需要新增的測試或 runbook。

## 8. 已驗證來源與限制

- [WP-103 Sandbox payment and full-refund evidence](../ai-team/evidence/wp-103-payuni-sandbox-payment-refund.md)：成功付款、一次全額退款與 audit 觀測；非完整退款矩陣。
- [WP-104 duplicate-refund rejection evidence](../ai-team/evidence/wp-104-payuni-sandbox-duplicate-refund-reconciliation.md)：終態重複退款明確拒絕；不代表 Production readiness。
- [WP-105 partial-refund reconciliation evidence](../ai-team/evidence/wp-105-payuni-sandbox-partial-refund-reconciliation.md)：部分退款、超額拒絕與 provider 重查；不代表完整 CAT04 matrix。

這些來源僅支持 Sandbox 或 staging 範圍內的明確主張。本 SOP 不能用來宣稱法律條款、客服驗收、merchant onboarding、Production payment／refund 或整體商業上線已完成。
