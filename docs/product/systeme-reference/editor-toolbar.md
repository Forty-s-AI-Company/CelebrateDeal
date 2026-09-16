# 全畫面編輯器與工具列

## EDT-LAYOUT-001｜整體框架

- 入口：Sell > Order Form > Edit page。
- 截圖：`11-editor-toolbar-elements.png`、`12-editor-blocks-categories.png`、`24-editor-mobile-view.png`
- 結果：固定頂部工具列、左側素材／設定面板、中央可捲動畫布；未觀察到獨立右側設定欄或縮放控制。側欄有收合箭頭。手機模式將中央畫布改成手機裝置框。
- 狀態：已實際操作。
- CelebrateDeal：必做；桌機寬畫布 + 手機 device frame，設定面板可沿用左欄。

## EDT-TB-001｜工具列按鈕

| 按鈕 | 實測結果 | 儲存／跳轉 |
|---|---|---|
| Undo | 加入 block 後可用；移除新增內容 | 不跳轉 |
| Redo | Undo 後可用；恢復內容 | 不跳轉 |
| Popups | 切換 Popup 清單／編輯模式 | 未自動儲存 |
| Settings | 開啟 Page settings | 不跳轉 |
| Mobile view | 桌機畫布切成手機框；再次切回桌機 | 不跳轉 |
| Preview page | 新分頁預覽已儲存版本 | 不替代 Save |
| Save | 寫入編輯器修改；成功後按鈕 disabled | 手動儲存 |
| Exit | 有未存變更時提示 Save now?（No/Yes） | No 返回並捨棄 |

- 功能 ID：EDT-TB-001
- 截圖：`11`、`24`、`25`、`29`。
- 狀態：全部已實際點擊。
- CelebrateDeal：必做；按鈕 disabled/enabled 與離開防呆是核心 UX。

