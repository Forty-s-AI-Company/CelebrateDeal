# 分支衝突取捨與可交付段落

基準 master：`bdbae2f53491afd518b97ee597e117d6a585b55c`。這份紀錄是來源內容審核與候選修改決策；尚未執行遠端合併。

## 補丁驗證更正

先前在儲存庫子目錄執行 `git apply --check` 時，Git 會忽略目錄前綴以外的 patch paths，僅看 exit code 0 不足以證明有效。舊檢查結果已撤回。三份 package script 改從 repo root 傳入明確 `--directory`，要求 verbose output 包含每個預期檔案且沒有 `Skipped patch`。

另外，將 #351 四檔、#211 三檔、#13 二檔 patch 真正套用到全新、固定來源 SHA 的隔離檔案副本，逐檔比對 SHA-256，**9 檔全部吻合候選**。驗證命令局部使用 `core.autocrlf=false`，避免 Windows 換行轉換干擾位元組比對；沒有修改全域 Git 設定、index、ref 或原工作目錄程式。[完整實際套用收據](branch-integration-patch-application-proof-20261004.json) 為現在的權威證據。

## #211：先分離自己的修改與繼承的 #210 內容

來源 head：`b5397dbb45ddc4dc15a3059b7dec90b5a7771487`。原 stack base：`e1f38be324e349969a657be376aa1602e804c2dd`，已驗證為 head 的 ancestor。這個範圍共 48 個 commit、288 個變更檔案；不能把整個 head 對 master 的差異都當成 #211 新功能。

對這 288 個路徑逐一比較 base、head 與 master blob，結果記錄於 [stack 差異清單](branch-integration-pr211-stack-delta-20261004.json)：

| 分類 | 檔案數 | 意義與處置 |
| --- | ---: | --- |
| EXACT_IN_MASTER | 35 | master 與 #211 的該路徑內容相同，不重複套用。 |
| UNCHANGED_BASE_IN_MASTER | 187 | master 在該路徑仍等於 stack base；包含新檔在兩者都不存在的情況。177 個是文件／歷史證據，6 個 src、3 個 scripts、1 個 Prisma 路徑逐項評估。 |
| BOTH_CHANGED | 66 | master 與 #211 各自演進；需依行為判斷，不能整批選 ours／theirs。 |

下面只列已實際核對的範圍，並未宣稱 66 個路徑全部解決。

| 路徑／範圍 | 已核對的差異 | 決策與理由 |
| --- | --- | --- |
| `src/lib/funnel-block-library.ts` | master 有 9 類共 27 個實際 variant；舊分支只有 9 個代表項目，部分 metadata 宣告更多數量。 | 保留 master 可實際使用的 registry；不以宣告數量替代真實元件。 |
| `src/lib/funnel-page-document.ts`、`src/lib/funnel-popup.ts` | master 的桌面 exit intent 已有可執行邏輯；舊分支仍將它標為未驗證／停用。 | 保留 master 已實作的功能；後續以 public runtime 測試驗證，不退回 placeholder。 |
| `src/lib/funnel-flow.ts` | master 的次要分頁對應實際持久化 operations；舊分支仍有停用／空白描述。 | 保留 master 的可執行操作；文案改善可另外抽取，不還原停用流程。 |
| `src/lib/funnel-commerce-service.ts` | master 遇到重複 slug 會拒絕公開解析，保留發布與 project 條件、絕對截止時間及 public commerce projection；舊版使用 `findFirst` 並缺少部分限制。 | 保留 master 的安全條件與截止契約，避免任意選中同名頁面或接受過期交易入口。 |
| `src/lib/landing-page-service.ts` | master 保留 metadata／rollback 的 operational reference 驗證、scope-aware 複製 slug、公開 slug 歧義拒絕與 consultation projection。 | 保留 master 的租戶／引用／公開資料邊界，不套回較弱舊版。 |
| `src/lib/funnel-goal-step-pages.ts` | master 的 Sell／Audience 在設定前提供模板選擇；舊分支直接選 primary template。 | 先保留 master 現行模板選擇流程；產品行為變更需另有使用者旅程驗證。 |
| `src/components/landing-pages/` 三個缺漏 test 檔 | commerce、webinar、interactive blocks 的測試尚未進 master；相關元件與領域來源在測試用 #351 snapshot 與 master 相同。 | 回收成獨立測試 patch；倒數測試補固定時鐘，避免隨機器日期失敗。 |

