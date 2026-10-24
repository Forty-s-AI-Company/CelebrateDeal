# 一頁式網站編輯器重構計畫（對標 systeme.io）

日期：2026-10-24
對標對象：systeme.io › Sites › Sales funnels › 招商 (TEST2) › Edit page（擁有者提供的截圖）

## 0. 規格來源

以 2026-09-17 實際操作 systeme.io 的實測基準為規格，文件已複製到 [docs/product/systeme-reference/](product/systeme-reference/README.md)（功能 ID 如 `EDT-LAYOUT-001`、`EDT-TB-001`、`EDT-INT-001` 皆出自該處）。對應截圖共 100 張（11 MB），未納入 git，存放於本機 `.ai-team/tmp/vnext-node-validation/docs/product/systeme-reference/screenshots/`；文件內引用的檔名即該資料夾的檔名。

重點規格摘要：
- `EDT-LAYOUT-001`：固定頂部工具列＋左側面板（可收合）＋中央可捲動畫布；沒有右側欄。
- `EDT-TB-001`：復原／重做（依歷史 enabled/disabled）、彈出視窗、頁面設定；選取節點時工具列中間顯示層級路徑（Section › Row › Text）；右側手機切換、預覽（新分頁看**已儲存**版本）、儲存（無變更時 disabled）、離開（有未存變更時詢問「尚未儲存，要先儲存嗎？」）。
- `EDT-INT-001`：選取後左側面板變成該節點設定，頂端「返回」＋上移、下移、複製、存成區塊、刪除；設定依「字型／顏色／尺寸與位置／進階」分組，滑桿＋數字框；文字可直接在畫布編輯。
- `EDT-SAVE-001`：步驟資料（名稱、網址）在管理頁離焦自動儲存；畫布手動儲存，並清楚顯示是否有未儲存變更。
- `EDT-RESP-001`：桌機／手機各自的字級、間距覆寫與「桌機／手機顯示」開關。
- `EDT-EL-001`、`EDT-BLK-001`：元件依「文字、欄位版型、表單、付款、媒體、社群、其他」分類；版型區塊九大類，加入後展開為可個別編輯的 Section › Row › 子元素。

## 1. 現況與差距

| 面向 | systeme.io | CelebrateDeal 現況 | 差距 |
|---|---|---|---|
| 漏斗管理頁 | 步驟清單＋Configuration／Automation／A/B／Stats／Leads／Sales／Deadline 分頁；View funnel step、Change page template、Edit page | `/landing-pages/[id]/operations` 已有同樣的步驟清單與 7 個分頁 | 小：保留，只修文案與發布狀態呈現 |
| 編輯器外框 | 全螢幕；只有頂部工具列 | 編輯頁在 `(app)` 路由群組內，被後台側欄、導引面板包住；上方還有發布條件提示與一排「儲存草稿／預覽草稿／發布已儲存草稿／複製頁面／刪除」 | **大**：畫布被擠成四欄中的一欄，1280px 筆電上卡片每行只剩 3–4 字 |
| 頂部工具列 | Logo｜復原／重做｜Popups｜Settings｜History ……｜裝置切換｜預覽｜Save｜Exit | 工具列按鈕分散在兩處（workspace 一列、編輯器左欄一列），中英混用 | 中 |
| 左側面板 | Elements／Blocks 兩個分頁；元件依「文字、媒體、欄位版型、表單…」分類的圖示格；選取元件後同一面板切換成屬性設定，可收合 | 7 個小按鈕分頁（元件、版型區塊、設定、頁面、彈出視窗、換模板、流程）；元件是 36 個純文字按鈕；另有獨立的步驟清單欄 | **大** |
| 版型區塊 | 依類別（Opt-in forms、Features、Page footers、Team、Welcome、Price plans、Page headers、Testimonials）分組，點進去看縮圖清單 | 單一長清單，只有文字說明，沒有縮圖 | 中 |
| 畫布互動 | 直接在畫布上點文字編輯、hover 外框與浮動工具（移動／複製／刪除）、拖放有插入指示 | 點選後到左欄表單改文字；拖放沒有插入位置提示 | **大** |
| 渲染品質 | 模板有真實圖片、標題有明確字級層次 | 模板主視覺全是破圖（`/placeholder.svg` 404）；H1 與內文字級差不多 | 中（破圖由 PR「問題 1」修） |
| 舊系統 | — | ~~仍留有 Puck 編輯器（`landing-page-editor.tsx`、`landing-page-puck-config.tsx`、`workspace-editor.tsx`）~~ R4 已移除；舊版頁面改由轉換器以新版編輯器開啟 | 已處理 |

資料模型 `PageDocument`（節點樹、`funnel-page-history` 指令與復原、彈出視窗、`flow` 步驟）結構健全，**本次重構不改資料格式、不需要 migration**，以替換編輯器介面與互動為主。

