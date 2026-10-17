# 2026-10-16 金流環境、Invoice、客服信箱與 SMS 查詢

本文件記錄人類已提供事實與本次唯讀查詢。建議尚非供應商採購、定價、稅務判定或功能驗收；原 20 WP 範圍與已暫緩項目不因本文件改變。

## 後續已決定事項

人類後續明確選擇：

- WP12：先顯示「自動電子發票尚未開放」，採原計畫的未開放呈現分支。此為產品功能決策，不是稅務免開發票認定；不開通PayUni／光貿、不新增海外Invoice寄送功能。
- WP19：採EVERY8D＋額外點數、基本方案不漲價，**但先不實作**。方向已定，不再詢問供應商方向；不採購、不啟用SMS、不新增adapter或點數／收費程式。實際帳號、合約費率、點數售價、預算上限與寄送驗證仍未提供。

下列比較保留研究當時資訊；文中的「尚未決定」由本節的後續人類決策取代，其他未確認事實不自行補完。

### 通知測試收件者補充

人類明確指定先使用a88221144@gmail.com接收測試Email。此地址現在同時是暫用客服Email與人類指定測試收件端，不再列為未指定；測試只使用合成訂單／報名內容，不代表准許寄給其他地址或真實客戶。本次沒有實際發信，仍須確認寄送環境隔離與供應商注入設定。

LINE待提供公開帳號名稱／@ID、Messaging API是否啟用，以及是否為專用測試或已連正式服務的帳號；不在對話索取Channel Secret／Access Token。專案已有/settings/line整合頁，Messaging Channel ID、Secret、Access Token為必填；LINE Login兩欄選填且成對。真正串接資料只能透過確認隔離的安全設定頁或既有核准secret provider注入，不讀回或輸出憑證，不覆蓋未知既有Webhook。

## 已確認的人類指示

- localhost 沿用原有測試付款設定；不因說明 Sandbox API 再要求建立另一套環境。
- staging 與正式站都使用 PayUni 正式金流；staging 方案僅使用 NT$1／NT$2／NT$3 測試價，正式站使用正常價格。
- 程式 `src/lib/payuni-staging-plan-test.ts` 的三個專用方案金額為 100／200／300 cents，與上述價格一致。本次僅讀取來源，未驗證部署中價格或執行付款。
- staging 的低價並不將 PayUni 正式交易變成 Sandbox。既有正式金流操作授權邊界繼續適用；本次沒有付款、退款或部署。
- 政策暫用顯示名稱：Carry Digital Nomad 凱瑞數位；暫用客服 Email：a88221144@gmail.com。這是顯示資料，不推定登記法人名稱或統編。
- 人類表示 PayUni 電子發票原為關閉；提供的啟用畫面不足以證明註冊、儲存、正式開通或成功開立。
- 人類希望未來保留 Email／LINE／SMS，後續已決定 SMS 方向為 EVERY8D＋額外點數、基本方案不漲價；本次 Goal 先不實作 SMS，沒有採購、啟用或修改方案價格。

## Invoice 建議與目前能力

- 建議以實際賣方與交易用途區分付款文件：台灣統一發票另接核准加值中心；海外商業 Invoice／付款收據提供英文交易資料與可下載文件。
- 海外商業文件應列實際賣方、買方、品項、幣別、金額與付款狀態；未付與已付清楚區分。付款成功後可設計自動寄送，退款／作廢另保留可追溯更正，不自行造出台灣統一發票號碼。
- 是否須開立統一發票、外銷或零稅率適用不能單憑國籍或 IP 判斷；實際賣方、服務使用地與佐證需另外確認。
- 現有 `src/app/(app)/billing/invoices/[invoiceId]/page.tsx` 為商家帳單／付款收據列印頁；`src/lib/taiwan-electronic-invoice.ts` 有開立介面與確定性測試 adapter，未注入 adapter 時不宣稱開立完成。
- 本次來源搜尋未找到完整英文商業 Invoice 自動產生／寄送流程。上述建議尚未實作，也不把商家平台帳單能力當成每位商家的顧客 Invoice 功能。
- 新增海外商業 Invoice 可能超出原 WP12 台灣電子發票／隱藏分支範圍，不能用此文件默默擴充原 Goal 或標 WP12 完成。

