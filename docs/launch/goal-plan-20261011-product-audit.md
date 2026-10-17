> WP17最新進度：快速3項決策入口與交易式自動建場已實作，原verified發布條件逐字保留；46測試／13真實PG／tsc通過，4次qualified review最後0B/M。最新UI編譯遇length錯誤，保留owned快取後同source重建23856進行中；browser／實際合成影片播放／通知回執及原前置尚未全驗。新增tenant／發布邊界採Critical scoped審查，UI不機械指定實作模型。詳最新handoff與WP17/validation.json，仍9/20。

> WP09最新進度：名單／Webinar各新增3款課程銷講模板，67測試、原12款相容比對、直接webpackbuild、獨立tsc／lint、全6款真實UI套用／發布／合成報名與12次axe已通過。wholegate僅保留原WP17／內容核可前置，仍9/20；不重跑未改動驗證，接WP17安全本機scope。詳最新handoff與WP09/validation.json。

> WP18 最新進度：3 追銷草稿可明確啟用，可信來源／版本競態防護與未到場退訂已完成；60 定向測試、14 實際 PG 檢查與兩次 qualified Opus review 通過，真實 browser checkout／延遲重放與4次 axe 已通過。暫跳過待補資料，仍 9/20（45%）。詳見最新 handoff 與 WP18/activation-validation.json。

> WP18最新進度：真實完看／未下單producer與寄送前檢查已接入現有Email job，含跨場次／非primary付款、未知歸因不猜零、來源不可用重試；134定向／相容測試、16真實PG檢查通過，4次qualified Claude review最新0B/M1MINOR。接續原新trigger啟用與既定Sandbox/E2E/axe/gate，仍9/20（45%）。已重核原報告／本計畫，額外「未持久化事件自動補寫」不是原驗收，不再列為阻擋；best-effort風險仍記錄。見最新handoff與WP18/completed-followup-validation.json。

> WP18最新進度：結帳30分鐘延遲佇列已接入現有Email job，跨規則／版本每張訂單最多一封；175定向＋10退訂測試、16實際disposablePG檢查通過。3次qualified Claude審查，最新0BLOCKER/MAJOR，保留send-time設定故障恢復子項；可信完看／事件遺漏恢復／整包驗收尚未完成，仍9/20（45%）。完整scope、風險、未驗證項及回滾見handoff與WP18/checkout-queue-validation.json。

> WP18續進：結帳候選事件及現有Email派送前狀態／收件綁定檢查已實作，192定向tests／9個真實disposablePG檢查通過，qualified critical review與修復已記錄；原佇列／完看／Sandbox／整包gate尚未完成，仍9/20（45%）。依使用者暫跳過資料指示繼續，不重新索取開發授權。

> 2026-10-16 最新執行指示：使用者要求暫跳過待補收款／發票／政策資料，先做下一項。WP18已進行3套一鍵追銷草稿實作與定向驗證；整包仍IN_PROGRESS，可信事件、send-time eligibility、Sandbox及原最終依賴尚未完成，不縮減20WP目標，累計仍9/20（45%）。

> 2026-10-16 執行狀態：WP-20 經 canonical gate READY，累計9/20（45%）；剩餘11包保留 D-2～D-6／依賴 WAITING_AUTHORIZATION。驗收範圍限非正式合成資料；完整變更、evidence與未驗證子項見 product-audit-20261012-handoff.md 最新區塊及 WP-20/delivery-final.json。以下保留原規劃與歷史授權狀態。

# Goal Plan：銷講第一次成功與產品審視修復

> 2026-10-16 執行進度：WP-03 經 canonical gate READY，累計 10/20（50%）。公開服務條款、隱私與退款政策已補齊版本／預定生效日與實際能力邊界；本機、disposable PostgreSQL、合成資料、瀏覽器與無障礙驗證通過，Critical 獨立複審為 0 BLOCKER／0 MAJOR。政策狀態在 2026-11-01 前維持 scheduled；Production build、部署與實際外部送達未執行。詳見 `docs/launch/wp03-policy-handoff-20261016.md`。

> 2026-10-16 最新人類決策：WP12先顯示「自動電子發票尚未開放」，選定原計畫的未開放呈現分支；不開通PayUni／光貿，也不推定稅務免開。WP19方向確定EVERY8D＋額外點數、基本方案不漲價，但人類明示先不實作。兩題方向不再等待決定；其他供應商實際資料與原依賴保留。細節見provider-decisions-research-20261016.md及最新handoff。
>
> 2026-10-16 WP12 分支結案補充：原 WP04→WP12 排程依賴只適用自動開立 adapter 分支；未開放呈現分支沒有 scheduler、adapter、provider、schema 或付款流程變更，因此以既有 canonical READY 與 Billing 深審完成 WP12。日後啟用供應商視為新變更，必須恢復 WP04→WP12 handoff、Sandbox 開立／重試／回寫驗證與獨立 Billing 深審；既有 queued 需求不得在未決定 backlog policy 前自動開立。

- 日期：2026-10-11（Asia/Taipei）。
- Goal ID 建議：`product-audit-20261011`。
- 基底：`origin/master@efb8b7e9a737ea30ea691870318d85bf74830331`。
- 本輪交付：只製作計畫。20 個 WP 均未啟動；未建立 Goal runtime state、未執行產品測試、未 commit／push／deploy。
- requested_team：`ai-team-pro`；每個未來 WP 的模型、effort、availability、quota 與 review plan 均交當次 router 決定。本文件不預選實作模型。
- 唯一文件 writer：本對話主代理。未啟動子代理。實作 ownership 名稱是未來責任槽位，尚未指派或 dispatch。

## 1. 來源、範圍與授權

已完整閱讀整合報告 `docs/reviews/2026-10-11-product-audit-consolidated.md`；僅針對 F-08／F-09／F-17／F-18 與 WP scope 查閱完整版相應段落。本輪未重新檢視 screenshots 或重現產品問題。歷史實測、程式碼判斷、推論與待驗證假設沿用原標籤，不能視為本輪驗證。

原工作樹 `C:/Users/eden/Downloads/AI/CelebrateDeal` 只讀取明確指定文件及 Git metadata，沒有修改。整合報告與完整版在原工作樹尚未追蹤，不存在於基底；它們是使用者指定的規劃輸入，不代表納入基底程式碼。來源 SHA-256 與實際位置另記 plan evidence；後續執行前必須確認能取得同版本報告，缺失時停止，不以其他分支代替。

