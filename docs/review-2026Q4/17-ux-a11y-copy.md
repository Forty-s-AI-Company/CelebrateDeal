# 17 可用性、無障礙與繁中文案審查（B-07）

> 產出者：B-07 審查員（唯讀）。基線：分支 `codex/goal-review-2026q4` = `origin/master` `78621ca3`，日期 2026-10-19。
> 只讀程式碼與既有測試。沒有啟動 dev server、沒有執行 `e2e:a11y` 或任何測試、沒有讀取 `.env*`、沒有任何 git 寫入。所有「畫面長什麼樣子」的判斷都是從 JSX、CSS token 與資料流推得，未經瀏覽器實測；需要實測才能確認的項目另標「推論，需實測」。

## 0. 前言

### 0.1 方法

1. 先讀 `PRODUCT.md`（設計原則 1～7、無障礙段落）、`docs/domain-workflows.md`「設計與互動」、`01-system-map.md` 路由樹、`03-test-map.md`、市場研究報告的 ICP 與功能決策兩節。市場報告把封測客戶定為「有自有名單的講師與顧問」，封測只開五個模組：直播、報名表單、商品與結帳、LINE 通知、追蹤。所以本報告以「講師從註冊走到第一筆成交」為主線，不是平均取樣。
2. 以主線每一步的實際元件為準逐一閱讀：`register`、`welcome`、`(app)/onboarding`、`product-form-client`、`form-builder-client`、`message-template-form-client`、`interaction-*`、`live-stepper-form`（1,233 行，除通知規則編輯器細節外皆讀）、`use-live-studio-draft`、`lives/*` 頁、`live-playback`／`live-chat-panel`／`live-danmaku`、`lead-form`／`verify-registration`、`commerce-checkout-form`、`checkout/result`。
3. 文案：用 grep 找「中文句子裡夾帶 slug／payload／provider／ledger／session／admission／reference／Workspace」等工程詞，再人工判斷是否為商家或買家看得到的字串，抽樣 40 筆（第 5 節）。
4. 對比度：從 `globals.css` 與常用 Tailwind 色票以 WCAG 公式實算（第 4.3 節）。
5. a11y 覆蓋：逐行讀 `tests/e2e/accessibility.spec.ts`，並 grep 其他 spec 的 `AxeBuilder`（第 4.6 節）。

### 0.2 抽樣範圍與限制

- `src/app` 共 144 頁，只深讀主線上約 40 頁；admin、portal、affiliate-portal、lp 編輯器、課程只做術語 grep，不做互動審查。
- 嚴重度：**BLOCKER** = 封測客戶或其買家會直接看到錯誤／內部資訊，或核心任務走不通；**MAJOR** = 會讓講師卡關、誤解或需要創辦人救援；**MINOR** = 有摩擦但可繞過；**NIT** = 風格。
- 估工：S ≤ 0.5 天、M 0.5–2 天、L > 2 天（單人，含測試）。
- 封測日為 2026-11-01，距審查日 13 天；「封測前必修」只標真的會傷到封測的項目。

### 0.3 一句話結論

後台骨架做得比一般 SaaS 紮實：共用 `FormSubmitButton` 的 pending／防重送／朗讀、直播草稿自動保存與版本衝突保護、報名失敗不丟資料（#441）、付款與訂單狀態用詞誠實、報名名單分「已驗證／待驗證」、虛擬使用者的留言與商家統計確實分開計算。真正會傷到封測的是三類問題：**(1) 對外字串混進內部備註與工程術語；(2)「建立直播 → 預覽 → 發布 → 觀眾進場」最後一哩有死路與斷點；(3) 虛擬使用者（互動角色）鏈路的前置條件、標示策略與實際畫面互相矛盾，且講師端有控制項沒有觀眾端承接。**

## 1. Findings 表

