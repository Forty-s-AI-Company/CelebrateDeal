# G7-29 Live publish and runtime readiness checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。Live Studio 的第五步現在會區分銷售型與內容直播，顯示可操作的發布條件；Server Action、公開直播頁與 viewer admission 共用相同 readiness 原則。草稿可保留不完整內容，公開狀態會 fail closed，已排程直播也能安全下架回草稿。

## 產品修正

- 有商品的直播視為銷售型直播，發布前要求：可播放媒體、啟用且確認履約類型的商品、有效報名表、可寄送的報名成功 Email、已發布互動腳本。
- 沒有商品的內容直播保留簡化流程，公開前仍要求可播放媒體。
- 第五步顯示每項 readiness 的已完成／待完成狀態，缺口可直接跳回對應步驟。
- 發布、開始直播與保留回放會依 readiness 停用按鈕；Server Action 會重新驗證，client forged request 無法繞過。
- `scheduled` 與 `ended` 可下架回 `draft`，提供明確確認、pending 與防重送回饋。
- 新建直播仍只能先建立 private draft，無法直接 forged `scheduled`。
- 編輯頁只提供 active、可用的商品、表單、Email、媒體與腳本；歷史 stale reference 會顯示警告並在下次儲存解除。
- 公開頁與 `/api/live-admission` 每次請求都重新驗證 runtime readiness。發布後若媒體、商品、表單、Email 或腳本失效，會在建立或刷新 viewer session 前回 404。
- 公開表單額外要求與 live 同 vendor，避免 tenant 關聯異常時外洩其他商家的表單結構。

## 權限與安全邊界

- `upsertLiveAction` 每次重新執行 CSRF、登入角色、vendor scope 與 reference ownership 檢查。
- Product、Video、RegistrationForm、MessageTemplate、InteractionScript 與 ImageAsset 都由 server 依目前 vendor 解析。
- Runtime predicate 同時驗證 live relation 與 product relation 的 vendor id。
- UI disabled 只提供即時回饋，最終判斷位於 Server Action、公開 Server Component 與 admission transaction。
- Runtime 不回傳 readiness 細節給匿名 client；不可用直播使用既有 bounded 404 訊息。
- 沒有讀取或傳送 `.env*`、Token、Cookie、正式 Secret、正式客戶或付款資料。

## Fresh deterministic evidence

- 最終 UTC：`2026-08-09T07:09:01.8797302Z`
- Final live regression：35 test files、`444/444 PASS`、failed=`0`、exit code=`0`。
- Readiness／public page／admission／actions targeted tests：最終納入上述 444 tests；所有新增 stale media／form／email／script／product cases PASS。
- Scoped ESLint：PASS，exit code=`0`。
- Full `npm run typecheck`：PASS，exit code=`0`。
- `git diff --check`：exit code=`0`；只有既有 Windows LF／CRLF warning，沒有 whitespace error。
- 本 WP 沒有 schema 或 migration 變更，因此沒有執行 disposable PostgreSQL。
- 本 WP 沒有執行 Browser、staging、Sandbox 或 Production 操作；不把未執行項目標示為 PASS。

## Reviewer

- 第一輪唯讀 reviewer 找到 1 個 P1：發布後 stale resource 仍可能繼續公開與 admission。
- 修正後由同一 reviewer 複核：`RESOLVED`，原 P1 無法重現。
- Reviewer 確認 public page 與 admission 都在 viewer session 前使用共用 runtime predicate。
- Reviewer 修正後另跑 7 files、`51/51 PASS`，沒有修改檔案。
- 最終沒有未解決 P0／P1。

## Source digests