已閱讀原工作樹與指定基底的 AGENTS、GOAL-PROTOCOL、ROUTING、handoff-schema、routing-policy。兩者 final-review/fallback 不同；實際路由採指定基底 canonical policy，不複製 dirty policy。文件間殘留泛用 fallback 敘述不得覆蓋 canonical policy 的最終 reviewer 資格。使用者本輪「plan-only、不得推送／部署」高於一般自主開發與 Git promotion 預設。

**Goal 結果**：讓新商家能完成報名頁發布、提醒、到場、追銷與分析；先修開發基礎線、公開發布與信任面，再處理安全、外部服務與低風險體驗整理。

**涵蓋範圍**：整合報告 WP-01～WP-20、其必要驗證、人工決策、sanitized evidence 與回滾規劃。表格列出的是候選檔案範圍；開始 WP 前須解析成精確檔案清單與 tests 清單，重新 snapshot／route，不能把 glob 當作整個目錄任意改動的授權。

**不在範圍**：產品實作、Goal 啟動、產品程式碼／CI 修改、commit、push、merge、任何部署、正式 DB／付款／退款／寄信、破壞性 migration、讀取秘密、既有 dev/test DB 套用 migration，以及課程／社群／學員中心擴張、勞報／稅務匯出擴充、平台推薦對外、抽獎／紅包、Meta CAPI 新增。F-22 文件整理與 F-25 README／角色識別字另列 backlog，不偷偷塞入本 Goal；角色問題若影響 Permission，須另行定義 Critical scope。

### 共同前置條件 G0～G4

- G0：取得「開始實作」的明確授權。本次授權僅限計畫，所有 WP 目前均為 `WAITING_AUTHORIZATION`；以下「無額外授權」只指 G0 之後不需額外業務／供應商核准。
- G1：在獨立工作樹確認 HEAD、乾淨 ownership 與精確檔案清單；修改 Next.js 前讀對應本機 `node_modules/next/dist/docs/`。不操作使用者 dirty 工作樹，不使用 checkout/reset/clean/stash/restore/rebase 丟棄變更。
- G2：WP-07 完成後，其「全新 disposable PostgreSQL 套用 migration、seed exit 0、合成帳號登入」成為其他 WP 的前置 smoke。純文件／靜態準備可以不依賴 DB，但不得宣稱 WP 完成。WP-07 自身負責建立此基線。
- G3：每個 WP 取得路由、writer lock、驗收清單及適用環境證明；共享路徑／資料資源未釋放就等待。現行政策 `max_parallel_agents=1`、`max_writers=1`，所以「可並行」僅表示依賴圖相容，目前預設仍序列執行。
- G4：只用本機／Preview／staging／固定 Sandbox／disposable PostgreSQL 與合成資料。runner 必須自行確認非 Production 目標與資料隔離；不得讀取或輸出 `.env*`、Token、Cookie、私鑰、正式 Secret、正式客戶／付款資料。憑證僅由核准 process environment／CI Environment／provider 注入，不索取其值。

## 2. 決策與阻擋登錄

所有決策目前缺本輪可驗證的核准輸入，狀態均為 `WAITING_AUTHORIZATION`。以下是需要的證據，不是本輪要執行的外部操作。

| ID | owner／待輸入 | 解鎖證據 | 直接阻擋 | 下游影響 |
| --- | --- | --- | --- | --- |
| D-1 | 產品 owner：專案單一發布，或雙層發布加檢查 | 明確決議；可用 5 位新商家 think-aloud 支援，記錄選項與驗收語意 | WP-01、WP-17 | WP-02、WP-09 的發布驗收、WP-16 |
| D-2 | 業務／法遵 owner：平台代收再結算或商家自有金流；付款方式定位 | 法遵意見及 PayUni 條款適用結論，僅 sanitized 摘要 | WP-02 | WP-17、WP-16 |
| D-3 | PayUni 整合 owner：Token／IP 核准狀態、範圍與時程 | 核准或未核准的可查證狀態紀錄，不含憑證值 | WP-02 | WP-17、WP-16 |
| D-4 | 產品 owner：SMS 或明確 Email＋LINE；適用成本／通道承諾 | 決議及可選的 5 位講師訪談摘要 | WP-19、WP-13 的通道方案 | WP-14、WP-16 |
| D-5 | owner／法遵：正式條款、隱私、退款內容 | 核准的版本、生效日、文字與責任人 | WP-03 | 公開上線信任驗收、WP-16 |
| D-6a | 平台維運 owner：staging／production 排程是否已存在 | owner 提供 sanitized 設定清單、時區、job owner、非 Production target、重複排程檢查與核准範圍 | WP-04 | WP-13、WP-18、WP-14、WP-17 提醒驗收、WP-16 |
| D-6b | 帳務／法遵 owner：發票供應商或暫不開放 | 決議、Sandbox 能力與注入方式；若不開放須確認呈現規則 | WP-12 | WP-16 |

D-6a／D-6b 是 D-6 的兩個輸入，不是新增 D-7。production 設定只接受 owner 的去識別說明；本計畫不授權登入正式平台檢查或呼叫正式 job。

其他外部輸入也不得假設：

| 輸入 | 狀態 | 阻擋 |
| --- | --- | --- |
| 非 Production ingress／proxy 信任拓撲與測試 host | WAITING_AUTHORIZATION | WP-11 |
| 合成 LINE channel／收件者與 provider 注入已備妥的確認 | WAITING_AUTHORIZATION | WP-13；連帶 WP-14 |
| 模板主題、素材使用權與產品內容核可 | WAITING_AUTHORIZATION | WP-09 |
| SMS 供應商、費用上限、Sandbox recipient 與計量定義，或不做 SMS 的核可 | WAITING_AUTHORIZATION | WP-19 |
| A/B 指標定義、實驗核可與代表性流量來源 | WAITING_AUTHORIZATION | WP-14；合成流量只能驗證技術，不能證明轉換提升 |
| 若現有事件不足：分析指標定義／事件資料契約 | WAITING_AUTHORIZATION | WP-20 受影響指標；不得擴大事件寫入 scope |
| G0 實作授權 | WAITING_AUTHORIZATION | 全部 WP |

## 3. 批次與可執行順序

批次是產品分類，不能覆蓋依賴或 writer lock。阻擋的 WP 留在原批次，下一個無阻擋項可繼續；不將等待外部資料的 WP 當作已完成。

