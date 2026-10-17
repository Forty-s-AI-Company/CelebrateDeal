# Product audit Goal：剩餘工作與解鎖輸入

狀態：部分解鎖，IN_PROGRESS。2026-10-12 D-1 已核准，D-2～D-6 延後但不形成全域阻擋；下表保留原稽核歷史，以 product-audit-20261012-handoff.md 為最新狀態。這不是縮減 Goal，也不是完成報告。

本次重新核對指定基底 efb8b7e9、Goal Plan 逐 WP 補充合約與現有 evidence。WP-06、07、10 及 WP-01 兩個子項的 acceptance 都是 READY，重新計算來源 snapshot 皆吻合；證據見 `docs/ai-team/evidence/product-audit-20261011/remaining-work-audit.json`。完整完成 3/20；其餘 17 項如下。沒有正在等待結果的測試／review／Next server handle，不能將決策等待稱為執行中驗證。

## 剩餘 17 個 WP

| WP | 目前證據／狀態 | 解鎖條件 |
| --- | --- | --- |
| 01 | 無專案 recovery、諮詢啟用子項 READY；發布與完整 E2E 未完成 | D-1：專案單一發布，或雙層發布加檢查。未替 owner 選分支 |
| 02 | WAITING_AUTHORIZATION | D-2 金流定位與法遵、D-3 PayUni 核准狀態、WP-01 |
| 03 | WAITING_AUTHORIZATION | D-5 核准條款／隱私／退款正文、版本、生效日。不能刪草稿標示冒充正式政策 |
| 04 | WAITING_AUTHORIZATION | D-6a scheduler 盤點、責任人、時區、非 Production target／範圍。repo staging crons 為空，不代表外部沒有 scheduler |
| 05 | WAITING_AUTHORIZATION | 核准既有 `WP-05/scope-proposal.md`：短效加密草稿 table／additive migration，以及不可信來源與儲存失效時的安全契約。既有提問仍待回答 |
| 08 | WAITING_DEPENDENCY | WP-01、05 完整驗收；WP-06 已完成。不能覆寫尚未定案的發布／表單用語 |
| 09 | WAITING_DEPENDENCY／WAITING_AUTHORIZATION | WP-08、17 與模板內容核可；不能把僅新增模板當成可發布驗收完成 |
| 11 | WAITING_AUTHORIZATION（缺拓撲輸入） | 非 Production 代理鏈、origin 是否可直連、各代理覆寫哪些 IP 標頭的可信證據；原 plan 明定缺输入等待 |
| 12 | WAITING_AUTHORIZATION | D-6b 發票供應商或暫不開放的明確決議、WP-04；不自行選隱藏分支 |
| 13 | WAITING_DEPENDENCY／WAITING_AUTHORIZATION | D-4、WP-04、08、LINE Sandbox 可用性與核准注入方式；WP-06 已完成。不要提供憑證值 |
| 14 | WAITING_DEPENDENCY／WAITING_AUTHORIZATION | WP-05、13、17、A/B 核可與流量；合成測試不能證明真實成效 |
| 15 | WAITING_DEPENDENCY | WP-08 與相關 renderer ownership 釋放 |
| 16 | WAITING_DEPENDENCY | 其他 19 個 WP 完整驗收；未取得任何縮減 Goal 的決議 |
| 17 | WAITING_DEPENDENCY／WAITING_AUTHORIZATION | D-1、WP-01→02、WP-04；不能以只生成頁面替代可播放／提醒送達驗收 |
| 18 | WAITING_DEPENDENCY | WP-04；結帳事件仍需獨立深度審查，Sandbox enqueue 不能當成送達 |
| 19 | WAITING_AUTHORIZATION／WAITING_DEPENDENCY | D-4 選 SMS 或 Email＋LINE、WP-13、供應商／成本／計量資料 |
| 20 | WAITING_AUTHORIZATION（缺指標契約） | 分母、完看門檻、live/replay 時窗、個人識別與事件來源。現有來源不足以計算五項要求指標；事件寫入超出原 scope，需先有精確提案與核可 |

`WAITING_DEPENDENCY` 為此工作表描述，repository Goal 保持 IN_PROGRESS；不是修改 Goal protocol 的 enum。

## 可先回覆的輸入

1. **D-1**：選「專案單一發布」或「保留雙層發布，加一致性檢查」。此決策直接影響最多下游工作。
2. **WP-05**：確認／修訂精確 schema 擴充提案。只授權方案評估不視為 migration 授權。
3. **WP-11**：描述 Preview／staging 的 Cloudflare／Vercel／其他代理鏈及 origin 是否可直連，不提供 Secret。
4. **D-4、D-6b**：分別選通知通道與發票分支；未回覆不自行取代。
5. **D-2、D-3、D-5、D-6a**：提供核准結論／文件或 sanitized 設定摘要。外部核准尚未完成可直接說明未核准。
6. **WP-20**：先定義指標與必要事件契約；沒有可核對來源時不得捏造數值，亦不把「不可計算」當成五項指標已完成。

安全與回滾：本次只有讀取明確程式／設定與寫入本清單和 sanitized audit evidence；沒有產品程式修改、外部設定寫入、DB 操作、push 或 deploy。回滾僅移除此清單及本次 audit 記錄，保留已完成 WP evidence。

全域阻擋稽核：本次為第一輪完整剩餘依賴稽核。前一輪有實際諮詢修正進度，不計入連續阻擋。Goal 尚未符合三輪相同阻擋的 blocked 門檻；保持 active，等待輸入並於續輪重新確認。

第三輪稽核：同一組必要輸入仍未取得，沒有可獨立完成的剩餘 WP 或執行中驗證 handle；thread Goal 依三輪門檻標記 blocked。repository WP 狀態與既有證據保留，未標完成。提供決策後可續作。