## 2. 分階段 PR

每個階段一個 PR，在 `ai/*` 分支上進行，依序合併；每階段都要能獨立上線、不破壞既有已發布頁面。

### R1 全螢幕編輯器外框與左側面板
- 新路由 `/landing-pages/[id]/edit?step=`，放在不含 AppShell 的路由群組；沿用 `requireVendorManager` 與既有 ownership 檢查，不新增資料存取路徑。舊的 `/landing-pages/[id]` 轉址到新路由。
- 頂部工具列：返回管理頁｜復原／重做｜彈出視窗｜頁面設定｜版本紀錄 ……｜桌機／手機｜預覽｜儲存｜離開。
- 左側面板只保留「元件／版型區塊」兩個分頁；元件依類別分組並加圖示；選取節點時面板切換成屬性設定（含「返回」），面板可收合。
- 從編輯器移除步驟清單欄與「儲存草稿／預覽草稿／發布…」整列；步驟切換與發布回到管理頁（與 systeme.io 一致）。發布條件改成工具列上的狀態標示＋說明，不再佔用版面。
- 畫布佔滿剩餘寬度。

### R2 畫布直接編輯
- 文字、標題、按鈕可在畫布上直接編輯（inline），失焦時寫入歷史紀錄，可復原。
- hover 外框＋選取時的浮動工具列（拖曳、上移、下移、複製、刪除）。
- 拖放時顯示插入位置指示；鍵盤 Delete、Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z。

### R3 版型區塊庫與渲染品質
- 版型區塊依類別分組，點進類別看縮圖清單（縮圖用既有渲染器以 preview 模式產生）。
- 渲染器標題字級層次（H1–H3）、預設間距與字型；模板改用真實或設計過的示意圖。

### R4 清理
- 確認無引用後移除 Puck 舊編輯器與相關設定、測試。
- 文件與 QA 腳本更新。

**完成紀錄（分支 `ai/landing-page-editor-r4-remove-puck`）**
- 新增純函式轉換器 `src/lib/legacy-landing-page-converter.ts`：舊版 `LandingPageContent`（schema v1）的 17 種區塊各自對應到 Section › Row 與新版元件；文字、連結、報名表與直播綁定都保留，節點 ID 由舊版區塊 ID 決定性推導（重開同一份草稿 ID 不變），輸出一律通過 `parsePageDocument`。沒有對應設定的項目（例如 YouTube 內嵌、輪播內放圖片、倒數到期處理、字重、兩欄比例）列入轉換報告，內容不靜默丟棄；舊版本來就不顯示的欄位保留為隱藏內容。
- 編輯器開啟舊版頁面時，在瀏覽器端轉換並顯示說明「這是舊版頁面，已轉換成新版編輯器格式；儲存後會以新版格式保存。舊版內容在你儲存前不會被改動。」與轉換報告。儲存沿用既有 save action，伺服器端驗證不變；**不需要 migration，資料契約不變**（`PageDocument` 本來就是可儲存格式）。
- 已發布的舊版版本在重新發布前，公開頁仍由 `landing-page-renderer.tsx` 渲染（以快照測試固定輸出）。
- 新版渲染器的 `/form/...` 報名表連結沿用舊版的 UTM、推薦碼與來源頁（`lp`）參數，避免轉換後的報名按鈕失去歸因。
- 移除 `landing-page-editor.tsx`、`landing-page-puck-config.tsx`、`WorkspaceEditor` 的舊版分支，以及未被使用、會遺失內容的舊轉接器 `landingPageContentToPageDocument`／`pageDocumentToLandingPageContent`。
- 解除安裝 `@puckeditor/core`；`happy-dom` 改為明確的 devDependency（測試環境需要），移除只為 Puck 加的 `overrides.happy-dom`。`npm audit --omit=dev --audit-level=high` 為 0。
- 已知差異：舊版倒數「依直播開播時間」轉為固定時間；新版倒數不支援到期訊息／隱藏按鈕／轉址；YouTube／Vimeo 改為連結；主視覺背景圖改為一般圖片。以上都會出現在轉換報告。

## 3. 擁有者決定的產品規則

- **2026-10-24 決定**：「建立名單」型網站（flow goal `audience`）可以獨立發布，不受所屬專案的發布條件限制（商品、價格、直播、諮詢、付款方式等），對標 systeme.io 漏斗可獨立發布。其他目標（銷售、銷講等）維持需要專案發布。此變更以獨立 PR（`ai/audience-funnel-independent-publish`）實作，涉及公開範圍與租戶邊界，合併前需要獨立審查。

## 4. 驗收

- 每個 PR：targeted vitest、`npm run typecheck`、`npm run lint`、`quality` CI。
- R1、R2 另外以內建瀏覽器在 1280×800 與手機寬度實測：建立 → 套模板 → 編輯 → 儲存 → 重新整理後內容保留 → 預覽。