| 批次 | WP | 序列與進入條件 |
| --- | --- | --- |
| Batch 0：基礎線／入口／公開信任 | WP-07、WP-06、WP-05、WP-03 | G0 後優先 WP-07；其餘檔案範圍理論可分離，但 DB 驗收等待 WP-07。WP-03 等 D-5。 |
| Batch 1：發布／安全／排程 | WP-01、WP-17、WP-10、WP-11、WP-04 | WP-06 → WP-01；D-1 → WP-01。WP-10 獨立；WP-11 等拓撲；WP-04 等 D-6a。WP-17 保留本批分類，但必須跨批等待 WP-02，並等 WP-04 提醒驗收。 |
| Batch 2：追銷／分析／命名／Billing | WP-18、WP-20、WP-08、WP-02 | WP-04 → WP-18；WP-06、WP-01、WP-05 → WP-08；D-2、D-3、WP-01 → WP-02；WP-20 等指標契約。WP-02 完成後回到 WP-17。 |
| Batch 3：觸達／發票／模板／體驗 | WP-13、WP-19、WP-12、WP-09、WP-14、WP-15 | D-4、WP-04、WP-06、WP-08 → WP-13 → WP-19；D-6b、WP-04 → WP-12；WP-08、WP-17、內容核可 → WP-09；WP-05、WP-13、WP-17 → WP-14；WP-08 → WP-15。 |
| Batch 4：無行為變更重構 | WP-16 | 等 WP-01～15、WP-17～20 全部完成。若決議延期任何項，須 owner 明確縮減 Goal 範圍並重訂回歸基線，不自行跳過依賴。 |

補正來源衝突：整合報告第 7 節把 WP-17 放 Batch 1、WP-02 放 Batch 2，同時規定 `WP-01 → WP-02 → WP-17`。本計畫採共享檔案序列為硬依賴，不形成循環。WP-17 自動提醒依賴 WP-04；WP-13 也受第 5 節 D-4 約束，即使來源 WP 表只列 WP-04，仍保留決策 gate。

### 單一 writer 表

每個 writer 只持有自身 WP 的精確檔案／資源清單。下表的 owner 是責任槽位，不是實作模型。檔案移交需保存 snapshot、未完成事項與鎖釋放證據；reviewer 永遠唯讀。

| 共享檔案／資源 | 唯一 writer 與移交順序 | 鎖的範圍 |
| --- | --- | --- |
| 本 Goal Plan、plan evidence | 本對話主代理 | 本輪唯一新增文件與證據；不寫 runtime Goal state |
| `src/components/app-shell.tsx` | WP-06 → WP-08 → WP-15 | 導覽、標題、行動 chrome |
| `src/lib/vendor-feature-toggles.ts` | WP-06 → WP-01 | 入口及諮詢可用性；不得改 Permission 規則 |
| `src/lib/sales-workspace.ts`、`src/lib/landing-page-service.ts` | WP-01 → WP-02 → WP-17 | WP-02 僅前者；後者仍保留群組鎖，避免發布契約交叉修改 |
| `src/components/landing-page-workspace.tsx` | WP-01 → WP-08 | 發布結果與工作區用語 |
| `src/components/landing-pages/**` | WP-05 → WP-08 → WP-09 → WP-14（若相交） | WP-14 實際 A/B 路徑須先解析；operations panel 再交 WP-15，與其他 writer 不重疊 |
| `src/app/(app)/**/page.tsx` 標題 | 各功能 WP 釋放後才交 WP-08；其後功能 owner 不覆蓋已定案用語 | WP-08 不擁有整頁功能或資料邏輯；涉及 WP-01/02/06/10/12/13/17/18/20 時逐檔鎖定 |
| Dashboard 頁面 | WP-08 → WP-15 | WP-20 只持有 read model／analytics；不得越界 Dashboard 頁面 |
| `src/app/(app)/settings/**` | WP-06 → WP-08 → WP-13/18（不同子目錄且鎖釋放） | WP-06 只處理入口／死連結，不擁有 automations、LINE 的業務實作 |
| `src/components/message-template-form-client.tsx` | WP-13 → WP-19 | 通道選擇與模板呈現 |
| `src/app/api/jobs/**`、`src/app/api/cron/**` | WP-04 → WP-12（發票子目錄） | scheduler 設定亦由 WP-04 獨占；禁止 billing-cycle 實際執行 |
| `src/app/api/payments/checkout/**` | 只有 WP-18 | 僅發事件；不得改價格、付款或冪等邏輯；獨立深度審查 |
| `src/app/actions.ts`、`src/app/actions/**`、app layout | 所有行為 WP → WP-16 | WP-16 不與其他 WP 並寫；不以重構名義改 Auth/Permission |
| 測試檔／vitest config | WP-07 先命名分層，再交各 WP 的精確測試 owner，最後 WP-16 | 同一測試／共用 fixture 同時一位 writer；不得刪 assertion 或降低 coverage |
| disposable DB、synthetic tenant／recipient | 當次 WP owner | 每個 WP 獨立 DB／namespace；不得共享可變資料作並行驗收 |
| Sandbox scheduler／LINE／SMS／發票資源 | WP-04／13／19／12 各自持有已核可資源 | 若實際共用同一 provider resource，依 WP 序列移交；停用後證明無待送任務 |

## 4. WP 合約

下列 scope、不可觸碰、驗收與驗證取自整合報告第 6 節；後續 signals 表與補充合約一起構成每個 WP 的完整合約。來源表若與補充表不同，依賴取聯集、驗收取較完整條件，risk 採結構化 signals 並交 router 計算；不得只讀來源表略過新增 gate。全部 WP 的 ownership 為對應 `WP-nn-owner`，由主代理在開始前指派唯一 writer；主代理負責整合，審查者唯讀。每個 WP 都繼承 G0～G4、單一 writer 順序與第 7 節 evidence／gate；目前實作、測試、審查一律 `NOT_RUN`。

