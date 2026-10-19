# 05 執行手冊：Phase B findings 的修復流程（D-06）

- 基線：`review-baseline-2026Q4` = `origin/master@78621ca3`；日期 2026-10-19（Asia/Taipei，星期一）；封測日 2026-11-01（星期日）
- 方式：唯讀產出文件；沒有派工、沒有改任何既有檔案。
- 輸入：`docs/review-2026Q4/11`～`21`（findings 與「給 ROADMAP 的結論」）、Goal Plan §6／§8／§9、`01-skill-inventory.md`、`02-agent-gaps.md`、`03-connector-playbook.md`、`CLAUDE.md`、`AGENTS.md`。
- 這份手冊的分類是依**目前的 findings 與估工**做的初判；實際派工時，主對話以 §1.2 的風險路徑清單逐次重判，不以本文的表為準。

## 0. 結論先講

1. **封測前必修的總量超過產能。** 把各報告「封測前必修＝是」的項目依各自估工粗加（不含「若…」的條件式項目、不含 owner 外部動作）約 44 人天：金流 B03 約 8、UX B07 約 8–11（報告自己的批次估計）、測試 B08 約 6、資料 B04 約 3.5、可觀測與 CI B09 約 4.5、授權 B02 約 4.5、效能 B06 約 4、B11 約 2.3、B05 約 1。同時最多 3 個寫入者、10 個工作天、每個 H 類 PR 還要一輪 reviewer 與 CI，現實可完成量遠低於 44。**所以本手冊先排 P0／P1／P2（§1.3），並規定 10/27 的容量檢查點：趕不上就由 owner 縮小封測範圍（隱藏模組、僅用 Sandbox 付款），而不是放寬審查。**（估工單位沿用各報告的「人天」，AI 代理的實際速度未量測，瓶頸預期是審查回合與 CI。）
2. **修復分四類**：H（`engineer-hard`＋`reviewer` 必經）、E（`engineer` 可獨立）、D（文件）、O（owner 外部動作）。分類看的是「這次改動碰到哪些路徑」，不是 finding 的嚴重度。
3. **寫入衝突才是最大的並行風險**，不是人力：`src/lib/auth.ts`、`src/app/actions.ts`、`billing.ts`、`payment-webhooks.ts`、`payuni.ts`、`prisma/schema.prisma`、`package.json`、`ci.yml` 是熱點檔，一次只允許一個寫入者；Prisma 相關工作還有一個 Windows 專屬陷阱（共用 `node_modules` junction 會讓不同 schema 的 worktree 互相覆蓋已生成的 Prisma client），見 §3.3。
4. **封測中的 staging 每次部署都會對 staging 資料庫套用 migration**（`vercel.staging.json` 的 `buildCommand`）。封測開始後，帶 migration 的 PR 一律不合併，除非 S0／S1 且已備份、已通知 owner。

## 1. 分類

### 1.1 四類定義

| 類 | 名稱 | 代理 | 必經關卡 | 典型內容 |
|---|---|---|---|---|
| **H** | 高風險 | `engineer-hard`（Opus／high，必要時逐次調 xhigh） | `reviewer` 對最終 head 一次；內建 `security-review`（auth、租戶、付款、webhook、RLS）；CI `quality`；H 類合併先交 owner 確認 | 付款、checkout、退款、佣金、auth／MFA、租戶邊界、migration、`proxy.ts`、job／ops 端點、排程、速率限制 |
| **E** | 一般 | `engineer`（Sonnet／medium） | CI `quality`；主對話檢視 diff 範圍與測試 | UI、文案、錯誤頁、非金流 API、效能查詢、測試補強、CI 小修 |
| **D** | 文件與設定 | `docs`（Haiku／low）或主對話 | CI；設定／權限類由主對話自查 | PR 描述、receipt、runbook、domain-workflows 更新、`STATE.md`、DECISIONS |
| **O** | owner 外部動作 | owner（主對話準備材料、指令、期限） | 無（但結果回寫 `STATE.md`） | 帳號、方案、法務、PayUni Sandbox、備份採購、repo／環境設定、產品決策 |

### 1.2 風險路徑清單（決定類別的唯一依據）

只要變更命中任一路徑，整個 PR 就是 H 類；不得為了降級而把 PR 拆成「看起來安全」的小塊。

