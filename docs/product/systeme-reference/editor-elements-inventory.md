# Elements 清單

功能 ID：EDT-EL-001；入口：Edit page > Elements；截圖：`11-editor-toolbar-elements.png`、`23-editor-text-settings-edited.png`。

| 分類 | 可見元件 |
|---|---|
| Text | Text、Headline、Bulleted list、Content box |
| Column layout | 4 columns、3 columns、2 columns、Row、Section |
| Form | Form、Form input、Button、Checkbox、reCAPTCHA |
| Payment | Payment button、Payment method、Customer type、Physical product、Offer price、Agreement、Order bump、Coupon、Two-step order form、Shipping fees、Paid calendar |
| Media | Image、Video、Audio、Carousel |
| Social | X share button |
| Other | Countdown、Menu、Horizontal line、Raw HTML、FAQ |

## 實測狀態

- 已實際操作：透過 Testimonials block 加入包含 Section/Row/Text/Image 的巢狀內容；選取文字、修改內容、調整裝置視圖、Undo、Redo、Save。
- 僅看到入口：其餘各元素可拖放入口已盤點，但沒有逐一拖入；Payment 類亦未串接商品或付款。
- 可見文字設定：breadcrumb `Section > Row > Text`；move up/down、Copy、Create block、Remove；font size、line height、font type、letter spacing、文字色／背景色、padding、margin、alignment、delay、Desktop/Mobile visibility、Advanced HTML attributes、ID。
- 桌機／手機分離：同一文字桌機 40px/24px，手機 34px/44px，padding 也不同，證實 responsive 值可分別設定。
- CelebrateDeal：Text、layout、Form、Media、Button、FAQ、Countdown 為必做；Payment 與 Raw HTML 為方案限制／後做；每個節點需保留層級 breadcrumb 與裝置覆寫。