| WP | 對應 | 目標 | Scope | 不可觸碰 | Signals | 驗收條件 | 驗證 | 依賴 | 額外授權 | 審查 |
|---|---|---|---|---|---|---|---|---|---|---|
| **WP-01** | F-01、F-03、F-04、F-07 | 發布鏈單一語意；缺項清單；無專案時可行動；諮詢模式不導向被隱藏頁 | `src/lib/sales-workspace.ts`、`src/app/actions/sales-workspace-actions.ts`、`src/app/actions/landing-page-actions.ts`、`src/lib/landing-page-service.ts`、`src/app/(app)/projects/**`、`src/app/(app)/landing-pages/new/**`、`src/components/landing-page-workspace.tsx`、`src/lib/vendor-feature-toggles.ts` | `prisma/schema.prisma`、migration、支付程式、`.env*` | C高 R中 S商家＋公開 P無 | Funnel 發布成功⇒公開頁 200 且含表單；未就緒顯示缺項；`/landing-pages/new` 無專案有「建立專案」；諮詢專案導向可用頁 | targeted＋E2E | D-1 | 否 | 一般 |
| **WP-02** | F-02 | 「商家扣款方式」拆出銷售就緒閘門或改名；文案任務化 | `src/app/(app)/billing/payment-methods/**`、`src/lib/sales-workspace.ts`、`src/lib/merchant-onboarding.ts` | `src/lib/payment-providers/**`、webhook | C中 R高(Billing) S商家 P billing 閘門 | 閘門與文案一致；有／無核准情境皆不誤導 | targeted＋integration | D-2、D-3、WP-01 | **是** | **獨立深度審查** |
| **WP-03** | F-10 | 移除內部治理語言；版本化政策頁骨架與頁尾 | `src/app/policies/**`、頁尾元件、`src/app/support/**` 文案 | 法律內容本身 | C低 R中(法遵) S公開 P無 | 公開頁無 `DRAFT`／`HUMAN OWNER`／`P0-P2`；有版本與生效日 | targeted＋a11y | D-5 | **是**（內容） | 一般 |
| **WP-04** | F-15 | 註冊排程與心跳、健康檢查、外部 scheduler 文件 | `vercel.json`、`vercel.staging.json`（僅 cron 欄位）、`src/app/api/jobs/**`、`src/app/api/cron/**`、`docs/launch/staging-cron-operations.md` | Production 部署、正式寄信、billing-cycle 實際執行 | C中 R高(Billing/Email) S基礎設施 P production 設定 | 非 production：排程可呼叫且有心跳；端到端確認信＋提醒（Sandbox） | integration＋staging | D-6 | **是** | **獨立深度審查**（billing-cycle 部分） |
| **WP-05** | F-08、F-21（表單） | 原生 POST 失敗回原頁；收斂 3 套報名表單 | `src/app/api/form-submissions/route.ts`、`src/components/landing-pages/funnel-webinar-experience.tsx`、`funnel-page-document-renderer.tsx`、`src/components/lead-form.tsx` | Email 確認規則本身 | C中 R中 S公開 P PII | 400/403/429/503 皆 303 回原頁保留欄位；aria-live 一致 | targeted＋E2E＋a11y | 無 | 否 | 一般 |
| **WP-06** | F-05、F-06 | 修死連結；補「我的夥伴頁」「LINE 整合」入口 | `src/components/app-shell.tsx`、`src/lib/vendor-feature-toggles.ts`、`src/app/(app)/settings/**` | 權限邏輯 | C低 R低 S商家 P無 | 導覽逐項點擊無 404；兩頁可由導覽到達；角色過濾測試通過 | targeted＋E2E smoke | 無 | 否 | 一般 |
| **WP-07** | F-20 | 修 seed；DB 落後自檢；DB 測試命名分層 | `prisma/seed.ts`、`vitest.config.ts`、`scripts/local-database-safety.ts`、需 DB 的測試 | schema、migration | C低中 R低 S開發 P本機 DB | 全新 DB：`migrate deploy`＋`db seed` exit 0 並可登入；落後時啟動前提示；命名與實際相符 | targeted | 無 | 否 | 一般 |
| **WP-08** | F-11 | 工作區與 Dashboard 中文化；導覽與頁名一致 | `src/components/landing-pages/**`、`src/components/landing-page-workspace.tsx`、`src/app/(app)/dashboard/**`、`src/components/app-shell.tsx`、`src/app/(app)/**/page.tsx` 標題 | 資料層識別字 | C中 R低 S商家 P無 | 無英文標題／內部識別字；對照表快照測試 | targeted＋a11y | WP-06 | 否 | 一般 |
| **WP-09** | F-12 | 新增銷講／課程主題模板 | `src/lib/funnel-template-gallery.ts`、`src/components/landing-pages/**` | 既有模板 | C中 R低 S商家 P無 | 名單／Webinar 各 ≥3 個銷講模板可套用並發布 | targeted＋E2E | 內容 | 否 | 一般 |
| **WP-10** | F-17 | platform_admin 未註冊 MFA 禁止進 `/admin/*` | `src/lib/auth.ts`、`src/app/admin/**`、`src/app/mfa/**` | session 儲存格式 | C中 R高(Auth) S平台 P security | 未註冊者導向註冊；已註冊流程不變 | targeted＋E2E | 無 | 否 | **獨立深度審查** |
| **WP-11** | F-18、F-19 | 統一 IP 解析；magic link／voucher 兩段式；補無限流端點 | `src/lib/rate-limit.ts`、`src/lib/request-client-ip.ts`、`src/app/portal/**/access/**`、`src/app/api/automation/vouchers/**`、`src/app/r/**`、`src/app/api/live-admission/**` | 付款路由行為 | C中 R高(Security) S公開 API P security | 偽造標頭無法繞過；兩段式兌換 | targeted＋integration | 部署拓撲 | 否 | **獨立深度審查** |
| **WP-12** | F-16 | 選供應商實作電子發票 adapter，或對外隱藏 | `src/lib/taiwan-electronic-invoice*.ts`、`src/app/api/jobs/electronic-invoices/**`、`src/app/(app)/billing/electronic-invoices/**` | 付款流程 | C高 R高(Billing/稅務) S帳務 P billing | Sandbox 開立並回寫；或 UI 顯示尚未開放 | integration（Sandbox） | D-6 | **是** | **獨立深度審查** |
| **WP-13** | F-23 | 報名→LINE 綁定→開播提醒；模板啟用 LINE；Rich Menu 同步 | `src/lib/line-*.ts`、`src/app/api/webhooks/line/**`、`src/components/message-template-form-client.tsx`、`src/app/(app)/settings/line/**` | 憑證加密邏輯 | C高 R中 S商家＋報名者 P PII | Sandbox 端到端送達；webhook 處理 follow／unfollow | integration＋E2E | WP-04 | **是**（憑證） | 一般 |
| **WP-14** | F-09 | 報名後即時 LINE／行事曆提醒並 A/B 比較二次確認 | `src/app/verify-registration/**`、`src/lib/form-submission-verification*.ts`、funnel A/B | token 安全性 | C中 R中 S公開 P PII | A/B 可設定、指標可讀；token 測試仍通過 | targeted＋E2E | WP-05、WP-13 | 否 | 一般 |
| **WP-15** | F-13、F-14 | 新商家首屏簡化、任務卡預設收合、行動導覽、對比與目標尺寸 | `src/app/(app)/dashboard/**`、`src/components/app-shell.tsx`、`funnel-operations-panel.tsx` | 資料查詢邏輯 | C中 R低 S商家 P無 | axe 0 serious；行動版首屏即主要表單 | a11y＋E2E smoke | WP-08 | 否 | 一般 |
| **WP-16** | F-21、F-24 | 拆分 `actions.ts`；單一路徑；layout 查詢合併 | `src/app/actions.ts`、`src/app/actions/**`、`src/app/(app)/layout.tsx` | 行為變更 | C高 R中 S全站 P無 | 無行為變更；測試不降 | 全量 targeted | WP-01～08 | 否 | 一般 |
| **WP-17** | F-01、F-04、F-26 | **一場即上線**：選影片＋時間表→自動產生報名／感謝／播放頁與提醒；缺項在背景檢查 | `src/app/(app)/lives/new/**`、`src/lib/evergreen-webinar.ts`、`src/lib/funnel-webinar.ts`、`src/lib/landing-page-service.ts`、`src/lib/sales-workspace.ts` | 付款、webhook | C高 R中 S商家＋公開 P無 | 新商家 ≤3 次決策得到可公開、可報名、可播放網址；未就緒不顯示「已發布」 | targeted＋E2E | WP-01 | 否 | 一般 |
| **WP-18** | F-26 | 新增「結帳未完成」trigger＋3 套一鍵追銷範本（未到場／看完未下單／未付款） | `src/lib/automation-workflow.ts`、`src/app/api/payments/checkout/**`（僅發事件）、`src/app/(app)/settings/automations/**` | 價格與冪等邏輯 | C中 R中(Email/Billing 事件) S商家 P事件 | 沙盒：待付款訂單依規則排入信件／LINE；去重與退訂有效 | integration（Sandbox） | WP-04 | 否 | **獨立深度審查**（觸及結帳事件部分） |
| **WP-19** | F-26 | 補 SMS adapter 與計量，或在 UI／文件明示僅 Email＋LINE | `src/lib/message-template.ts`、新增 SMS adapter、`src/components/message-template-form-client.tsx` | 付款 | C中 R中(PII/成本) S商家 P成本 | 供應商 Sandbox 送達與退訂；點數記錄 | integration | D-4 | **是**（供應商） | 一般 |
| **WP-20** | F-26 | 場次分析：報名率、到場率、完看率、平均觀看時長、看完下單率 | `src/app/(app)/lives/[id]/analytics/**`、`src/lib/dashboard-read-model.ts` | 事件寫入邏輯 | C中 R低 S商家 P無 | 指標與資料表一致（合成資料對賬） | targeted | 無 | 否 | 一般 |