```text
src/lib/payment*            src/lib/billing*            src/lib/payment-providers/**
src/lib/auth.ts             src/lib/csrf.ts            src/lib/rate-limit.ts
src/lib/api-security.ts     src/lib/merchant-api-security.ts   src/lib/student-portal-auth.ts
src/lib/sensitive-data.ts   src/lib/bank-account.ts    src/lib/inventory-reservations.ts
src/lib/stream-usage.ts     src/lib/cloudflare-stream.ts
src/proxy.ts                next.config.ts             vercel*.json
src/app/api/payments/**     src/app/api/webhooks/**    src/app/api/jobs/**    src/app/api/cron/**
src/app/api/admin/**        src/app/admin/**           src/app/api/cloudflare/**
src/app/actions/vendor-member-actions.ts   src/app/actions/affiliate*.ts   src/app/actions/invoice-actions.ts
src/app/actions.ts（結算、出款、退款、佣金、方案相關區段）
src/components/*checkout*   src/components/billing-plan-checkout-form.tsx   src/app/affiliate-portal/**/remuneration/**
prisma/**                   scripts/*refund*           scripts/*payuni*       .github/workflows/**
任何新增或修改退款、佣金、結算、出款邏輯的檔案
```

此清單同時是 `engineer.md` 的「遇到就停下」清單（01 §2.4 diff）與 `risk-path-review-gate.yml` 的正規表示式來源（02 §3.4）。三處要一起維護，建議日後抽成單一檔案。

### 1.3 findings 分類與優先序

優先序：**P0**＝錢或個資可能出錯、或跨租戶，封測前必須修；**P1**＝卡住首次成功路徑或封測客戶一定會踩到；**P2**＝封測前建議、容量不足時先砍。「需決策」欄表示要先有 owner 決定才能動工（對應 O 類）。

#### H 類（`engineer-hard`＋`reviewer`）

| 工作包 | Findings | 優先 | 備註 |
|---|---|---|---|
| FIX-01 後台財務 MFA | B02-01、B03-09、B11-01、B11-02、B11-03 | P0 | PR #436 目前與 master CONFLICTING，需 rebase（B11 判定為假衝突加兩行字串）；B11-01 阻擋 staging Sandbox 退款驗證；B11-03 的 `/mfa/setup` 風險需 owner 決策 |
| FIX-02 PayUni 回呼狀態與欄位 | B03-01、B03-04、B03-12、B03-13、B04-13、B08-02 | P0 | 修復與「真實欄位 fixture」同批；需 owner 提供 Sandbox 實際回呼樣本；費率模型需決策（B03-04） |
| FIX-03 月結與帳務歸屬 | B03-02、B03-03、B08-04 | P0（若封測有商家撥款）/P1 | 負餘額處理需決策（B03-03）；若封測不撥款，降 P1 |
| FIX-04 幣別與金額來源 | B03-05、B03-15、B03-23 | P0 | 小；與 FIX-02 同一位 writer 連續做 |
| FIX-05 庫存保留與逾期 paid | B03-07、B04-14、B03-22 | P0 | 超賣處理政策需決策 |
| FIX-06 排程與 job 契約 | B03-06、B09-01、B09-02 | P0 | 排程平台由 owner 選；先修 handler 的 GET／POST 與密鑰型態，再接排程；FIX-05 依賴此項 |
| FIX-07 資料不變式 migration | B04-06、B04-05（及 B04-02、B04-07 延後） | P0／P1 | 訂單號安全亂數＋唯一約束；Production 方案 bootstrap；財務表 `RESTRICT` 與 CHECK 延至封測後 |
| FIX-08 RLS／GRANT 補強 migration | B02-03、B04-08、B02-09 | P1 | 先用 03 文件 §3.2 的唯讀白名單確認實況；實況為 `anon` 有權限則升 P0 |
| FIX-09 auth 熱路徑與限流 | B06-01、B02-05、B01-04、B02-04 | P1 | `auth.ts` 熱點檔，與 FIX-01 串行 |
| FIX-10 ops／測試端點關閉 | B10-01①、B10-02 | P1 | `proxy.ts`：正式環境 `/api/admin/ops/**` 一律 404 |
| FIX-11 模組隱藏與綁卡閘門 | B01-01、B01-02、B01-03（含 B03-14） | P1 | 需決策「隱藏」的嚴格度與預設模組清單；含 migration；B01-03 為刪除不可達的非 PayUni 退款路徑，fail-closed |
| FIX-12 身份模型 | B02-02、B02-06、B02-14 | 依決策 | owner 先決定是否新增最小權限 partner 身份 |
| FIX-13 即時互動與串流計量 | B06-05、B06-06、B06-07 | 依封測場次規模 | 僅在封測場次可能 ≥20–50 人同時在線時列 P0；否則延後 |
| FIX-14 公開頁預檢 | B05-04、B06-04 | P2 | 廣告流量放大前必修；封測可延後 |
| FIX-15 註冊與結帳同意紀錄 | B07-15、B07-01（若需儲存同意） | P0 | 純文案勾選由 E 做；一旦要儲存同意紀錄（欄位／migration）即升 H；條款定稿由 owner |
| FIX-16 金流相鄰表單防重送 | B05-09（金流相鄰 4 處） | P1 | `billing-plan-checkout-form.tsx`、`affiliate-portal/**/remuneration`，B05 §8 建議 H |
| FIX-17 金流次要修正（批次一次審） | B03-10、11、17～22、B04-12、B04-15 | P2 | 同一批、同一個 reviewer 回合 |

