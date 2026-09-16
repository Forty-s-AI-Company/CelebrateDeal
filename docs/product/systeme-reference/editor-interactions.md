# 編輯器互動規格

## EDT-INT-001｜選取與節點操作

- 入口：Sell Order Form editor > Testimonials block > Text。
- 截圖：`22-editor-block-added-testimonial.png`、`23-editor-text-settings-edited.png`
- 結果：選取元素後左欄顯示層級 breadcrumb 與 move up/down、Copy、Create block、Remove。內容可直接在畫布編輯；設定即時反映畫布，但仍需 Save 寫入。
- 狀態：加入、選取、內容修改、Undo/Redo、Save 已實際操作；自由拖曳排序、跨容器巢狀與每種元素複製／刪除僅看到控制，未逐項驗證。
- CelebrateDeal：必做節點選取框、breadcrumb、move/copy/remove、明確 dirty state。

## EDT-INT-002｜Blocks 實際拖入與結構

- 入口：Custom Info editor 與 Sell Order Form editor > Blocks。
- 操作：九個分類逐一開啟，各拖入一個代表 block；Order forms 的唯一變體由縮圖拖至畫布底部。
- 截圖：`50-block-added-optin-form.png` 至 `61-order-form-block-text-settings.png`。
- 結果：block 會展開為 Section、Row 與可個別選取的子元素，不是扁平圖片。Order forms 代表項建立左右欄結構；左欄含 icon 與標題，右欄顯示預留容器。選取標題後可調 Typography、padding、margin、alignment、delay、Desktop/Mobile visibility 與 HTML ID。
- 儲存：字級 20→21 後 Undo/Redo 均有效；Save 後 disabled；reload 後 block 與修改保留。
- 狀態：九分類代表 block 已實際拖入；81 個純視覺變體僅完整盤點縮圖，未逐張拖入。
- CelebrateDeal：必做可組合 block schema、節點展開、拖放插入、裝置可見性與可復原交易。

## EDT-SAVE-001｜儲存與重載

- 編輯器：修改後 Save 可用；按 Save 後 disabled；Preview 顯示已儲存文字。
- Funnel step metadata：Name 離焦後自動儲存，無 Save；reload 後保留。
- Exit：未存 Popup 變更時顯示 `This page has not been saved. Save now?`，No/Yes；選 No 回詳情並捨棄。
- 截圖：`23`、`25`、`29`。
- 狀態：已實際操作。
- CelebrateDeal：必做；步驟資料 auto-save、畫布 manual-save 需分開並顯示狀態。

## EDT-RESP-001｜桌機與手機

- Mobile view 使用手機外框；同一元素可有獨立 typography/padding；Desktop/Mobile visibility checkbox 可見。
- 截圖：`24-editor-mobile-view.png`。
- 狀態：已實際操作。
- CelebrateDeal：必做 breakpoint override；至少 desktop/mobile。

## EDT-TPL-001｜Change page template

- 入口：Step Configuration > Change page template。
- 提示：`You are about to apply a new template to the page. All changes will be lost. Continue?`，Cancel/Confirm。
- 結果：Confirm 後回模板 picker；套用新模板時 step Name 與 URL Path 保留，但 editor page ID 改變，原畫布內容被替換。
- 截圖：`30-change-template-warning.png`、`31-change-template-result.png`。
- 狀態：已實際操作。
- CelebrateDeal：必做 destructive warning；清楚定義「保留 step metadata、替換 page document」。