---

### 結構化 task signals 與 ownership

數字是規劃估值，非實測：context_size 單位為 token，expected_duration 為分鐘，code_surface_area 為預估受影響檔案數，含測試。開始前依精確 scope 重估並交 router；時間不是停止／完成硬上限。production_impact=low 表示僅非 Production，並不授權部署；不宣稱最終產品變更沒有正式環境風險。data_integrity_impact 與 PII 說明分開，PII 不等同 Production data。

| WP／唯一 owner | complexity | risk／risk_categories | task_type | context_size／expected_duration／code_surface_area | surface | production／security／data_integrity impact | 獨立深度審查 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WP-01／WP-01-owner | high | medium／cross_module | cross_module | 24000／240／12 | 商家＋公開發布 | low／low／medium | 否；一般驗證 |
| WP-02／WP-02-owner | medium | critical／billing | implement | 16000／180／7 | 商家 Billing 閘門 | low／medium／high | 是：Billing |
| WP-03／WP-03-owner | low | medium／[]；法遵內容 | ui | 8000／90／6 | 公開政策／頁尾 | low／low／low | 否 |
| WP-04／WP-04-owner | medium | critical／billing | cross_module | 24000／240／12 | jobs／scheduler | low／medium／high | 是：billing-cycle 邊界；不執行該 job |
| WP-05／WP-05-owner | medium | medium／cross_module | cross_module | 18000／180／8 | 公開 PII 表單 | low／medium／medium | 否；不改驗證規則 |
| WP-06／WP-06-owner | low | low／ui_only | ui | 10000／90／6 | 商家導覽 | low／low／low | 否；不改 Permission |
| WP-07／WP-07-owner | medium | low／[] | test_fix | 18000／180／12 | 本機 seed／測試基線 | low／low／low | 否；不修改 schema/migration |
| WP-08／WP-08-owner | medium | low／copy_only | copy | 22000／180／18 | 商家 UI 文案 | low／low／low | 否 |
| WP-09／WP-09-owner | medium | low／ui_only | ui | 12000／150／7 | 商家模板＋公開呈現 | low／low／low | 否 |
| WP-10／WP-10-owner | medium | critical／auth, permission | implement | 18000／180／9 | 平台管理員／MFA | low／critical／medium | 是：Auth／Permission |
| WP-11／WP-11-owner | medium | critical／security, auth | cross_module | 24000／240／12 | 公開 API／兌換入口 | low／critical／medium | 是：Security／Auth |
| WP-12／WP-12-owner | high | critical／billing | cross_module | 20000／240／9 | 帳務／電子發票 | low／medium／high | 是：Billing |
| WP-13／WP-13-owner | high | medium／webhook, cross_module | cross_module | 24000／240／12 | 商家＋報名者 PII | low／medium／medium | 否；不改簽章／綁定授權邊界 |
| WP-14／WP-14-owner | medium | medium／cross_module | cross_module | 18000／180／9 | 公開確認／A/B／PII | low／medium／medium | 否；不改 token／存取資格 |
| WP-15／WP-15-owner | medium | low／ui_only | ui | 16000／150／9 | Dashboard／行動 UI | low／low／low | 否 |
| WP-16／WP-16-owner | high | medium／large_refactor | cross_module | 40000／300／20 | actions／layout | low／medium／medium | 否；若觸及 Auth/Permission 等邊界須重切 scope |
| WP-17／WP-17-owner | high | medium／cross_module | cross_module | 24000／240／12 | 商家建場＋公開流程 | low／low／medium | 否 |
| WP-18／WP-18-owner | medium | critical／payment, billing | cross_module | 18000／180／9 | 結帳事件＋追銷 | low／medium／high | 是：Payment／Billing 事件 |
| WP-19／WP-19-owner | medium | medium／[]；PII／成本 | implement | 16000／180／8 | 訊息通道／用量 | low／medium／medium | 否；不含商家扣款／帳單 |
| WP-20／WP-20-owner | medium | low／[] | implement | 14000／150／6 | 場次分析 read model | low／low／low | 否 |

