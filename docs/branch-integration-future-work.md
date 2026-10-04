# 分支整合：未來處理與接手報告

日期：2026-10-04（Asia/Taipei）。狀態：**IN_PROGRESS / #351 已通過新 CI、canonical gate 並合入 master；五檔回收成果與本報告由 #352 接續交付**。

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
- #13 尚未保留的商品去重與名稱正規化已補成 [二檔 patch](branch-integration-pr13-preview-20261004.patch)；保留現行 API 與最多兩件的摘要行為，空白商品名改用「未命名商品」。新增三個案例，與表單測試共同 **39/39 PASS**，ESLint／apply check PASS。[manifest](branch-integration-pr13-preview-manifest-20261004.json) 保存主代理四面向審查與驗證限制；仍未合併。
- 權限恢復前的遠端確認以 `bdbae2f5` 為基準；恢復後已推送 #351 修正並建立 #352／#353，進度見下表。
- 修正補丁驗證方式：先前在儲存庫子目錄直接執行的 apply check 會跳過路徑，原結果無效。三份 patch 現已從 repo root 指定隔離目錄逐檔檢查，並實際套用到新的原始來源副本；9 個輸出檔的 SHA-256 全部與已測試候選相同。[實際套用證據](branch-integration-patch-application-proof-20261004.json) 取代舊 check 結論。產品修改與測試內容未因這項更正而改變。
- 分離 #118–#135 的原 PR delta 與功能分支底層：[逐 PR 範圍與檢查](branch-integration-feature-pr-deltas-20261004.json)。正確的 reverse-check 均為 `NO_PROOF`，不能據此推定已包含或缺少；另以內容核對確認 #118 預覽測試、#121 重設密碼寄送失敗保密、#135 checkout no-store 有主線對應行為。分支整體仍保留待審，詳見 [取捨紀錄](branch-integration-conflict-decisions-20261004.md)。
- 後續已完成 #118–#135 全部 18 個自身 delta 的內容核對，保留 master 的交易隔離、租戶／manager 範圍、可信 analytics、庫存補償與歸因防護。6 個 mock 測試檔 **452/452 PASS**；相關原始檔雜湊、`actions.test.ts` 的精確審核區塊與未執行項目均記錄於同一 JSON。共用底層殘餘集中為 6 個路徑，仍待一個 sandbox QA 批次處理，因此不虛減分支待審數。

## 寫入恢復後的發布進度

使用者調整權限並明確要求繼續後，本機 Git 與 GitHub 寫入已恢復；以下為新的實際操作。先前不能寫入的記錄僅描述當時環境，不再是目前 blocker。