| ID | 嚴重度 | 檔案:行號 | 問題 | 對封測客戶的影響 | 建議 | 估工 | 需 owner 決策 | 封測前必修 |
|---|---|---|---|---|---|---|---|---|
| B07-01 | BLOCKER | `src/components/commerce-checkout-form.tsx:506` | 買家結帳頁的必勾選項寫著「這些文件在正式上線前仍需真人 owner 核准」，內部備註直接顯示給每位買家。 | 每位買家在付款前都看到「條款尚未核准」，直接破壞信任，也可被解讀為商家用未生效條款收款。 | 移除該句；條款定稿前改用中性句，或依 `resolvePolicyStatus` 顯示「條款自 2026/11/01 生效」。 | S | 是（條款何時定稿） | **是** |
| B07-02 | MAJOR | `src/app/(app)/lives/[id]/preview/page.tsx:16-47`、`src/app/actions.ts:1398`、`src/components/live-stepper-form.tsx:396-406` | 「建立草稿並預覽」成功後導向 `/lives/:id/preview`，但這頁沒有「回到編輯」「發布」「複製連結」，只有「開啟公開頁」；內容是欄位清單（含 `streamMode` 原始值與 Cloudflare Live Input UID），不是觀眾畫面。步驟 8 的「即時手機預覽」是寫死的假畫面（固定出現「AI 主持人／官方」與「優惠在這一段會自動跳出」），不反映真實腳本。 | 講師建完草稿就卡在死路，要自己回側欄找「直播間 → 編輯」；以為預覽看到的就是觀眾會看到的（違反原則 3「先看見再公開」）。 | 預覽頁加固定動作列：回到編輯、排程發布、複製公開連結；用真實 viewer 元件做 owner 專用預覽（可看草稿、不計入統計）；假預覽改標「示意畫面」。 | M | 否 | **是** |
| B07-03 | MAJOR | `src/components/interaction-roles-workbench.tsx:276,697-701`、`src/components/interaction-script-form.tsx:106-115,308`、`src/lib/live-chat-contract.ts:69` | 新建角色預設 `isScheduled=false`；腳本編輯器的角色下拉只列「啟用且為排程角色」。勾選框說明寫「前台呈現與數據排除將在直播互動流程完成後生效」，與現況（已排除）不符。腳本編輯器在沒有可選角色時沒有空狀態或連結。 | 講師建好虛擬角色，到腳本頁下拉是空的，不知道要回去勾「排程角色」；儲存時只得到泛用訊息「互動事件資料不完整」。 | 角色預設勾選「排程角色」，或把勾選框改名為「可用於腳本發言」；腳本頁無角色時顯示「尚無可用角色，去建立」；改寫勾選框說明。 | S | 否 | **是** |
| B07-04 | MAJOR | `interaction-roles-workbench.tsx:550,415,680`、`scripted-roles-control.tsx:51`、`live-danmaku.tsx:137`、`src/lib/public-policy-content.ts:65`、`live-chat-contract.ts:83`、`live-chat-panel.tsx:293-298` | owner 2026-10-18 決定封測開放「不標示」的虛擬使用者，但：角色頁寫「前台會明確標示」、暖場控制台寫「會清楚標示為暖場角色」、彈幕前綴「暖場角色／預設互動」、條款只揭露「標示為官方的互動」；而程式對 `audience` 角色在聊天室仍輸出 `label`，標籤欄必填，空白時 fallback 為「一般觀眾」。用詞還有五種：互動角色／暖場角色／官方角色／一般觀眾／虛擬使用者。 | 四個地方對講師說不同的話。講師照畫面以為會標示，實際聊天室顯示「小美　一般觀眾」，看起來很假；若要真的不標示，目前做不到（標籤不可為空）。 | 先決定 A（不標示：標籤改選填、移除 fallback、改寫四處文案與條款揭露）或 B（標示：維持現狀、把 2026-10-18 決策改回標示）。選 A 時商家服務條款需律師審閱（PRODUCT.md 已載明）。統一單一用語。 | M | **是**（A 或 B；選 A 需律師） | **是** |
| B07-05 | MAJOR | `src/components/live-danmaku.tsx:55-140`（`LiveDanmaku`）、`live-interaction-studio.tsx:262`、`scripted-roles-control.tsx:41-62`、`src/app/globals.css`（無 `.danmaku-*`） | 觀眾端彈幕元件 `LiveDanmaku` 全專案沒有任何地方掛載（`git log -S"<LiveDanmaku"` 無結果），`.danmaku-strip／lane／message` 也沒有 CSS（`.ai-team/tmp` 舊副本有，主線沒有）。但講師控制台有「開啟全場彈幕」「載入手動暖場」「啟用播放時間排程」「手動發送」，會寫入設定、輪詢 API，觀眾端沒有承接。 | 講師按「手動發送」看到成功狀態，觀眾什麼也沒看到。違反原則 4、5（回音要真、狀態要講真話）。reduced-motion 的彈幕規則（舊副本有）在主線也不存在。 | 二擇一：封測先隱藏 `InstructorDanmakuSwitch` 與 `ScriptedRolesControl`；或把 `LiveDanmaku` 掛進 `live-playback`，補 CSS 與 `prefers-reduced-motion: reduce { animation: none }`、補 e2e。 | M | 是（隱藏或交付） | **是** |
| B07-06 | MAJOR | `src/app/(app)/lives/page.tsx:29`、`dashboard/dashboard-details-view.tsx:42`、`interaction-scripts/page.tsx:88`、`lives/[id]/preview/page.tsx:40`、`components/video-form.tsx:68`、`support-cases/page.tsx:99`、`consultations/page.tsx:171`、`settings/security/page.tsx:319` | 狀態徽章直接輸出資料庫列舉值：`draft／scheduled／live／ended`、`published`、`vod`、`ready／archived`。訂單頁已有完整中文對照（`orders/page.tsx:9`），顯示不一致。 | 「直播間」列表是講師最常看的頁，狀態欄是英文小寫。 | 建共用 `statusLabel(kind, value)`（草稿／已排程／直播中／已結束），逐頁替換；加 unit test 確保每個 enum 值都有中文。 | S | 否 | **是** |
| B07-07 | MAJOR | `src/components/live-stepper-form.tsx:907`、`prisma/schema.prisma:672`（`Live.slug @unique` 全域唯一）、`src/app/actions.ts:816`（`tx.live.create` 無 P2002 處理）、`src/app/global-error.tsx:20` | 直播標題旁有必填欄位「Slug」（英文，placeholder `friday-new-arrival`），不會從標題自動帶入；全站唯一，卻沒有事先檢查，也沒有欄位層級的「已被使用」訊息（對照：商品有 `duplicate_slug`、表單有 `fieldErrors.slug`）。重複時 `P2002` 在 `commitLiveDraft` 內未被攔截（推論，需用兩個租戶以相同 slug 實測）。 | 講師第一次建直播就要想一個英文網址代稱；撞到別人或自己舊場次的 slug 時，可能看到整頁「系統暫時無法顯示這個頁面」，且沒有按鈕可返回（見 B07-08）。 | 欄位改名「直播網址」，由標題自動產生可編輯預設（允許中文或隨機短碼）；伺服器端撞名回 `?error=duplicate_slug` 並在欄位下顯示；草稿存檔時即時檢查。 | M | 否 | **是** |
| B07-08 | MAJOR | `src/app/(viewer)/live/[slug]/page.tsx:49,64`、`src/app/global-error.tsx:14-24`、`find src/app -name not-found.tsx`（僅 4 個，皆非 viewer） | 觀眾端直播頁在「查無／尚未發布／未達發布條件」時呼叫 `notFound()`；專案沒有根層或 `(viewer)` 的 `not-found.tsx`，會落到 Next 預設的英文 404（推論，需實測）。`global-error` 文案寫「返回後台」但沒有連結或重試按鈕。 | 講師在發布前就把連結貼給朋友測試、或腳本被取消發布，觀眾看到英文空白 404，無從得知是「還沒開始」還是「連結錯了」。WP-01（#440）只處理了 lp／funnel。 | 為 `(viewer)` 與根層加繁中 `not-found.tsx`（「這個直播尚未開放或連結有誤」＋聯絡主辦人）；`global-error` 加「重新整理」與「回首頁」。 | S | 否 | **是** |
| B07-09 | MAJOR | `src/lib/registration-submission-client.ts:30`、`src/app/verify-registration/page.tsx:28-37`、`src/components/lead-form.tsx:205-209` | 報名採雙重確認：送出後必須開 Email、點連結、在確認頁再按一次按鈕，才列入正式名單。確認完成頁只說「可以關閉這個頁面」，沒有「前往直播間」「加入行事曆」；連結過期只說「回到原活動頁重新送出」，沒有連結，也沒有「重寄確認信」。 | 觀眾從報名到進場要跨 3 個畫面；確認後沒有下一步，容易流失，講師的名單與出席率會偏低。 | 確認頁加「前往直播間」「加入行事曆」；過期頁帶回原活動連結並提供重寄；送出成功畫面加「沒收到？請看垃圾信件匣」。 | M | 是（雙重確認是否保留；個資法 §8 與行銷同意見市場報告） | **是**（至少加下一步連結） |
| B07-10 | MAJOR | `src/components/message-template-form-client.tsx:20-23`、`src/lib/live-publish-readiness.ts:55-58` | 「報名成功 Email」是發布必要條件，但新增模板時主旨與內容都是空白，沒有範本或預設文案，變數只列清單。對照：報名表單有預設欄位與文案（`form-builder.tsx:11-14`）、腳本有範本。 | 講師在發布前被要求寫一封信，卻沒有任何起手式，是第一次成功路徑上最大的空白頁。 | 每個觸發條件（報名成功／開播提醒／課後）各給一份預設文案並預填；註冊完成時自動建立一份「報名成功」模板。 | M | 否 | **是** |
| B07-11 | MAJOR | `src/lib/format.ts:9-16`、`src/app/(app)/lives/page.tsx:27`、`lives/[id]/analytics/page.tsx:391`、`live-stepper-form.tsx:161-163` | `formatDateTime` 沒指定 `timeZone`，在伺服器元件中依執行環境時區輸出（Vercel 預設 UTC；推論，需在 staging 實測）。全站 29 個檔案使用它、23 處 `toLocaleString("zh-TW")` 未帶 `timeZone`。開播時間輸入是依商家時區存成 UTC（正確），但列表回顯會差 8 小時。輸入欄標籤還輸出原始字串「開播時間（Asia/Taipei）」與「儲存時會轉成 UTC」。 | 講師排 20:00 的場次，在「直播間」列表看到 12:00，會以為存錯而反覆修改。 | `formatDateTime` 預設 `timeZone: "Asia/Taipei"`（或接受 `vendor.timezone`）；標籤改「開播時間（台灣時間）」；移除「轉成 UTC」說明。 | S | 否 | **是** |
| B07-12 | MAJOR | 見第 5 節抽樣表 | 封測模組內大量工程術語：直播步驟（「啟用 ref 追蹤」「immutable usage ledger」「fail closed」「heartbeat」「payment provider reference」）、儀表板（「播放 session」「admission」）、商品表單（「課程推廣者 G 比例（basis points）」「F/G 分潤」「幣別（ISO 4217）」）、影片（「provider token」「streamKeyRef」）、上傳錯誤（「R2 完成驗證失敗」）、上線導引（「release gate」「客服 SLA」「release owner」）、註冊（「Workspace」）。 | 講師不是工程師；直接違反原則 1 與 `PRODUCT.md`「避免要求使用者理解內部資料模型或供應商術語」。商品表單暴露 F/G 分潤，而課程與聯盟在封測是隱藏的。 | 建立詞彙表（附錄 A），逐頁改；課程／聯盟欄位在 feature flag 關閉時整段不渲染；加 lint 規則禁止 JSX 中文字串出現 `provider`／`ledger`／`session`／`slug`／`payload`。 | M | 否 | **是**（限主線頁面） |
| B07-13 | MAJOR | `src/components/line-official-account-form.tsx:34-70,85,108`、`line-rich-menu-studio.tsx:29,61`、`settings/line/page.tsx:68-75`、`message-template-form-client.tsx:72-73` | LINE 綁定頁要求貼 Channel ID／Secret／Access Token 並設定 Webhook，沒有逐步教學；錯誤訊息只有「憑證格式不完整，或目前無法儲存」。三個檔案使用未定義的色票 `text-muted-foreground`、`text-destructive`（`globals.css` 的 `@theme` 沒有這兩個 token，Tailwind v4 不產生樣式），錯誤訊息不會變紅、輔助文字不會變灰。模板的 LINE 渠道又顯示「尚未串接，不能啟用」。 | LINE 通知是封測五模組之一；講師要在 LINE Developers Console 完成綁定卻沒有指引，失敗時看不出哪裡錯。「LINE 整合」與「LINE 尚未串接」同時出現，讓人不確定到底能不能用。 | 加「三步驟」說明與每欄位的取得位置；錯誤分「憑證錯／Webhook 未驗證／權限不足」；把兩個 token 補進 `@theme` 或改用 `text-red-700`／`text-slate-500`；頁首明講「目前 LINE 僅用於哪些通知」。 | M | 是（封測 LINE 提供推播、登入還是只有 Email） | 樣式修正必修；教學建議 |
| B07-14 | MAJOR | `src/lib/live-publish-readiness.ts:59-61`、`src/lib/merchant-onboarding.ts:45-48`、`live-stepper-form.tsx:76` | 只要直播綁了商品，發布前就必須有「已發布的互動腳本」；上線導引也把「啟用互動角色」「發布互動腳本」列為完成條件。 | 講師只想賣課、不想用虛擬使用者，仍被迫建立腳本；導引永遠不會 100%。與「虛擬使用者是選配」的方向衝突。 | 腳本改為選配（商品聚焦與 CTA 可另行設定），或提供「一鍵套用預設腳本」；導引只列必要項目。 | M | **是** | **是**（決策） |
| B07-15 | MAJOR | `src/app/register/page.tsx:9`（全頁無政策連結或同意勾選）、`src/app/login/page.tsx:78`、`src/lib/public-policy-content.ts:53`（只有 terms／privacy／refunds 三份政策） | 商家註冊頁沒有條款與隱私通知的連結和同意紀錄；也沒有專屬的「商家服務條款」（PRODUCT.md 說虛擬使用者的法律責任由商家服務條款規範）。標題「建立你的商家 Workspace」是英文詞。 | 商家在未同意任何條款的情況下開通；之後無法證明他們同意過「虛擬使用者責任歸商家」。 | 註冊加必勾選的條款與隱私連結，並記錄版本與時間；撰寫商家服務條款（需律師）；標題改「建立你的商家帳號」。 | M | **是**（條款定稿與接受紀錄設計） | **是** |
| B07-16 | MAJOR | `src/components/app-shell.tsx:241,206,208` | 側欄固定顯示綠色閃爍圓點與「系統連線正常」，沒有連到任何健康檢查；另有英文「Live Commerce OS」「Beta」。 | 違反原則 5：狀態不是系統確認的。服務異常時畫面仍說正常。 | 移除，或接 `/api/health` 並在失敗時顯示警示；品牌副標改中文。 | S | 否 | **是** |
| B07-17 | MAJOR | `src/app/(app)/dashboard/dashboard-kpis.tsx:93-104` | 儀表板 10 個 KPI 沒有「已付款訂單數／金額」；只有「近 7 天訂單建立」（未付款也算）。市場報告的首次成功指標第三階是「首筆付費訂單且對帳正確」。 | 講師開播後回到首頁，看不到賺了多少，要自己點進「訂單與履約」。 | 加「已付款訂單」與「已確認金額」兩張卡，只計 `paid` 並扣除已退款，標明「不含待付款」。 | S | 否 | 建議（創辦人可暫時手動看 /orders） |
| B07-18 | MAJOR | `src/components/ui.tsx:98-205`（`Field`／`TextArea`／`SelectField` 無 error、hint、`aria-invalid` 插槽）、`product-form-client.tsx:97-110`、`live-stepper-form.tsx:523-537`、`interaction-roles-workbench.tsx:526-531` | 共用欄位元件沒有錯誤與說明插槽。商品、直播、角色的伺服器端錯誤都只在表單頂端顯示一則泛用訊息（例如「商品名稱、Slug、售價、庫存、幣別或網址格式不正確」），不指出哪個欄位、不把焦點移過去。表單建立器（`form-builder-client.tsx:196,478-486`）已有 `aria-invalid` 與 `aria-describedby`，是現成的好範本。 | PRODUCT.md 承諾「指出可修正內容並將焦點帶到正確位置」，目前僅直播步驟的瀏覽器驗證、報名失敗與結帳做到。 | 擴充 `Field` 加 `error`／`hint`；伺服器 action 回傳 `fieldErrors`；錯誤時聚焦第一個無效欄位；先做商品與直播。 | L | 否 | 否（分批） |
| B07-19 | MAJOR | `src/components/live-stepper-form.tsx:1131,1136-1150,1204-1207`；欄位 `h-10` 共 15 處 | 八個步驟按鈕在 390px 寬為單欄堆疊（`grid gap-2 sm:grid-cols-2`），每顆 56px 高並帶「待完成」徽章，約 510px 的導覽先於內容；上一步／下一步與所有 select／input 為 40px 高。步驟切換不移動焦點、不通知螢幕閱讀器。#439 沒有動這個元件。 | 講師用手機建直播（原則 6 的核心任務），第一屏全是步驟按鈕。 | 手機改為「第 N 步／共 8 步＋目前步驟名稱＋下拉選單」；控件至少 44px；切換後把焦點移到該步標題。 | M | 否 | 否 |
| B07-20 | MINOR | `src/components/use-live-studio-draft.ts:64,85,201` | 草稿版本衝突時只能「重新整理後再繼續」，且衝突後本分頁的編輯被鎖定並丟棄（`conflictLocked`）。 | 在兩個分頁各改一些，重新整理後本分頁的修改全部消失。 | 衝突時提供「複製我的版本」或「載入伺服器版本並保留我的欄位差異」。 | M | 否 | 否 |
| B07-21 | MINOR | `src/lib/format.ts:1-8`、`commerce-checkout-form.tsx:57`、`checkout/result/page.tsx:59`、`customers/[id]/page.tsx:20` | 金額顯示不一致：`formatCurrency` 輸出「$1,234」，結帳頁輸出「$12,345.00」（多餘 .00），學員頁手寫「NT$」（以 `Intl.NumberFormat("zh-TW",{currency:"TWD"})` 實測）。 | 買家與講師看到三種金額格式；「$」在台灣語境可能被誤認為美元。 | 統一一支 `formatTwd()`：「NT$1,234」，整數不帶小數。 | S | 否 | 否 |
| B07-22 | MINOR | `globals.css:44-47`、`ui.tsx:131,170,201`、`lead-form.tsx:195`（共 78 處 `outline-none`、36 檔）、`app-shell.tsx:254,263` | 全域焦點樣式（3px 藍色外框）被 78 處 `outline-none` 蓋掉（Tailwind v4 的 `outline-none` 是 `outline-style:none`），替代的是 1px 藍邊加 `ring-blue-100`（對白底僅 1.22:1）。輸入框邊框 `#dbe3ef` 對白底 1.29:1；`text-slate-400` 小字 2.56:1（29 處，含側欄 10px 分組標題）。 | 焦點仍可辨識（邊框變色約 3.7:1，勉強通過 2.4.7）但弱於產品承諾；欄位邊界對低視力者不明顯（1.4.11）。 | 把 `focus:ring-blue-100` 改為 `focus-visible:ring-2 ring-primary`，或移除 `outline-none`；欄位邊框改 `slate-400`；`slate-400` 文字改 `slate-600`。 | M | 否 | 否 |
| B07-23 | MINOR | `src/components/app-shell.tsx:64-69,302-308`、`src/lib/vendor-feature-toggles.ts` | 手機導覽把所有群組攤平成一排橫向膠囊（管理者約 35–40 顆，隱藏捲軸，無「更多」），「說明與政策」「聯絡客服」「夥伴入口」只在桌機帳號選單。6 個帳務項目（用量與扣點、平台服務付款方式、方案、帳單、電子發票、月結）沒有 feature flag，封測時 owner 仍看得到；儀表板說明仍寫「聯盟來源與用量配額」。 | 手機要找「品牌設定」要橫滑 30 顆；封測應隱藏的模組（市場報告：聯盟、課程、billing）仍露出。 | 手機改為底部 5 項加「更多」抽屜；加入 beta 旗標隱藏帳務／聯盟／課程；更新儀表板說明。 | M | 是（封測要隱藏哪些） | 隱藏模組：是；手機導覽：否 |
| B07-24 | MINOR | `(app)/onboarding/page.tsx`、`welcome/page.tsx`、`onboarding-task-panel.tsx:29`、`merchant-onboarding/page.tsx`、`(app)/projects/new/page.tsx:10` | 共有五套引導：註冊後問卷（4 題）、側欄「專案上線任務」、`/onboarding`「上線導引」（5 步）、公開的「商家使用指南」（6 步）、建立專案的「使用上線導引／快速建立」。步驟內容與數量互不相同。 | 講師不知道該以哪一份為準。 | 合併：`/onboarding` 為單一事實來源，側欄任務由它產生，指南頁只做說明。 | M | 否 | 否 |
| B07-25 | MINOR | `src/components/interaction-script-form.tsx:45-69` | 內建腳本範本含稀缺與主張性文案：「限量清倉」「售完後不一定會補」「本場最划算的一組」「官方角色會整理重點」。 | 講師套用範本後可能在不屬實的情況下公開稀缺或比較性主張（公平交易法、消保法風險）。 | 範本改為中性占位（【請填入庫存】），或加提示「請確認內容屬實」。 | S | 是（範本文案由誰審） | 否 |
| B07-26 | MINOR | `src/components/live-playback.tsx:1750-1756` | 播放器 `<video controls>` 沒有 `<track>` 字幕軌，也沒有字幕上傳欄位。 | 聽障學員無法使用預錄課程；WCAG 1.2.2（A）預錄影片字幕。 | 路線圖：Cloudflare Stream 支援 WebVTT，影片管理頁加字幕上傳；封測先在說明中揭露。 | L | 是（排程） | 否 |
| B07-27 | MINOR | `tests/e2e/accessibility.spec.ts:276-497`（詳見第 4.6 節） | a11y 測試只攔 `critical／serious`；沒掃 `/register`、`/welcome`、`/onboarding`、`/policies/*`、`/checkout/*`、`/support/*`、`/verify-registration`、`/lp/*`、`/portal/*`；直播 stepper 只掃第 1 步（其餘面板是 `hidden`，axe 不掃）；沒有 stepper／上傳／對話框的鍵盤操作測試；沒有表單錯誤狀態掃描。 | 可用性最關鍵的註冊與驗證頁沒有任何自動檢查。 | 加 12 個路由與 stepper 8 步（逐步點擊後掃描）、錯誤狀態、moderate 層級報表（不阻擋）。 | M | 否 | 否 |
| B07-28 | MINOR | `live-playback.tsx:880-925`、`app-shell-account-menu.tsx:15-46` | 外部連結確認對話框有焦點陷阱與 Escape，但關閉後未還原焦點；帳號選單沒有 Escape 與點外面關閉，也沒有 `aria-controls`。 | 鍵盤使用者關閉對話框後焦點回到頁首。 | 還原觸發元素焦點；選單補 Escape 與外點關閉。 | S | 否 | 否 |
| B07-29 | MINOR | `src/app/registration-error/page.tsx:8`、`registration-submission-client.ts:19` | 「報名資料未能送出」頁的「回首頁」連到 `/`，而根路由對未登入者轉去商家登入頁（`app/page.tsx`）；403 文案「請重新整理頁面後再試」與其他文案「內容仍保留」衝突（重新整理會清掉 JS 流程中已輸入的內容）。 | 觀眾被帶到商家登入頁；被要求重新整理卻擔心資料消失。 | 該頁改為「回上一頁」；403 文案改為「請稍候再試；若仍失敗請重新開啟活動頁」。 | S | 否 | 否 |
| B07-30 | MINOR | `src/components/live-interaction-studio.tsx:34-292` | 講師互動台含幸運抽獎（範例獎項「iPhone 16」）、限時快閃搶購、「空投限時紅包」、問答審核，使用紫色加紅色漸層（違反設計系統「無紫藍漸層」）；超出封測五模組，也沒有 beta 隱藏。 | 講師被大量不需要的功能淹沒；抽獎涉及贈品與稅務，封測不應預設開放。 | 封測預設隱藏，由創辦人個別開啟；漸層改為中性。 | S | 是 | 否 |
| B07-31 | MINOR | `src/app/checkout/result/page.tsx:51-52,103-105` | 付款結果頁只認「開始結帳的同一個瀏覽器」；換瀏覽器或裝置看不到訂單，只能走客服（推論：LINE 內建瀏覽器跳轉外部瀏覽器付款時可能發生，需用 PayUni Sandbox 在 LINE 內實測）。 | 買家付完款回不到結果頁，可能重複付款或找講師。 | 在付款完成 Email 附「查看訂單」安全連結；實測 LINE 內建瀏覽器路徑。 | M | 否 | 否（先實測） |
| B07-32 | MINOR | `src/lib/public-policy-content.ts:6-9` | 所有政策頁與客服聯絡方式使用個人 Gmail（`a88221144@gmail.com`）。 | 買家與講師對平台的信任度降低；信箱異動需改程式。 | 申請專用網域信箱；設定改由環境變數或後台管理。 | S | 是 | 否 |
| B07-33 | NIT | `src/components/interaction-role-form.tsx`（未被任何頁面引用，只有測試引用）、`:78-94` | 舊版角色表單是死碼，其 16 個頭像按鈕沒有可存取名稱與 `aria-pressed`；現行 `InteractionRolesWorkbench` 已修正。 | 無實際影響，但易被誤改。 | 刪除死碼與其測試。 | S | 否 | 否 |
| B07-34 | NIT | `lead-form.tsx:201,208`、`verify-registration/page.tsx:29`、`onboarding-task-panel.tsx:43` | 載入文案混用「…」與「...」；按鈕與標題內嵌 emoji（🟢、🚀），與設計系統「不用 emoji icon」不符。 | 風格不一致。 | 統一「…」；改用 lucide 圖示。 | S | 否 | 否 |

