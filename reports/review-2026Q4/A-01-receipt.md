# A-01 回執：系統地圖盤點

- 執行者：A-01 唯讀盤點員（Sonnet）
- 起訖：2026-10-19 12:28:54 至約 12:48（實測起點到最後一次驗證 12:45:55 為 1021 秒，另加撰寫回執約 2 分鐘），總計約 19 分鐘
- 產出：`docs/review-2026Q4/01-system-map.md`（666 行）、本回執
- 修改既有檔案：無。唯一的寫入是新增上述兩個檔案，以及 `mkdir -p docs/review-2026Q4 reports/review-2026Q4`（目錄當時已被其他盤點員建立，無實質變化）。未執行任何 git 寫入操作；未讀取 `.env*`；未進入其他 worktree 目錄。

## 重要前提：工作目錄 HEAD 不包含審查基線

`git merge-base --is-ancestor review-baseline-2026Q4 HEAD` 結果為非祖先；`git rev-list --count review-baseline-2026Q4..HEAD` = 9，`HEAD..review-baseline-2026Q4` = 15。任務書說「工作目錄 HEAD 已包含該基線」與實際不符。處置：以 `git archive review-baseline-2026Q4 src prisma scripts .github package.json vercel.json vercel.staging.json tsconfig.json vitest.config.ts next.config.ts` 匯出到 scratchpad 的 `base/`（只讀操作，3 秒），之後所有統計都對該副本執行。`docs/`、`tests/`、`ops/`、`.claude/` 的數字改用 `git ls-tree` 直接讀基線。

任務書的概估數字與基線實測不同：route.ts 約 116 → 實測 122（api 下 102）；lib 623 檔 → 實測 684（非測試 347）。工作目錄 HEAD 的數字則為 route 117、lib 641、page 140，與基線也不同。

## 執行過的命令（依序，摘要；路徑變數 `B` = 基線匯出副本，`S` = scratchpad）

環境與基線確認
1. `git rev-parse --short HEAD`、`git rev-parse --short review-baseline-2026Q4`、`ls`、`ls docs`
2. `git merge-base --is-ancestor review-baseline-2026Q4 HEAD`；`git rev-list --count A..B`（兩個方向）；`git log --oneline -3 review-baseline-2026Q4`；`git worktree list`（僅檢視，未進入任何其他 worktree）
3. `git diff --stat review-baseline-2026Q4 HEAD -- src prisma package.json vercel.json vercel.staging.json .github scripts`（用於確認兩者差異，264 檔）
4. `git archive review-baseline-2026Q4 <paths> | tar -x -C $S/base`

路由與 API（第 1、2 節）
5. `find $B/src/app -name page.tsx / layout.tsx / route.ts | wc -l`；`find … -name error.tsx|loading.tsx|not-found.tsx|global-error.tsx`
6. 以 `sed`＋`awk` 依第一層目錄彙總 page 數；`ls src/app`、`ls src/app/@checkout/*`、`ls src/app/(viewer)`
7. 針對每個 route.ts 的迴圈：`grep -oE 'export (async )?function (GET|POST|…)'` 取 method、`grep -oE 'from "@/lib/…"'` 取依賴 lib、`wc -l` 取行數 → `route_methods.txt`
8. 針對每個 route.ts 的 grep 啟發式（`requireJobSecret|CRON_SECRET|getCurrentAuth|requireFinanceAdmin|requireMerchantApiActor|requireSameOriginRequest|verifyCsrfToken|checkRateLimit|signature…`）→ `route_guards.txt`（跑兩輪，第二輪擴充關鍵字後剩 10 條未偵測到）
9. 抽查閱讀：`wp4-refund/route.ts`、`q1-original-callback-retry/route.ts`、`proxy.ts` 前 50 行、`r/[code]/route.ts`、`api/live-admission`、`api/live-media`、`api/live-purchase-broadcasts`、`api/automation/vouchers/redeem`、`api/checkout/upsell`、`api/stream-usage`、`api/orders/shipping`、`api/affiliate-attribution/direct-entry`、`api/analytics`、`api/webhooks/payuni-live-probe`、`admin/billing/payouts/[id]/csv`、`api/billing/plans/select`、`api/media/images/presign`、`api/team-funnel/template-actions`、`api/funnel/operations/reports` 的頭 10–60 行（檢視授權模式，非完整審查）
10. `grep -rlE "^['\"]use server['\"]" src`（排除測試）→ 46 檔；對每檔 `grep -oE '^export (async )?function …'` 取 exported 名稱（183 個）；`grep -ciE` 對金額／佣金／退款／權限關鍵字做計數；`awk` 計算 `actions.ts` 各 export 的區段行數
11. 閱讀 `actions.ts` 的 `refundPaymentTransactionAction` 前 40 行、`src/lib/auth.ts` 的 export 清單、`product-server-actions.ts`、`product-actions.ts` 的 export

