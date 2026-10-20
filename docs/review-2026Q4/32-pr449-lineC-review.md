# PR #449 工作線 C 獨立審查（codex/beta-lineC-first-success）

- 審查範圍：`git diff 78621ca3..fb66c229`（6 個 commit、58 檔，+1513／-197），worktree `C:\Users\eden\Downloads\AI\CelebrateDeal-wt-lineC`
- 審查者：reviewer（Opus），2026-10-19；只做唯讀檢查，沒有改程式
- 本機驗證（皆在 worktree 執行）：
  - `vitest run` 18 個相關測試檔（sentry-scrub、live-slug、drafts route、commerce-checkout-form、live-publish-readiness、merchant-onboarding、live-chat-contract、live-chat-analytics、format、not-found、live-slug-field、use-live-studio-draft、live-stepper-form、actions、interaction-role、interaction-roles-workbench、live-chat-panel、live-runtime-readiness）：556 個測試全部通過
  - `npm run typecheck`：通過
  - 對 58 個變更檔執行 `eslint`：無錯誤
  - 用 tsx 寫一支臨時探測腳本（放在 scratchpad），把擬真的 Sentry 事件丟進 `scrubSentryEvent`，用來確認 B-1
  - Playwright、DB 測試沒有跑

## 結論摘要

金流、租戶、權限與 migration 都沒有問題：結帳元件只改了文案，沒有 migration，直播寫入的 ownership 仍綁在 vendor 上。但 Sentry 過濾器會把每個事件的 `event_id`、`trace_id`、`release`、`debug_id` 一律遮成 `[Filtered]`，錯誤事件與交易在上線後等於失效，這是 BLOCKER。其餘是 MINOR 與 NIT。

| 嚴重度 | 數量 |
|---|---|
| BLOCKER | 1 |
| MAJOR | 0 |
| MINOR | 8 |
| NIT | 7 |

## Findings