稅務來源：[財政部外銷發票說明](https://www.etax.nat.gov.tw/etwmain/tax-info/understanding/tax-q-and-a/national/business-tax/invoice/pxeqeBY)。

## 客服信箱查詢

- 目前工作樹的 `docs/production-infrastructure-plan.md:336` 寫過 support@celebratedeal.com，僅為規劃內容。
- 已連接 Gmail 的精確地址搜尋為 0 筆；這不證明其他 Gmail 帳號或信箱沒有相關紀錄。
- 本次本機 DNS resolver 對 celebratedeal.com 的 MX 查詢回報名稱不存在；carry-digital-nomad.in.net 未取得 MX 記錄。本次未用其他 DNS resolver 交叉確認。
- Gmail 找到 Cloudflare 官方 Email Routing 舊通知，但未取得該地址的實際規則／收件匣設定證據，不宣稱信箱已建立。
- Resend 是目前產品寄送 Email 的來源實作。客服信箱轉寄或獨立收件匣的供應商仍未確認，不直接改 DNS 或寄送測試信。

## SMS 比較與建議

公開價格查詢日：2026-10-16。API 帳號資格、實際收件國家、可用路由及契約仍須供應商確認。

| 服務 | 公開資訊 | 本次判斷 |
| --- | --- | --- |
| EVERY8D | 500 點 NT$425；1,000 點 NT$840，含稅。一般文字 1–70 字扣 1 點、71–134 字扣 2 點；國際簡訊依頁面為五倍點數。另有 API 文件入口。 | 主要寄台灣手機時，建議先列為優先評估；不將大宗 0.7 元起當成小量實際價。 |
| 三竹 | 官方列企業簡訊 0.7 元起、送達計費，實際級距依帳號；API 需申請。 | 作為詢價備選，不假定小量或 API 實際單價。 |
| Twilio | 台灣 outbound 公開價 USD 0.0842／segment，另依路由／號碼／附加功能等條件計價。 | 可評估跨國需求，不假定比台灣供應商便宜。 |
| 幫賣 Bombmy | 官網有排程簡訊與 Email；既有專案分析記錄扣點紀錄頁。 | 未找到可核實的簡訊單價、月費內含量或簡訊供應商，不推定其收費與成本。 |

- 建議保留既有基本方案價格，另提出可選購的 SMS 點數／用量費，長訊息依分段扣點；商家可選 Email／LINE／SMS，SMS 顯示發送前估算、餘額與預算上限。
- 國際號碼另顯示費率，避免以台灣短訊單價統一承諾。點數回補應依供應商最終送達／失敗狀態與契約，避免超時就盲重送。
- 試算：1,000 人 × 每人 2 則 × 每則 1 點 × NT$0.84＝NT$1,680 供應商成本；若每則需 2 點則 NT$3,360。未含平台維運成本，亦非商家售價。
- SMS 供應商方向已決定為 EVERY8D；實際合約費率、點數售價、費用上限與儲值細節尚未決定，不因方向確定就採購、開通或改方案價格。

來源：[EVERY8D 價格](https://www.teamplus.tech/product/every8d-price/)、[三竹服務](https://msg.mitake.com.tw/SMS/product/more.jsp)、[Twilio 台灣價格](https://www.twilio.com/en-us/sms/pricing/tw)、[幫賣官網](https://www.bombmy.live/)。

## 研究當時的 handoff（歷史快照）

下列區塊記錄研究當時尚待決策的狀態；目前 WP-19 決策以 `wp19-notification-channels-20261016.md` 為準。

AI_TEAM_HANDOFF_HISTORY
HISTORICAL_TASK_STATUS: IN_PROGRESS
CURRENT_WORK_ITEM: 回答人類 Invoice／環境／信箱／SMS 問題，保存新事實與研究結果。
ACTUAL_RESULT: 已查來源、公開供應商頁、公開 DNS 及 Gmail 搜尋；沒有產品實作或外部寫入。
EVIDENCE: 本文件；引用來源與本地檔案如上。未保存郵件正文、帳單內容或認證資料。
NEXT_ACTION: 依人類對 Invoice 與 SMS 建議的後續決定續辦；不得把研究建議當已核可實作／售價。
ROLLBACK: 本輪僅新增此文件，回滾限定本文件，不還原其他 WP。
SAFETY_STATUS: PASS
PLAN_REVIEW_STATUS: NOT_REQUIRED（唯讀研究與事實紀錄，非實作驗收）
GIT_PROMOTION_STATUS: NOT_REQUESTED
PRODUCTION_DEPLOYMENT: NOT_AUTHORIZED
COPY_TO_NEW_TASK: NO