統計：BLOCKER 1、MAJOR 18、MINOR 13、NIT 2，共 34 筆。「封測前必修」完整必修 15 筆（B07-01～12、14、15、16），部分必修 2 筆（B07-13 的樣式修正、B07-23 的模組隱藏），B07-17 為強烈建議。

## 2. 首次成功路徑逐步檢查表

圖例：✓ 達標、△ 部分、✗ 缺失、— 本輪未深讀。

| # | 步驟（路由／元件） | 合理預設與範例（原則 1） | 空狀態與引導 | 保存與續作（原則 2） | 預覽與發布分離（原則 3） | 非同步回饋（原則 4） | 判定 | Findings |
|---|---|---|---|---|---|---|---|---|
| 1 | 註冊 `/register` | △ 四個空欄位，「60 秒問卷」承諾清楚 | — | ✗ 錯誤後以 `?error=` 重導，姓名與 Email 清空 | — | ✓ `FormSubmitButton` 防重送與朗讀；`role=alert` 錯誤，但訊息泛用 | 部分 | 15, 12 |
| 2 | 問卷 `/welcome` | ✓ 4 題、可略過 | ✓ | ✓ 每題伺服器保存，`initialStep` 可續 | — | ✓ 儲存中／已儲存／失敗皆有 live region；△ 失敗時「下一題」被鎖，須重點選項才能重試；步驟切換不移動焦點 | 良好 | — |
| 3 | 上線導引 `/onboarding` | ✓ 依資料庫真實狀態計算進度，`progressbar` 語意正確 | ✓ 每項缺口附連結 | ✓ 進度不需重填 | — | — | 部分 | 14, 24, 12 |
| 4 | 品牌與客服信箱 `/settings/brand` | — | — | — | — | — | 未深讀 | — |
| 5 | 建立商品 `/products/new` | △ 無範例值；有「新商品會先儲存為草稿」提示 | ✓ 列表有 EmptyState | △ 草稿概念在欄位層，無自動保存 | ✓ 上架需另外勾選 | △ 伺服器錯誤只有一則泛用訊息（`product-form-client.tsx:97-110`） | 部分 | 12, 18 |
| 6 | 建立報名表 `/forms/new` | ✓ 預設欄位與送出文案 | ✓ | ✓ 草稿復原 `FormDraftRecovery` | ✓ 4 步含預覽 | ✓ 行內錯誤＋`aria-invalid`；△ 錯誤時不移焦點 | **最佳範本** | 18 |
| 7 | 建立報名成功 Email `/messages/templates/new` | ✗ 主旨與內容空白 | △ 列表有 EmptyState | ✓ 版本衝突保留輸入並提示 | — | ✓ | 缺口 | 10 |
| 8 | LINE 綁定 `/settings/line` | ✗ 無教學 | ✗ | — | — | △ 有測試連線；錯誤訊息泛用且無紅色樣式 | 缺口 | 13 |
| 9 | 互動角色與腳本 | ✓ 頭像、性別、範本、時間範例 | ✓ 角色空狀態；✗ 腳本頁無角色時無提示 | ✓ | △ 角色預覽為靜態卡；腳本無整體預覽 | ✓ 逐事件錯誤＋`aria-describedby` | 部分 | 03, 04, 14, 25 |
| 10 | 建立直播（8 步 stepper） | △ 用途卡片、促銷短句預設「直播限定優惠」；✗ 開播時間、網址代稱皆空 | ✓ 每步缺資源時有「新增 X」連結；△ 必須離開 stepper 去建立 | ✓✓ 700ms 自動保存、離開前攔截、「找到未完成的直播草稿」續作；△ 版本衝突只能重新整理 | △ 步驟 8 假預覽 | ✓ 步驟間瀏覽器驗證並聚焦無效欄位；✓ 待完成清單可一鍵跳到缺漏步驟並聚焦；△ 發布按鈕被停用時只在上方清單說明原因；確認用 `window.confirm` | 部分 | 02, 07, 11, 19, 20 |
| 11 | 預覽 `/lives/:id/preview` | — | — | — | ✗ 死路，非觀眾畫面 | — | 缺口 | 02, 06 |
| 12 | 發布（stepper 第 8 步或編輯頁） | — | — | ✓ 伺服器再驗證，`publish_not_ready` 有說明 | ✓ 草稿與發布按鈕分離 | ✓ `FormSubmitButton` 與確認對話框 | 良好 | — |
| 13 | 分享連結 | ✗ 無「複製連結」，只顯示 `/live/slug` 相對路徑 | — | — | — | — | 缺口 | 02 |
| 14 | 觀眾報名 `/form/:slug` 或直播頁 | △ 無必填標示 | ✓ | ✓✓ 失敗保留內容、原生 POST 退路（#441） | — | ✓ pending、停用、`aria-busy`、`role=alert` 焦點管理 | 良好；後續斷點 | 09, 29, 34 |
| 15 | 確認 Email `/verify-registration` | — | — | — | — | ✓ | ✗ 無下一步 | 09 |
| 16 | 觀看 `/live/:slug` | — | ✓ 等待室與倒數；✗ 不可用時為英文 404 | — | — | ✓ 聊天室 `role=log`、失敗可重試；播放器為原生控制項 | 部分 | 08, 26 |
| 17 | 結帳 `/checkout/...` | — | — | ✓ 冪等鍵與恢復訂單 | — | ✓ 步驟條、`aria-busy`、狀態朗讀、防重送；✗ 內部備註 | **BLOCKER** | 01, 21 |
| 18 | 付款結果 `/checkout/result` | — | ✓ | — | — | ✓ 狀態用詞誠實（「等待付款確認」「付款逾期」） | 良好 | 31 |
| 19 | 講師回看成果（儀表板、訂單） | — | ✓ 零活動時摺疊 | — | — | ✓ 訂單狀態全中文 | 部分 | 11, 17 |

