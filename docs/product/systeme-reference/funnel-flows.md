# Funnel 流程實測

## FUN-LIST-001｜Funnels list

- 所屬頁面與入口：`Sales > Funnels`／`/dashboard/funnels`
- 實際操作：從空清單載入，建立後反覆返回確認。
- 截圖：`01-funnels-list.png`、`04-funnels-list-one-created.png`、`49-funnels-list-three-limit.png`
- 實測結果：表格呈現；頁首有數量、搜尋、狀態篩選（預設 Active）、Filter、Create。欄位為 Name、Status、Created、列尾選單。成功建立後名稱為可點連結，狀態以綠色勾示意。
- 可見欄位／選項：搜尋框、Active 下拉、Filter、Create、每頁 10/25/50、Previous/Next。
- 狀態：已實際操作。
- CelebrateDeal：必做；保留表格、搜尋、狀態篩選、建立入口、空狀態與配額提示。

## FUN-CREATE-001｜Create funnel

- 入口：Funnels list > Create。
- 操作：逐一點選全部 goal，填入測試名稱，Sell／Audience／Custom 送出，Webinar 嘗試送出。
- 截圖：`02-create-funnel-goals.png`、`02a`–`02e`、`03-sell-create-form-filled.png`、`32-audience-create-form.png`、`39-custom-create-form.png`、`47-webinar-create-form.png`
- 結果：Name 與 goal 未完成時 Save disabled；Funnel domain 預設目前帳戶子網域；Currency 預設 Euro。Currency 展開可見 Argentine Peso、Australian Dollar、Bulgarian Lev、Brazilian real、Canadian Dollar、Central African CFA Franc、Chilean Peso、Yuan、Colombian Peso、Czech Koruna、Danish Krone、Egyptian Pound、Euro、Ghanaian Cedi、Guinean Franc、Hong Kong Dollar、Hungarian forint、Icelandic Krona、Indian rupee、Indonesian rupiah、Israeli New Shekel、Japanese Yen、Kenyan Shilling、Malawian Kwacha、Malaysian ringgit（畫面為虛擬清單，僅代表本輪可見範圍）。
- 可見欄位：Name *、Funnel domain *、Choose your funnel goal *、Currency、Save。
- 狀態：已實際操作。
- CelebrateDeal：必做；以繁中欄位、明確必填錯誤與 disabled Save 實作。

## FUN-LIMIT-001｜帳戶配額

- 入口：建立第 4 個 Funnel（Webinar）後按 Save。
- 截圖：`48-free-plan-limit-webinar.png`、`49-funnels-list-three-limit.png`
- 結果：清單仍為 3；訊息為 `You have exceeded multiple limits on your current plan (webinars, funnels).`，附 Upgrade your plan。
- 狀態：受方案限制。
- CelebrateDeal：必做；配額需在送出前後清楚顯示，且不得造成半建立資料。

## FUN-DELETE-001｜釋放測試名額

- 入口：Funnels list > `CelebrateDeal Research Custom` 列尾選單 > Delete。
- 操作：在 `You are about to remove this funnel. Continue?` 確認視窗按 Confirm。
- 截圖：`71-custom-funnel-deleted-slot-released.png`。
- 結果：Custom 測試 Funnel 永久刪除，清單由 3 Funnels 變成 2 Funnels；保留 Audience 與 Sell。這是完成 Custom 流程取證後，經使用者明確確認才執行的名額釋放，不代表帳戶上限改為 2。
- 狀態：已實際操作；雲端刪除不可復原，本機規格與截圖保留。
- CelebrateDeal：刪除必須二次確認，並在成功後立即更新配額與清單。

## FUN-SELL-001｜Sell 詳情流程

- 入口：建立 `CelebrateDeal Research Sell` > 點名稱。
- 截圖：`05-sell-order-form-template-picker.png`、`09-sell-step-settings.png`、`10-sell-view-funnel-step.png`、`30-change-template-warning.png`、`31-change-template-result.png`
- 結果：預設 steps 為 Order Form、Thank You Page、Inactive Page。可 Add step；頂部有 View funnel、Funnel settings。選模板前其他 tabs disabled，選後啟用 Configuration、Automation Rules、A/B test、Stats、Leads、Sales、Deadline settings。
- Step 欄位：Name *、URL Path *、Affiliate commissions *（0%）、Commission payout delay *（30 days）、Sales limit、View funnel step、Edit page、Change page template、offer type（Digital/Physical）、Coupons、Add order bump。
- 安全修改：Name 改為 `Order Form Research`，離焦即儲存；reload 後保留。未選 offer 顯示「Please add a digital or physical product...」，但 View funnel step 仍可開啟。
- 狀態：已實際操作。
- CelebrateDeal：必做；step metadata 自動儲存與 editor 手動儲存需明確區分。

## FUN-AUD-001｜Build an audience 詳情流程

- 入口：建立 `CelebrateDeal Research Audience` > 點名稱。
- 截圖：`33-audience-template-picker.png`、`37-audience-step-settings.png`、`38-audience-view-step.png`
- 結果：預設 steps 為 Opt-in page、Thank You / Download Page、Inactive Page。Opt-in step 選模板後欄位只有 Name *、URL Path * 與三個操作入口。
- 安全修改：Name 改為 `Opt-in Page Research`，reload 後保留；View funnel step 顯示所選志工／社群主題完整前台。
- 狀態：已實際操作。
- CelebrateDeal：必做；Audience 應提供收集名單頁與感謝／下載頁預設組合。

## FUN-CUSTOM-001｜Custom 詳情與 Add step

- 入口：建立 `CelebrateDeal Research Custom`。
- 截圖：`40-custom-empty-detail.png`、`41-custom-step-types.png`、`42-custom-info-template-picker.png`、`46-custom-step-settings.png`
- 結果：建立後只有 Inactive Page，主區顯示無 steps。Add step 對話框含 Name *、Type *、Choose a template（預設）／Start from scratch、Save。
- Step types：Sales page、Order form、Upsell、Downsell、Thank you page；Opt-in page、Opt-in thank you page、Inline form、Popup form、Link in bio；Info page、Contact us page；Webinar registration page、Webinar thank you page、Webinar broadcast page。
- 實作：新增 `Custom Info Research`（Info page、Choose a template），選模板後得到 Name、URL Path、View/Edit/Change template。
- 狀態：已實際操作。
- CelebrateDeal：必做；Custom 從空白開始，step type 應分群且支援模板／空白二選一。

## FUN-WEB-001｜Run an evergreen webinar

- 入口：Create > Run an evergreen webinar > Save。
- 截圖：`02d-create-goal-webinar-selected.png`、`47-webinar-create-form.png`、`48-free-plan-limit-webinar.png`
- 結果：goal 可選、Save 可按；有 3 個 Funnel 時送出被 webinars 與 funnels 雙重配額擋下。刪除 Custom、清單降為 2 後再次建立，錯誤只剩 `You have exceeded multiple limits on your current plan (webinars).`，證實 Webinar 本身受方案限制，並非只有 Funnel 名額不足。
- 補充截圖：`72-webinar-plan-limit-after-slot-release.png`。
- 狀態：受方案限制；詳情、steps、模板、View、Edit、Change template 無法驗證。
- CelebrateDeal：仍需補查；至少先保留 goal 與三種 Webinar step type 的資料模型位置。
