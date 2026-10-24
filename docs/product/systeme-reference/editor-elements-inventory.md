# Elements 清單

功能 ID：EDT-EL-001；入口：Edit page > Elements；截圖：`11-editor-toolbar-elements.png`、`23-editor-text-settings-edited.png`、`62-element-form-added.png`、`63-element-form-settings.png`、`64-element-image-settings.png`、`95-editor-calendar-insert.png`、`96-editor-x-share-insert.png`。

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
- Form input：直接拖入時若未選 Input type，畫布顯示 `WARNING - INPUT TYPE NOT SET`；可設定類型、placeholder、Optional、icon、字體、背景、間距、border、shadow、裝置可見性與 HTML ID。截圖：`77-element-form-input-settings.png`。
- Button：已拖入並開啟完整設定。可設定點擊動作（Submit form／Show popup／Open URL／Next step URL／Download file）、註冊後導向、double opt-in、自動化、對齊、寬度、文字／副文字、icon、hover、裝置可見性與 HTML ID。截圖：`78-editor-element-button.png`、`79-editor-button-settings.png`。
- Checkbox：已拖入並開啟設定。可設定未勾選訊息、Optional、自動化、字型／色彩／對齊、間距、Desktop/Mobile visibility 與 HTML ID。截圖：`80-editor-checkbox-settings.png`。
- reCAPTCHA：入口可拖，但本次投放到相同畫布位置未生成元件，只選到父 Section；未嘗試解 CAPTCHA、未輸入網域金鑰，狀態標為無法驗證。截圖：`81-editor-recaptcha-insert.png`。
- Sell 付款元件：既有 Order Form 模板已實際包含並選取 Offer price、Payment method、Payment button。Offer price 僅控制 price plan name／amount／description 的字型、顏色與間距，實際價格方案需回 Step settings；Payment method 控制付款選項的字體、顏色與間距，畫布明示需在 Step settings 加入 payment methods；Payment button 可調 loading text、button/subtext、字型、hover、border、shadow、尺寸與裝置可見性。未輸入商品、付款或客戶資料。截圖：`92-sell-offer-price-settings.png`、`93-sell-payment-method-settings.png`、`94-sell-payment-button-settings.png`。
- Calendar：已實際拖入。預設生成兩階段預約 UI，先選日期、再選時間；畫布提示必須先建立 event，時區顯示 Asia/Taipei，未選 event 前時段不可用。測試後以 Undo 移除。截圖：`95-editor-calendar-insert.png`。
- X share button：已實際拖入，生成 `Post` 連結，目標為 X/Twitter intent URL；測試後以 Undo 移除。截圖：`96-editor-x-share-insert.png`。
- Survey：已實際拖入，生成預設問題、說明與 Answer 1～3 三個選項；證實不是單一表單欄位，而是帶題目及答案集合的互動元件。測試後以 Undo 移除。截圖依同輪 Elements 畫面存證：`11-editor-toolbar-elements.png`。
- Menu：已實際拖入，預設生成 Home 與 Contact 兩個導覽連結；可作為頁內／跨頁導覽容器。測試後以 Undo 移除。截圖依同輪 Elements 畫面存證：`11-editor-toolbar-elements.png`。
- Horizontal line：已實際拖入，畫布生成跨內容區的分隔線；該線沒有可讀文字節點，但視覺結果可見。測試後以 Undo 移除。截圖依同輪 Elements 畫面存證：`11-editor-toolbar-elements.png`。
- 付款條件元件仍僅看到入口：Customer type、Physical product、Agreement、Order bump、Coupon、Two-step order form、Shipping fees、Paid calendar；未建立真實商品或付款條件。
- 可見文字設定：breadcrumb `Section > Row > Text`；move up/down、Copy、Create block、Remove；font size、line height、font type、letter spacing、文字色／背景色、padding、margin、alignment、delay、Desktop/Mobile visibility、Advanced HTML attributes、ID。
- 桌機／手機分離：同一文字桌機 40px/24px，手機 34px/44px，padding 也不同，證實 responsive 值可分別設定。
- CelebrateDeal：Text、layout、Form、Media、Button、FAQ、Countdown、Calendar、Survey、Menu 與分隔線為必做；Payment 與 Raw HTML 為方案限制／後做；每個節點需保留層級 breadcrumb 與裝置覆寫。