| ID | 嚴重度 | 檔案:行號 | 情境 | 建議修法 |
|---|---|---|---|---|
| C-01 | BLOCKER | `src/lib/sentry-scrub.ts:176`（`scrubValue(event)` 走訪整個事件）、`:75`（`LONG_HEX_PATTERN`）、`:73`（`PHONE_PATTERN`） | `scrubSentryEvent` 對整個事件的每個字串都套用正規式。實測擬真事件的結果：`event_id`（32 碼 hex）→ `[Filtered]`；`release`（Vercel 的 40 碼 commit SHA）→ `[Filtered]`；`contexts.trace.trace_id` 與 `spans[].trace_id` → `[Filtered]`；`contexts.trace.span_id` `0123456789abcdef` → `[Filtered]abcdef`（被電話規則切碎）；`debug_meta.images[].debug_id` → `…-ef[Filtered]`。`@sentry/core` 的 envelope header 直接使用 `event.event_id`（`utils/envelope.js:148`），因此每個錯誤事件的 header 都是無效 UUID，交易與 log 的 trace_id 也全部無效。預期 Relay 會拒收或丟棄這些資料（這一點是依 Relay 的 ID 格式推論，沒有對真實 DSN 送件驗證）。就算 Relay 收下，release 對應、debug-ID source map、trace 串接也全部失效。結果是 `beforeSend` 名義上「永遠不丟事件」，實際上上線後付款路徑在內的錯誤監控等於歸零。測試只用了 `event_id: "evt"`、`span_id: "1"`，因此沒有抓到（`sentry-scrub.test.ts:118,137`）。 | 改成白名單結構：只對自由文字欄位做字串遮蔽，例如 `message`、`exception.values[].value`、`extra`、`contexts`（排除 `trace`）、`tags` 的值、`breadcrumbs`、`request`、`spans[].description`／`data`、log 的 `message`／`attributes`（排除 `sentry.*`）；`event_id`、`trace_id`、`span_id`、`parent_span_id`、`release`、`dist`、`environment`、`sdk`、`debug_meta`、`timestamp`、`start_timestamp`、`sdkProcessingMetadata`、`contexts.trace` 一律原樣保留。補上用真實格式 ID（32 hex event_id／trace_id、16 hex span_id、40 hex release、UUID debug_id）的測試，斷言這些欄位完全不變，並加一個用 `createEventEnvelope` 檢查 header `event_id` 為 32 hex 的測試。 |
| C-02 | MINOR | `src/app/actions.ts:1240-1241` | 撞名預檢 `requireLiveSlugAvailable` 拿表單送來、尚未驗證 ownership 的 `id` 當作 `excludeLiveId`，而 ownership 要到後面的 `resolveSubmittedLiveReferences`／`hasInvalidReference` 才檢查。攻擊者可以送出「其他租戶的 live id ＋ 某個 slug」：回 `slug_taken` 代表該 slug 不屬於那場直播，回 `invalid_reference` 代表 slug 是空的或正好屬於那場直播。這等於一個「某 live id 是否擁有某 slug」的跨租戶判斷（前提是要知道對方的 cuid，所以風險低）。最終寫入仍綁 vendor，資料不會被改動。 | 把預檢移到 `existingLive` 驗證之後，改傳 `existingLive?.id ?? null`；或者在 `id` 不屬於目前 vendor 時一律先回 `invalid_reference`。 |
| C-03 | MINOR | `src/app/api/live-studio/drafts/route.ts:35-36` | (1) 撞名查詢放在 `try` 之外：DB 暫時失敗時會丟出未處理例外，變成沒有 JSON envelope 的 500，連帶讓這次草稿自動存檔失敗，而存檔本身其實可以成功。(2) slug 是全站唯一（`schema.prisma` `slug String @unique`），任何商家成員都能用自動存檔判斷「某 slug 是否被任何租戶用掉」，包含其他租戶尚未公開的草稿直播。只回布林值、不回 id，而且在全站唯一的前提下，送出時的 P2002 本來就有同樣的訊號，所以屬於可接受的殘餘風險。 | (1) 把查詢包進 `try`，失敗時回 `slugTaken: false`（或省略這個欄位），不要讓存檔失敗。(2) 在 `docs/domain-workflows.md` 或 PRISMA_INVARIANTS 記一筆「slug 全站唯一，撞名提示會揭露是否已被使用」作為已接受風險；之後如果要改成租戶命名空間，再另開議題。 |
| C-04 | MINOR | `sentry.server.config.ts:24`、`sentry.edge.config.ts`、`src/instrumentation-client.ts`（`inheritOrSampleWith`） | `inheritOrSampleWith` 會沿用上游 trace 的取樣決定。瀏覽器在商品頁、直播頁（預設 10%）發出的 `/api/commerce`、`/api/checkout` 請求，在伺服器端會沿用 10%，所以「付款路徑 100%」只對沒有上游的 webhook 成立。反過來，輪詢 `/api/live-*` 在有上游 trace 時也會沿用 10%，不是 0.5%。成本方面：沒有上游時，100% 只會落在 webhook 與 checkout 這類低流量路徑，沒有成本疑慮；主要的量其實來自上述的繼承行為。 | 如果要確保付款路徑全取樣：伺服器端對 `CRITICAL_PATH_PATTERN` 直接回傳 `1`，不經過 `inheritOrSampleWith`（接受 trace 斷鏈）；或在 client 對會呼叫結帳 API 的頁面（`/p/`、`/live/`、`/lp/`）提高 pageload 取樣率。輪詢路徑則在伺服器端直接回傳 0.005。同時把實際行為寫進註解與測試。 |
| C-05 | MINOR | `src/components/live-slug-field.tsx:57-90`；`tests/e2e/accountant-lives-new-direct-url.spec.ts:202` | 包住 input 的 `<label>` 也包住了說明文字與錯誤訊息，所以 input 的可及名稱會變成「直播網址觀眾會用這個網址…」（`/live/` 前綴有設 aria-hidden）。accountant spec 用 `getByLabel("直播網址", { exact: true })` 斷言數量為 0，這個斷言現在恆真：就算表單被錯誤地顯示出來，也測不到。以前的 `"Slug"` 可以精確比對。這不是刪掉斷言，而是讓斷言失效。另外螢幕閱讀器每次聚焦都會唸出整段說明。 | `<label htmlFor="live-slug">` 只包「直播網址」，說明與錯誤訊息移到 label 外，只靠 `aria-describedby` 連結。修好後確認 smoke 與 accountant spec 的 `getByLabel("直播網址", { exact: true })` 在有權限時找得到這個欄位。 |
| C-06 | MINOR | `src/lib/live-chat-analytics.test.ts:75-91` | 原始碼掃描只用「檔案裡有沒有出現 `realViewerMessageWhere` 字串」來判斷。只要同一檔案有一處用了它，另一處繞過它的 `count` 也會過關。`findMany(...).length`、`$queryRaw`、跨行寫法 `liveChatMessage\n  .count(` 也都抓不到。範圍只涵蓋 `liveChatMessage`，沒有涵蓋彈幕、互動回應或抽獎參與等可能把虛擬使用者算進去的表。新增的 `realViewerMessageWhere` 斷言本身是有效的。 | 改成逐一呼叫點檢查：以 `liveChatMessage.(count\|aggregate\|groupBy\|findMany)` 的每個 match 為單位，往後檢查參數區塊；更好的作法是 ESLint `no-restricted-syntax`，禁止在 `live-chat-analytics.ts` 以外直接呼叫 `liveChatMessage.count`。另外補一個 DB 測試：同時寫入一筆角色訊息與一筆真人訊息，斷言 dashboard KPI 與直播分析只算 1。 |
| C-07 | MINOR | `src/lib/live-chat-contract.ts:61-76`；`src/components/interaction-roles-workbench.tsx:304,482` | 輸出層會把「官方角色、一般觀眾、AI 主持人、系統助手、客服助手」都當成沒有標籤。造成兩個副作用：(1) 既有資料（舊的 10 個內建角色與 schema 預設 `label @default("官方角色")`）在後台列表與預覽仍顯示「官方角色」，但直播間不顯示，預覽和實際畫面不一致。(2) 商家如果自己刻意填了「客服助手」，直播間也會默默隱藏。後台角色名（`name`）不受影響，這部分沒問題。把 10 個內建角色的 label 改成空字串只影響之後的匯入；既有資料由輸出過濾處理，不需要 migration。 | 預覽改用同一個 `publicRoleLabel` 判斷，顯示「直播間不顯示標籤」的提示；如果標籤欄填的是系統預設字樣，在表單上說明會被隱藏。可另外評估一支 forward-only 的資料 migration，把既有的預設標籤清空（需登記 PRISMA_INVARIANTS），但不急。 |
| C-08 | MINOR | `src/app/global-error.tsx:28,45` | `retrying` 設成 true 之後沒有任何地方會重設。如果 `retry()` 之後根 layout 仍然出錯，GlobalError 會帶著新的 `error` 重新渲染，但按鈕一直停在「正在重新載入…」並維持 disabled，使用者只剩「回首頁」可以按。`retry` 的用法、`<html>`／`<body>` 的寫法都符合 Next 16.3.8 文件（`error.md` 第 117、163-202 行）。 | 比照 `RouteErrorFallback` 改用 `useTransition`，或用 `useEffect(() => setRetrying(false), [error])`。 |
| C-09 | MINOR | `src/lib/live-publish-readiness.ts:54` | 改成 `productsReady && productCount > 0` 之後，只要是 `studioPreset=COMMERCE` 且沒有商品的直播，就無法公開。以前 `[].every()` 恆真，所以這類直播只會被「互動腳本」擋住。新行為合理，銷售直播本來就應該有商品；但已排程、COMMERCE 預設、沒有商品、而且當初靠已發布腳本通過檢查的既有直播，現在任何編輯都會被 `publish_not_ready` 擋下。runtime 檢查沒有傳 preset，會自動判成 content 模式，所以不影響觀看端。 | 先在 staging 查一下這類資料有幾筆；如果有，`publish_not_ready` 的文案要明確指出「銷售直播至少要一個商品，或改成內容直播」。 |
| C-10 | NIT | `src/components/commerce-checkout-form.tsx:507` | 確認只改了文案：金額、送出與付款邏輯都沒動，測試涵蓋 11/01 前後兩種狀態，`resolvePolicyStatus` 以台北日期比較，前後都正確。殘餘問題有兩個：client component 在 SSR 與 hydration 時各自用當下時間計算，只有在台北 11/01 00:00 前後送出的那次請求（或使用者時鐘偏差）會出現文字不一致。另外，import 整個 `public-policy-content` 可能把三份政策全文打包進結帳的 client bundle。 | 由伺服器把 `status` 當 prop 傳下來；或者把 `policyCenterPublication`／`resolvePolicyStatus` 拆到不含全文的小模組。 |
| C-11 | NIT | `src/components/live-slug-field.tsx:40` | 在 `setValue` 的 updater 裡呼叫 `setAutoFillCount`，updater 不是純函式。StrictMode 會執行兩次，導致多觸發一次草稿存檔。 | 先算出 `next`，比較後在 effect 本體裡分別呼叫 `setValue` 與 `setAutoFillCount`。 |
| C-12 | NIT | `src/components/history-back-button.tsx:11` | `window.history.length > 1` 不能代表上一頁是本站。從外站點進來時，「返回上一頁」會回到外站。 | 可以接受；或改用 `document.referrer` 的同源判斷。 |
| C-13 | NIT | `src/components/interaction-role-form.tsx`、`src/lib/interaction-role-label.ts` | `InteractionRoleForm` 已經沒有任何地方引用，本 PR 對它的修改不會生效；`interaction-role-label.ts` 現在只剩自己的測試在用。 | 列入 dead code 清單（20-dead-code-residue）之後一併移除。 |
| C-14 | NIT | `src/lib/format.ts:12` | `formatDateTime` 一律用台北時間而且不標示時區。商家時區如果不是 Asia/Taipei，排程輸入用商家時區、列表卻顯示台北時間。對所有呼叫端（54 處）而言，沒有重複換算；改成固定時區之後，server 與 client（`blacklist-search-list.tsx`）的輸出反而一致；資料庫仍存 UTC。 | 直播與排程相關頁面改傳 `vendor.timezone`；或者在非台北時區時附上 `formatTimeZoneLabel`。 |
| C-15 | NIT | `src/components/interaction-roles-workbench.tsx:544`、`src/components/scripted-roles-control.tsx:51` | 文案寫「不計入觀眾端在線人數」，但 D-10 還在決策中。目前系統沒有在線人數功能，所以這句話暫時成立，不過等於先替尚未定案的決策下了結論。 | D-10 定案時同步確認這兩處文案。 |
| C-16 | NIT | `src/lib/live-chat-contract.ts:105` | 觀眾端 DTO 仍帶 `source: "scheduled"` 與 `presentationRole`，在瀏覽器的網路面板看得到。這符合 PRODUCT.md 第 31 行「虛擬使用者只存在於觀眾端聊天室」與揭露語的精神，不要求修改，只是記錄下來：「不標示」只做到 UI 層。 | 不需修改；如果 owner 要更徹底，另開議題。 |