Critical 是本計畫對 router risk 的正規化；原報告「高(Billing/Auth/Security)」不得因程式改動少而維持較低審查底線。WP-13 的 categories 分數、cross_module floor 等可能由 router 提升 risk/complexity，表內值只是輸入，不覆蓋 router 計算。只有 WP-02、04、10、11、12、18 在目前合約明示獨立深度審查。其他 WP 若實際必須改 Auth、Permission、Payment、Billing、Security 邊界、正式資料或 migration，立即停下提出 scope 變更、重新路由並增加必要審查，不把它藏在一般 WP。

### 逐 WP 補充合約：依賴、驗收與回滾

下表補足來源表的缺項，不代替來源合約。依賴是「已驗收」而非「已開始」。全部 WP 目前等待 G0，並保留各自的附加阻擋。

| WP | 依賴／額外授權或輸入 | 補充驗收與驗證 | 回滾範圍 |
| --- | --- | --- | --- |
| WP-01 | D-1、WP-06、G2；無額外外部授權 | 發布 200 必須可實際送出表單；缺表單／專案未就緒不得回成功；諮詢預設路徑可用。targeted＋公開 E2E＋axe。維持既有 Billing／Permission guard，不能先繞過 D-2。 | 精確發布／導引 UI 變更；只回復本 WP synthetic 專案狀態 |
| WP-02 | D-2、D-3、WP-01；有額外授權 | 覆蓋已核准、未核准、未知三態；不得將 unknown 當 verified，provider/webhook 保持不動。targeted＋integration＋Billing 獨立審查。 | 閘門／文案 patch；不改正式或 provider 帳務狀態 |
| WP-03 | D-5；有內容核准 | 不得只刪 DRAFT 字樣把未核准法律稿冒充正式條款；內容版本、生效日、頁尾連結可追溯。targeted＋公開 E2E＋axe。 | 本輪政策骨架／頁尾 patch，保留核可歷史；未核可不公開 |
| WP-04 | D-6a；有 scheduler scope 核可 | 先盤點重複排程；固定 Sandbox 驗證確認信＋提醒、時區、心跳與失敗回報；billing-cycle 只測設定契約／隔離測試，不實際執行。integration＋staging；需 UI 公開流程則 E2E＋axe。 | 只取消本 WP 建立的非 Production schedule，先停止發送並清楚標记 synthetic 待處理工作；復原精確設定 |
| WP-05 | G2；無額外授權 | 補入來源 F-08 的 404，連同 400/403/429/503：原生 POST 安全 303 回原頁、欄位及 aria-live/alert 一致；API client 原契約保留；不可把 PII 放 query/log；503 後重送不重複寫入。公開 E2E＋axe＋targeted。 | 3 套表單與 route 精確 patch；保留合成重送證據 |
| WP-06 | G2；無額外授權 | 依角色／功能開關點擊每個入口無 404；補入口不能放寬角色授權。targeted＋E2E smoke。 | 導覽／入口 patch；不新增 Permission 規則 |
| WP-07 | G0；無額外授權 | 在全新 disposable DB 套用基底 96 個 migration，seed 可重跑且可用合成帳號登入；具 schema 落後提示；DB 測試分層但不得 skip／exclude 掩蓋既有失敗。targeted＋DB smoke，保存失敗分類。 | seed／測試命名／config patch；僅移除核對 resource ID 的自建 disposable DB，不碰既有 dev/test |
| WP-08 | WP-06、WP-01、WP-05；無額外授權 | 只改使用者可見詞彙；保留資料識別字與 API 值。命名對照快照＋a11y；逐檔等待其他 owner 釋放標題 lock。 | 文案 patch／對照表 |
| WP-09 | WP-08、WP-17 本機建立／發布／報名／播放子項（revision `sha256:9562f738af5486e7c19338ad59f141dc71ba98732da5f6aef5a98b55680f8dd7`）、內容核可；無新增供應商授權。WP-17 排程與外部提醒送達仍由 WP-17 持有，不因 WP-09 完成而驗收。 | 名單／Webinar 各至少 3 個銷講模板，舊模板相容；套用後可公開發布。targeted＋公開 E2E＋axe。若此 WP-17 子項 revision 改變或失去 READY，須重跑 WP-09 公開 E2E 與 axe。三個新 Webinar 模板在外部提醒完成前不得承諾或啟用 LINE／SMS／自動提醒／結算送達。 | 僅新增模板與 UI patch，既有模板不覆寫 |
| WP-10 | G2；無額外授權 | 先用合成帳號確認 F-17 假設；未註冊／已註冊未驗證／已驗證 admin 及非 admin 矩陣，包含 direct URL 與財務入口；不得註冊導向循環。targeted＋E2E＋Auth 獨立審查。 | 本 WP auth/MFA patch；只處理 synthetic factor，不放寬 guard 作暫時回滾 |
| WP-11 | 拓撲輸入、G2；缺輸入等待 | 直接 origin／可信代理／偽造與多段標頭矩陣；GET 預覽不消耗、POST 確認單次兌換；重放／並發與限流；付款路由行為不變。targeted＋integration，公開頁 E2E＋axe，獨立審查。 | IP／兌換／限流 patch；不得用停用安全防護處理失敗 |
| WP-12 | D-6b、WP-04；有供應商／分支決議 | adapter 分支：Sandbox 開立、失敗重試與回寫一致；隱藏分支：明示尚未開放，不宣稱已開立。未決定前不得自行選分支。integration 或呈現 targeted＋Billing 獨立審查。 | 本 WP adapter／UI patch；Sandbox 已送出請保留回應摘要，不宣稱 revert 能撤銷發票 |
| WP-13 | D-4、WP-04、WP-06、WP-08、Sandbox 注入確認；有額外輸入 | 合成報名→綁定→提醒送達、follow/unfollow、重送去重與退訂；Rich Menu 草稿與同步狀態一致。integration＋公開 E2E＋axe。簽章／跨租戶綁定若須變更另提 Critical scope。 | 停用本 WP 的非 Production webhook／提醒，再回復 LINE/template patch；不讀 credential |
| WP-14 | WP-05、WP-13、WP-17、A/B 核可及流量；缺輸入等待 | 保留 token 安全測試與原存取資格；A/B 分派、指標分母可追溯。合成 E2E＋axe 只證明可運作，真實成效維持待驗證；不以降低驗證換取到場率。 | 關閉本實驗配置／回復精確 patch，保留去識別實驗結果 |
| WP-15 | WP-08、相關 renderer lock 已釋放；無額外授權 | 桌機／行動 axe 0 serious；鍵盤與目標尺寸；主要表單首屏可達；方案幣別明確為 TWD。a11y＋E2E smoke；不改查詢。 | UI／樣式 patch |
| WP-16 | 其他 19 個 WP 全部驗收，或另有明確縮 scope 決議；無額外授權 | actions 與互動腳本單一路徑、layout 查詢串行次數前後量測；測試與權限／資料契約不變。全受影響 targeted＋整合／E2E 回歸，coverage 不降。安全共用函式若必須改動先重定義 scope。 | 分段回復本重構 patch；不逆轉先前 WP 的業務修復 |
| WP-17 | D-1、WP-01→WP-02、WP-04；無額外授權 | 記錄 ≤3 次使用者決策計數及定義；產生報名／感謝／播放頁、合成影片可播、提醒有回執；缺項不顯示已發布。targeted＋公開 E2E＋axe。 | 本 WP wizard／生成流程 patch；只清理自建合成場次 |
| WP-18 | WP-04、G2；無供應商新授權，但結帳事件需獨立審查 | 3 套模板與未完成結帳事件；pending→paid 後不再追銷、事件去重、退訂、重放／延遲情境；未有真實 LINE Sandbox 能力時僅驗證 enqueue，不宣稱送達。integration Sandbox＋結帳 E2E／axe＋獨立審查。 | 停用合成追銷規則／排程，再回復事件 patch；不改價格、冪等或訂單歷史 |
| WP-19 | D-4、WP-13、provider／成本／計量輸入；有額外授權 | SMS 分支驗證 Sandbox 送達、退訂、點數記錄；Email＋LINE 分支只驗證一致的 UI／文件能力聲明。不能將文案分支標成 SMS 送達。若牽涉 Billing／schema 另提 Critical scope。 | 停用自建 Sandbox 通道／合成待送工作，再回復 adapter/template patch |
| WP-20 | G2、指標契約；無額外外部授權 | 固定報名率、到場率、完看門檻、平均觀看時長與看完下單率的分母／時間窗；零分母、多次觀看、跨場次／租戶合成對帳。資料不足標不可計算，不猜數值、不改事件寫入。targeted＋read-model integration。 | analytics/read-model 精確 patch；事件紀錄不變 |