## 3. 行動版

- **#439 的範圍**（`git show --stat 9bf83f4f`）：導覽標籤與頁面標題一致、新商家的任務面板預設摺疊、專案切換器在手機摺成 `<details>`、零活動時儀表板指標摺疊、手機導覽維持 44px 目標、方案價格標 TWD。**沒有動**：直播 stepper、商品／表單編輯頁、觀眾端。
- **表格**：含 `<table>` 的 21 個檔案中 17 個有 `overflow-x-auto` 包裹；沒有的 4 個是 `billing/invoices/[invoiceId]`、`settings/security`、`announcement-center`、`funnel-operations-panel`（皆非封測主線）。報名名單（講師最常看的表）桌機用表格、`md` 以下改卡片（`form-submissions-workbench.tsx:49`），做法正確。
- **觸控目標**：共用 `ButtonLink`／`SubmitButton` 為 `min-h-11`；但用 grep 估算仍有約 113 處 `h-8／h-9／h-10` 的按鈕、連結、輸入框（含 stepper 全部欄位）。WCAG 2.2 AA 的 24px 下限都達標，未達 PRODUCT.md 的「合理觸控範圍」意圖。
- **溢出**：`accessibility.spec.ts:497-` 在 390px 驗證殼層無橫向溢出且 header 目標 ≥ 44px；`wp7` 與 `commerce-orders` 在 390px 掃觀眾端、結帳、訂單詳情的 axe 與溢出。
- **觀眾端**：以手機優先設計（持久播放器、底部 44px 功能列、`env(safe-area-inset-bottom)`），沒有發現固定寬度問題。
- **缺口**：B07-19（stepper）、B07-23（手機導覽）。