| PR | 已推送 head | 已完成內容 | 尚待完成 |
| --- | --- | --- | --- |
| [#351](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/351) | `ff9f446751d37be64bf2cf423e2e7c055135e0ce` | 原四檔與新增 webhook 兩檔均完成獨立審查，131 個本機測試；PR 描述已更新 | 已完成：新 CI、gate READY、取消 Draft、protected merge |
| [#352](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/352) | 本次整合提交以 PR 即時 head 為準 | 三檔 Funnel 測試、#353 兩檔預覽修正、完整報告；已同步 master `40db1781` | 新 head CI、gate、protected squash merge |
| [#353](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/353) | `49e884ff6870793412534e1cb22fb19cfea76a4e` | 商品去重、名稱正規化及回歸測試已納入 #352 | #352 合併後核對兩檔完全相同，將本 PR 標記由 #352 交付 |

#352／#353 最初基於舊 master，CI 在 Production dependency audit 失敗。#351 已含 Next.js 16.3.5→16.3.8 更新且同項稽核通過，因此已透過正常 merge 同步其已審查版本，沒有降低稽核門檻。是否完全解決仍以新 head CI 為準。

合併時使用 expected-head，保留 master 分支保護與線性歷史要求，採 squash merge；`vercel.json` 的 master 自動部署仍為 false。沒有執行正式付款、probe、正式資料庫或部署。#210／#211 在剩餘功能核對完成前保留開啟，不用關閉 PR 取代實際整合。

原 518 個參照、351 個 PR、115 個 worktree 的盤點是發布前 snapshot；新增 #352／#353 不回填成原盤點已包含的資料。完成合併後另記錄 master 與 open PR 的即時狀態。

## 未完成批次

完整的逐 head 範圍、保留原因與驗收條件見 [未來批次明細](branch-integration-deferred-work-20261004.json)。除本輪發布及三個查詢替代段落外，仍有 42 個歷史 head：Funnel 5、AI Team 2、Sandbox QA 19、staging 15、早期 smoke 1。它們是待辦，並非已合併或已通過驗收。

| 優先級／批次 | 原始工作與目前成果 | 剩餘工作、依賴與驗收條件 |
| --- | --- | --- |
| P0：#351 發布 | head `ff9f4467`；兩項 MAJOR 與新增 webhook return 增量已完成獨立複審；新 CI run `37200997791` | 已通過新 head quality、canonical gate READY 並合併；正式付款、退款、migration 與 probe 執行仍未授權。 |
| P1：Token 到期資料 | #351，`src/lib/payment-providers/payuni.ts`；既有 callback 未保存官方 `CreditLife` | 核對官方 MMYY 語義與時區，解析並傳入 `expiresAt`，明確定義缺值／錯誤格式的保守行為。測試合法月份、跨年、非法月份、已到期 Token，以及發布／quota gate 不接受過期 reference。此次不以縮小現有安全驗證解決。 |
| P1：#211 測試段落發布 | #352 回收 3 檔、20 個測試；與 #353 預覽修正整合為一個五檔產品批次 | 同步 #351 合併後的 master，執行最新 head CI 與 gate，再以 protected PR 合併。 |
| P1：#210／#211 功能差異拆分 | #210 `b7956d80`、#211 `b5397dbb`、本機 `60132971`；主線已有 #219、#231–#240、#243–#253、#260、#263–#270 等拆分成果 | 以目前 master 為實作基準，核對 student portal、LINE rich menu、affiliate portal／分潤、成長工具與私訊等剩餘功能。舊分支相對 master 各有 216／199 個新增 src／migration 路徑，包含繼承內容，並非 #211 自己的新功能數或功能全數缺失的證明。按功能拆 PR，補齊租戶／角色／路由／資料約束及完整使用者流程，再驗收合併。 |
| P1：#211 編輯器的剩餘差異 | 已有 stack 三方分類與局部取捨矩陣；Funnel 建立、管理、public runtime、commerce、operations 與 editor 已有主線拆分 PR | 繼續核對其餘路徑；187 個未套用路徑有 177 個文件／歷史收據，不把舊收據搬成新 PASS。保留 master 最新 scope、CAS、可信價格、庫存 reservation、錯誤處理和效能改善。通過 editor→發布→匿名公開頁→mock checkout 的桌面／手機旅程；不能直接採舊分支的 migrations 覆蓋現行 migration tree。 |
| P1：主目錄未提交工程 | 原 `codex/one-stop-webinar-flow`，HEAD `60132971`；既有 AI Team vNext、Funnel、登入安全及驗證工具變更均留原位 | 每個功能先確認與 master／#351 是否重複，按 ownership 分開 checkpoint。AI Team 修改由主代理直接處理，不啟動正在修改的 AI Team 修改自己。登入與 Next.js 修改先讀相應本機文件；新增／變更測試、既有 CI 不得丟失。 |
| P2：歷史 PayUni／Staging 工作 | `codex/payuni-sandbox-external-qa`；#118–#135 自身 delta 已完成內容核對，共用底層殘餘 6 個路徑；其餘功能分支／診斷 PR 保留 | 先一次核對共用 QA runner／tests、文件、package 指令與已刪除舊 project 設定。`.env.example` 未讀取，不自動整合。再逐分支處理其餘 `remaining_paths`。保留新版 provider、reconciliation、歸因與隔離保護；不把舊收據冒充新候選驗證。 |
| P2：#13 預覽段落發布 | #353 已提交商品去重與名稱正規化；39 個本機測試通過；提交歷史已整合到 #352 的本機候選 | 隨 #352 最新 head 通過 CI、gate 後合併；保留原 #13 的追溯來源與現行 API，不還原舊預覽 UI。 |
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
