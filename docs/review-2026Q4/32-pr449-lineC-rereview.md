# PR #449 工作線 C 複審

- 範圍：修正 commit a553686d、dfbd8ed0、27192a56（`git diff fb66c229..HEAD`，27 檔，+397／-66），並回頭快速看過整體 `78621ca3..HEAD`
- 對照：`docs/review-2026Q4/32-pr449-lineC-review.md`
- 審查者：reviewer（Opus），2026-10-19，全程唯讀
- 本機驗證（在 worktree 執行）：
  - 相關 20 個測試檔（含新增的 `global-error.test.tsx`）共 582 個測試全部通過
  - `npm run typecheck` 通過
  - 對整體 diff 的 ts／tsx 檔執行 `eslint`，無錯誤
  - `src/app/actions.ts` 的 CRLF 仍完整保留（2499 行全是 CRLF）
  - 用 scratchpad 的 tsx 探測腳本實測 C-01 與 C-04，用 node 腳本實測 C-06 守護
  - 沒跑的部分：新增的 `live-chat-analytics.db.test.ts` 需要 PostgreSQL，本機沒有跑（CI 的預設 `vitest run` 會執行）；Playwright 也沒有跑

## C-01 實測（擬真事件，再測一次）

| 項目 | 結果 |
|---|---|
| `event_id`（32 hex）、`release`（40 hex SHA）、`dist` | 原樣保留 |
| `contexts.trace.trace_id`／`span_id`／`parent_span_id`、`spans[].trace_id`／`span_id`／`parent_span_id` | 原樣保留，數字開頭的 span_id 也不再被電話規則切碎 |
| `debug_meta.images[].debug_id`、整個 `sdk`、`sdkProcessingMetadata.dynamicSamplingContext` | 原樣保留 |
| `@sentry/core` `createEventEnvelope` 的 header | `event_id` 是 32 hex，`trace.trace_id` 正確 |
| `exception.values[].value` 裡的 Email、電話、卡號 | 都變成 `[Filtered]` |
| `message`、事件內的 breadcrumb、獨立 breadcrumb（`data.url` 的 query 與 message） | 已遮蔽 |
| `extra.phone`、卡號、frame `vars.email`、span 的 URL query、`request` 的 cookie 與 query、`user` 只剩 id | 已遮蔽 |
| log 的 `message` 已遮蔽，`sentry.release` 保留 | 符合預期 |

## C-04 實測

用 `createTracesSampler(false)` 搭配模擬的 `inheritOrSampleWith` 測試：

- `POST /api/payments/payuni/notify`（從 name 解析路徑）、`http.target=/api/payments/checkout?x=1`、`url.path=/api/payments/x`：上游未取樣、上游已取樣、沒有上游三種情況都回傳 **1**。所以瀏覽器從 10% 取樣的商品頁發起的 `/api/payments/*`，在伺服器端仍是 100%。
- `/api/live-chat/*` 三種情況都固定回傳 0.005。
- 一般頁面會沿用上游決定，沒有上游時是 0.1。

## 逐條狀態