## 4. 無障礙

### 4.1 鍵盤可達性

| 元件 | 觀察 | 判定 |
|---|---|---|
| 跳至主要內容 | `app-shell.tsx:193-198`，`main` 有 `tabIndex=-1`，e2e 驗證（`accessibility.spec.ts:305`） | ✓ |
| Stepper | 純 `<button>`，有 `aria-current="step"`、`aria-controls`；切換後焦點不動，也沒有宣告步驟變更 | △（B07-19） |
| 外部連結對話框 | `aria-modal`、標題與描述關聯、開啟時聚焦、Tab 陷阱、Escape；關閉未還原焦點 | △（B07-28） |
| 上傳 | `role="button" tabIndex=0`＋Enter／Space，隱藏 `<input type=file>`，狀態 `role=status`、錯誤 `role=alert` | ✓（`media-upload-field.tsx:783-795`） |
| 播放器 | 原生 `<video controls>`；迷你播放器自訂按鈕皆有 `aria-label` 與 44px | ✓；無字幕（B07-26） |
| 角色頭像 | 現行工作台有 `aria-label` 與 `aria-pressed`；舊版死碼沒有 | ✓／NIT（B07-33） |
| 腳本事件排序 | 上移、下移、刪除皆有針對第 N 個事件的 `aria-label` | ✓ |
| 帳號選單 | `aria-expanded`，無 Escape、外點關閉 | △（B07-28） |

### 4.2 可見焦點

全域規則 `:where(a,button,input,select,textarea,[tabindex]):focus-visible { outline: 3px solid #2563eb }`（`globals.css:44-47`）使用 `:where()`，特異性為 0，因此任何 `outline-none` 工具類都會覆蓋它。專案有 78 處 `outline-none`（36 檔），包含共用 `Field`／`TextArea`／`SelectField`、報名表單、結帳、角色與腳本編輯器。登入頁的輸入框沒有 `outline-none`，所以 e2e 的焦點測試（`accessibility.spec.ts:283-303`）只證明登入頁，不代表全站。見 B07-22。