#### E 類（`engineer`）

| 工作包 | Findings | 優先 | 備註 |
|---|---|---|---|
| FIX-E1 錯誤頁 | B05-01、B05-02（共用 `RouteErrorPanel`，8 檔）、B05-03 | P1 | 同一 PR |
| FIX-E2 UX 批次 A | B07-01（純文案）、06、08、11、16、21，B07-03 預設值與空狀態，B07-09 下一步連結，B07-13 樣式 | P1 | 報告估 2–3 天、10/21 前 |
| FIX-E3 UX 批次 B | B07-02、07、10、12（主線頁）、14、04／05（依決策） | P1 | 報告估 6–8 天、10/29 前；`ui.tsx`、`app-shell.tsx` 為熱點 |
| FIX-E4 效能小修 | B06-02、B06-11、B06-12、B06-13 | P2 | B06-02 為 `(app)/layout.tsx` |
| FIX-E5 可觀測性 | B09-03（health）、B09-04（Sentry 去識別）、B09-05～06 | P1 | B09-04 加跑 `security-review` |
| FIX-E6 CI 防護 | B09-07、08、09、11；B04-04（schema 漂移檢查）、B08-03 輔助 | P1 | 動 `ci.yml`；因為路徑清單含 `.github/workflows/**`，**實務上歸 H**（需 reviewer）。這是本表唯一的「看似 E、實為 H」項 |
| FIX-E7 測試補強 | B08-01、B08-05（金流與 PII 相關 6 項）、B08-07、B08-08 | P1 | 只加測試不改 src 時為 E；一旦要為了可測性改 src 風險路徑檔案，該部分轉 H |
| FIX-E8 Next 慣例 | B05-05、06、07、08、11、13 | P2 | — |
| FIX-E9 架構清理 | B01-05 階段 1、2、4；B01-06、11、12、13；B10-03～08 | P2 | B01-05 階段 3（結算→出款→退款搬出）為 H 且延至封測後 |
| FIX-E10 worktree／分支清理 | B10-13、B10-05 | P2 | 需 owner 同意；先拆 junction |

#### D 類（文件）

| 工作 | Findings／來源 | 備註 |
|---|---|---|
| domain-workflows 與 PRODUCT.md 修訂（虛擬使用者規則、現況缺口註記） | 01 §3.4 | 第一個做，所有派工模板會引用 |
| `STATE.md`、每日摘要、PR 描述草稿 | 02 §2 | 主對話 |
| Runbook：備份還原、Production migration 核准、個資刪除與保存期限 | B04-01 文件部分、B04-10、B04-17、B09-13 | 與 O 類配合 |
| 文件封存與引用修正 | B01-17、B01-20、B04-23、B04-25、B10-10～12、B10-14 | 因 43 個檔案被測試／CI 固定路徑讀取，**實務上歸 E**，且封存 `docs/codex-goal/*` 必須同步改三處寫死路徑（02 §5 #8） |
| 修復階段審查報告 | `docs/review-2026Q4/fixes/…` | reviewer 直接寫入（01 §2.3） |

#### O 類（owner 外部動作；主對話負責備齊材料與期限）

