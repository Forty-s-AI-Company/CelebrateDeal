# 分支整合：未來處理與接手報告

日期：2026-10-04（Asia/Taipei）。狀態：**五個交付段落完成 / #351、#352、#354、#355、#356 已通過新 CI、canonical gate 並合入 master；#353 的兩檔內容已由 #352 完整交付。原 42 個歷史 head 已有 15 個完成交付或替代核對，剩餘 27 個與原有未提交工作持續整合，整體 Goal 尚未全部完成**。

## 本輪已完成的段落

- 盤點初始 `master`：`bdbae2f53491afd518b97ee597e117d6a585b55c`；#351 合併後主線：`40db1781aa9d2bf17013c328a390dfecef7eee11`。分支保護已啟用，必要 GitHub check 是 `quality`；現有 CI 對每次 push 和 PR 執行 ESLint、typecheck、單元／coverage、資料庫與瀏覽器驗證，不新增重複 workflow。
- 查完 351 個 PR：334 個標記 merged，其中 315 個合併 commit 可證明在目前 master；另外 19 個是合進功能分支，不能直接當作已進 master。
- 查完 280 個即時遠端 branch heads、518 筆本機／遠端參照、115 個 worktree。詳見 [逐分支處置](branch-integration-dispositions-20261004.md) 與 [機器可讀盤點](branch-integration-audit-20261004.json)。448 筆有既有 merged PR、ancestor、patch 等價或變更面相同的證據；4 筆有新版替代或內容替代證據；66 筆（47 個獨立 head）保留待內容審核，參照數不等於獨立功能數。
- 獨立審查 PR #351 最新 head，找出並在隔離來源副本修復兩項 MAJOR：PayUni 取消 Token 補上與 setup 相同的 `CreditTokenType: 2`；正式扣款 probe workflow 移除 schedule，保留手動觸發及既有授權 guard。
- 修正有 setup→cancel 的解密契約回歸測試。本機 5 檔 Vitest **79/79 PASS**，3 個變更 TS 檔 ESLint PASS。標準修補檔對原始四檔 `git apply --check` PASS；獨立複審關閉兩項 MAJOR。
- [可套用修補檔](branch-integration-pr351-fix-20261004.patch) 與 [來源／內容雜湊](branch-integration-pr351-fix-manifest-20261004.json) 已保存。修補基準固定為 `863218bba4d64ee2f97e8db43c19583ea9fdccd8`，不能當成任意版本可套用的 patch。
- Canonical `assess_acceptance` 已以實際新 head CI run `37200997791` 重驗，[驗收紀錄](branch-integration-pr351-acceptance-20261004.json) 為 **READY**，無 blocker；targeted tests、scoped ESLint、手動觸發限制、新 head quality 與獨立 review 的收據均吻合已發布來源。#351 已透過 expected-head protected merge 合入 master。
- #211 以原 stack base 分離出自己的 288 個變更檔案：35 個已與 master 相同，187 個主線仍保留 base 狀態，66 個兩邊各自演進。已核對範圍與保留 master 的理由寫入 [衝突取捨紀錄](branch-integration-conflict-decisions-20261004.md)，其餘仍明列待辦。
- 從 #211 回收 3 個缺漏回歸測試檔，補固定時鐘後 **20/20 PASS**、ESLint PASS、patch apply check PASS。[獨立測試 patch](branch-integration-pr211-tests-20261004.patch) 與 [manifest](branch-integration-pr211-tests-manifest-20261004.json) 保存原始驗證；已建立 #352，發布進度見下表。
- #234 原作者已確認由 #236 替代；另核對四個來源檔案與替代差異，確認 #236 的 Live scope／idempotency 防護較完整，且其 merge commit 已在 master。原分支保留，處置為 `DOCUMENTED_SUPERSEDED`，不重新合併舊實作。
- #213 的原有依賴規格、override 與 lockfile 的 794 個套件版本皆已保留在主線；舊 recovery 直播預覽測試兩個案例亦已有主線對應測試，目前整檔 31/31 PASS。這兩個 head（3 筆參照）標記 `CONTENT_SUPERSEDED`，詳見 [內容替代證據](branch-integration-content-supersession-20261004.json)。
- #13 尚未保留的商品去重與名稱正規化已補成 [二檔 patch](branch-integration-pr13-preview-20261004.patch)；保留現行 API 與最多兩件的摘要行為，空白商品名改用「未命名商品」。新增三個案例，與表單測試共同 **39/39 PASS**，ESLint／apply check PASS。[manifest](branch-integration-pr13-preview-manifest-20261004.json) 保存主代理四面向審查與驗證限制；已由 #352 交付。
- 權限恢復前的遠端確認以 `bdbae2f5` 為基準；恢復後已推送 #351 修正並建立 #352／#353，進度見下表。
- 修正補丁驗證方式：先前在儲存庫子目錄直接執行的 apply check 會跳過路徑，原結果無效。三份 patch 現已從 repo root 指定隔離目錄逐檔檢查，並實際套用到新的原始來源副本；9 個輸出檔的 SHA-256 全部與已測試候選相同。[實際套用證據](branch-integration-patch-application-proof-20261004.json) 取代舊 check 結論。產品修改與測試內容未因這項更正而改變。
- 分離 #118–#135 的原 PR delta 與功能分支底層：[逐 PR 範圍與檢查](branch-integration-feature-pr-deltas-20261004.json)。正確的 reverse-check 均為 `NO_PROOF`，不能據此推定已包含或缺少；另以內容核對確認 #118 預覽測試、#121 重設密碼寄送失敗保密、#135 checkout no-store 有主線對應行為。分支整體仍保留待審，詳見 [取捨紀錄](branch-integration-conflict-decisions-20261004.md)。
- 後續已完成 #118–#135 全部 18 個自身 delta 的內容核對，保留 master 的交易隔離、租戶／manager 範圍、可信 analytics、庫存補償與歸因防護。6 個 mock 測試檔 **452/452 PASS**；相關原始檔雜湊、`actions.test.ts` 的精確審核區塊與未執行項目均記錄於同一 JSON。共用底層殘餘集中為 6 個路徑，仍待一個 sandbox QA 批次處理，因此不虛減分支待審數。