src/lib 分群（第 3 節）
12. `find src/lib -mindepth 1 -type d`、`find src/lib -maxdepth 1 -type f`、非測試／測試計數
13. Python 腳本（`$S/libgroups.py`，`python -I`）：依檔名前綴 regex 分 15 群，掃描 `src` 下所有非測試 `.ts/.tsx` 的 `from "@/lib/…"`／`import("@/lib/…")` 計算 app／components／lib 引用數

分群 regex（依序匹配，第一個命中者為準）：
- payuni：`^(payuni|payment-providers/|wp4-|q1-|provider-|staging-qa|preview-)`
- payment：`^(payment|checkout|commerce|platform-payment|platform-plan|platform-subscription|webhook-retry|inventory|reconciliation|post-purchase|billing|invoice|taiwan|bank|payout|usage-est)`
- affiliate：`^(affiliate|course-commission|course-payout|course-policy|merchant-affiliate|platform-referral|referral|registration-attribution)`
- line：`^(line-|learner-)`
- tracking：`^(tracking|client-analytics|product-analytics|analytics|landing-page-attribution|stream-usage-attr)`
- live：`^(live-|interaction|scripted|presenter|public-interaction|sellable-live|post-live|form-submission-chat)`
- form：`^(registration|form-submission|public-registration)`
- funnel：`^(funnel|landing-page|public-landing|team-funnel|ab-testing|ai-funnel|rich-text|public-policy|referral-share)`
- course：`^(course|student|customer|consultation|mobile-consultation|evergreen|product-delivery|product-)`
- auth：`^(auth|mfa|password|csrf|rate-limit|api-security|merchant-api|request-|sensitive|redaction|http-request|blacklist|external-url|visitor)`
- tenant：`^(sales-|vendor-|merchant-onboarding|dashboard|announcement|support-case|buyer-support)`
- email：`^(email|message-template)`
- cloudflare：`^(cloudflare|media-|image-assets|r2-|stream-|live-media)`（因順序在 live 之後，`live-media-*` 實際歸入 live 群）
- platform core：`^(db|env|database|audit|monitoring|sentry|app-url|format|zoned|e2e|automation|funnel-)`

Prisma（第 4 節）
14. `grep -cE '^model ' / '^enum '`、`wc -l prisma/schema.prisma`、`ls prisma/migrations`、`git ls-tree -d --name-only review-baseline-2026Q4 prisma/migrations/`、`git ls-tree -r --name-only … | grep -E 'migrations_sqlite_archive|dev\.db'`
15. `git ls-files prisma/dev.db`、`git check-ignore -v prisma/dev.db`、`ls -la prisma/dev.db`、`head -c 15 prisma/dev.db | od -c`（只讀檔頭 magic，確認為 SQLite）
16. `awk` 依欄位名稱統計各 model 的金額相關欄位數；對 `git show review-baseline-2026Q4:docs/codex-goal/PRISMA_INVARIANTS.md` 逐一 grep 148 個 model 名稱

背景作業、環境變數、CI（第 5–8 節）
17. `cat vercel.json vercel.staging.json`（基線副本）；`ls .github/workflows`；對 25 個 workflow 以 Python 擷取 `on:`／job 名稱／`cron`；`grep -l schedule`；`sed -n` 檢視 `ci.yml`、`payuni-live-probe.yml`、`staging-issued-trade-recovery.yml` 前段；`grep -n 'environment:' .github/workflows/*.yml`
18. `git grep -nE "api/(jobs|cron)/" review-baseline-2026Q4 -- docs ops supabase config README.md`；`git log --oneline -5 review-baseline-2026Q4 -- vercel.json`；閱讀 `scheduler-config.test.ts` 的 `crons` 斷言
19. 環境變數：`grep -rhoE 'process\.env\.[A-Z0-9_]+'`、`grep -oE '^  [A-Z][A-Z0-9_]+:' src/lib/env.ts`（schema key 34 個）、`grep -rhoE '(env|Env|ENV)(\?)?\.[A-Z][A-Z0-9_]+'` 於 86 個含 env 讀取的檔案、`sed -n 1,40p scripts/preflight.ts`、對 `META_TRACKING_*`／`BANK_ACCOUNT_KEYRING_*`／`TWILIO`／`WHATSAPP` 等逐一確認讀取方式（只列出名稱與所在檔案，沒有輸出任何值）
20. 外部服務：`grep -rhoE 'https://[a-zA-Z0-9._-]+\.[a-z]{2,}' src`（非測試）取外部主機、`grep -rniE tiktok src`、`grep -rn "api.cloudflare.com|r2.cloudflarestorage|api.resend.com|graph.facebook" src`
21. `package.json`：`node -e` 讀取依賴數、scripts 分群與指令；`ls scripts` 副檔名與前綴統計

