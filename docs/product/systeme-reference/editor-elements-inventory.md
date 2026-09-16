# Elements 清單

功能 ID：EDT-EL-001；入口：Edit page > Elements；截圖：`11-editor-toolbar-elements.png`、`23-editor-text-settings-edited.png`、`62-element-form-added.png`、`63-element-form-settings.png`、`64-element-image-settings.png`。

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

- 已實際操作：透過 Testimonials block 加入包含 Section/Row/Text/Image 的巢狀內容；另將 Form 與 Image 從 Elements 面板直接拖入畫布，查看設定後以 Undo 清除，未污染已儲存頁面。
- Form 加入後自動產生 First name、Last name、Email、Checkbox 與 Submit button；設定面板分成 Elements、Design、Actions，可排序欄位、Add new field，並設定 placeholder、Optional、icon 與 HTML ID。
- Image 加入後顯示預設佔位圖；可設定圖片檔、點擊動作、alt、100% width、尺寸、對齊、overlay、margin、border、圓角、style、blur、shadow、delay、Desktop/Mobile visibility 與 HTML ID。
- Video：預設插入 systeme.io YouTube 範例；可設定 video type、URL、autoplay、controls、aspect ratio、shadow、border、圓角、style、margin、delay 與裝置可見性。
- Audio：可選音訊來源與 URL，另有 margin、Desktop/Mobile visibility 與 HTML ID；畫布使用瀏覽器原生音訊控制列。
- Carousel：新增後只有空白 slide drop zone；可新增／切換 slides、垂直對齊、箭頭導覽與顏色、padding、margin、裝置可見性。
- Countdown：可選固定日期時間、到期不動作或 redirect URL，並設定時間／標籤字體與顏色；預設顯示 DAYS/HOURS/MINUTES/SECONDS。
- Raw HTML：提供 Edit code、對齊、margin、裝置可見性與 HTML ID；本輪未輸入或執行外部程式碼。
- FAQ：可新增 FAQ item、設定間距／圓角／展開收合 icon、字體、顏色、padding、shadow；每個答案區仍是可拖入其他元素的容器。
- 僅看到入口：Form input、Button、Checkbox、reCAPTCHA、Payment、X share button、Menu、Horizontal line 尚待逐項拖入；Payment 類未串接商品或付款。
- 可見文字設定：breadcrumb `Section > Row > Text`；move up/down、Copy、Create block、Remove；font size、line height、font type、letter spacing、文字色／背景色、padding、margin、alignment、delay、Desktop/Mobile visibility、Advanced HTML attributes、ID。
- 桌機／手機分離：同一文字桌機 40px/24px，手機 34px/44px，padding 也不同，證實 responsive 值可分別設定。
- CelebrateDeal：Text、layout、Form、Media、Button、FAQ、Countdown 為必做；Payment 與 Raw HTML 為方案限制／後做；每個節點需保留層級 breadcrumb 與裝置覆寫。