## #211 可先交付的測試段落

[三檔 patch](branch-integration-pr211-tests-20261004.patch) 與 [來源／驗證 manifest](branch-integration-pr211-tests-manifest-20261004.json) 保留原來源與候選 SHA-256。包含：

- Commerce 13 個案例：可信目錄價格、公開 checkout 邊界、預覽不可付款、商品缺失／不匹配與付款能力呈現。
- Webinar 5 個案例：任意影片拒絕、配置缺失時停用、所屬表單與導向、手機預覽不送出、播放到期。
- Interactive blocks 2 個案例：倒數 CTA 與到期隱藏，固定測試時鐘並於每個案例結束恢復。

本機 20/20 PASS、三檔 ESLint PASS、patch `git apply --check` PASS。未執行瀏覽器旅程、真實 provider 或新 commit 的遠端 CI；這個段落仍待 protected PR 與驗收 gate，不能當成已合併。

## #234：已被 #236 替代，不合回舊方案

原分支 `codex/consultation-deps-integration`，head `429bc93d5b54c131d1d45768154a0bfd749336af`。原 PR 作者已[明確記錄由 #236 替代](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/234#issuecomment-5748004765)。#236 merge commit `3fefe1c1ada00b8e4e2e67e997907fdf911204e2` 已驗證在 master 的 ancestry 中。

另外核對原分支的四個變更路徑與 #236：`automation-workflow.ts`、其測試、`sales-project-customer-membership.ts`、`sales-project-scope.ts`（均位於 `src/lib/`）。替代版本只有 21 行新增／2 行移除，實質變更為由可信來源提供 `liveId`、缺少 Live scope 時拒絕執行、idempotency 與 execution log 綁定 Live、no-show 查詢限定 Live，並補上契約測試；後兩檔只涉及檔尾換行。

因此處置為 `DOCUMENTED_SUPERSEDED`。它不等於舊 SHA 已合併，也不需要重新合併舊方案。原分支與提交仍保留，沒有刪除。

## #213：依賴修正已保留，不倒退 lockfile

head `7f07a5f615ee6011c5eb559a60687f966653d1d9`，剩餘差異只有 `package.json` 與 `package-lock.json`。逐項核對顯示原有 dependency、devDependency 與 override 規格全部相同；原 lockfile 的 794 個套件項目都存在於 master，版本、resolved、integrity 與其他內容也都保留。只有 `@types/react`、`@types/react-dom`、`csstype` 三項不再標記 `dev: true`。

master 額外包含 Puck `0.22.4`、相關 lock 項目與更多 staging 契約測試。將舊檔整份合回會丟失這些後續成果，因此兩筆本機／遠端參照標記 `CONTENT_SUPERSEDED`。這是歷史修正的包含性核對，並未宣稱現在執行過 npm 漏洞稽核。[逐項證據與 blob 雜湊](branch-integration-content-supersession-20261004.json) 已保存。

## 舊直播預覽測試：主線已有相同案例與更完整測試

`codex/recovery-live-stepper-qa-20260719`，head `22f06a69bf79149f673d7800225045990e68cb07`，只剩 `src/components/live-stepper-form.test.tsx` 一個差異路徑。舊測試的兩個意圖均已在主線覆蓋：空白狀態的三個提示文字；輸入標題、促銷短句、選商品後的兩個商品名稱與剩餘件數。主線也額外檢查選商品後不再出現空白選取提示。

目前元件和測試的 blob 均與 master 完全相同，在隔離候選中執行該測試檔 **31/31 PASS**。將此分支標記 `CONTENT_SUPERSEDED`，保留主線較完整的表單、草稿、發布檢查測試，不覆蓋成舊版 2 個案例。未執行瀏覽器 E2E。

## #13：核心預覽已替代，但仍保留小範圍差異

head `f5512bf0f0a256bcaf732307cdd330a91dad90e0` 的三檔已核對。master 已具備表單輸入連動、空白提示、未知商品 ID 過濾、最多兩件商品摘要，且預覽 CTA 使用非提交元素，避免舊版預覽按鈕送出外層表單。這些主線行為應保留。

但舊 `buildLivePreview` 尚有去除重複商品 ID、商品名稱 trim／空字串 fallback；master 的 `createLivePreview`／`summarizeLivePreviewProducts` 並未保留這兩項。這不是整個預覽功能缺失，也不能宣稱全檔等價。

本輪已在隔離候選的現行 API 補回：先依初次選取順序去重，再排除未知 ID、顯示前兩件並計算其餘件數；商品名稱 trim，空白時用「未命名商品」，避免已選商品卻顯示「尚未選擇」的誤導。保留原輸入陣列，不還原舊 UI／API。新增三個回歸案例，與既有 live-stepper 測試共同執行 **2 檔 39/39 PASS**；兩檔 ESLint 與 patch apply check PASS。

[二檔修補檔](branch-integration-pr13-preview-20261004.patch)、[manifest 與安全性／效能／可讀性／維護性審查](branch-integration-pr13-preview-manifest-20261004.json) 已保存。原分支仍列待處理，下一步是將這個段落以新 protected PR 提交、跑新 CI 與 gate；#13 本身已關閉，不需要重開舊版實作。未完成遠端驗收前，不把候選 patch 當成 master 已包含。

## 未合併分支的依賴關係

[pending lineage](branch-integration-pending-lineage-20261004.json) 保存本輪分類前 49 個待審 head 的兩兩 ancestry 結果。它們有 39 個不被其他待審 head 包含的頂端 head；這僅供辨認依賴與安排批次，不代表合併其中一個就能通過所有功能驗收。後續的內容審核又將 #213 與 recovery 測試兩個 head 判定為已有替代內容，因此目前待審為 47 個。來源關係與內容替代證據分開保留，避免誤用 ancestry 當成已進 master。

## #118–#135：各 PR 的修改與功能分支底層分開核對

18 個 PR 都合進 `codex/payuni-sandbox-external-qa`。以各自 squash commit 的 parent→commit 取得原 PR 實際整合 delta；各 PR head 對 master 的差異還包含累積底層，不能全部算成該 PR 的未完成工作。[每筆 SHA、路徑與 reverse-check 收據](branch-integration-feature-pr-deltas-20261004.json) 已保存。

本輪正確的 reverse-check 對 18 個 PR 全部回覆 `NO_PROOF`：主線後續重構使舊 patch 無法逐 hunk 反向套用。這不是「功能不存在」的證據，必須核對行為。最早那批在子目錄產生的 PASS 已明確作廢，沒有用來更動分支處置狀態。

| 原 PR | 已核對的主線對應內容 | 後續處置 |
| --- | --- | --- |
| #118 | 原增補的空白預覽、輸入／商品摘要測試，已在目前 `live-stepper-form.test.tsx` 的 31 個案例中保留；前輪實際執行通過。 | 不重複加入舊測試檔。繼承的 sandbox QA 底層仍待核對。 |
| #121 | request route 改用 canonical URL、固定匿名 `{ ok: true }`，不再回傳 reset URL；`schedulePasswordResetLink` 將寄信放到 response 後，捕捉 provider 失敗。寄送失敗時撤銷未送達 Token 並保留遮罩 audit 的程式與測試亦存在。 | 保留較新的背景處理與保密設計，不還原舊同步寄信；本輪只有靜態核對，未執行 DB／寄信測試。 |
| #135 | `checkoutResponse` 仍設定 `Cache-Control: no-store`；route test 保留同名 no-cache 案例，並加入 support cookie 與完整 payload 契約。 | 不重複套用舊 route，保留新的可信訂單金額與 cookie 處理。本輪未執行 checkout tests。 |
| #119、#120 | 停權案例、Email 確認、非本人／active／owner 限制保留。主線停權和最後一名 owner 檢查放在同一 Serializable transaction，且更新條件綁定 vendor／原角色／active 狀態；session 撤銷與遮罩 audit 保留。 | 保留主線較完整的並行與權限防護，不還原舊 action 整段。 |
| #122 | Live／script／vendor 同範圍解除綁定、count 檢查、UI 確認與 revalidation 都保留；主線增加 manager 權限、ID 長度限制及 audit。 | 保留主線拆分後的 `interaction-actions.ts` 與現有 UI。 |
| #123、#124 | KPI 與最近 30 筆事件清單已分開。主線 KPI 計入可信、不重複 admission session 與已驗證名單；最近事件和聯盟歸因表保留無資料提示。 | 保留主線可信統計與 project／vendor 範圍，不退回所有原始事件的計數方式。 |
| #125–#128、#134 | 建立交易、provider session、metadata 寫入失敗均有處理；補償寫入再次失敗時保留通用 502。主線另以 `failPendingCheckoutAndReleaseInventory` 釋放庫存，並保留訂單、商品版本、voucher 的具體錯誤。 | 保留原子 reservation 與補償流程，不回復只更新交易 status 的舊版。 |
| #129、#130、#132 | 主線導向站內 checkout 頁；共用 navigation lock、disabled／busy 狀態、防連點與失敗訊息保留。外部商品 URL 採驗證後的獨立使用者確認流程，並非站內失敗後自動 fallback；另有 timeout 訊息與外部確認鎖。 | 保留目前站內／明確確認外部導向的設計，不恢復舊元件直接送 payment request 的架構。 |
| #131、#133 | checkout 僅採驗證過的 visitor／click／vendor／affiliate 歸因，不信任 request referralCode。paid webhook 以既有交易 metadata 更新 conversion，不允許 provider metadata 覆蓋可信 snapshot。 | 保留較新的可信交易來源；checkout 有本輪 mock test 證據，webhook 為本輪靜態核對，未執行 DB tests。 |

現在 18 個原 PR delta 均完成內容核對。上述結論代表原 PR 意圖已有對應行為，不代表原 branch head 的所有底層修改已包含。整體 47 個待審 head 的數量維持不變。

本輪在隔離候選執行 `actions.test.ts`、停權確認元件、interaction script form、Live analytics page、Live playback、checkout route 六個測試檔，**452/452 PASS**。這是本機 mock 測試，不包含 DB、瀏覽器 E2E、真實 provider／付款／寄信。相關七個實作檔與五個測試檔完全等於 master；`actions.test.ts` 只有其他測試區塊隨 #351 改變，今回審核的 deactivate／unbind 兩個 describe 區塊與 master 完全相同。逐檔雜湊與範圍限制保存在 feature-pr-deltas JSON。

將 18 個 head 的差異扣除已核對的家族路徑後，共用殘餘只有六個路徑：

- `.ai-team/project.yaml`：master 已刪除舊設定；不得重引入其一次執行限制或舊 routing。依現行 canonical policy 核對是否仍有必要設定。
- `.env.example`：依專案規則未讀取內容；只保留參照與路徑，不將模板差異自動合併。
- `docs/ai-team-payuni-sandbox-qa.md`：核對現行 runner 與非 Production 流程，不回復舊 evidence 結論。
- `package.json`：保留現有版本、override 與 staging 驗證 scripts，只核對 QA 指令缺口。
- `scripts/payuni-sandbox-external-qa.mjs`、其 `.test.mjs`：master 有新增固定 staging allowlist、process environment preflight、public callback 探測與安全 artifact schema；原 query timeout／固定 provider disposition 等函式與測試仍存在。尚須完整檢查殘餘差異，不因函式名稱保留就宣稱完全等價。

這六項應以一個共用 sandbox QA 批次處理，而不是重複處理 18 份繼承內容。沒有將 reverse-check 的 NO_PROOF 改寫為 PASS，也沒有將 mock tests 當成正式付款驗收。