## 5. 風險與停止條件

1. **授權／輸入缺失**：D-1～D-6、G0、供應商與實驗資料未到位，對應項維持 `WAITING_AUTHORIZATION`。不能因等待太久自行選分支。只可推進不相依的已授權工作。
2. **環境不明**：無法確認非 Production endpoint、資料隔離或 runner 安全性，記 `BLOCKED_ENVIRONMENT`。不讀 .env 或列舉環境／Secret Store 排查，不繞過 host/sandbox permission。
3. **基線污染**：既有 dev/test DB 落後且有殘留資料，禁止就地 migrate。WP-07 失敗則依賴 DB 的驗收不能通過；179 個歷史失敗不預先歸咎 DB，也不視為當前失敗總數。
4. **scope／writer 衝突**：遇到未知變更、同一檔案／資料資源已有 writer、需要 schema/migration／付款行為／授權邊界改動，停止受影響項，提出精確新 scope 與重路由，不擴權。
5. **反覆失敗**：同一命令或同一根因無新資訊／改善即停止重試，留下根因、已嘗試方式與不同路徑。每模型／外部 attempt 和 dispatch 上限依當次 policy；不得反覆建立新 task 規避。
6. **審查／驗收缺失**：必要獨立 reviewer 不可用則 `REVIEW_BLOCKED`；provider discovery／probe／候選 findings 不能代替最終審查。未完成必要 checks 不得 READY。未知模型、effort、quota 都記 unknown，不能捏造 0 或成功。
7. **公開信任／PII**：未核准政策不上線；報名失敗欄位保留不得把 PII 暴露在 URL、log 或跨租戶；實驗不得弱化確認安全機制。
8. **外部副作用**：scheduler 去重、停止已付款追銷、退訂優先。任何正式寄送／扣款／退款／部署要求均越出本計畫授權；停止並另取授權。
9. **能力膨脹**：電子發票、SMS、分析如果需新 schema、Billing 或事件寫入，不自行擴充原 WP。F-09、F-17、F-18、F-24 保留假設／條件標籤，先證明再修。

## 6. 回滾與恢復

本輪只新增本 Plan 與 plan evidence；回滾時先確認檔案仍為本輪版本且沒有新作者變更，再僅移除這些精確檔案。保留獨立 worktree 供檢閱，不刪除使用者工作樹、不 reset/clean/stash/restore/checkout/rebase。

未來實作每個 WP 先記錄前一 snapshot 與精確 patch；只有另獲 checkpoint 授權才 commit。回滾採反向精確 patch 或有授權的 revert commit，重新跑受影響驗證，不撤銷前一 WP 的修復。資料庫只處理自己新建且能確認 identity 的 disposable DB；不得用 down migration 或清除正式資料。外部已送出訊息、已開發票等不可由程式碼回滾撤銷，需先停用自建非 Production 排程，保留去識別紀錄並記明不可逆副作用。

## 7. Evidence 與驗收 gate

證據根目錄建議：`docs/ai-team/evidence/product-audit-20261011/`。

| 路徑 | 用途／目前狀態 |
| --- | --- |
| `plan/source-manifest.json` | 本輪實際讀取來源與 SHA-256、基底與 isolated root |
| `plan/route.json` | 僅文件規劃 task 的實際 router 建議；不代表任何 WP 模型派遣 |
| `plan/validation.json` | 文件結構與 scope 檢查的真實結果 |
| `plan/acceptance.json` | 實際 assess_acceptance 結果；若 BLOCKED 原樣保留，不能當作 READY |
| `WP-nn/snapshot.json` | 未來精確 source_revision／scope／owner；NOT_CREATED |
| `WP-nn/route.json`、`execution.json` | requested/resolved/observed、effort、provider terminal、fallback；NOT_CREATED |
| `WP-nn/checks/*.json` | validation_runner 實跑命令／exit code／時間／revision／非 Production identity；NOT_CREATED |
| `WP-nn/review.json` | 適用 reviewer 資格、independent、findings、修正後 revision；NOT_CREATED |
| `WP-nn/browser/` | 合成資料 E2E／axe／必要截圖，避開 PII／憑證；NOT_CREATED |
| `WP-nn/acceptance.json`、`handoff.md` | gate、剩餘阻擋、rollback／lock 釋放；NOT_CREATED |
| `decisions/D-1.md`～`D-6.md` | owner 決议與 sanitized 外部輸入；NOT_CREATED |