規模指標（第 9 節）
22. `find src -name '*.ts' -o -name '*.tsx' | wc -l`、test／db test／非測試計數、`find … -print0 | xargs -0 cat | wc -l`（總／非測試行數）、`find src/components`、`grep -rlE "^['\"]use client['\"]"`、`find prisma/migrations -name migration.sql … | wc -l`、`git ls-tree -r --name-only review-baseline-2026Q4 tests|docs`、`git ls-tree --name-only … | grep -c '^playwright|^vitest'`、`git rev-list --count`、`find src … | xargs wc -l | sort -rn`

文件組裝
23. 以 Write 工具撰寫 `part3.md`、`part4.md`，以 Bash `cat part1..4 > docs/review-2026Q4/01-system-map.md`；之後 `sed` 修正兩處數字（admin payuni ops 22 條、環境變數合計 82）並以 Python 比對 env 清單與文件一致。

## 花費時間

約 19 分鐘，其中最久的是：(a) 發現基線與 HEAD 分歧並改走 `git archive` 重做統計（約 4 分鐘重工）；(b) 環境變數清單的雜訊過濾（約 3 分鐘）；(c) 文件撰寫（約 7 分鐘）。

## 遇到的問題

- Bash 工具在參數含括號的 `echo` 與含中文＋特殊引號的長 heredoc 時兩次解析失敗（沒有副作用，重試後改用 Write 工具寫入長文字）。
- 第一次對工作目錄統計（route 117、lib 641、page 140）後才發現基線分歧，這批數字已全部丟棄，文件內使用的都是基線副本的數字。

## 未能完成或僅部分完成的項目

1. **每條 route 的「用途」**是依路徑、匯入的 lib 與檔頭註解推斷的一句話，沒有逐條通讀實作；`team-funnel/*`、`live-presenter`、`dashboard/details` 等推斷程度較高。
2. **「防護」欄是 grep 啟發式**，不是授權正確性結論；10 條 route 在 route 檔內看不到防護，已在文件內列名，需 Critical 審查逐條確認。
3. **Server Action 的風險標記**依函式名稱與檔內關鍵字計數，沒有逐一讀完 183 個函式；`mutateProduct` 等被呼叫但非 `"use server"` 的核心函式只列出了檔案層級。
4. **lib 分群為前綴 regex 啟發式**，少數檔案歸類可商榷（例如 `analytics-funnel.ts`、`automation-workflow.ts`）；「引用次數」是 import 語句行數，未計算同檔多處使用，也未納入 `scripts/`、`tests/` 的引用。
5. **cron 實際排程無法確認**：repo 內找不到驅動 `/api/cron/*`、`/api/jobs/*` 的排程（`vercel.json` 無 `crons`、`vercel.staging.json` 為空陣列、workflow 無 `schedule`）。是否在 Vercel 專案設定或外部排程器，必須由 owner 確認；我沒有也不應該呼叫 Vercel MCP 去查（超出任務唯讀範圍）。
6. **環境變數**只涵蓋 `src` 與 `scripts/preflight.ts`；`scripts/` 其餘 400 多個檔案內的環境變數、`tests/`、`playwright*.config.ts` 未掃描。`process.env[變數]` 這類動態讀取只靠人工補入（發現 `BANK_ACCOUNT_KEYRING_JSON`），可能仍有遺漏。
7. **mermaid 圖未經渲染驗證**（環境中沒有 mermaid CLI），僅依語法規則人工檢查。
8. 台灣電子發票是否有實際供應商 API 呼叫、LINE／Meta 的實際傳輸細節、Cloudflare R2 與 Stream 的完整呼叫面，只確認到主機名稱與 lib 檔層級，未深入。
9. 未跑任何測試、typecheck、lint、build（本任務為唯讀盤點，沒有也不該執行）。