| # | 事項 | 影響的工作包 | 建議期限 |
|---|---|---|---|
| O1 | PayUni Sandbox 商店開通信用卡 Token（T1） | Funnel 發布、FIX-02 驗證 | 10/21 |
| O2 | PayUni 實際回呼樣本（Sandbox） | FIX-02、B08-02 | 10/21 |
| O3 | 選排程平台（Vercel Cron／GitHub Actions schedule／Supabase `pg_cron`／外部服務） | FIX-05、FIX-06 | 10/21 |
| O4 | 封測 UX 七項決策：虛擬使用者標示策略 A／B（B07-04）、彈幕與暖場控制台隱藏或交付（B07-05）、銷售直播是否強制互動腳本（B07-14）、註冊同意與商家條款（B07-15）、雙重確認保留與否（B07-09）、封測要隱藏的模組清單（B07-23）、LINE 範圍（B07-13） | FIX-11、FIX-15、FIX-E3 | 10/21（報告要求） |
| O5 | 金流費誰負擔與費率（B03-04）、佣金「只累計不出款」時是否仍扣商家撥款（B03-08）、負餘額結轉或請款（B03-03）、超賣自動退款或人工（B03-07） | FIX-02、03、05 | 10/22 |
| O6 | 封測是否收真實款項（影響 B04-01 是 BLOCKER 或 MAJOR，以及 B03-02／03 是否 P0） | 全部 | 10/20 |
| O7 | 備份方案與一次隔離還原演練（B04-01）；`CSRF_SECRET` 明列為不可輪替的資料根金鑰（B04-03①） | 封測前 gate | 10/28 |
| O8 | 重新授權 Vercel MCP scope；指認 staging 的 Supabase 專案；是否連 Sentry MCP | 驗證與 triage | 10/22 |
| O9 | repo 設定：只允許 squash、`delete_branch_on_merge`、secret scanning／push protection（B09-15）、fork PR 核准政策（B09-10）、environment 限制只有 master 可部署（B09-14、T7） | CI／發布 | 10/24 |
| O10 | 營運者法定資料（T4）、法務審閱條款（B07-15、B07-01） | FIX-15 | 10/26 |
| O11 | 身份模型決策（B02-02）、`#436` 合併確認 | FIX-01、FIX-12 | 10/20 |
| O12 | 封測前 PayUni 實付演練（T2）：owner 輸入 Sandbox 測試卡號 | RC gate | 10/30 |
| O13 | 同意套用 01 的 agent／settings／hook 修改 | 流程 | 10/20 |

## 2. 派工模板

派工單由主對話填寫，貼進 `Agent` 呼叫的 prompt，並同時登錄在 `STATE.md`。所有模板共用的**開頭六行**：

```text
目標：<一句話，含 finding ID>
背景：docs/review-2026Q4/<NN-xxx>.md 的 <Bxx-yy> 條；相關規則 docs/domain-workflows.md 的「<小節>」
基線：分支 <codex/...>，從 origin/master@<sha7> 建立；工作目錄 <worktree 路徑或主 checkout>
鎖定檔案（只能改這些）：<逐一列出>
禁止觸碰：其他任何檔案；.env*；Production 主機／資料庫／付款／寄信；不得用 reset／clean／stash／restore／checkout 丟棄你沒做過的變更
前置檢查：node_modules 存在（不存在就停下回報，不要自己 npm ci）；已讀 AGENTS.md 與 node_modules/next/dist/docs/ 中對應章節
```

### 2.1 H 類模板（`engineer-hard`）

```text
<共用開頭六行>

完成標準：
1. <可驗證的行為描述，例如「PayUni 回呼 TradeStatus ≠ 1 時不建立 paid 交易、不產生佣金，並寫入 audit」>
2. 先寫會失敗的測試（記錄現況缺陷），再修到轉綠；測試使用 provider 真實欄位名稱，不自創欄位
3. 每個輸入 ID 追到最後 DB 操作的 vendor 綁定；金額、幣別、費率只來自伺服器紀錄
4. 新增第二租戶負向測試（斷言「無寫入」，不只狀態碼）；拒絕不洩漏存在性
5. 若有 migration：只能往前；時間戳大於 master 最新 migration；同步登記 docs/codex-goal/PRISMA_INVARIANTS.md；說明對既有資料列的影響
6. 不降低任何 assertion 或覆蓋率門檻；不用 skip 或假資料

測試要求（全部要跑並回報輸出摘要）：
- npx vitest run <相關測試檔>
- DB 測試（僅 loopback celebratedeal_* 資料庫，使用 .github/workflows/ci.yml 的合成 JOB_SECRET／CSRF_SECRET）：<對應 vitest.*db*.config.ts>
- npm run typecheck、npm run lint
- 若改到頁面或 route：說明手動或 Playwright 驗證方式（受控 runner，合成資料）

審查要求：完成後 commit（git add 逐一列出路徑），不要 push。主對話會啟動 reviewer 對最終 head 審查；你的回報必須包含「請 reviewer 特別看的風險」。

停止條件：同一命令或同一根因失敗兩次；需要 owner 決策（列出選項與影響）；發現疑似真實 secret 或客戶資料（單獨回報，不寫進任何檔案）；需要改動鎖定檔案以外的檔案。

回報（繁體中文）：修改的檔案、讀過的 Next docs 路徑、測試與結果、未驗證項、給 reviewer 的風險、commit SHA。
```

