# CelebrateDeal 中文 Funnel 編輯器執行計畫

規格來源只採用 `docs/product/systeme-reference/` 的實測文件與截圖。未確認的 systeme.io 行為不得推測成已完成。

## 分階段工作包

1. **WP-01：資料核心與編輯器外殼**
   - PageDocument v1、節點 registry、父子規則、desktop/mobile override、序列化、legacy adapter。
   - 固定全畫面 shell、工具列、dirty state、現有 Save/reload、Puck Undo/Redo 與 viewport 整合。
2. **WP-02：結構化命令與基礎節點**
   - Section／Row／Column／Text／Image／Button renderer 與 inspector。
   - add、update、move、duplicate、delete、reorder command history；跨容器移動與循環防護。
3. **WP-03：完整 Elements 與設定面板**
   - Form、Media、FAQ、Countdown、Calendar、Survey、Menu 等已實測元件。
   - Payment、Raw HTML、reCAPTCHA 維持明確限制，直到前置安全整合成立。
4. **WP-04：Blocks 模板庫**
   - 九分類各一個代表 Block；插入後展開為一般節點，不保存截圖或扁平 HTML。
5. **WP-05：Popup、Page settings 與 Preview**
   - Popup 建立／編輯／刪除／延遲預覽；Exit intent 先標示未驗證。
   - Typography、Language、Background、SEO；Tracking／Affiliate 安全停用。
6. **WP-06：可用性與完整驗證**
   - 鍵盤操作、錯誤狀態、效能、E2E、migration 文件與 release evidence。

## WP-01 checkpoint

- 狀態：已完成。
- 保留既有 `LandingPage`、revision CAS、immutable published versions、Server Action 與 `/lp/[slug]` renderer，未執行 Prisma migration。
- `PageDocument v1` 採 additive adapter，尚未取代現行 Puck persistence。
- 未確認／受限：Webinar 流程、Payment 完整交易、reCAPTCHA、Popup exit intent、Tracking code、Affiliate、A/B test、deadline engine。
- 回滾：移除 `funnel-page-document` 新檔，並回復 workspace/editor shell 兩個元件即可回到既有編輯器。

## WP-02 checkpoint

- 狀態：已完成。
- 新增結構化 command history，涵蓋 add、update、move、duplicate、delete、move up/down、Undo、Redo；每次交易後重新驗證 PageDocument。
- 新增 editor／preview 共用安全 renderer，支援 Section、Row、2／3／4 欄、Text、Headline、List、Content box、Image、Button、Horizontal line 與 responsive override。
- 新建頁面使用新版 Funnel editor；既有 Puck 文件繼續沿用舊編輯器，避免未經確認的自動轉換破壞內容。
- LandingPage 儲存服務可同時讀寫 legacy Puck document 與 PageDocument；沿用既有 JSON 欄位、revision CAS 與 immutable published version，不需資料庫 migration。
- Raw HTML 不執行；Payment 與 reCAPTCHA 顯示 capability placeholder。
- 回滾：回復 `landing-page-service`、workspace 與公開頁入口，並移除 history、renderer、editor 新檔；既有資料不需回滾。

## WP-03／WP-04 checkpoint

- 狀態：Elements registry 已接入；Blocks 第一階段完成。
- 左側面板可切換 Elements、Blocks、設定；已實測元件入口完整列出，不可用的 Payment、Raw HTML、reCAPTCHA 顯示限制原因並禁止插入。
- 九個 Blocks 分類各有一個可插入代表模板；插入時產生唯一 ID，展開成可獨立選取與編輯的 Section／Row／Column／Element 節點。
- Order form 模板只呈現付款限制節點，不包含付款 action 或成功流程。
- 尚未完成：所有 Elements 的專屬 inspector 與互動 renderer、Blocks 其餘視覺變體。