### 4.3 色彩對比（以 WCAG 相對亮度公式實算）

| 前景／背景 | 對比 | 用途 | 結果 |
|---|---|---|---|
| `#ffffff` on `#c2410c`（CTA） | 5.18 | 主要行動按鈕 | 通過 |
| `#ffffff` on `#2563eb`（primary） | 5.17 | 一般按鈕 | 通過 |
| `#64748b`（`--muted`／slate-500）on `#ffffff` | 4.76 | 說明文字 | 通過 |
| `#64748b` on `#f8fafc`（slate-50） | 4.55 | 後台底色上的說明文字 | 勉強通過 |
| `#64748b` on `#f5f7fb`（`--background`） | 4.44 | 公開頁底色上的 muted 文字 | **未達 4.5** |
| `#94a3b8`（slate-400）on `#ffffff` | 2.56 | 29 處小字，含側欄 10px 分組標題 | **未通過** |
| `#dbe3ef`（`--border`）on `#ffffff` | 1.29 | 輸入框邊界 | 未達 1.4.11 的 3:1 |
| `#dbeafe`（ring-blue-100）on `#ffffff` | 1.22 | 輸入框聚焦光暈 | 僅輔助 |
| `#3b82f6` on `#ffffff` | 3.68 | 聚焦時邊框顏色 | 通過 1.4.11 |
| `#fcd34d` on `#020617` | 13.99 | 聊天室「官方」框 | 通過 |
| 約 `#595959` on `#0b0b0b`（`white/35` placeholder） | 2.81 | 聊天輸入 placeholder | 未達（placeholder 不強制，但應補提示） |
| 狀態徽章（blue-700／blue-50 等） | 4.88–6.16 | `Badge` | 通過 |

### 4.4 Reduced motion

- `globals.css:62-74` 以 `prefers-reduced-motion: reduce` 全域把 `animation-duration`、`transition-duration` 壓到 0.01ms；`accessibility.spec.ts:476-495` 用探針元素驗證。`app-shell.tsx:241` 的 `animate-ping` 另有 `motion-reduce:animate-none`。
- 副作用：`FormSubmitButton` 的載入圈圈（`animate-spin`）在 reduce 模式下變成靜止的缺角圓，仍有「儲存中…」文字與朗讀，可接受。
- 彈幕：`LiveDanmaku` 未掛載、無 CSS，reduced-motion 目前無從驗證（B07-05）；掛載時必須補規則。

### 4.5 表單錯誤是否把焦點帶到欄位

| 表單 | 欄位層級錯誤 | 聚焦到錯誤欄位 |
|---|---|---|
| 直播 stepper（瀏覽器驗證） | ✓ `onInvalid` 跳到該步並聚焦（`handleLiveFormInvalid`） | ✓ |
| 直播 stepper（伺服器錯誤） | ✗ 頂端單則訊息 | ✗ |
| 報名失敗（#441） | 表單層級 `role=alert`（`registration-submission-feedback.tsx`） | ✓ 聚焦錯誤訊息，並且不搶走使用者已移走的焦點 |
| 結帳 | 表單層級狀態列（`tabIndex=-1`，`statusRef` 聚焦） | ✓ |
| 表單建立器 | ✓ `aria-invalid`＋`aria-describedby` | ✗ |
| 商品、角色、模板、註冊、登入 | ✗ 頂端單則訊息 | ✗ |

### 4.6 `tests/e2e/accessibility.spec.ts` 與其他 axe 測試的實際覆蓋

規則集：`wcag2a/2aa/21a/21aa/22aa`；**只有 `critical`／`serious` 會讓測試失敗**，`moderate`／`minor` 不報。這一輪沒有執行這些測試，以下只是讀碼結果。

| 測試 | 覆蓋 | 未覆蓋 |
|---|---|---|
| `accessibility.spec.ts:276` 公開帳號頁 | `/login`、`/password-reset/request` | `/register`、`/password-reset/confirm`、`/mfa/*` 的 owner 版本 |
| `:283` 登入鍵盤順序與焦點 | 僅登入頁的 Email → 密碼 → 登入 | 其他頁面的焦點樣式 |
| `:305` 殼層 skip link | `/dashboard` | — |
| `:317` 31 條靜態 owner 路由 | dashboard、lives(/new)、videos(/new)、products(/new)、forms(/new)、messages/templates(/new)、interaction-scripts/roles(/new)、blacklists、affiliates(/new)、team-templates(/new)、team-performance、partner-pages、billing/{usage,plans,invoices,settlements,payouts}、affiliates/commissions、settings/{brand,tracking,security} | `/onboarding`、`/orders`、`/customers`、`/support-cases`、`/consultations`、`/landing-pages`、`/projects`、`/messages/deliveries`、`/settings/{line,features,team,automations}`、`/billing/{payment-methods,electronic-invoices,course-payouts}` |
| `:376` 14 條動態路由 | 各資源 edit、forms submissions、lives preview／analytics、`/live/{slug}`（**scheduled、未入場**）、`/form/{slug}` | 直播中、已入場、聊天室展開、商品浮卡、外部連結對話框 |
| `:412` 平台管理員 | admin 五頁與 MFA 設定／驗證 | — |
| `:476` reduced motion | 以探針元素驗證全域 CSS | 實際元件的動畫 |
| `:497` 手機殼層 | 390px 溢出與 header 目標 ≥ 44px | 其他頁面的溢出 |
| `wp7-one-stop-webinar-flow.spec.ts:355,368` | 390px 觀眾直播頁（播放中、商品浮卡）與結帳頁的 axe 與溢出 | 報名失敗狀態 |
| `commerce-orders.spec.ts`（多處） | 商品上傳、訂單詳情、配額耗盡、批次出款的 390px axe | — |
| `announcement-center.spec.ts:37` | 公告中心對話框 | — |
| `wp128-public-partner-unavailable-state.spec.ts:112` | 夥伴頁不可用狀態，含 320px | — |

重點缺口：註冊與問卷、政策頁、驗證確認頁、直播 stepper 的 2～8 步（面板 `hidden`）、所有錯誤狀態、所有鍵盤互動（stepper／上傳／對話框）、`moderate` 以下違規。見 B07-27。

## 5. 文案抽樣表（40 筆）

標記：✓ 好、△ 可用但可改、✗ 需修。