### 2.2 E 類模板（`engineer`）

```text
<共用開頭六行>

完成標準：
1. <可見行為，例如「錯誤頁不顯示 error.message，並提供重試與回首頁」>
2. 重用 src/components/ui.tsx 與 src/app/globals.css 的元件與 token；UI 文字為自然繁體中文（台灣用語），不使用工程詞（對照 docs/review-2026Q4/17-ux-a11y-copy.md 附錄 A）
3. 每個查詢或 mutation 維持 vendor 綁定；若發現需要碰風險路徑清單內的檔案，立即停下回報
4. 狀態完整：default、hover、focus-visible、disabled、loading、empty、error、success

測試要求：
- npx vitest run <相關測試檔>；新增或更新對應測試（不得降低 assertion）
- npm run typecheck、npm run lint
- UI 變更：用既有 Playwright 設定跑相關 spec；視覺／響應式變更另檢查 390×844、768×1024、1280×800、1440×900

審查要求：不需 reviewer。主對話會比對 git diff --name-only 與鎖定檔案；超出範圍會退回。

停止條件：同 H 類。

回報（繁體中文）：修改的檔案、讀過的 Next docs 路徑、測試與結果、未驗證項、commit SHA。
```

### 2.3 D 類模板（`docs` 或主對話）

```text
目標：<文件名稱與用途>
輸入：<主對話提供的事實清單與檔案路徑；docs agent 沒有 Bash，git 輸出由主對話貼入>
鎖定檔案：<只有這幾個>
完成標準：只描述輸入顯示的事實；不宣稱測試通過；不複製 secret、token、客戶資料；繁體中文（台灣用語）
審查要求：主對話逐段核對數字與路徑；PR 描述必須含檔案範圍與驗證欄位
回報：修改的檔案（一到兩行）
```

### 2.4 O 類模板（owner 外部動作）

主對話在每日摘要中以此格式呈現，每則不超過 5 行，每日最多 3 則：

```text
事項：<一句話>
為什麼現在：<擋住哪個工作包，期限>
你要做的事：<具體步驟或指令；不需要貼任何金鑰給我>
選項（若是決策）：A <描述／影響>　B <描述／影響>　建議：<A 或 B 與理由>
完成後告訴我：<例如「回覆 A」或「Sandbox 後台已開通」>
```

### 2.5 reviewer 派工模板

```text
審查範圍：分支 <name>，head <sha7>，基底 origin/master@<sha7>；變更意圖：<一句話>
適用清單：celebratedeal-review-checklists 的 <T/P/D/N>
已知風險（作者回報）：<貼上>
輸出：在 docs/review-2026Q4/fixes/<branch-slug>-<sha7>.md 寫入報告（新檔，繁體中文）
限制：唯讀＋只寫報告檔；不讀 .env*；只在 loopback celebratedeal_* 跑 DB 測試；發現疑似 secret 或客戶資料先單獨回報
回報：報告路徑、各嚴重度數量、需要主對話決策的事
```

## 3. 同一時間單一 writer 的鎖定規則

### 3.1 規則

1. **鎖定單位是檔案路徑**。派工前主對話把鎖定檔案寫進 `STATE.md` 的「檔案鎖」表；寫入者只能改自己鎖定的檔案；釋放時機是該 PR 合併（或明確放棄）。
2. **同時寫入者最多 3 個，另加 1 個 reviewer**（Goal Plan §8.5 的「最多 4 個並行」之解釋）。
3. **熱點檔一次一個 PR，並依序排隊**：

