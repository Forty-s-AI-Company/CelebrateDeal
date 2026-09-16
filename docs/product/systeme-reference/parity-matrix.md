# systeme.io → CelebrateDeal parity matrix

| 功能 ID | systeme.io 實測功能 | CelebrateDeal 對應 | 優先級 | 實測狀態／備註 |
|---|---|---|---|---|
| FUN-LIST-001 | Funnel 表格、搜尋、狀態、建立、分頁 | 中文 Funnel 管理清單 | 必做 | 已實際操作 |
| FUN-CREATE-001 | 名稱、網域、goal、幣別、Save 驗證 | 建立 Funnel wizard | 必做 | 已實際操作 |
| FUN-LIMIT-001 | 第四個 Funnel 被配額阻擋 | 配額計數與升級提示 | 必做 | 本帳戶上限實測為 3 |
| GOAL-001 | Audience/Sell/Custom/Webinar | 四種用途入口 | 必做 | Webinar 後續受限 |
| FUN-SELL-001 | Order/Thank-you/Inactive 預設流程 | 銷售 Funnel 預設步驟 | 必做 | 已實際操作 |
| FUN-AUD-001 | Opt-in/Thank-you/Inactive | 名單蒐集 Funnel | 必做 | 已實際操作 |
| FUN-CUSTOM-001 | 空流程 + Add step + 分群 step types | 自訂 Funnel 建構 | 必做 | 已實際操作 |
| FUN-WEB-001 | Evergreen webinar goal | Webinar Funnel | 仍需補查 | 方案阻擋 |
| TPL-SELL-001 | 模板 gallery、預覽、套用、分頁 | 銷售模板庫 | 必做 | 3 預覽、2 套用 |
| TPL-AUD-001 | Opt-in 模板庫 | 名單頁模板庫 | 必做 | 1 完整、2 受擴充功能干擾 |
| TPL-CUSTOM-001 | Privacy/Terms/品牌條款模板 | 資訊與法務模板 | 次要 | 3 預覽、1 套用 |
| EDT-LAYOUT-001 | 左欄 + 中央畫布 + toolbar | 全畫面編輯器 shell | 必做 | 已實際操作 |
| EDT-TB-001 | Undo/Redo/Popup/Settings/Mobile/Preview/Save/Exit | 編輯器命令列 | 必做 | 全部已點擊 |
| EDT-EL-001 | Text/Layout/Form/Payment/Media/Social/Other | 元件面板與 schema | 必做 | 全清單；代表性操作 |
| EDT-BLK-001 | 9 分類、81 個可見變體 | 區塊模板庫 | 必做 | 每類已點開；1 block 加入 |
| EDT-INT-001 | 選取、層級、樣式、move/copy/remove | 節點樹與 inspector | 必做 | 核心已操作；拖曳細節待補 |
| EDT-SAVE-001 | step auto-save、canvas manual-save、Exit 防呆 | 雙儲存模型與 dirty state | 必做 | 已實際操作 |
| EDT-RESP-001 | Desktop/Mobile override 與 visibility | RWD 編輯 | 必做 | 已實際操作 |
| EDT-TPL-001 | 換模板警告、保留 metadata、替換頁面 | 模板替換交易 | 必做 | 已實際操作 |
| EDT-POP-001 | Popup 列表、建立、觸發設定、樣式 | Popup 編輯器 | 次要 | 前台觸發仍需補查 |
| EDT-SET-001 | Typography/Language/Background/SEO/Tracking/Affiliate | 頁面設定 | 必做 | Tracking/affiliate 暫不做 |
| PAY-001 | Payment 元件與 Sell offer type | 商品／付款整合 | 方案限制或暫不做 | 未串商品、未輸入付款資料 |
| WEB-001 | Webinar 詳情、模板、編輯 | Webinar 模組 | 仍需補查 | webinars + funnels 配額阻擋 |

## 實作前必須再確認

1. 使用具 Webinar 額度帳戶補查預設 steps、模板、排程與 broadcast 行為。
2. Audience 再完成 26049/26048 的內容比較、套用與 Change template 保留規則。
3. Elements 各功能類型逐項拖入，尤其 Form、Payment、Media、Countdown、FAQ、Raw HTML。
4. Blocks 每類至少一個實際加入；確認跨 section 拖曳、排序、copy/delete 與巢狀限制。
5. Popup 儲存後在 Preview 驗證 auto delay、exit intent、close button。
6. Funnel settings、step 列尾選單、Automation/A-B/Stats/Leads/Sales/Deadline 各頁仍需專題調研。