每個 WP 的 required_checks 必須在執行前宣告；checks 收據由 `validation_runner.py` 實際執行產生，與 source_revision 一致。影響公開流程必須 E2E＋axe；付款／Auth／Permission 等必須合格獨立深度審查。判定安全性、效能、可讀性與可維護性時提供具體 findings；reviewer 僅列 BLOCKER／MAJOR／MINOR／NIT，不直接改碼。

完成產品程式碼後須確認 GitHub Actions 每次 push 執行 ESLint 與單元測試；本輪未改程式碼、禁止 push，也不修改 CI。未來若 CI 缺失，先提精確 scope，不藉此修改本次文件任務以外檔案。

READY 僅由同 snapshot 的 MCP `assess_task` 或相同 `assess_acceptance` gate 判斷。內容變更即失效的收據不可沿用；必要獨立審查缺失不可用主代理自審充數。Goal `COMPLETE` 必須所有納入 scope 的 WP 均通過 gate、人工決議齊全，且適用 deterministic／integration／Sandbox evidence 完整；不是 Production 上線授權。

本輪產品 ESLint、typecheck、unit、coverage、E2E、axe、npm audit、secret:scan、DB seed／migration、Sandbox、provider 審查皆未執行。歷史報告的 tsc、96/96 migration 或 axe 結果不轉記為本輪 PASS。文件結構檢查與 router 執行另以本輪 evidence 為準。

## 8. Goal 初始狀態建議（不寫入 runtime state）

建議未來 `.ai-team/state/goal-state.json` 的初始狀態為 `WAITING_AUTHORIZATION`，原因為 G0 僅獲 plan-only 授權；WP-01～20 全部尚未開始，D-1～D-6 pending。這是概念欄位建議，並非保證符合 MCP state 的實際 JSON schema：

- goal_id：product-audit-20261011；base_revision：efb8b7e9a737ea30ea691870318d85bf74830331。
- status：WAITING_AUTHORIZATION；current_wp：null；completed_wps：[]。
- requested_team：ai-team-pro；selected_model／reasoning：由每個 WP 的當次 router 填寫；observed：unknown 直到實際收據可證明。
- authorization：plan_only；production：NOT_AUTHORIZED；git_promotion：NOT_REQUESTED。
- dispatch_count：0；active_children：0；parent_depth：0；max_agent_depth：1；max_parallel_agents：1；max_writers：1；max_dispatches_per_task：4；automatic_spawn：false。
- open_decisions：D-1～D-6 與其他輸入表；evidence_root：docs/ai-team/evidence/product-audit-20261011。
- next_action：取得實作授權後檢查既有 Goal，透過協定恢復或建立一次，不重複 bootstrap。

若之後取得 G0，Goal 才轉 `IN_PROGRESS`，優先選 WP-07；各需人類輸入的 WP 仍維持 `WAITING_AUTHORIZATION`。本輪不呼叫 goal_bootstrap／goal_checkpoint／goal_finalize，不建立持續實作 Goal。

## 9. 本輪 handoff 補充

- 本輪 ownership：本 Plan 及 `plan/` evidence；產品檔案、CI、runtime state 均不在寫入範圍。
- requested/effective team、selected model、reasoning 與 review plan 以 `plan/route.json` 實際結果為準；只路由文件 task，20 個 WP 沒有預選模型。
- 主對話 observed model/effort：unknown；未取得 provider terminal metadata，不以路由建議冒充實際模型。
- fallback events 以實際 route 為準；provider availability 未查時為 NOT_CHECKED，未呼叫 provider 不猜登入或 quota 問題。
- 本輪 dispatch_count=0、active_agent_count=1、parent_depth=0；深度與並行上限依基底 policy，未啟動子代理。
- 文件完成不等於 runtime Goal 完成。最終 acceptance／review 狀態只引用實際收據，不宣稱產品 READY。


### WP05 安全複審後補強 checkpoint

Opus無BLOCKER/MAJOR，3MINOR；交易隔離與密文長度已補強、4項targeted驗證PASS。容量／pool風險與最新獨立審查未完成，WP05仍IN_PROGRESS，WP08不解鎖；此審查批次dispatch額度耗盡。詳見native-integration/review-minor-disposition.md及最新handoff。


WP05最新snapshot整合回歸：13項收據與24browser案例PASS；canonical gate仍缺必要review。已詢問追加最多2次審查呼叫，尚未獲授權。WP08維持依賴阻擋，詳見最新handoff。


WP05追加審查已依「請繼續」執行：安全子項READY；UI1MAJOR/6MINOR/1NIT。非報名入口loading已修復，5項最新驗證PASS；其餘findings及修正版複審未完成，WP08不解鎖。完整明細見最新handoff。


WP05 UI-6 Webinar binding已修復：雙表單單元red/green、8個標準Webinarbrowser案例通過；完整WP尚缺其他UI修復及獨立複審。參閱最新handoff。


WP05 query假成功修復：60秒加密form/path結果回條與canonical成功導向；5項最新驗證PASS，fresh context分享網址可正常填表。UI-3錯誤狀態部分及最終審查仍未完成；詳見最新handoff。

### 2026-10-16 WP13 人類追加 scope：可重用 LINE 官方帳號

已依最新要求完成商家多官方帳號集中管理、Project 下拉選擇及跨課程共用，並接入帳號範圍 OAuth／身份／webhook／outbox／圖文選單與舊資料 migration。這是授權後的實作追加，未改原始計畫歷史或發布付款閘門。128 units、18 PostgreSQL cases、132 migrations、1實際Next dev瀏覽器流程、tsc/lint與獨立Critical複審通過；同來源canonical gate僅本機子項READY。原WP13真實供應商與其他原依賴未驗收，仍9/20=45%。完整ownership、37檔增量、限制與evidence見 `docs/launch/wp13-project-line-handoff-20261016.md`。