| 熱點檔 | 為何熱 | 排隊順序建議 |
|---|---|---|
| `src/lib/auth.ts` | B02-01、B03-09、B06-01、B02-04、B10-02、B01-07 都要改 | FIX-01 → FIX-09 → FIX-10；B01-07 延後 |
| `src/app/actions.ts`（2,472 行／51 個 export） | 結算、出款、退款、方案、B07-02、B01-03、B01-05 拆分 | FIX-03 → FIX-11（B01-03）→ 其他；B01-05 階段 3 延至封測後 |
| `src/lib/billing.ts`、`billing-cycle.ts` | B03-02、03、04、08 | 只有 FIX-03 一個寫入者 |
| `src/lib/payment-webhooks.ts`、`payment-providers/payuni.ts` | B03-01、04、12、13、B04-13 | 只有 FIX-02 一個寫入者；FIX-05 在其後 |
| `prisma/schema.prisma`、`prisma/migrations/**` | FIX-07、08、11 | **全域一個寫入者**；其他人不得同時有 schema 變更 |
| `package.json`、`package-lock.json` | 依賴與腳本 | 一次一個；依賴升級封測前不做 |
| `.github/workflows/ci.yml`、`vercel*.json` | FIX-E6、FIX-06 | 一次一個 |
| `src/components/ui.tsx`、`app-shell.tsx`、`globals.css` | B07 多項 | UX 批次內序列化 |
| `docs/domain-workflows.md`、`AGENTS.md`、`CLAUDE.md`、`.claude/**` | 派工模板的依據 | 只有主對話改，且在派工前先定稿 |

4. **車道（lane）**：把互相競爭熱點檔的工作放進同一車道，車道內序列、車道間並行。

| 車道 | 內容 | 同時寫入者 |
|---|---|---|
| A 金流與帳務 | FIX-02 → 04 → 03 → 05 → 17 | 1 |
| B 授權與資料 | FIX-01 → 09 → 10 →（FIX-07／08 migration 輪流） | 1 |
| C 介面與測試 | FIX-E1 → E2 → E3 → E7 | 1 |
| D 文件／CI／可觀測 | D 類、FIX-E5、FIX-E6、FIX-06 | 主對話或 `docs`，非主要寫入者 |

5. **範圍檢查**：每個 PR 在送 reviewer 前，主對話執行 `git diff --name-only origin/master...HEAD`，與鎖定清單比對；超出範圍的檔案要不是退回，就是由主對話明確擴充鎖定並更新 `STATE.md`。
6. **migration 時序**：合併前 rebase 到最新 `origin/master`，若有他人 migration 較晚合併，重新命名自己的 migration 時間戳使其維持單調（B04-09 的 18 個亂序案例）。
7. **冷卻**：`reviewer` 審查後任何新 commit（包含 rebase 解衝突）都會使審查失效，需對新 head 重審受影響範圍。

### 3.2 一個工作包同時只有一個作者

審查者不得是作者的同一個 agent 回合；修復作者不得審查自己的 PR。主對話不寫程式（CLAUDE.md），只做文件、設定與 git 操作。

### 3.3 Windows worktree 固定步驟

多寫入者時每人一個 worktree，避免彼此看見對方未完成的修改而讓 typecheck／測試失敗。

```bash
# 建立（Git Bash）
git fetch origin
git worktree add ../CelebrateDeal-wt-<id> -b codex/<type>-<ids>-<slug> origin/master
```

- **一般 worktree**：在 worktree 內建立指向主 checkout `node_modules` 的 junction（PowerShell：`New-Item -ItemType Junction -Path <wt>\node_modules -Target <main>\node_modules`），省去重複安裝。
- **有 Prisma schema 或 migration 變更的 worktree：不要共用 junction。** `prisma generate` 會寫入 `node_modules/.prisma`，共用同一個 `node_modules` 的各 worktree 會互相覆蓋已生成的 client，導致不同 schema 的分支互相造成型別錯誤。這類 worktree 自己 `npm ci`，並且全域同時只有一個。
- **移除前必須先拆 junction**（2026-10-17 的事故：移除 worktree 時清空了主目錄的 `node_modules`）：

```bash
cmd //c rmdir "..\\CelebrateDeal-wt-<id>\\node_modules"   # 只移除連結，不刪目標
git worktree remove ../CelebrateDeal-wt-<id>
```