| # | 位置 | 字串 | 判定與問題 | 建議 |
|---|---|---|---|---|
| 1 | `lives/page.tsx:19` | 用 stepper 建立第一場直播 | ✗ 工程術語 | 用八個步驟建立第一場直播 |
| 2 | `register/page.tsx:9` | 建立你的商家 Workspace | ✗ 英文殘留 | 建立你的商家帳號 |
| 3 | `login/page.tsx:78` | 建立商家 Workspace | ✗ 同上 | 建立商家帳號 |
| 4 | `onboarding/page.tsx:87` | 發布前仍需遵守外部與人工 release gate | ✗ | 正式開賣前，仍請確認條款、金流與客服流程 |
| 5 | `onboarding/page.tsx:161` | 不取代法務、財務、客服 SLA、外部監控或 release owner 簽核 | ✗ | 這個進度只代表資料已備齊，不代表法務、財務與客服流程已確認 |
| 6 | `onboarding/page.tsx:120` | Step 1. … | ✗ 英文 | 第 1 步 |
| 7 | `commerce-checkout-form.tsx:506` | 這些文件在正式上線前仍需真人 owner 核准 | ✗✗ 內部備註外露給買家 | 刪除 |
| 8 | `live-stepper-form.tsx:494` | 啟用 ref 追蹤 | ✗ | 接受推薦連結來源 |
| 9 | `live-stepper-form.tsx:517` | 額度會在 immutable usage ledger 寫入前 fail closed；額度用完會拒絕後續 heartbeat | ✗✗ | 額度用完時，播放會暫停，不會自動扣款 |
| 10 | `live-stepper-form.tsx:527` | 必須先由 payment provider 驗證付款方式 reference | ✗ | 請先完成平台服務的付款方式驗證 |
| 11 | `live-stepper-form.tsx:161-163` | 開播時間（Asia/Taipei）；儲存時會轉成 UTC | ✗ | 開播時間（台灣時間） |
| 12 | `dashboard-kpis.tsx:94,124` | 近 7 天播放 session；已通過直播 admission 的不重複播放 session | ✗ | 近 7 天觀看人次；只計入成功進入直播間的不重複觀看 |
| 13 | `media-upload-field.tsx:373,397` | R2 完成驗證失敗；Stream 無法處理這個影片 | ✗ | 圖片上傳後驗證失敗，請重試；影片無法處理，請換一個檔案 |
| 14 | `commerce-checkout-form.tsx:425` | 付款服務目的地不安全；請先查看訂單狀態並聯絡客服 | △ 買家看到的怪詞 | 付款連結無法確認安全，請先不要付款並聯絡客服 |
| 15 | `product-form-client.tsx:328,309,105` | 課程推廣者 G 比例（basis points）；幣別（ISO 4217）；這個 Slug 已被… | ✗ | 推廣者分潤比例；幣別；這個商品網址已被使用 |
| 16 | `lives/[id]/preview/page.tsx:40-41` | 串流模式：vod；Cloudflare Live Input：{uid} | ✗ 原始值 | 播放方式：預錄影片；直播串流：已設定 |
| 17 | `line-official-account-form.tsx:70,105` | Messaging Access Token；憑證格式不完整，或目前無法儲存 | △ 對應 LINE 後台欄名但無指引、錯誤泛用 | 加欄位來源說明；錯誤分類 |
| 18 | `registration-submission-client.ts:20-27` | 請確認必填欄位與資料格式後再送出。 | △ 沒指出欄位（原生驗證通常先攔住） | 可接受；伺服器端回欄位名時要顯示 |
| 19 | `register/page.tsx:6` | 請確認資料完整，密碼至少 12 個字元。 | △ 泛用 | 依錯誤原因分開說 |
| 20 | `use-live-studio-draft.ts:200` | 草稿已儲存，可安全離開後再繼續。 | ✓ | — |
| 21 | `use-live-studio-draft.ts:201` | 另一個分頁已有較新的版本。為避免覆蓋，請重新整理後再繼續。 | △ 沒說本分頁修改會消失 | 補一句「目前的修改不會保留」並提供複製 |
| 22 | `lives/page.tsx:29` | `draft`／`scheduled` | ✗ 原始列舉 | 草稿／已排程／直播中／已結束 |
| 23 | `billing/payment-methods/page.tsx:50` | 目前 provider 尚未提供安全的付款方式設定流程；不會要求 CelebrateDeal 儲存卡號或手動 token | ✗ | 目前尚無法在這裡設定付款方式；我們不會儲存你的卡號 |
| 24 | `affiliates/commissions/[id]/page.tsx:90` | 以…append-only ledger 核對佣金、退款、dispute 與 payout 結果 | ✗（封測隱藏的模組，但仍可見） | 逐月核對佣金、退款、爭議與出款 |
| 25 | `settings/team/page.tsx:77` | slug 只用於內部穩定識別 | ✗ | 團隊代號僅供系統內部使用 |
| 26 | `settings/security/page.tsx:135` | 資料庫 session 搭配 httpOnly cookie | ✗ | 登出會讓目前裝置的登入狀態失效 |
| 27 | `login/page.tsx:34` | 所有 session 已撤銷，請重新登入。 | △ | 已將所有裝置登出，請重新登入 |
| 28 | `global-error.tsx:20-22` | 系統暫時無法顯示這個頁面…請稍後重新整理或返回後台 | △ 用詞好，但沒有任何按鈕或連結 | 加「重新整理」「回到後台」 |
| 29 | `verify-registration/page.tsx:34-35` | 確認連結無效或已過期；請回到原活動頁重新送出報名 | △ 用詞好，沒有連結與重寄 | 加連結與「重寄確認信」 |
| 30 | `registration-submission-client.ts:30` | 請到 Email 開啟確認連結；完成確認後才會列入正式名單。 | ✓ 清楚；可再補垃圾信提示 | 補「沒收到請查看垃圾信件匣」 |
| 31 | `registration-error/page.tsx:8` | 無法安全確認原報名頁，這次未儲存填寫內容。請回到原活動頁重新填寫。 | ✓ 誠實；✗ 「回首頁」連到商家登入頁 | 改「回上一頁」 |
| 32 | `interaction-script-form.tsx:45-69` | 限量清倉…售完後不一定會補 | △ 預填的主張性文案 | 中性占位 |
| 33 | `app-shell.tsx:206,208,241` | Live Commerce OS；Beta；系統連線正常 | ✗ 英文；✗ 硬編碼狀態 | 移除或接健康檢查 |
| 34 | `dashboard-kpis.tsx:102-103` | 近 7 天真實留言；排程留言腳本（設定數） | ✓ 誠實區分 | — |
| 35 | `orders/page.tsx:9-10` | 待付款／已付款／付款逾期／部分退款 | ✓ 全中文且對應系統狀態 | — |
| 36 | `checkout/result/page.tsx:22-26,39-46` | 等待付款確認；這不代表扣款成功或失敗。請勿重複付款 | ✓ 狀態講真話 | — |
| 37 | `format.ts:1-8` 與 `commerce-checkout-form.tsx:57` | $1,234；$12,345.00 | ✗ 格式不一 | NT$1,234 |
| 38 | `messages/templates/page.tsx:97` | 在事件來源或 provider 接通前保持停用 | ✗ | 尚未開放，敬請期待 |
| 39 | `video-form.tsx:23,62` | 應用程式不會接觸 provider token 或 stream key；已安全保存，streamKeyRef: {id} | ✗ | 影片檔案會直接上傳到影音服務，不經過我們的伺服器 |
| 40 | `lead-form.tsx:201,208` | 送出中...；🟢 接收 LINE 開播提醒與電子票券 | ✗ 風格 | 送出中…；以圖示取代 emoji |

### 5.1 #441 報名失敗文案專評

`formSubmissionErrorMessage`（`registration-submission-client.ts:19-27`）把 400／403／404／429／503／其他 HTTP 錯誤／網路錯誤分成六種，且明確說明「內容仍保留」，與 `RegistrationRetryProvider` 的「若您已報名，請先查看確認信，避免重複送出」互相呼應，是全站最好的錯誤文案。只剩兩個小問題：403 要求重新整理（B07-29）、400 不指明欄位。`RegistrationSubmissionFeedback` 的焦點行為（不搶走使用者已移走的焦點）也很細。

### 5.2 政策頁（`public-policy-content.ts`）專評

- 語氣為自然的台灣法律用語（通訊交易解除權、載具、統一編號、消費者保護法），沒有簡體字或中國用語；對「尚未提供一鍵刪除」「自動電子發票尚未開放」等限制誠實揭露，值得肯定。
- 缺口：(1) 只揭露「標示為官方的互動」是腳本，沒有涵蓋不標示的虛擬觀眾（B07-04）；(2) 沒有專屬的商家服務條款（B07-15）；(3) 客服信箱為個人 Gmail（B07-32）；(4) 生效日 2026-11-01 與封測同日，結帳頁的內部備註（B07-01）與此矛盾。

## 6. 虛擬使用者與互動腳本專節

