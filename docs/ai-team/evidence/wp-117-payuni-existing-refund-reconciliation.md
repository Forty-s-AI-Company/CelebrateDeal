# WP-117 — PayUni Sandbox 既有退款與對帳

結果：`LOGIN_REQUIRED_BEFORE_EXTERNAL_OPERATION`。CAT04 維持 **6.0/10**。

- CelebrateDeal staging 財務管理頁可以開啟；沒有送出任何退款、付款、callback 或 provider query。
- 官方 PayUni Sandbox Chrome tab 已回到登入頁，因此依 fail-closed 規則停止。
- 退款 attempts 為 0；provider queries 為 0；new payments 為 0。
- 沒有讀取、輸出或輸入帳密、cookie、token、卡號、交易識別碼或 `.env*`。
- staging 與 PayUni tabs 已保留供使用者完成互動登入後續接手。

登入完成後仍須先重新進行退款前雙邊狀態檢查；只有精確 synthetic 交易在兩邊均顯示可全額退款時，才可依 WP-117 送出唯一一次 Sandbox 退款。