- 不在其他 session 的 worktree 內執行任何指令；有未提交變更的 worktree 視為他人 ownership。
- 單一寫入者時可直接在主 checkout 工作，省去上述步驟；但仍要 `git add <paths>` 逐一列出，不使用 `git add -A`。

## 4. 分支與 PR 規則

### 4.1 分支

| 類型 | 格式 | 範例 |
|---|---|---|
| 修復 | `codex/fix-<finding ids>-<slug>` | `codex/fix-b03-01-payuni-tradestatus` |
| 功能 | `codex/feat-<slug>` | — |
| 文件 | `codex/docs-<slug>` | `codex/docs-domain-workflows-virtual-viewers` |
| 設定／工具 | `codex/chore-<slug>` | `codex/chore-reviewer-write-guard` |
| 封測熱修 | `codex/hotfix-<issue#>-<slug>` | `codex/hotfix-512-checkout-blank` |
| 審查文件（現有） | `codex/goal-review-2026q4` | 本 Goal；以 PR 合併 |

全部從 `origin/master` 建立（記憶：master 為 canonical）；不 force push；不直推 `master`；合併採 squash。

### 4.2 PR

- **標題**：`<type>(<scope>): <摘要> (<finding ids>)`，沿用既有歷史風格（例如 `fix(billing): …`、`feat(funnel): …`）。範例：`fix(payments): reject non-success PayUni TradeStatus before marking paid (B03-01)`。
- **內容**：使用 02 §3.3 的 PR template（類別、檔案範圍、驗證、審查證據、風險與回復）。
- **大小**：一個 PR 一個關注點；非測試程式變更盡量 ≤ 約 400 行；不混合 H 類與 E 類；不混合 `.claude/**` 設定與產品程式碼。
- **提交訊息**：結尾加上本專案要求的共同作者行；`git add` 明確列出路徑。
- **合併條件**：`quality` 在最終 head 為 SUCCESS；H 類另有 reviewer 報告（綁定該 head）、`security-review`（適用時）與 owner 確認；合併後釋放檔案鎖並更新 `STATE.md`。
- **封存／搬移 `docs/codex-goal/*` 的 PR** 必須同步修正 `AGENTS.md`、`.claude/agents/engineer-hard.md`、`docs/domain-workflows.md` 的寫死路徑。

## 5. 審查關卡

| 類別 | 流程 |
|---|---|
| H | 作者 commit → 主對話範圍檢查 → `reviewer`（依 02 §1 清單，對 head）→ 作者修 BLOCKER／MAJOR → 新 head 重審差異範圍 → `security-review`（適用時）→ CI → 交 owner 確認 → squash 合併 |
| E | 作者 commit → 範圍檢查 → CI → 合併；每 5 個 E 類 PR 抽 1 個交 Sonnet 版 reviewer 檢查（品質抽樣） |
| D | CI → 合併（設定類由主對話自查，必要時 owner 同意） |
| RC（封測前一次） | 10/29 功能凍結後，對 `review-baseline-2026Q4..master` 做增量審查：`reviewer` 對 T／P／D 三軸各一次（Opus）＋`security-review`＋`code-review ultra`；只對增量，不重做全站 |

`code-review ultra` 與 `--comment` 的限制見 02 §3.2。reviewer 的報告檔路徑：`docs/review-2026Q4/fixes/<branch-slug>-<sha7>.md`。

## 6. 封測前每日節奏（2026-10-19 至 11-01）

### 6.1 每日固定動作

| 時段 | 動作 |
|---|---|
| 09:00 | `git fetch`；`gh pr list`；`ccd_pr.get_status`；看 `STATE.md`；staging 部署與錯誤（目前用 `vercel` CLI，見 03 §2.4）；決定今日派工並更新檔案鎖 |
| 午間 | 收子代理回報；範圍檢查；啟動 reviewer |
| 15:00 | 容量檢查：P0 進度 vs 日程；落後就當日通知 owner 要不要縮範圍 |
| 18:00 | 合併已通過者；更新 `STATE.md`；傳一則 owner 摘要（已合併、阻擋、需決策最多 3 項） |

規則：同一根因失敗兩次就停止重試並記 blocked；S0 事件立即單獨通知 owner。

### 6.2 日程建議