| 面向 | 觀察 | 評價 |
|---|---|---|
| 建立角色 | 工作台提供預設頭像（性別篩選、上一個／下一個）、上傳頭像、即時預覽卡、「使用影響」面板（被幾個腳本引用、停用後影響幾則）、刪除確認 | 好用，是全站少見的「變更前先看影響」設計 |
| 角色型別 | 現行僅「官方角色」與「一般觀眾」兩型（`interaction-role.ts`）；市場報告提到的 `audience` 風險確實存在 | 見 B07-04 |
| 前置條件 | 角色必須勾「排程角色」才會出現在腳本與聊天室 | ✗ B07-03 |
| 排程發言時機 | 腳本編輯器：`MM:SS` 時間輸入、逐事件錯誤＋`aria-describedby`、上下移動、四種範本、時間軸大綱；卡片排程（`interaction-card-schedule.tsx`）檢查影片長度並可輸入預覽時間 | 好用；缺整體預覽與時間範例 |
| 預覽 | 角色預覽為靜態文字（「歡迎來到直播！」）；腳本沒有「模擬播放」 | △ |
| 講師即時控制 | 暖場控制台（載入、排程、停止、手動發送）＋全場彈幕開關 | ✗ 觀眾端未承接（B07-05） |
| 對觀眾的呈現 | 聊天室顯示角色名稱與 `label`；`official` 另有「官方」徽章 | 與 owner 決策不一致（B07-04） |

**是否流進商家統計**：本輪讀到的路徑**沒有**流進。`realViewerMessageWhere`（`live-chat-analytics.ts:36-51`）要求 `source="viewer"`、`isSimulated=false`、`roleId=null`、`formSubmissionId` 不為空；排程訊息另以 `scheduledMessageEventWhere` 計為「設定數」，儀表板（`dashboard-kpis.tsx:102-103`）、直播分析（`lives/[id]/analytics/page.tsx:275,279`）、CSV 匯出（含 `isSimulated` 欄）、學員 CRM（`customer-crm.ts:218`）皆分開。因此不標 MAJOR。未覆蓋：抽獎／投票／快閃搶購的 response 與 presence 計數是否排除虛擬使用者（超出本軸，建議 A 軸補一支測試）。

## 7. 商家後台資訊架構與狀態誠實

- **側欄分群**（`app-shell.tsx:20-110`）：營運總覽／銷講中心（直播間、影片素材、一頁式網站、報名管理）／成交管理（商品、訂單、諮詢、學員 CRM、客服案件）／互動與行銷（訊息模板、寄送管理、互動腳本、互動角色、封鎖名單）／夥伴成長／設定（收進帳號選單）。分群語意清楚，標籤與頁面標題一致（#439 的成果）。對講師的建立順序（商品 → 報名表 → Email → 直播）而言，「商品」在第三組、「訊息模板」在第四組，所以應由 `/onboarding` 單一路徑負責引導，而不是調整側欄（B07-24）。「報名管理」實際是表單建立器加名單，可考慮改名「報名表單與名單」。
- **頁面標題**：直播、影片、商品、表單、模板、腳本皆為「列表名／新增 X／編輯 X」，已無舊競品的標題錯誤。互動角色三條路由共用同一個工作台，是刻意設計。
- **狀態講真話**：
  - 做到：訂單與買家結果頁（完全依系統狀態）、報名名單「已驗證／待驗證」、儀表板分開列「報名」與「完成 Email 驗證」、「真實留言」與「排程留言腳本（設定數）」、Email 寄送成功／失敗、直播編輯頁對失效資源的逐項警告。
  - 沒做到：「系統連線正常」硬編碼（B07-16）、狀態徽章輸出原始列舉（B07-06）、手動發送顯示成功但觀眾看不到（B07-05）、儀表板缺已付款（B07-17）、客服案件退款交接狀態與佣金／出款狀態同樣輸出原始值（`support-cases/page.tsx:99`、`affiliates/commissions/page.tsx:159`）。

## 8. 做得好的部分

1. `FormSubmitButton`（`form-submit-button.tsx`）：`useFormStatus` 防重送、`aria-busy`、獨立 `role=status` 朗讀、`confirmMessage` 與 `requestSubmit(button)` 保留 name／value／formAction。
2. 直播草稿自動保存佇列：序列化寫入、不中斷請求、離開前攔截、版本衝突鎖定而非覆蓋。
3. 報名失敗不丟資料與原生 POST 退路（#441）、`RegistrationSubmissionFeedback` 的焦點策略。
4. 結帳：冪等鍵、恢復訂單、步驟條、狀態朗讀；付款結果頁用詞誠實。
5. 報名表單建立器：預設欄位、草稿復原、行內錯誤、4 步預覽。
6. 角色工作台的使用影響面板與刪除前確認。
7. 發布待辦清單可一鍵跳到缺漏步驟並聚焦欄位。
8. `PublicPolicy` 的條款對限制誠實，且生效日以 Asia/Taipei 判斷（`resolvePolicyStatus`）。
9. axe 測試已涵蓋 31＋14 條 owner 路由與 390px 的觀眾端、結帳、訂單詳情。

## 9. 建議修復批次

| 批次 | 內容 | 估工 | 時程 |
|---|---|---|---|
| A 一天內可完成 | B07-01、06、08、11、16、21；B07-03 的預設值與空狀態；B07-09 的「前往直播間」連結；B07-13 的樣式 token | 約 2–3 天（S 級合計） | 10/21 前 |
| B 封測前 | B07-02、07、10、12（主線頁面）、04＋05（依 owner 決策）、14、15 | 約 6–8 天 | 10/29 前，需 owner 先在 10/21 前回覆 04、05、09、14、15 的決策 |
| C 封測期間 | B07-17、18、19、22、23、24、27、28、29 | 約 6–8 天 | 封測第一週後 |
| D 路線圖 | B07-20、25、26、30、31、32 | — | 公開上線前 |

需 owner 決策彙整：(1) 虛擬使用者標示策略 A／B（B07-04）；(2) 彈幕與暖場控制台封測隱藏或交付（B07-05）；(3) 銷售直播是否強制互動腳本（B07-14）；(4) 註冊同意與商家服務條款（B07-15）；(5) 雙重確認保留與否（B07-09）；(6) 封測要隱藏的模組清單（B07-23）；(7) LINE 在封測的範圍（B07-13）。

## 10. 未驗證與限制

- 沒有任何瀏覽器實測：英文 404（B07-08）、UTC 顯示（B07-11）、重複 slug 的 500（B07-07）、LINE 內建瀏覽器的付款回跳（B07-31）、焦點樣式的實際視覺（B07-22）都是從程式碼推論，建議在 staging 以 390×844 與 1280×800 兩個視窗各走一次第 2 節流程，並錄下證據。
- 沒有執行 `e2e:a11y`、`vitest` 或 `typecheck`，因此不能宣稱現行 a11y 測試通過。
- 色彩對比是以 Tailwind 預設色票與 `globals.css` token 計算，未涵蓋所有元件的實際疊色與透明度。
- `src/app/admin`、`portal`、`affiliate-portal`、`lp` 編輯器、課程學習頁未做互動審查；品牌設定頁、追蹤設定頁未深讀。
- `.ai-team/tmp/*` 內的舊副本只用來判斷彈幕 CSS 曾存在，未讀其他內容。

## 附錄 A 建議詞彙表（工程詞 → 講師用語）

| 工程詞 | 建議用語 |
|---|---|
| Workspace | 商家帳號／工作區 |
| slug | 網址代稱（商品、表單、直播頁用「網址」） |
| session（登入）／播放 session | 登入狀態／觀看人次 |
| admission | 成功進入直播間 |
| provider／payment provider | 金流服務／付款服務 |
| reference（付款方式 reference） | 付款方式紀錄 |
| webhook | 通知網址（僅在 LINE 設定頁保留英文並加說明） |
| ledger／append-only | 帳務明細／只增不改的帳 |
| ref 追蹤 | 推薦連結來源 |
| VOD／Live Input | 預錄影片／即時直播 |
| streamKey | 直播串流金鑰（不顯示給講師時整段拿掉） |
| fail closed／heartbeat | 不使用，改寫成結果（「額度用完時會暫停播放」） |
| release gate／release owner／SLA | 上線前確認／負責人 |
| 暖場角色／官方角色／一般觀眾／虛擬使用者 | 統一為單一名詞（依 B07-04 的決策） |
| NT$／日期 | 一律 `NT$1,234`；日期時間固定 Asia/Taipei，顯示「台灣時間」 |
