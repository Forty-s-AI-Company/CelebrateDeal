# Blocks 分類與變體

功能 ID：EDT-BLK-001；入口：Edit page > Blocks。九個實際出現的分類皆已逐一點開；截圖：`12`–`22`。

| 分類 | 可見變體數 | 變體摘要 | 實測狀態 |
|---|---:|---|---|
| Order forms | 1 | 右側兩步驟表單、左側商品資訊；實際縮圖標籤為匈牙利文 | 已拖入代表 block |
| Opt-in forms | 12 | 單欄、左右雙欄、圖片／影片、背景、透明表單、水平表單、社群 icon | 已拖入第 1 個代表 block |
| Features | 13 | 2/3/4 欄、圖片、icon、卡片、按鈕、彩色框／中間高亮 | 已拖入第 1 個代表 block |
| Page footers | 5 | Logo、選單、文字欄、社群、Google Maps | 已拖入第 1 個代表 block |
| Team presentation | 3 | 圓形人像、偏移雙照、文字欄 | 已拖入第 1 個代表 block |
| Welcome | 7 | Hero 背景、圖片、影片、卡片、雙圖、CTA | 已拖入第 1 個代表 block |
| Price plans | 9 | 2/3 欄方案、推薦高亮、彩色 banner、圖像與列表 | 已拖入第 1 個代表 block |
| Page headers | 2 | 公司名＋選單、Logo＋選單 | 已拖入第 1 個代表 block |
| Testimonials | 9 | 圓圖、短評、欄式、quote icon、彩邊、重疊卡片 | 已拖入代表 block |

## 實際加入行為

- 九個分類均已至少拖入一個代表 block；截圖：`50`–`60`。Opt-in forms、Features、Page footers、Team presentation、Welcome、Price plans、Page headers、Testimonials 放在 Custom Info 測試頁；僅 Sell Order Form 才會顯示的 Order forms 放在 Sell 測試頁。
- 代表 block 加入後不是不可分割圖片，而是生成 Section > Row > 子元素的可編輯節點樹。不同類別分別展開為表單欄位、文字、按鈕、圖片／icon、選單、方案卡或見證卡。
- Order forms 實際拖入後建立 Section > Row；左欄含圖示與 `Rendelési összefoglaló` 文字，右欄為預留區。文字可套用一般 Typography、間距、對齊、延遲顯示，以及 Desktop/Mobile visibility。截圖：`59-blocks-order-forms-picker.png`、`60-block-added-order-form.png`、`61-order-form-block-text-settings.png`。
- Order forms 文字字級由 20 改為 21，Undo 回復、Redo 再套用；Save 後按鈕 disabled，重新載入仍保留 block 與字級修改。
- Testimonials 的「quote icon + 文字 + 客戶照片／姓名／職稱」加入後亦生成 Section > Row > 各子元素，可各別選取編輯。
- 純視覺變體只做完整縮圖與用途盤點；每類選代表項操作，未把 81 個視覺變體全部留在畫布，以避免重複污染測試頁。
- CelebrateDeal：九分類導覽與 block gallery 必做；第一階段每類至少一個代表 block，變體逐步補齊。
