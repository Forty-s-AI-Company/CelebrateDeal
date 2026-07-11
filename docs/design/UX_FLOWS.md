# Core UX Flows

## 建立第一場直播

`選擇目標/基本資料 -> VOD 或 Live Input -> 商品 -> 報名 -> 通知 -> 互動腳本 -> 推廣/黑名單/用量 -> 預覽 -> 發布`

- 每步顯示完成條件與阻塞原因。
- 儲存草稿不等於發布；發布前驗證 slug、影音 ready、CTA URL、用量與必要關聯。
- 預覽使用真實選取資料，不能只顯示固定 mock。

## 觀看與轉換

`帶 referral 進站 -> 保存候選歸因 -> 播放 -> 時間軸事件 -> 商品/CTA -> 報名或 server checkout -> analytics/audit`

- 官方互動角色顯示「官方/AI 主持人/系統助手」。
- Product click 與 confirmed conversion 分開。
- Analytics 失敗不得中斷播放或 checkout，但需可觀測。

## 組織推廣與外部商城

`上線開放推廣 -> 下線取得 referral link -> 下線設定安全商城 URL -> 訪客進站 -> 依歸因選 URL -> 記錄 click -> 等待外部訂單證據`

- 下線 URL 無效/過期時回退上線或產品預設 URL。
- 沒有外部訂單證據時，成效頁只顯示 click/lead，不顯示 revenue。

## 月結與出款

`期間交易/退款/佣金 reconciliation -> draft settlement -> adjustment -> review -> lock -> payout batch -> export/pay/fail/retry`

- Vendor 只能看自己的資料；平台操作需 admin + MFA + audit。
- Locked 後用 adjustment，不直接改歷史。
- Failed payout 保留原因、重試次數與操作人。