| 日期 | 重點 | 里程碑／gate |
|---|---|---|
| 10/19（一） | D 類先行：domain-workflows／PRODUCT.md 修訂 PR、`STATE.md`、PR template；向 owner 要 O6、O11、O13 的回答；車道 B 開始 FIX-01（rebase #436） | `STATE.md` 建立；派工模板定稿 |
| 10/20（二） | FIX-01 送 reviewer；車道 A 開始 FIX-02（等 O2 樣本，樣本未到先做不依賴樣本的狀態檢查與紅燈測試）；車道 C 開始 FIX-E1、FIX-E2 | O4 決策清單送 owner |
| 10/21（三） | FIX-01 合併（owner 確認）；FIX-02 送審；FIX-E2 合併；O1～O5 期限 | owner 決策回收 |
| 10/22（四） | 車道 A：FIX-04、FIX-03；車道 B：FIX-09；車道 C：FIX-E3 開始 | Vercel／Supabase 存取修好（O8） |
| 10/23（五） | FIX-06 handler 修正（排程平台依 O3）；FIX-05 開始；FIX-07 migration 開始 | 週檢查：P0 完成度 |
| 10/24（六） | 車道 A／B 續；FIX-08 先用唯讀白名單確認 RLS／GRANT 實況 | O9 repo 設定完成 |
| 10/25（日） | 緩衝；只合併已審查的 PR | — |
| 10/26（一） | FIX-10、FIX-11（依 O4）；FIX-15（依 O10）；FIX-E5、FIX-E6 | — |
| 10/27（二） | **容量檢查點**：P0 全數完成？P1 完成比例？未達就由 owner 決定縮範圍（隱藏模組、僅 Sandbox 付款、延後 FIX-13／14） | 縮範圍決策 |
| 10/28（三） | FIX-17、FIX-E7 收尾；O7 備份與還原演練完成 | 備份 gate |
| 10/29（四） | **18:00 功能凍結**：H 類停止合併新功能；啟動 RC 增量審查（reviewer 三軸＋security-review＋code-review ultra） | RC 候選建立 |
| 10/30（五） | 修 RC 的 BLOCKER／MAJOR；全量 CI；PayUni Sandbox 實付演練（O12）；Playwright 受控 runner 跑核心旅程；合成資料清理 | RC 驗收 |
| 10/31（六） | owner 以封測客戶角色走完首次成功路徑；Go／No-Go 檢查表；staging 備份 | Go／No-Go |
| 11/01（日） | 封測開始；僅允許 S0／S1 熱修 | 凍結 |

### 6.3 Go／No-Go 檢查表（10/31）

- P0 工作包全部合併，且 H 類均有 reviewer 報告綁定最終 head。
- `master` head 的 `quality` 為 SUCCESS；staging 部署的 commit 等於 RC。
- PayUni Sandbox：付款成功／失敗、重複回呼、部分與重複退款各跑過一次。
- 排程確實被呼叫（以 runtime log 證明，而不是設定檔存在）。
- 備份與隔離還原已演練（O7）；Sentry 告警有人接收；回報管道與 02 §4 的流程已告知 owner。
- 未解的 BLOCKER／MAJOR 清單與 owner 已接受的風險，逐項簽收寫入 `STATE.md`。

## 7. 封測期間（11/01 之後）

- 只做 S0／S1 熱修與 S2 批次；依 02 §4 的 triage；新功能與重構（B01-05 階段 3、B01-07～10、B05-04 等）一律延後。
- 帶 migration 的變更預設不合併；例外需備份、通知 owner、在 `STATE.md` 記錄。
- 每週一次回顧：已修、仍開著、客戶實際踩到的 finding（作為 ROADMAP-v2 的第一批真實資料，C-09）。

## 8. 風險與未驗證

- 本手冊的人天加總是把各報告的區間取中間值粗加，並排除條件式項目；沒有針對 AI 代理的實際吞吐量校準。
- `engineer`、`engineer-hard` 是否會遵守「列出讀過的 Next docs」「只改鎖定檔案」，要靠主對話的範圍檢查與抽查；沒有機制強制。
- `hooks`、`skills` frontmatter 欄位未實測（01 §2.3、§3.3）。
- RC 的 `code-review ultra` 需要 GitHub.com PR 目標且是雲端執行；本專案為 public repo，程式碼本就公開，但仍需 owner 同意使用額度。
- Goal Plan 的 T3 規定 #436 合併需要 owner 說 OK；本手冊將同樣的做法推廣到所有 H 類 PR，這是建議，需 owner 確認是否過度保守。
