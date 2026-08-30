# G7-45 Live Studio 跨步即時預覽與 Bombmy 唯讀校準

- Work Package：G7-45
- 日期：2026-08-09（Asia/Taipei）
- 模式：PRELAUNCH_DEV_AUTONOMOUS
- 結果：PASS
- Writer：主 control-plane（產品程式、測試、runner、證據）
- 唯讀競品盤點：Codex Terra High

## 產品問題與修改

Live Studio 已有五步流程、伺服器草稿、版本衝突保護與最後發布預覽，但商家在前四步無法持續看到買家手機畫面。這與既有功能 scorecard 的「persistent preview」缺口一致。

本輪完成：

1. 桌面版在五個步驟右側持續顯示 sticky 手機預覽。
2. 行動版在前四步提供可用鍵盤展開的即時預覽，第五步保留完整發布預覽。
3. 標題、促銷短句與商品選擇會同步更新預覽。
4. 將預覽拆成可重用元件，維持既有每函式 300 行 ESLint 上限。
5. 修正 Axe 找出的三類色彩對比：說明文字、透明覆蓋層、橘色 CTA。
6. Browser runner 新增 `--focus-live-studio` 精確模式，只驗證 Live Studio 契約，且桌面與行動截圖都必須存在才可 PASS；既有完整七項契約未縮減。
7. Axe 失敗摘要改為保留 selector 最後三層，提升定位能力，沒有降低 WCAG tags、impact 或 assertion。

## Bombmy 唯讀盤點

Terra High 使用已登入 Chrome，依 Chrome skill 以安全 GET、可見 DOM、小範圍 locator 與截圖完成盤點。全程沒有建立、儲存、上傳、發布、刪除或送出 Bombmy 資料，也沒有讀取帳密、Cookie、Token 或 browser storage。

已驗證：

- `/manage-live`：影片卡片庫、搜尋、新增入口、影片上傳對話框。
- `/manage-live-stream`：直播管理表格、空狀態、建立入口。
- 建立直播前的類型選擇對話框。
- 上傳前格式、大小、必填名稱與網路穩定提醒；開啟流程有遮罩 loading。

未驗證：

- 真實上傳進度、失敗重試、取消或續傳。
- 建立後草稿續作、發布、預覽與狀態轉換。
- 任何需要送出資料的流程。

可採用的產品原則為「先說明限制、先選目的、長操作立即回饋、清單空狀態清楚」。不複製 Bombmy 品牌、文案或受保護內容。

## Source lineage

| 路徑 | SHA-256 |
|---|---|
| `src/components/live-stepper-form.tsx` | `1b7e4823d6aaa8ddae6844a7753bac83bd986a9403b47b0f012caaf864122fb7` |
| `src/components/live-stepper-form.test.tsx` | `13221a836472040c9e1ddc8cb03c1e4c42659e07fc4af3bef2bfd395205b9802` |
| `tests/e2e/commerce-orders.spec.ts` | `13474850a70f58d2a144e606439cfa9787fdbefbad224528fed0d93837ce9419` |
| `scripts/g7-commerce-browser-qa.mjs` | `d7069cb485cde95b00ef243a2d47e2b3031d7f3fc83ef35588006116d40faf42` |
| `scripts/g7-commerce-browser-qa.test.mjs` | `69df8b51cea6b4564abc5a72e875ffed2e31d0234154cc2e6e5aa4f470aefc30` |

## Deterministic 與 Browser 證據

### PASS

- `npx vitest run src/components/live-stepper-form.test.tsx src/lib/live-preview.test.ts`
  - 2 files、21 tests PASS。
- `node --test scripts/g7-commerce-browser-qa.test.mjs`
  - 14 tests PASS，包含 focused mode 不可缺少兩張 RWD 截圖的契約。
- ESLint：修改的 component、unit、E2E、runner 全部 PASS。
- `npm run typecheck`：PASS。
- `git diff --check`：PASS；輸出只有既有工作區 LF／CRLF warning，沒有 whitespace error。
- `node scripts/g7-commerce-browser-qa.mjs --focus-live-studio`
  - receipt：`g7-45-live-studio-browser-qa-e39fc82252abf8d9.json`
  - receipt SHA-256：`9a66f8bf07be1e71b266eab8478b628d339bb1c666199fc600d448c764bf398c`
  - production Next build PASS。
  - 50 個 canonical migrations PASS。
  - Browser 1/1 PASS、0 failed、0 skipped。
  - Axe critical/serious = 0。
  - desktop/mobile RWD PASS。
  - server、container、temp root cleanup 全部 PASS。
  - 桌面圖：`live-studio-desktop.png`，SHA-256 `ab1b4e1e022bfa93503deea7603810e97e26ddd11cd8aa1aa69ae506220bd9c9`。
  - 行動圖：`live-studio-mobile.png`，SHA-256 `035f22392ee8717b0f9b2c52989e87331fe0719d52966443cbd693c9f193b225`。

### 保留的失敗證據

| Receipt | 分類 | 處理 |
|---|---|---|
| `g7-04-browser-qa-fec21516ac6676bf.json` (`35cf7a8b...613cb9f`) | checkout timeout，Live Studio 尚未執行 | 不重跑完整命令，新增精確 focused route |
| `g7-45-live-studio-browser-qa-a8a214755f7716ee.json` (`756de3a1...d9fd15`) | Axe color contrast | 修正 aside 說明與預覽字色 |
| `g7-45-live-studio-browser-qa-e60de7366abb4269.json` (`182d616f...1415e`) | `/lives/new` 單次 500 | 切到 diagnostic-dev，後續未重現 |
| `g7-45-live-studio-browser-qa-40963b4e5c2e572d.json` (`0f8235ed...1b2c`) | Axe color contrast | 將透明 overlay 改為實色高對比 |
| `g7-45-live-studio-browser-qa-d59bb177e3203dbc.json` (`fdb3e4b4...f6fc`) | Axe selector 被摘要截短 | 改善安全診斷格式，保留 selector 尾端 |
| `g7-45-live-studio-browser-qa-efdcdc6d71a4f730.json` (`8cb8a339...90f6`) | 橘色 CTA 對比不足 | `orange-500` 改為 `orange-700` |

所有失敗均維持 FAIL／NOT_VERIFIED，沒有改寫成 PASS。

## 計分與 blocker

- `live_studio` 功能分數具資格由 8.7 提升為 8.9：UX 1.7 → 1.9。
- canonical CAT01～CAT10 本輪維持 74；CAT04=6、CAT10=4.5，沒有外部或真人證據，不調高。
- Goal 維持 ACTIVE。
- Bombmy 送出後流程受唯讀限制，本輪明確標示未驗證，不交由使用者立即處理。

## 回滾範圍

只需回滾本輪五個 source/test/runner 檔案與本證據、receipt、兩張截圖、scorecard 更新。沒有 migration、正式資料、正式服務、push、merge 或 deploy。

## 下一個最高價值工作

G7-46 候選：Live Studio 目的／版型開始器。先以「內容直播」與「銷售直播」提供安全預設與說明，沿用既有五步草稿與發布 readiness，不覆寫商家已輸入內容。需先做 source review 與可回復套用規則，再決定實作範圍。
