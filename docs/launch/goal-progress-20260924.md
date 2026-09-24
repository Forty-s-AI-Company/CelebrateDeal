# CelebrateDeal Goal 執行紀錄

開始：2026-09-24 19:07（Asia/Taipei）。Codex thread Goal status：active；專案舊 `CELEBRATEDEAL-M2-M7` state 仍為 IN_PROGRESS，最後更新在 9 月初，本輪沒有覆寫。Plan 的四小時上限為 23:07；Codex usage 工具所示重置時間為 21:26，若按重置前交接，預留 15 分鐘的交接點為 21:11。此時間資訊不代表 Goal 已完成或自動暫停。

## Checkpoint 1：來源與 Git

- `codex/launch-integration-20260924` 由當時最新 master `a476ce34abdbb93d67b89a1abffa40496e1fdc0d` 建立，原 dirty 工作目錄未修改或清除。
- master CI run `35674751757` success；PR #210/#211 均衝突；PR #210 對 master 的唯讀 merge preview 有 376 個衝突路徑。差異矩陣見 [Git inventory](integration-inventory-20260924.md)。
- commit `0194e001`：建立現況入口、下一輪清單、Plan/審查紀錄與 Git inventory。文件相對連結檢查無缺失，staged diff check 通過。
- 當時建立 draft PR [#274](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/274)；本紀錄後段另記最終合併結果。

## Checkpoint 2：Funnel 缺陷與候選驗證

- commit `dc9940d9`：名單感謝頁改為明確顯示資料送出結果；增加商品 commerce 綁定在一般編輯與版型切換的回歸測試。舊分支的相同修正已核對 master 尚缺，master 原有編輯器已正確區分一般編輯與換版型，故沒有重複移植該元件。
- `npx vitest run src/lib/funnel-goal-step-pages.test.ts src/lib/funnel-step-pages.test.ts`：13/13 PASS。
- 三個變更檔的 ESLint：PASS；`npm run typecheck`：PASS；`git diff --cached --check`：PASS。`npx prisma generate`：PASS。這些只覆蓋這個候選切片，不證明完整產品功能。
- AI Team route recommendation：requested/effective `ai-team-pro`，selected `gpt-6-luna` high，review plan 空；實際主對話模型/effort無可觀測 receipt，observed=unknown。此處僅記路由，不冒充已 dispatch 子代理。

## Checkpoint 3：Preview 與環境

- staging 專案的新 immutable Preview `dpl_5Wn3sJCexuft3YYqJ2u5hd3uB3Nd` 已 READY；Vercel list 對應 `dc9940d90296af46e3919078e381f652a167cbc2`。首頁及 `/api/health` GET 均 200。指定 staging alias 尚指舊部署 `dpl_Dtp88X6L4iD7a6fWAKXFfqLycp6N`。
- 透過 Vercel Preview process environment 注入指定欄位執行只輸出布林的本地 attestation；沒有列舉 Secret Store、沒有輸出值或 raw log。結果：`sandbox=true`、`merchantBindingPresent=true`、`databaseKeysPresent=false`、`supabasePublicPresent=false`、`appHostExpected=false`。因此 `dbRefsSame` 與 `publicRefMatchesDb` 也未成立。
- 這是 staging 操作 blocker：未證明 Auth/DB/Storage與付款 callback 均指向固定非 Production 資源。暫不執行登入/上傳/checkout mutation，不切 alias；新 Preview 的 HTTP 200 不是核心功能通過。

## Checkpoint 4：AI Team 與非 Production 執行規則（候選）

- 從原工作區的已盤點差異移植 canonical router、thin adapters、CLI fallback、驗收 gate、handoff 與文件；原工作區未清理。CI 僅加入已存在的 AI Team 測試，沒有把尚未整合的學生入口、LINE rich menu 等測試清單一起帶入。
- 固定非 Production 的 smoke 與 PayUni Sandbox runner 移除逐次 owner token；仍保留精確環境／host 限制、Sandbox preflight、獨立 provider 執行開關及遮罩化輸出。退役舊 validator 的程式與 CI step，更新 runbook。正式部署、資料與付款的授權邊界不變。
- Python `unittest discover` 41/41 PASS；AI Team routing、resilience、handoff、bootstrap、tracked snapshot PowerShell checks PASS；外部 smoke safety 14/14、PayUni Sandbox QA 30/30 PASS；`npm run typecheck` PASS；`npm run lint` PASS（既有 3 個 `<img>` warning）。首次以 `node --test` 執行 Vitest 檔案屬 runner 選錯，改用 `npx vitest run` 後 30/30 PASS。未執行外部 Sandbox 交易，因 staging 綁定仍未證明。

## Checkpoint 5：核心路徑與瀏覽器回歸（進行中）

- Auth、checkout admission／idempotency、commerce order／checkout、PayUni provider 與 payment routes 的 8 個 Vitest 檔案，195/195 PASS。
- 租戶帳本的 4 個 DB tests 首次因本機 `celebratedeal_test` 不存在而未通過；建立固定 disposable PostgreSQL DB、套用 79 份既有 migration 後，4/4 PASS。這是測試環境準備缺口，不是產品斷言失敗。
- 舊候選 CI 的 browser gate 在 `tests/e2e/landing-page-flow.spec.ts` 超時。隔離本機 production-mode browser 重現時，完整旅程已走到公開感謝頁，但舊測試標題與新文案不一致；已更新文案斷言，並對此完整旅程設定 90 秒時限。同一條本機旅程重跑 1/1 PASS（測試執行 4.9 秒，含重新建置總約 2.5 分鐘）。最新 GitHub `quality` 仍待完成。
- 獨立唯讀 reviewer 對 runner 的非 Production host 邊界提出 2 個 MAJOR：external smoke 只比較同源的 target/expected host，PayUni Sandbox QA 允許環境值覆寫已知正式 host。已在兩個 runner 加入固定 staging/project host 限制，補上正式 host 被自我宣告為 staging 仍拒絕的回歸測試；HTTP smoke 不跟隨 redirect，Sandbox 瀏覽器在 checkout 前再次確認仍在 staging origin。兩份目標 Vitest 46/46、五檔 ESLint 與 typecheck PASS。獨立 reviewer 對固定 host 修正複核後無剩餘 finding；後補的 redirect/origin 防護有目標測試，仍待新版 CI 驗證。

## Checkpoint 6：候選 CI、受保護合併與最新版 Preview

- `235b496a442c18139d581db59c3b41d5eb61687f` 的 GitHub `quality` run `35995602557` 與 `35995607497` 均 success；包括 lint、typecheck、coverage、LINE、Node contracts、PostgreSQL concurrency、完整 Playwright、build 與 preflight。Windows 本機 `test:contracts` 960/963；3 個歷史檔案 hash 因工作樹 CRLF 換行不同而失敗，原始 Git blob 的 12/12 evidence hashes 與 canonical hash 相符，Linux CI 同一契約 PASS。
- PR #274 經 repository 允許的 squash merge 合入 master `0f1fc3e84b524edd46bb1a6946b852cf9ef74742`。原先 merge-commit 方式被 repository 規則拒絕，未繞過保護；合併後 master 與受驗候選 Git tree 均為 `43838a811345cf7e2c0b4a8490f85b0907ccac10`。master 自身 CI run `35998114044` 已啟動，尚待最終結果。
- 新 immutable Preview `celebrate-deal-staging-falb4yfd5-a25814740s-projects.vercel.app` READY，對應合併前候選 SHA；首頁、`/api/health`、`/login` 均 200。Preview process environment 的指定欄位布林檢查仍是 PayUni Sandbox／merchant binding present，但 DB keys、Supabase public URL、預期 app host 不成立。指定 staging alias 仍指 9 月 3 日舊 deployment；新 Preview 的 200 不等於登入、資料寫入或 Sandbox 訂單成功。

## 下一步與 handoff

- 確認 master [run `35998114044`](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/35998114044) 的最終結果，不能把候選 CI 結果充作新 SHA 的獨立執行。PR #210/#211 尚有衝突及獨有功能，依 [下一輪清單](NEXT-CYCLE.md) 按功能、Auth/tenant/schema 風險處置，不直接合舊樹。
- staging Preview 必須透過核准的平台 Secret provider 補齊固定非 Production 的 DB／Supabase／公開 host 綁定，重新部署 master 對應 SHA、驗證 lineage 與主要操作，再切指定 alias；目前不得把 HTTP 200 或 PayUni Sandbox env flag 升級為核心／金流 PASS。不讀 `.env*`、不輸出值或 raw log。
- requested/effective team=`ai-team-pro`；Plan Opus `INVALID_REVIEW`／scratch path failure 後由獨立 Sol xhigh 唯讀複審。產品 runner 有一次 reviewer helper 唯讀 dispatch，2 個 MAJOR 經修正與複核；實際 observed model／effort 無 receipt 記為 unknown。ownership：主代理單一 writer；helper dispatch 1/4，depth 1/1。下一步：master CI 結果、staging 非 Production 綁定與實際 Sandbox 成功訂單證據；Goal acceptance 尚未成立。
