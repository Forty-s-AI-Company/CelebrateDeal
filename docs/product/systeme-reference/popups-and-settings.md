# Popups 與 Page settings

## EDT-POP-001｜Popup

- 入口：Edit page > Popups。
- 截圖：`26-editor-popups-empty.png`、`27-editor-popup-settings.png`、`29-editor-exit-unsaved-prompt.png`、`90-editor-popup-settings.png`、`91-popup-preview-triggered.png`
- 結果：空清單提示尚未建立並以 `+` Create popup。建立後切到 Popup 編輯模式，載入預設大型內容 Popup，提供 `EDIT POPUP SETTINGS`。
- 可見欄位：Show close button On/Off（預設 Off）、Open popup automatically On/Off（預設 On）、Automatic delay（1 second）、Open on exit intent On/Off（預設 Off）、Background color、vertical/horizontal padding、corner radius（6）、border style（Solid）、color、width（3）、type（Full Border）、shadow（Soft shadow）、Advanced HTML attributes、ID。
- 儲存與前台驗證：重新建立測試 Popup，保留預設 `Open popup automatically = On`、delay 1 秒、close button Off、exit intent Off；按 Save 後開 Preview，新分頁在約 1 秒後自動顯示遮罩與置中 Popup。因 close button Off，前台沒有關閉圖示；未送出 Email 表單。
- 狀態：建立、設定、手動 Save、Preview 自動觸發均已實際操作；exit intent 的滑鼠離頁觸發僅確認設定入口，未能穩定模擬。
- CelebrateDeal：次要；先做 auto delay、exit intent、close button、樣式與 dirty-state。

## EDT-SET-001｜Page settings

- 入口：Edit page > Settings。
- 截圖：`28-editor-page-settings.png`
- 可見設定：
  - Default typography：Google Fonts、Hind Siliguri、Regular、font size 16、line height 21、link color、text color、alignment。
  - Heading typography：Google Fonts、Cardo、Regular、text color、alignment。
  - Language：English、French、Spanish、Italian、Portuguese、German、Dutch、Russian、Japanese、Arabic、Turkish、Chinese、Swedish、Romanian、Czech、Hungarian、Slovak、Danish、Indonesian、Polish、Greek、Serbian、Hindi、Norwegian、Thai、Slovenian、Ukrainian、Albanian。
  - Background：color、image Upload、Blur（5）。
  - SEO：Title、Description、Keywords、Author、Social media image、Hide from search engines。
  - Tracking：Facebook event（None）、Edit header code、Edit footer code。
  - Affiliation：`Display an affiliate badge...` checkbox disabled 且 checked。
- 安全界線：未上傳、未輸入追蹤碼、未串付款、未發布。
- 狀態：所有可見區塊已開啟盤點；實際追蹤與網域發佈無法驗證。
- CelebrateDeal：SEO、背景、字型、語言為必做；追蹤碼與 affiliate badge 為方案／安全限制，後做。