## 逐項檢查結果

1. **結帳元件**：diff 只有一行文案與一個 import，沒有動到金額、送出或付款邏輯；`resolvePolicyStatus` 在生效前顯示「將自」、生效後顯示「自」，測試涵蓋兩種狀態。殘餘問題見 C-10。
2. **actions.ts 直播建立**：CRLF 已保留（2495 行全部是 CRLF，diff 只有 +27 行）；只改了 `commitLiveDraftOrRedirect`、新增兩個 helper，以及 `upsertLiveAction` 的兩處呼叫，同檔其他區段沒動。P2002 的處理是攔截後再查一次 slug，確認是撞名才 redirect，其他唯一鍵衝突照常拋出（有測試）。建立草稿的 claim 與 `live.create` 在同一個交易裡，回滾後草稿保留，redirect 會帶上 `draft=`。最終寫入的 ownership 仍綁 vendor。預檢順序有問題，見 C-02。
3. **drafts route**：只多回傳 `slugTaken`。`liveId` 先驗證屬於本 vendor，之後才當作排除條件，所以不能拿別人的 live 來排除。slug 是全站唯一，查重本來就無法綁 vendor，殘餘風險見 C-03。
4. **虛擬使用者**：系統預設標籤在輸出層會被視為無標籤，後台角色名不受影響，副作用見 C-07。原始碼掃描測試只能部分守住，見 C-06。改成「部分互動」的揭露語，與 master 上已更新的 PRODUCT.md（第 22、31 行）及 domain-workflows（第 20 行）一致。注意本 PR 的 base（78621ca3）早於這次文件更新，worktree 裡的 PRODUCT.md 仍是舊版規則；合併後以 master 為準即可。
5. **not-found／error**：`retry` 是 Next 16.3 的穩定 API，用法正確。`global-error` 有包含 `<html>`／`<body>`，也用行內樣式。`(viewer)` 底下只有 `live/[slug]`，所以 `(viewer)/not-found` 只會攔到直播頁的 `notFound()`，不會影響其他路由；沒有對應路由的網址由根層 `not-found.tsx` 處理。殘餘問題見 C-08、C-12。
6. **formatDateTime**：沒有重複換算，server 與 client 的輸出一致，資料庫仍存 UTC。建議見 C-14。
7. **Sentry**：`dataCollection` 的欄位名稱與 `@sentry/core` 10.64 的 `DataCollection` 型別逐一比對過，全部正確。「`sendDefaultPii` 已棄用，而且與 `dataCollection` 並存時會被忽略」的說法與 `options.d.ts:345-356` 一致。`beforeSend` 雖然不回傳 null，但會破壞事件識別欄位，見 C-01。正規式的誤判方向確實是「多遮」，可是多遮到了結構欄位，所以列為 BLOCKER。付款路徑 100% 取樣沒有成本疑慮，但因為繼承上游決定，實際上達不到 100%，見 C-04。
8. **發布 readiness**：互動腳本改成建議項目、商品要求數量大於 0，方向合理。對既有資料的影響見 C-09。
9. **Playwright**：三個 spec 只把 `Slug` 改成 `直播網址`，沒有刪任何斷言，但其中一個精確比對的斷言因此恆真，見 C-05。

## 結論

C-01 會讓上線後的 Sentry 錯誤監控失效，必須先修並補上擬真 ID 的測試；C-02、C-05 建議在同一輪一起修。

需修正後再審。