| ID | 原嚴重度 | 狀態 | 說明 |
|---|---|---|---|
| C-01 | BLOCKER | 已解決 | 新增 `PRESERVED_LEAF_KEYS`／`PRESERVED_SUBTREE_KEYS`，實測結果見上表。新測試改用真實格式 ID，並檢查 envelope header（`sentry-scrub.test.ts:223-277`）。殘餘問題見 R-01、R-02（NIT）。 |
| C-02 | MINOR | 已解決 | 預檢移到 `references` 解構之後，排除條件改用已綁 vendor 查到的 `existingLive?.id`（`actions.ts:1279-1280`；查詢在 `:978` 以 `vendorId` 限定）。如果送來的是別人的 live id，`existingLive` 會是 null，攻擊者只能得到「slug 是否被用掉」這個布林值，與 drafts route 相同，無法再判斷「某個 live 擁有某個 slug」。 |
| C-03 | MINOR | 已解決 | 撞名檢查包進 `checkSlug` 的 try；失敗時回 `slugCheckFailed: true`，草稿照常存檔，欄位顯示「送出時會再確認」。殘餘風險已記入 `docs/domain-workflows.md`「已接受的殘餘風險」。 |
| C-04 | MINOR | 已解決 | 付款與 webhook 固定回 1，輪詢固定回 0.005，不再沿用上游決定，實測結果見上節。 |
| C-05 | MINOR | 已解決 | 改成 `<label htmlFor="live-slug">直播網址</label>`，說明文字移到 label 外，只靠 `aria-describedby` 連結。可及名稱恢復為「直播網址」，accountant spec 的 exact 斷言重新有效。 |
| C-06 | MINOR | 部分解決 | 改成逐一檢查呼叫點，並新增行為測試（純函式模擬）與 DB 測試（一筆虛擬使用者訊息、一筆真人訊息，斷言只算到 1）。用同一套邏輯實測：未過濾的 `count`、跨行寫法、只在註解提到函式名的情況都**擋得住**。但下列情況**擋不住**：(a) 未過濾的呼叫後面 400 字內緊接著另一個有過濾的呼叫（例如 `Promise.all([db.liveChatMessage.count({ where: { vendorId } }), db.liveChatMessage.count({ where: realViewerMessageWhere(...) })])`，正是分析頁常見的寫法）；(b) `findMany(...).length`；(c) 用 `...realViewerMessageWhere()` 展開後再覆寫欄位；(d) `$queryRaw`。見 R-03。 |
| C-07 | MINOR | 已解決 | `publicRoleLabel` 改為 export。後台列表只顯示會公開的標籤；預覽在遇到系統預設字樣時提示「直播間不會顯示標籤」。 |
| C-08 | MINOR | 已解決 | 用 `retriedError === error` 判斷是否正在重試；出現新錯誤時按鈕自動恢復可按，有新測試。 |
| C-09 | MINOR | 已解決（文案） | `publish_not_ready` 補上「銷售直播至少需要一項商品，也可以改成內容直播」。staging 上受影響的資料筆數仍待 owner 或主對話查詢。 |
| C-10 | NIT | 部分解決 | 生效日與狀態判斷拆成 `policy-publication.ts`，結帳的 client bundle 不再帶入政策全文。生效日當天 00:00 前後 SSR 與 hydration 可能不一致的問題沒改，可以接受。 |
| C-11 | NIT | 已解決 | 改用 `valueRef`，不再在 updater 裡呼叫 setState。 |
| C-12 | NIT | 已解決 | 先判斷 `document.referrer` 是否同源，才執行 `router.back()`。 |
| C-13 | NIT | 未解決（可接受） | `InteractionRoleForm` 與 `interaction-role-label.ts` 仍是 dead code，留待 dead-code 清單處理。 |
| C-14 | NIT | 未解決（可接受） | `formatDateTime` 仍固定使用台北時間。 |
| C-15 | NIT | 未解決（可接受） | 「不計入在線人數」的文案等 D-10 定案時再確認。 |
| C-16 | NIT | 不需修改 | 不變。 |

## 複審新發現

| ID | 嚴重度 | 檔案:行號 | 情境 | 建議修法 |
|---|---|---|---|---|
| R-01 | NIT | `src/lib/sentry-scrub.ts`（`PRESERVED_LEAF_KEYS` 的 `filename`／`abs_path`） | 堆疊位置欄位完全不過濾。瀏覽器 inline script 的 frame 會以頁面網址當 `abs_path`，實測 `https://…/checkout/recover/g1?grant=secret123` 原樣送出。 | 對 `abs_path`／`filename` 只移除 query 與 fragment（`URL_QUERY_PATTERN`），其餘保留。 |
| R-02 | NIT | 同上（`key.startsWith("sentry.")`） | log 的 `sentry.message.parameter.N` 會原樣保留，實測一個 Email 照樣送出。目前程式沒有使用 `logger.fmt`，屬於潛在問題。 | 預留白名單只放 `sentry.release`、`sentry.environment`、`sentry.sdk.*`、`sentry.trace.*`；`sentry.message.*` 仍要過濾。 |
| R-03 | MINOR | `src/lib/live-chat-analytics.test.ts:88-90` | 守護用固定 400 字元的視窗，會「借用」後面相鄰呼叫的 `realViewerMessageWhere`，最常見的 `Promise.all` 並列寫法因此漏網；`findMany(...).length` 也沒有涵蓋。DB 行為測試只能證明這個 helper 本身正確，無法擋住繞過 helper 的新查詢。 | 視窗改成「到下一個 `liveChatMessage.` 出現的位置，或配對的右括號為止」，並把 `findMany` 納入：允許清單之外的檔案只要出現 `liveChatMessage.findMany` 就要求明確豁免。長期改用 ESLint `no-restricted-syntax`。 |
| R-04 | NIT | `src/lib/sentry-scrub.test.ts:1` | 測試直接 import `@sentry/core`，但 package.json 只宣告了 `@sentry/nextjs`，`@sentry/core` 是遞移相依。 | 改從 `@sentry/nextjs` 取用，或把 `@sentry/core` 加到 devDependencies。 |

## 整體 `78621ca3..HEAD` 快速確認

金流、租戶、權限與 migration 都沒有新問題：沒有 migration；結帳元件仍然只改文案，import 換成小模組；直播寫入、草稿 claim 與 P2002 的處理都沒變，ownership 仍綁 vendor。`interaction-roles-workbench` 這個 client 元件新 import 的 `live-chat-contract` 不含 server-only 相依。

## 結論

BLOCKER 已解決，所有 MAJOR 以上的問題都已清零。剩下 1 個 MINOR（R-03 守護的視窗漏洞）與若干 NIT，都不影響資料、金流或租戶安全，可以在後續 PR 處理。

可合併。