## 寫入恢復後的發布進度

使用者調整權限並明確要求繼續後，本機 Git 與 GitHub 寫入已恢復；以下為新的實際操作。先前不能寫入的記錄僅描述當時環境，不再是目前 blocker。

| PR | 已推送 head | 已完成內容 | 尚待完成 |
| --- | --- | --- | --- |
| [#351](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/351) | `ff9f446751d37be64bf2cf423e2e7c055135e0ce` | 原四檔與新增 webhook 兩檔均完成獨立審查，131 個本機測試；PR 描述已更新 | 已完成：新 CI、gate READY、取消 Draft、protected merge |
| [#352](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/352) | `e4d726fd4fefdda6c6c142349d5dce261d8d753e` | 三檔 Funnel 測試、#353 兩檔預覽修正、完整報告；已同步 master `40db1781` | 已通過新 head CI、gate READY 並 squash merge |
| [#353](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/353) | `49e884ff6870793412534e1cb22fb19cfea76a4e` | 商品去重、名稱正規化及回歸測試已納入 #352 | 已確認主線兩檔與原候選雜湊完全相同，由 #352 交付 |

#352／#353 最初基於舊 master，CI 在 Production dependency audit 失敗。#351 已含 Next.js 16.3.5→16.3.8 更新且同項稽核通過，因此已透過正常 merge 同步其已審查版本，沒有降低稽核門檻。是否完全解決仍以新 head CI 為準。

合併時使用 expected-head，保留 master 分支保護與線性歷史要求，採 squash merge；`vercel.json` 的 master 自動部署仍為 false。沒有執行正式付款、probe、正式資料庫或部署。#210／#211 在剩餘功能核對完成前保留開啟，不用關閉 PR 取代實際整合。

原 518 個參照、351 個 PR、115 個 worktree 的盤點是發布前 snapshot；新增 #352／#353 不回填成原盤點已包含的資料。完成合併後另記錄 master 與 open PR 的即時狀態。

## 本輪交付與後續批次

完整的逐 head 範圍、保留原因與驗收條件見 [未來批次明細](branch-integration-deferred-work-20261004.json)。初始尚有 42 個歷史 head。後續已核對其中 14 個由主線完整保留或替代；目前剩 28 個：Funnel 5、AI Team 2、Sandbox QA 19、staging 2。剩餘項目是待辦，並非已合併或已通過驗收。逐次核對過程與證據見後文及明細 JSON。

| 優先級／批次 | 原始工作與目前成果 | 剩餘工作、依賴與驗收條件 |
| --- | --- | --- |
| P0：#351 發布 | head `ff9f4467`；兩項 MAJOR 與新增 webhook return 增量已完成獨立複審；新 CI run `37200997791` | 已通過新 head quality、canonical gate READY 並合併；正式付款、退款、migration 與 probe 執行仍未授權。 |
| P1：Token 到期資料 | #351，`src/lib/payment-providers/payuni.ts`；既有 callback 未保存官方 `CreditLife` | 核對官方 MMYY 語義與時區，解析並傳入 `expiresAt`，明確定義缺值／錯誤格式的保守行為。測試合法月份、跨年、非法月份、已到期 Token，以及發布／quota gate 不接受過期 reference。此次不以縮小現有安全驗證解決。 |
| P1：#211 測試段落發布 | #352 回收 3 檔、20 個測試；與 #353 預覽修正整合為一個五檔產品批次 | 已在最新 master 上通過 CI 37202721735 與 gate READY，隨 #352 合併。 |
| P1：#210／#211 功能差異拆分 | #210 `b7956d80`、#211 `b5397dbb`、本機 `60132971`；主線已有 #219、#231–#240、#243–#253、#260、#263–#270 等拆分成果 | 以目前 master 為實作基準，核對 student portal、LINE rich menu、affiliate portal／分潤、成長工具與私訊等剩餘功能。舊分支相對 master 各有 216／199 個新增 src／migration 路徑，包含繼承內容，並非 #211 自己的新功能數或功能全數缺失的證明。按功能拆 PR，補齊租戶／角色／路由／資料約束及完整使用者流程，再驗收合併。 |
| P1：#211 編輯器的剩餘差異 | 已有 stack 三方分類與局部取捨矩陣；Funnel 建立、管理、public runtime、commerce、operations 與 editor 已有主線拆分 PR | 繼續核對其餘路徑；187 個未套用路徑有 177 個文件／歷史收據，不把舊收據搬成新 PASS。保留 master 最新 scope、CAS、可信價格、庫存 reservation、錯誤處理和效能改善。通過 editor→發布→匿名公開頁→mock checkout 的桌面／手機旅程；不能直接採舊分支的 migrations 覆蓋現行 migration tree。 |
| P1：主目錄未提交工程 | 原 `codex/one-stop-webinar-flow`，HEAD `60132971`；既有 AI Team vNext、Funnel、登入安全及驗證工具變更均留原位 | 每個功能先確認與 master／#351 是否重複，按 ownership 分開 checkpoint。AI Team 修改由主代理直接處理，不啟動正在修改的 AI Team 修改自己。登入與 Next.js 修改先讀相應本機文件；新增／變更測試、既有 CI 不得丟失。 |
| P2：歷史 PayUni／Staging 工作 | `codex/payuni-sandbox-external-qa`；#118–#135 自身 delta 已完成內容核對，共用底層殘餘 6 個路徑；其餘功能分支／診斷 PR 保留 | 先一次核對共用 QA runner／tests、文件、package 指令與已刪除舊 project 設定。`.env.example` 未讀取，不自動整合。再逐分支處理其餘 `remaining_paths_at_inventory`。保留新版 provider、reconciliation、歸因與隔離保護；不把舊收據冒充新候選驗證。 |
| P2：#13 預覽段落發布 | #353 已提交商品去重與名稱正規化；39 個本機測試通過；提交歷史已整合到 #352 的本機候選 | 已隨 #352 通過 CI、gate 並合併；原 #13 與 #353 保留追溯來源。 |
| P2：真實環境與營運驗收 | #351 的既有 WP1–WP6 文件保留多項外部與政策待辦 | 更新同一候選的非 Production 隔離、備份恢復、對帳、scheduler、寄送及政策 evidence。既有非 Production 授權持續有效；正式環境與真實付款操作另行授權。移除的正式 probe 自動排程不得在其他 workflow 偷渡恢復。 |

官方契約來源：[PayUni credit_bind/cancel](https://docs.payuni.com.tw/web/#/7/41)、[PayUni UPP](https://docs.payuni.com.tw/web/#/7/34)。本次 reviewer 以公開文件核對，未讀取任何帳號秘密。

## 保護、ownership 與完成定義

- 既有工作目錄唯一 dirty 的是原主目錄；原始 dirty 檔案持續保留；本輪已驗證修正在 managed worktree `branch-integration-20261004` 逐批 exact staging、提交與推送。隔離來源副本保留驗證依據。
- 主代理負責盤點、付款四檔 patch、回收三檔測試 patch、預覽二檔 patch 與報告；獨立 reviewer 只讀審查 #351 修正。requested team=`auto`；盤點 effective=`ai-team`、resolved=`gpt-6.1-sol high`；Critical review effective=`ai-team-pro`、Opus 不可用後 resolved=`gpt-6-astra high`，原因 `critical_review_no_equivalent`；observed model／effort 均為 unknown。
- agy discovery 一次失敗，記錄 `HOST_PERMISSION_BLOCKED / HOST_AUTH_CONTEXT_UNAVAILABLE`，沒有把 sandbox 無法取得登入 context 說成使用者必須重新登入。最大 active helper=1、depth=1；同一四檔只有主代理寫入。
- 回復本輪本機成果只涉及本輪新增的報告、patch 與隔離副本；不對未知修改使用 reset、clean、stash、restore、checkout 或 rebase。本輪已更新上述三個 PR 分支與描述；master 是否前進以發布紀錄為準。
- 本 Goal **尚未完成**。#351 已完成合併；其餘完整目標仍要求所有剩餘分支有已驗收合併、可證明替代、或具體保留待辦的處置；發布權限與新 CI 缺口不能寫成 PASS。

## 同時進行工作的整合紀錄

#351 的 b3ddc37b 完整 CI 已成功，但合併前 expected-head 檢查發現遠端新增 ff9f4467，包含付款後返回已登入方案頁的兩檔修改。主代理保留新提交，補做 route／test 的獨立 Critical review；沒有新增 findings。六檔相關修改的 131 個本機測試、五檔 ESLint、手動 probe workflow 限制皆通過。最終驗收採 ff9f4467 與新 CI 37200997791；沒有沿用上一個 head 綠燈直接合併。

## #351 實際合併收據

- PR：https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/351
- 已驗證 head：`ff9f446751d37be64bf2cf423e2e7c055135e0ce`
- merge commit：`40db1781aa9d2bf17013c328a390dfecef7eee11`
- 合併時間：`2026-10-04T12:33:14Z`
- 三個歷史 PayUni query heads 的相同意圖已隨此主線保留，見 [語義與 blob 證據](branch-integration-payuni-query-supersession-20261004.json)。原始分支未刪除。

## #352 實際合併收據

- PR：https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/352
- 已驗收 head：`e4d726fd4fefdda6c6c142349d5dce261d8d753e`
- merge commit：`fc28e1b8dcdba9ca3926f11d27153de048f597da`
- 合併時間：`2026-10-04T13:03:37Z`
- master：`fc28e1b8dcdba9ca3926f11d27153de048f597da`；合併 tree 與已驗收 head 完全相同。
- 必要 quality CI `37202721735` PASS，canonical gate READY；五個產品檔案與 26 份文件已交付。
- 原有 118 個可雜湊檔案與全部原始狀態條目已核對，內容與狀態均未改動；主目錄仍在原分支與原 HEAD。

## 最終遠端與保留狀態

- master：`fc28e1b8dcdba9ca3926f11d27153de048f597da`。
- 目前開啟 PR：#211, #210；兩者尚未整體合併。
- #353 已關閉為由 #352 交付；原始分支未刪除。
- 42 個歷史 head 仍依五批計畫保留；盤點與未來計畫不能當作內容已合併。
- 以上最終收據補記在本機報告；#352 提交內的文件保留提交當時的發布 snapshot。

## 後續 Goal 提示詞

```text
繼續 CelebrateDeal 的剩餘分支整合。先讀 docs/branch-integration-future-work.md、docs/branch-integration-deferred-work-20261004.json 與最新 publication／delivery-state 紀錄，重新確認 origin/master 和 open PR。以 42 個保留 head 與原有未提交工作為範圍，優先完成 P1 Funnel 與 AI Team 的可獨立驗收段落，再處理 Sandbox QA 與 staging runner。

已授權自行處理一般衝突，選擇適合目前 SaaS 架構、租戶隔離與資料安全的方案；不因例行工程選項再次詢問。逐分支核對既有主線是否已包含同一意圖，未完成工作先完成可交付段落，剩餘功能寫入未來處理報告。使用 audit 的 disposition 與實際 blob／語義證據，不只以 Git ancestry 判定。

保留未知 dirty 工作；重用乾淨隔離 worktree，僅精確 stage 本批檔案。依風險執行 targeted tests、現有 quality CI 與必要獨立審查，再經 canonical acceptance gate 與 protected squash PR 合入 master；以 expected head 與合併後內容比對留下收據。CI 已涵蓋每次 push 的 ESLint 與單元測試。

AI Team 變更由主代理處理，不啟動正在修改的 AI Team 修改自己。不要直接推 master、force push、降低驗證、讀取 .env* 或接觸正式資料。Production 部署、正式付款／退款／寄信與正式 migration 不在本 Goal 授權範圍。完成每批後更新來源、證據、剩餘範圍和下一步；不能把未執行的驗證或未整合的分支標成完成。
```

## 持續整合：LINE 草稿與 staging 診斷

- PR #354 已推送 `f73f78457b5b3059419223d0860b621b854eea90`：從 #210 完成 LINE 範本、預覽與 owner-scoped 草稿 CRUD；42 個 unit/SSR、3 個獨立 PostgreSQL 測試、TypeScript、ESLint 通過，獨立 Critical review 無剩餘 findings。CI 37206001593 與新增瀏覽器互動仍在執行，尚未合併。
- 歷史 heads `0b10ff680117`、`4fac54930808` 的兩個剩餘 runner/test 路徑已逐行比對。主線保留原診斷與非敏感分類，增加 lineage、alias、資源載入、navigation/hydration 與 session cleanup。16 個 mock contract tests 全部通過，證據見 branch-integration-staging-browser-supersession-20261004.json；兩者改列 CONTENT_SUPERSEDED，保留原分支。
- 初始 42 個保留 head 現有 2 個完成內容替代核對，剩餘 **40 個** 未完成整體驗收；#354 是 #210 的部分功能段落，不能再扣除 #210/#211 的 head 數。

### 第二次 CI 與替代證據更新

#354 最新 head 為 `026a95228d449f937e0317f6ec2aba5e5e499c95`，CI run `37206568084`。舊 head CI 在完整 unit/coverage 階段失敗；已修正 122 models／82 migrations 的 canonical inventory 相依，保留付款 adapter 固定 79→81 的拒絕範圍，獨立複審無 findings。新增 6 個 Node contract 與 5 個 Vitest tests PASS；實際 Playwright 新旅程 PASS。新 head CI 尚在執行，未合併。

另外 6 個 head（browser flow 兩個、provider read-only probe 兩個、migration apply 兩個）均逐檔核對為由現行主線替代。browser 共 16、provider 共 4、apply 共 11 個 mock contract tests PASS；沒有執行外部 staging workflow。累計 8 個 head 完成內容替代，**剩餘 34 個 head**，完整 metadata 與行為取捨分別見 `branch-integration-staging-browser-supersession-20261004.json`、`branch-integration-staging-provider-supersession-20261004.json`、`branch-integration-staging-apply-supersession-20261004.json`。

原目錄 118 檔內容雜湊與 120 筆 status 均未變動，來源 HEAD 保持 `60132971`，證據見 `branch-integration-preservation-20261004.json`。

### 當前阻擋與繼續處理

#354 的 `026a9522` CI 37206568084 仍在 unit/coverage 階段失敗，尚未合併。已啟動相同 combined-coverage runner 的本機隔離重現，僅保存 sanitized failure summary；不降低門檻、不移除案例。

歷史 smoke head `d8c85fbbb39e` 已核對只有 CI、lockfile 與隔離 smoke 文件：所有原依賴仍在現行 lockfile，Next/eslint-config-next/Vitest 已向前更新，原 CI 的驗證行為皆由現行 CI 保留，#351/#352 的實際 protected PR 交付提供 guarded-write 流程證據。來源文件留在原分支，不冒充新執行收據。累計 **9 個 head 已證明替代，剩餘 33 個**；詳见 branch-integration-historical-smoke-supersession-20261004.json。

#354 第三版 head `23fcae9871cec124cdb940a339be806081d5f849`：完整本機 4,210 Vitest tests PASS，Node TAP 找到 G7-55 清單尚未加入第 82 條 migration，精確補正後相關 11 tests PASS。Windows 本機三個 evidence hash failures 為 CRLF，已確認 Git blob 完全吻合既有 hash，無文件內容修改。獨立第四次增量 review 無 findings，新 CI run `37207666809` 執行中。

歷史 migration replay head `4c44431c9769` 五檔已完成內容替代核對；主線保留隔離、checksum、history 與 cleanup contract，改善精確 rollback 與跨 collation table counts 比對。6/6 contracts PASS，未执行外部 migration。證據見 `branch-integration-staging-replay-supersession-20261004.json`，剩餘32個歷史head。

PayUni success/idempotency本機及遠端兩個head三檔內容已由master保留並強化，65/65 mock contracts PASS；API registry原98列皆保留。完整取捨及雜湊見 `branch-integration-payuni-idempotency-supersession-20261004.json`。未呼叫真實付款／退款。剩餘30個歷史head。

來源lineage及backup兩個head（`cd3571dd8184`、`f669d5b502ce`）已完成內容替代核對，40/40 contracts PASS；證據見 `branch-integration-staging-backup-lineage-supersession-20261004.json`。未執行外部DB、backup或付款操作，剩餘28個歷史head。

#354 最終候選23fcae98本機完整coverage已PASS：4,210 Vitest +1,063 Node contracts全數通過，statements64.78%、branches63.54%、functions68.28%、lines70.33%，global及src/lib門檻均通過。82 migrations fresh deploy與一次性container/temp cleanup PASS；遠端CI仍待結果。

原始120筆dirty清單重新與master逐檔比對：44檔內容已在master（僅正規化CRLF），62檔仍不同、12檔master不存在、2筆刪除／未雜湊。精確分類與hash見 `branch-integration-original-dirty-equivalence-20261004.json`；差異不代表全部都需覆蓋主線，下一輪仍須三方核對。原檔及狀態完整保留。

#211 補充核對：舊 `20260917093000_inventory_reservation_items_snapshot` SQL 與 master `20260922120000_inventory_reservation_items_snapshot` 完全同 bytes，不能重複套用。舊 landing-pages/layout.tsx 的 Puck CSS import 目前 src 尚未找到，列入下一個樣式交付段落（需實際browser驗證），詳見 `branch-integration-pr211-layout-migration-20261004.json`。

## #354 已實際合併（最終狀態）

#354 於 `2026-10-04T14:26:55Z` protected squash merge，master為 `42bce600e9c6b88003bd3b2a924d0ea96c70aee8`。PR CI `37207666809` 及push CI `37207662788` 全數成功，canonical gate READY、0 blockers；master tree `708da1b0e185a28ad31fe72e530ada363fa80541` 與已驗收head `23fcae9871cec124cdb940a339be806081d5f849` 完全一致。未降低測試、coverage或分支保護。#210/#211及28個歷史head與原dirty剩餘範圍仍進行中，Goal未標完成。

## #211 表單修復與樣式判斷更正

Puck 0.22 起由 useInjectUiCss 自動注入編輯器樣式；已查核安裝套件的實際呼叫，先前僅依 src 缺少 CSS import 判定未交付並不充分，撤回額外 import。LeadForm 的同步送出鎖確實未保留，現正補回並驗證 HTTP 失敗重試。保留較完整的現行 FormBuilder、伺服器可信 attribution 與防重複建檔，不套用舊版簡化介面或不可信 URL 歸因。

## #355 已實際合併

PR #355 的 head `24d9c7c76d6273329e2aff0b27ae9299da04d364` 已於 `2026-10-04T15:14:26Z` 經 protected squash merge，master 為 `c071b2d655b0d875fa9d616920c5a554d462dbe6`。PR CI `37210769933` 與 push CI `37210766776` 成功，canonical gate READY、0 blockers；master tree `d68ee61105387d56172e66b7425e58c31a96697d` 與驗收版本相同。交付表單防重送與重試、指定公開場次的 404 保護、管理者一頁式網站導覽，及上一批整合報告。

下一批已完整回收歷史 staging R2 binding attestation 的 4 檔，原 bytes 不變；合成契約 4/4 與 ESLint PASS，尚未呼叫外部 provider。#211 的 library/UI 九檔取捨與 50/50 targeted tests 見 branch-integration-pr211-library-decisions-20261004.json；staging target_url 原 leaf 意圖已有證據，但 eac0a343 全部分支仍未結案。原 120 筆 dirty 與 118 檔 hash 再次核對未變。

## Sandbox QA 共用層核對

19 個歷史 head 的六個共用路徑收斂為五個 runner 版本。已核對原付款／callback／query／timeout-cleanup 意圖、宣告結構、package scripts/dependencies 與 vNext policy 取代關係；付款及交接收據 33 個 Vitest tests PASS，沒有外部付款／退款。`.env.example` 只記錄 blob metadata，未讀內容。

現行正常 runner 成功時輸出 `PENDING_REFUND`，退款、資料庫狀態及冪等仍為 `pending-chrome`。已修正 QA 文件，不能以付款成功或逾時清理退款冒充完整 QA PASS。來源 `35d8f59341bc` 的 `refundThroughCelebrateDeal`、`waitForRefundPersistence`、`refundPersistencePassed`、`latestRefundableCheckout` 尚未遷移為新的固定 staging 交接消費流程；後續需驗證角色／CSRF、非 Production 綁定、單筆 processed RefundRecord 與重複退款拒絕。保留原分支，未將這 19 個 head 標成完整替代。詳見 branch-integration-sandbox-common-layer-20261004.json。


## #210 學員入口：整合前權限核對

來源 `b7956d80` 的登入、token、access route 與 dashboard 四檔已完成首輪資料邊界核對，完整來源雜湊與三項 findings 見 `branch-integration-pr210-student-portal-review-20261004.json`。尚未搬入產品程式，亦未完成整個學員入口的審查。

必須先修正：舊版用單筆訂單的 buyer support grant 換發同 Email 的整個學員 session，缺少信箱所有權驗證；整合版本應由購買完成頁導向登入，透過寄至信箱的一次性安全連結取得帳戶權限。另移除非 production action 直接回傳有效 mockLink 的分支，測試改用隔離的合成郵件收件器；token/session 補齊未來簽發時間及正值期限驗證。這些是來源靜態審查結果，不冒稱主線已暴露此入口，亦未操作真實付款或測試他人資料。

第一個完整交付段落包括信箱驗證登入、店家與學員範圍 dashboard、既有交付快照、諮詢／行事曆、優惠券及發票；新增 token model 必須以目前 migration tree 延伸，通過 disposable PostgreSQL 一次性 consume 併發測試、跨帳戶／跨店家測試及完整本機瀏覽器旅程，再經 Critical 獨立審查與新 head CI。原生課程單元／進度／證書、社群及多語／PWA 相依另外整合，不能先放入會導向不存在路由的連結。


## #356 已合併與下一段實作

#356 已於 `2026-10-04T15:41:06Z` 透過 protected squash merge 合入 `0f6cdbfa19e2bfe16c64513e85b0b4741d42f7a2`。PR CI `37212354565` 與 push CI `37212350358` 成功，canonical gate READY；master tree 與驗收 head 完全相同。來源 `860560079757` 的 parent 在 master，自身四檔 blob 全部相同，歷史待核對 28→27。未操作真實 R2。

學員入口已在 `codex/recover-student-portal-20261004` 開始恢復信箱登入與 dashboard；隔離副本的 16 個 auth/action 測試通過，實際整合初跑 31/32，尚需調整原生課程路由的階段契約、補 CSRF voucher POST、DB／browser／獨立 review 與 CI。這些是進行中狀態，不代表 #210 完成交付。


## 2026-10-05 學員入口整合驗證中

已完成信箱登入及現有交付／訂單學員中心候選。修正單筆 checkout grant 升權、開發 mockLink、行銷退訂封鎖登入信、過期信重送與 internal-origin redirect；優惠券須符合原生結帳、交付、庫存及幣別。DB 13 項、登入邊界 browser 2 項及郵件 32 項 targeted tests 通過，獨立 Critical review findings 已關閉。最終 coverage、完整新增 browser 與 protected PR gate 仍執行中，不標為已合併。原生課程播放器／進度／證書、社群、多語言與 PWA 保留原來源，未計入此里程碑完成範圍；PR210、PR211 及其餘 27 historical heads 繼續逐項整合。


## 2026-10-05 學員入口里程碑已合併

PR #357 已於 2026-10-04T16:40:44Z 受保護 squash merge 到 `361a37da2b487bbfa17f419d7b72b9306da07c99`；accepted tree 等於 merge tree。4,270 項測試、3 項 Chromium、83 migration、完整 coverage、獨立 Critical review 及精確 head CI 皆通過，canonical gate READY。原生播放器／學習進度／證書、社群、多語言與 PWA 尚未交付，保留來源並列後續；本節更新先前「驗證中」紀錄。整體仍有 27 組歷史分支內容及原始未提交工作需要核對，不宣稱全部整合完成。