- `0AB06A0FE6102E6EA57648060E5681ACF55C1EF02C34D72A7A295496093E7DB7  src/lib/live-publish-readiness.ts`
- `D9F9749EFF594723B25B03892BAB5FB5324D6AB544BF601F0CA6078E11A038DC  src/lib/live-publish-readiness.test.ts`
- `CAE6262F88367AD2E5044111C32731795F1E7F2E45AC7A2ED1ABBC03B620D5C4  src/lib/live-runtime-readiness.ts`
- `3024103134D39B02DD96591FC0F222446E1E2BFFE24A244CB8EDF74F28384B97  src/lib/live-runtime-readiness.test.ts`
- `1B6B935DDF72EE685689D96EF1D73BC1EA84D4844CA773381B9B101B01279757  src/lib/message-template.ts`
- `3A1204262EA98F2658FCC3359FF7B7530E8635C1E007BB354F93C4A3C572AC53  src/lib/sellable-live.ts`
- `0757CA93775460197FA0847C74F2612D7EECCF00B4991DE04DA3986E7ED0FD7B  src/lib/live-quota-admission.ts`
- `87C06F571EA059868FD075983AFAF63C152FB5A6B691024048C82B1F50D96DA8  src/lib/live-quota-admission.test.ts`
- `92480B90D92ABD0DB83144D4D6777D6FEF133A7FD227D995220E9EAEF42E4ECF  src/app/api/live-admission/route.test.ts`
- `91924B5B1D33873D2F96EF935A36834C0A9CC3C26D2CFA79C7BFF3108360B0F7  src/app/live/[slug]/page.tsx`
- `9C457AD71493EC96ED59D21C424A8D767403E14E6AF9146C2851F60D8DBA0ACC  src/app/live/[slug]/page.test.tsx`
- `9BEF8814B42C6C8FF574F1EF034C68133070A3F6A2CCC7783FB4BE1975ED07A2  src/app/actions.ts`
- `F29D58E6AB624529CD8F2970FABB3143AC3335AEDD69F654608D665DCD285214  src/app/actions.test.ts`
- `CB2B458374480BE05CC5AEDB797F3B13E6E5E89A1D77944010D6035D356C0AEB  src/components/live-stepper-form.tsx`
- `943752B6BE166439AA373E6A1C7A1415DFC202CCC94ED9DF753C8D8B2ED0E1FB  src/components/live-stepper-form.test.tsx`
- `45C3843384E56190D548DC72D4C9DE88FF6FE06D1BE9280E81191316B6961A12  src/app/(app)/lives/new/page.tsx`
- `3CAC4D2F9008DB2846FACE02F8F79844379F5732449B57B0815F706F082113DD  src/app/(app)/lives/new/page.test.tsx`
- `2F3FDFC1F6BF9F81F4F3972AB804E19814BC69C5C169FA4ABA5DCF84DB3A4A53  src/app/(app)/lives/[id]/edit/page.tsx`
- `286546583D74FFE57E2E9381AADD2B7A2540B18C573A05879DDFD4D36A21D46F  src/app/(app)/lives/[id]/edit/page.test.tsx`

## 分數判斷

- 固定功能 `直播 Studio`：`8.0 → 8.5`。
- 提升來源：發布前有可操作檢查、Server Action 無法繞過、內容直播保留合理流程、已公開銷售直播對 stale resource 即時 fail closed，並新增可復原下架路徑。
- Latest canonical total 維持 `74.0`。本機功能證據不能代替 CAT04 PayUni Sandbox／staging，也不能代替 CAT10 真人簽核與外部監控交付。
- CAT04／CAT10 保持 blocker，不阻擋其他產品工作。
- 沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal endpoint、probe 或失敗命令。

## 回滾範圍

- 回滾範圍限於 readiness helpers、Live Studio UI、live action、公開直播頁、admission runtime gate 與對應 tests。
- 沒有 schema、migration、外部服務或正式資料副作用。
- 若只回滾 UI 而保留 server runtime gate，舊公開直播可能因 stale resource 回 404；完整回滾應以同一 scope 處理。

## 下一個最高價值工作

重新盤點尚未被固定功能 scorecard 捕捉的 P0／P1 販售流程缺口，優先檢查 checkout 前的商品可售狀態、公開分享入口與商家發布後的操作復原，再決定下一個產品 WP。
