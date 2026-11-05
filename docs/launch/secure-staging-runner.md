# CelebrateDeal Secure Staging Runner

## 目的

此 runner 讓受保護的 GitHub Actions job 使用 staging database credential，完成
目前 RC staging DB `public` schema 的唯讀 migration history 查核與隔離 backup/restore。Secret 不會交給 Codex、寫入
repository、command arguments、log、receipt 或 artifact。

它不授權 Production、付款、退款、migration write、deployment、alias mutation、
資料刪除或任意 command。

## 信任邊界

Workflow 只有在以下條件全部成立時才會執行：

1. `.github/workflows/secure-staging-validation.yml` 已合併至受保護的預設分支
   `master`。
2. GitHub 回報該分支受保護（`github.ref_protected == true`）。
3. Job 綁定 GitHub Environment `Preview – celebrate-deal-staging`。
4. GitHub deployment receipt 唯一對應固定 source SHA `9193326824b8b6bf774bdfa28e4783a1a1b8f304`、Preview hostname、
   成功狀態與 non-Production environment。WP2 只做這道 lineage，不經 alias 自證（見下方「WP2 不經 alias 自證」）。
5. `STAGING_DATABASE_URL` 與 `NEXT_PUBLIC_SUPABASE_URL` 對應同一個 Supabase
   project identity。
6. 固定 task 為 `wp2-readonly-restore`。

Feature branch 無法透過修改 workflow 或 runner 取得 Secret。Trusted runner
只會從上述 exact source commit 讀取 migration SQL inventory，不會執行該 commit 的
產品程式或任意 script。

Migration manifest 的數量、名稱與 checksum 由該 commit 的 `prisma/migrations`
逐一讀取並核對；不預設 staging 已套用數量。已套用的 migration 必須是此 manifest
的有效子集，且不得有未解決失敗或未知 checksum。當資料庫尚未追平 manifest 時，
receipt 的 migration status 為 `BACKUP_READY_MIGRATIONS_PENDING`。此時整體
`PASS` 僅證明目前資料庫的備份、隔離還原及查核成功，不能當作 migration 完成驗收。

## GitHub Environment 設定

在 `Preview – celebrate-deal-staging` 設定：

- Secret：`STAGING_DATABASE_URL`
- Variable：`NEXT_PUBLIC_SUPABASE_URL`
- Variable：`STAGING_BACKUP_AGE_RECIPIENT`，獨立 staging age 公鑰；不得使用 repo 的 Production recipient。

Lineage 使用 workflow 的短效、唯讀 `GITHUB_TOKEN`，不需要 Vercel Token。

### Lineage 閘門只信任 `vercel[bot]` 的部署紀錄

`verifyDeployment()`（`scripts/secure-staging-runner.mjs`）是所有受保護 staging
workflow 注入 Secret 前共用的 lineage 閘門；`mvp-payuni-sandbox-e2e.mjs --verify-lineage`、
`staging-migration-apply.mjs` 與 `secure-staging-wp4-payuni.mjs` 都直接呼叫它，沒有自己的候選邏輯。

每個在 `master` 上綁定 `Preview – celebrate-deal-staging` environment 的 Actions job
（`scheduled-jobs.yml` 每次排程、heartbeat、`secure-staging-validation` 本身等）都會在
同一個 sha 下多建立一筆 GitHub deployment：creator 是 owner 帳號或
`github-actions[bot]`，payload 為 `{}`，status URL 指向 Actions run。這些紀錄不證明
Preview hostname 與 sha 的對應，而且會隨 sha 在 `master` 停留的時間累積。2026-11-02 實測
同一 sha 有 19 筆候選，只有 1 筆來自 Vercel；舊版每頁 10 筆、對每筆都讀 statuses，第二頁就耗盡
20 次讀取預算，六個受保護 workflow 全部 `GITHUB_DEPLOYMENT_READ_BUDGET_EXHAUSTED`。

因此閘門的規則是：

- 第一道：列表查詢同時帶 `sha=<source sha>`、`ref=<source sha>` 與
  `environment=Preview – celebrate-deal-staging`。2026-11-02 實測，`vercel[bot]` 建立的紀錄
  `ref` 都是完整 40 碼 commit sha（例如 id 7464859261 的 ref 是
  `6f3de05efc6fc1872778aa213ccf7cee2d7725fc`），Actions 建立的紀錄 `ref` 是 `master`，
  所以 Actions 紀錄根本不會被列出，heartbeat 或排程跑再多次也不影響這個閘門。
- 第二道（API 若忽略 `ref` 仍有效）：只有 `creator.login === "vercel[bot]"` 且
  `creator.type === "Bot"` 的候選才讀 statuses；其他候選不讀、不耗預算，也不計入候選數。
- 列表分頁一律走完（GitHub 由新到舊排序），每頁 100 筆（GitHub 上限）、上限 10 頁，即每個 sha 最多 1000 筆；
  超過回 `GITHUB_DEPLOYMENT_PAGE_LIMIT_EXHAUSTED`。最後一頁接受 GitHub 實際送出的
  `prev`/`first`（沒有 `next`/`last`）Link header，`prev` 必須正好是前一頁。
- 讀取預算 20 次 = 列表頁數 + Vercel 候選的 statuses 讀取。
- 原本的檢查全部保留：sha、environment、`production_environment === false`、最新
  status 為 `success`、host 與 `CELEBRATEDEAL_DEPLOYMENT_HOST` 完全相同、`.vercel.app`
  後綴與 `SAFE_HOST`，且必須剛好一筆符合（多於一筆仍為 `GITHUB_DEPLOYMENT_AMBIGUOUS`）。

錯誤碼：

| 錯誤碼 | 意義 |
|---|---|
| `GITHUB_DEPLOYMENT_NO_VERCEL_CANDIDATE` | 列表有紀錄，但沒有任何一筆是 `vercel[bot]`（Bot）建立；在 `ref` 過濾正常時只會出現在 ref 等於 sha 卻不是 Vercel 建立的紀錄，或 API 忽略了 `ref`。 |
| `GITHUB_DEPLOYMENT_AMBIGUOUS` | 完全沒有候選（含 `ref=<sha>` 查無紀錄，通常是 Vercel 尚未部署這個 sha 或 GitHub 整合中斷），或多於一筆 Vercel 紀錄同時符合 host。 |
| `GITHUB_DEPLOYMENT_LINEAGE_MISMATCH` | 有 Vercel 候選，但沒有一筆成功且 host 相符。 |
| `GITHUB_DEPLOYMENT_PAGE_LIMIT_EXHAUSTED` | 列表超過 10 頁（1000 筆）仍未結束。 |
| `GITHUB_DEPLOYMENT_READ_BUDGET_EXHAUSTED` | 列表頁數加 Vercel statuses 讀取超過 20 次。 |

## 固定 alias 自證（取代直連 Preview host）

### 為什麼 Preview host 不能直連

2026-11-03 實測：對 immutable Preview host（`celebrate-deal-staging-<hash>-a25814740s-projects.vercel.app`）
做 `HEAD /api/health`，Vercel 回 `403` 並帶 `X-Vercel-Mitigated: deny`。任何 `*.vercel.app` 預覽主機
都被 Vercel 防火牆擋下，固定 alias `celebrate-deal-staging.carry-digital-nomad.in.net` 則回 200。
lineage 閘門本身通過（GitHub 紀錄的 sha 與 host 都相符），但後續對 Preview host 的健康探測讓
secure-staging-validation 的 WP2／WP4／LINE task 與 funnel smoke 全部停在
`mvp_payuni_lineage=BLOCKED`（例如 run 41573026300）。另一條證明路徑 `--verify-alias` 用
`VERCEL_TOKEN` 查 alias 綁定，目前回 `ALIAS_PERMISSION_DENIED`（token 權限不足）。

### 新流程

`dispatch` 的輸入語意不變：`source_sha` 是完整 commit sha，`deployment_host` 是 GitHub 部署紀錄裡的
immutable Preview host。差別在於這個 host 現在只當 **lineage 比對的輸入**，不再被連線：

1. **Lineage 閘門**（`verifyDeployment()`，不變）：GitHub 部署紀錄（`vercel[bot]`）證明
   `source_sha` ↔ `deployment_host`。
2. **受保護 master 閘門**（`verifyShaOnProtectedMaster()`，共用函式）：GitHub compare API 確認
   `source_sha` 是受保護 `master` 本身或其祖先（不比對分支名稱，merge queue 的 commit 可通過）。
   任何接受 alias 自證的路徑都先過這一關；失敗回 `SOURCE_NOT_ON_PROTECTED_MASTER` 或
   `PROTECTED_MASTER_CHECK_FAILED`，alias 不會被探測。
3. **Alias 自證**（`verifyAliasAttestation()`）：對固定 alias `GET /api/health`（不跟隨 redirect、
   不帶任何認證），要求：
   - HTTP 200、`content-type: application/json`、`ok === true`、`database === "ok"`；
   - `content-length` 若存在不得超過 4096 bytes；body 以 stream 讀取，累計超過 4096 bytes 立即中止；
   - `deployment` 物件恰好有 `commitSha`、`deploymentId`、`vercelUrl` 三個欄位；
   - `deployment.commitSha === source_sha`；
   - `deployment.vercelUrl === deployment_host`（小寫比對）；
   - `deployment.deploymentId` 為 `null` 或 `dpl_…` 格式。GitHub 部署紀錄沒有 Vercel deployment id，
     所以 id 只檢查格式、不作比對依據；sha 與 host 兩者都必須相符。
4. 只有前三關都通過，WP4／LINE／funnel／browser 的實際請求才改打 alias（「操作用 host」）；
   lineage 比對仍用 Preview host。WP2 不經 alias 自證，見下方。

`/api/health` 的 `deployment` 只在 Preview（`VERCEL_ENV=preview`）填值；Production 與本機一律回 `null`。

任何失敗一律 fail closed，回固定錯誤碼：

| 錯誤碼 | 意義 |
|---|---|
| `SOURCE_NOT_ON_PROTECTED_MASTER` | sha 不是受保護 `master` 本身或祖先，不探測 alias。 |
| `PROTECTED_MASTER_CHECK_FAILED` | 缺唯讀 token、GitHub compare API 失敗或回應不可判讀。 |
| `ALIAS_ATTESTATION_INPUT_INVALID` | 預期 sha 或 Preview host 格式不對，未發出請求。 |
| `ALIAS_ATTESTATION_UNREACHABLE` | alias 連不上（DNS、TLS、逾時）。 |
| `ALIAS_ATTESTATION_REDIRECTED` | 回 3xx 或帶 `Location`。 |
| `ALIAS_ATTESTATION_HTTP_REJECTED` | 非 200（含 503 資料庫失敗、403 防火牆）。 |
| `ALIAS_ATTESTATION_RESPONSE_INVALID` | 非 JSON、`content-length` 或實際內容超過 4096 bytes、或不是物件。 |
| `ALIAS_ATTESTATION_FIELDS_MISSING` | 缺 `deployment` 或其欄位、欄位型別或格式不符、`ok`／`database` 不是健康狀態（舊部署沒有 `deployment` 也會落在這裡）。 |
| `ALIAS_ATTESTATION_SHA_MISMATCH` | alias 正在服務的部署 commit 與 `source_sha` 不同（例如 alias 尚未切到這次部署）。 |
| `ALIAS_ATTESTATION_HOST_MISMATCH` | alias 正在服務的部署 `VERCEL_URL` 與 `deployment_host` 不同。 |
| `ALIAS_ATTESTATION_FAILED` | 其他無法分類的自證失敗。 |

### 信任依據與限制

這條證明鏈的每一層：

1. **GitHub 部署紀錄**（`vercel[bot]`）：sha ↔ Preview host。
2. **受保護 master**：sha 已經過 PR 審查與 `quality` CI，合併到受保護分支。
3. **DNS（`carry-digital-nomad.in.net`）**：`celebrate-deal-staging.carry-digital-nomad.in.net` 解析到 Vercel。
   這一層由網域註冊商與 DNS zone 的控制權保障；能改這個 zone 的人可以把 alias 指到自己的伺服器，
   並以 ACME 取得合法 TLS 憑證，回應任意 `deployment` 欄位。runner 只靠 TLS 驗證主機名稱，無法區分。
   因此 DNS 與網域帳號屬於信任根，需與 Vercel、GitHub 帳號同等保護（雙因素、最小權限）。
4. **Vercel edge 路由**：alias 由 Vercel 路由到它目前指向的部署；回應由那個部署的程式產生。
5. **Vercel 注入的系統環境變數**：`VERCEL_GIT_COMMIT_SHA`、`VERCEL_URL`、`VERCEL_DEPLOYMENT_ID`
   不是 secret，請求者無法影響。`/api/health` 只輸出符合固定格式的值，其他一律 `null`，並帶
   `Cache-Control: no-store`。

**限制（請誠實看待）**：欄位是「alias 目前服務的部署」自己回報的。自證只擋得住「誠實但未審查」的部署
（例如 alias 還指著舊部署、或指到一個 feature branch 的 Preview：它們會誠實回報自己的 sha 而被拒）；
**擋不了偽造**：若 alias 被指到一個由惡意程式建置的部署，或 DNS 被接管，回應可以照抄目標 sha 與 host。
受保護 master 閘門保證「被要求證明的 sha」是審查過的，但無法保證「回應的部署」就是那個 sha 建出來的。

**長期方向**：修好 `VERCEL_TOKEN` 權限（能讀 `GET /v4/aliases/<alias>` 與 `GET /v13/deployments/<host>`），
讓 Vercel API 回到主要證明；alias 自證只作為 token 不可用時的退路。這是 owner 待辦：
`Preview – celebrate-deal-staging` environment 的 `VERCEL_TOKEN` 需換成有上述讀取權限的 token。

### 各 runner 的操作 host 與 master 檢查

| 入口 | lineage 比對 | 受保護 master 檢查 | alias 自證 | 實際請求 |
|---|---|---|---|---|
| `mvp-payuni-sandbox-e2e.mjs --verify-lineage`（所有 workflow 的閘門步驟，不分 surface） | Preview host | 有（`diagnoseMvpPayUniLineage`） | 閘門步驟內 | 不發業務請求 |
| `mvp-payuni-sandbox-e2e.mjs` 各執行旗標（WP4 付款、訂閱、payment-only、recovery、payment-check、callback-retry、continuation） | 前一個閘門步驟 | 由同一 job 的閘門步驟負責（相同的 immutable dispatch 輸入；執行步驟刻意不帶 `GITHUB_TOKEN`） | 每次執行前再自證一次（關閉 alias 被移動的時間窗）；失敗不寫 receipt、exit 2 | alias |
| `secure-staging-wp4-payuni.mjs`（reconciliation） | 同一行程內 | 有（`runParent`） | parent 自證後才啟動 child，並只把 alias 傳給 child | alias |
| `secure-staging-runner.mjs` `verifyDeploymentThroughAlias` | 同一行程內 | 有 | 有 | alias |
| `secure-staging-runner.mjs`（WP2，`runSecureTask`） | 同一行程內 | 不適用 | **不適用**（receipt 標 `aliasAttestation: "not_applicable"`） | 不發業務請求 |
| `secure-staging-line-notifications.mjs`（LINE） | 前一個閘門步驟 | 有（連資料庫之前；執行步驟帶唯讀 `GITHUB_TOKEN`） | 有（連資料庫之前） | alias |
| `staging-browser-smoke.mjs` `fixed_alias`、`staging-funnel-smoke.mjs` | 閘門步驟 | 有（閘門；`--verify-alias` 的退路也再查一次） | 閘門 + `--verify-alias` 退路 + 每次送憑證前 | alias |
| `staging-browser-smoke.mjs` `immutable_preview` | 閘門步驟 | 有（閘門） | 不適用（切換前模式，仍探測 Preview host） | Preview host |

PayUni 的 `NotifyURL`／`ReturnURL` 由部署的 `NEXT_PUBLIC_APP_URL` 組成，staging 的值就是 alias。
runner 的瀏覽器在 alias 自證通過後，以 alias 作為 origin，並等待導回 `https://<alias>/checkout/result`；
回呼重送（`/api/webhooks/payments?provider=payuni&source=notify`）也只送到 alias。

### WP2 不經 alias 自證

WP2（`wp2-readonly-restore`）不送任何業務請求，只讀 GitHub 部署紀錄與 staging 資料庫，所以不需要
「操作用 host」。原本對 Preview host 的健康探測改為**略過**：receipt 的 `lineage.healthStatus` 為 `null`、
`noRedirect` 為 `false`、`aliasAttestation` 為 `"not_applicable"`，`network.stagingPreview` 為 `false`，
WP2 的 egress 只放行 GitHub API 與資料庫。validator 對新 receipt 要求上述值，不能宣稱做過探測；
在這次變更之前產生、已保留的 receipt（沒有 `aliasAttestation` 欄位）仍以原本「Preview health 200」的形狀驗證，
備份回復流程不受影響。

**已知限制**：WP2 釘選的 RC `9193326824b8b6bf774bdfa28e4783a1a1b8f304` 不在現行 `master` 歷史中
（PR #277 head，squash 合併），所以它無法通過受保護 master 閘門，也無法做 alias 自證；它的 lineage
只靠 GitHub 部署紀錄。要讓 WP2 具備與其他 runner 同等的證明，需要另案換一個在 `master` 歷史中的新 RC。

### `--verify-alias` 的退路

`staging-browser-smoke.mjs --verify-alias` 先用 `VERCEL_TOKEN` 查 alias 綁定；這是**獨立**的證明，
由 Vercel 的 alias 紀錄回答。只有當結果是 `VERCEL_TOKEN_MISSING`、`ALIAS_AUTH_REJECTED`、
`ALIAS_PERMISSION_DENIED`、`DEPLOYMENT_AUTH_REJECTED` 或 `DEPLOYMENT_PERMISSION_DENIED`（token 無法讀取紀錄）時，
才退回受保護 master 檢查加 alias 自證。**這個退路和 `--verify-lineage` 步驟是同一道證明，不是第二道獨立證明**；
它只是在步驟之間再做一次，確認 alias 沒有被移動。兩者都失敗才 `NOT_VERIFIED`。

Vercel 明確回答不符（`ALIAS_DEPLOYMENT_MISMATCH`、`DEPLOYMENT_METADATA_INVALID`、`*_NOT_FOUND`、`*_API_ERROR` 等）
時不退回。輸出 JSON 帶 `method`（`VERCEL_API`／`SELF_ATTESTATION`／`NONE`）與 `vercelApi`（Vercel API 的原始結果碼）；
當 token 讀得到 alias 紀錄、但讀 deployment 被拒（`DEPLOYMENT_*_DENIED`／`DEPLOYMENT_AUTH_REJECTED`）時，
另帶已讀到的 `aliasDeploymentId`（`dpl_…`，非 secret），供事後以 Vercel 介面稽核 alias 當時指向的部署。
funnel 與 browser smoke 在執行期間的重新檢查走同一個邏輯。

### 合併後驗收（PR #542）

1. 確認 staging Vercel 專案（`celebrate-deal-staging`）的 **Settings → Environment Variables →
   「Automatically expose System Environment Variables」** 已開啟；沒開時 `VERCEL_GIT_COMMIT_SHA`、
   `VERCEL_URL` 讀不到，`/api/health` 的 `deployment` 全為 `null`，自證一律 `ALIAS_ATTESTATION_FIELDS_MISSING`。
2. 合併後由 owner 把 alias 指到 `master` 新 commit 的 Preview 部署（staging 現行流程）。舊部署沒有
   `deployment` 欄位，alias 切換前所有自證都會 BLOCKED。
3. 以唯讀 `GET https://celebrate-deal-staging.carry-digital-nomad.in.net/api/health` 確認 `deployment.commitSha`
   等於合併 commit、`deployment.vercelUrl` 等於該 Preview host；再確認正式站 `/api/health` 的 `deployment`
   三個欄位皆為 `null`。
4. 依序重跑 `staging-funnel-smoke`、`staging-browser-smoke`（`fixed_alias`）與 secure-staging-validation 的
   WP4 task，確認閘門輸出 `mvp_payuni_lineage=PASS; reason=VERIFIED`。

### #542 合併後首次執行的診斷（2026-11-03，部署 `cd901c3e`）

六個 workflow 的 lineage 與 alias 自證都 PASS；後續失敗都不是 alias 假設造成的：

| Run | 結果 | 根因 | 處理 |
|---|---|---|---|
| 41604147001 `wp4-payuni-sandbox-payment-only` | `PAYMENT_FIELDS_REJECTED` | 已過付款預約（server 端 `wp4PaymentSubmissionReserved` 已標記），在 PayUni Sandbox 頁面「選一次付清」之後、填卡號／到期日／CVV／Email 其中一欄時逾時。log 沒說是哪一欄，也無法區分欄位改名、改成 iframe，或其他原因。 | runner 現在會多印一行 `wp4_payuni_browser_diagnostic=step=<CARD_NUMBER/CARD_EXPIRY/CARD_CVV/EMAIL/...>; error=<TIMEOUT/...>; page=<PAYUNI_UPP/...>; mainFrameMatches=n; childFrames=n; childFrameMatches=n`，只有固定代碼與 0–9 的計數。 |
| 41604158597 `wp4-payuni-sandbox-reconciliation` | `PAYMENT_ATTEMPT_ALREADY_RESERVED`（只在 artifact） | 與 payment-only 同一個 `source_sha`、同時派送。兩者都是 `buyer_order`，每個 sha 只允許一次 PayUni 送出；payment-only 先預約，reconciliation 就被拒。這是設計，不是 bug。 | stdout 現在印出 `mvp_payuni_sandbox_e2e=BLOCKED; failure=<代碼>`（訂閱 task 也一樣）。 |
| 41604164926 `line-notifications-e2e` | `RECEIPT_FILE_MISSING; diagnostic=NONE` | `Preview – celebrate-deal-staging` environment 沒有任何 LINE 用的 secret／variable，step 停在 `require_database_binding`，沒有寫 receipt。 | step 先印 `secure_line_missing_bindings=<名稱>`（只有名稱）；validator 讀固定的 stage 檔，改印 `diagnostic=RUNNER_STAGE_<STAGE>`。 |
| 41604170566 `staging-funnel-smoke` | `BROWSER_EXECUTION_FAILED; stage=CREATE` | runner 的 selector 過時：#498 之後建立頁的網址欄是「一頁式網站網址 *」（舊：「Funnel 網址 *」），送出鈕是「建立」（舊：「儲存」）。 | 改用與 CI e2e（`tests/e2e/landing-page-flow.spec.ts`）相同的 label；失敗時多記 `failureStep`、`failureCategory`、`failurePage`。 |
| 41604176472 `staging-browser-smoke` | `BROWSER_EXECUTION_FAILED`（`HYDRATION_INTERACTION`/`TIMEOUT`/`product_edit`） | 已知的過時處：Dashboard 標題是「營運總覽」（舊：「Dashboard」），商品列表是「商品」（舊：「商品管理」），就算互動通過也會 `BROWSER_JOURNEY_FAILED`。商品編輯頁的交付方式互動在本機正式建置（實體商品、同一組 selector）四步都能通過，staging 上逾時的步驟仍未確定。 | 標題更新；改用 `select[name="fulfillmentType"]`（與 CI e2e 相同）；失敗時多記 `failureStep`（哪個等待）、`failurePath`（路由類別）與 `failureDom`（select 數、選中的固定選項、交付設定區塊數、是否出現全站錯誤頁）。 |

`scripts/staging-smoke-selectors.test.mjs`（由 `npm run test:contracts` 執行）會在 PR 改掉這些標題或 label 時直接失敗，不用等 staging 才發現。

**重新派送注意**

1. `cd901c3e` 的 buyer 交易已被 payment-only 預約，之後對同一個 sha 跑 payment-only 或 reconciliation 都會得到
   `PAYMENT_ATTEMPT_ALREADY_RESERVED`。需要合併新的 commit、讓 alias 指到新部署後，用新的 sha 重跑；
   每個 sha **只派送** payment-only 與 reconciliation 其中之一。
2. callback-retry、payment-check 等「既有交易」task 綁固定的歷史 sha，不受影響。
3. LINE 要等 owner 在 environment 補齊 secret 後再派送；否則只會得到 `secure_line_missing_bindings=...`。
4. browser smoke 與 funnel smoke 不會碰付款，可以先派送；失敗時看 artifact 的 `failureStep`／`failureDom`。

### #547 合併後重跑的診斷（2026-11-05，部署 `93f26e00`）

alias 自證 PASS，三個 workflow 都靠 #547 的診斷輸出縮小了範圍：

| Run | #547 診斷 | 根因判斷 | 處理（`ai/staging-smoke-round2`） |
|---|---|---|---|
| 42064913257 `staging-browser-smoke` | `failureStep=DELIVERY_GROUP_VISIBLE`、`failureDom.fulfillmentValue=digital`、`deliveryGroups=0` | **推斷**：商品編輯頁的「付款後交付設定」`<fieldset>`／`<legend>` 結構沒變（`getByRole("group", { name: "付款後交付設定" })` 仍對），但它只在 React state 變成非實體後才渲染。runner 用 `waitUntil: "domcontentloaded"` 開頁後立刻 `selectOption`，staging 遠端載入 JS 較慢，選項是在 hydration 之前改到 server HTML 上，change 事件沒進 React state，所以 select 顯示 digital、fieldset 卻沒出現。本機正式建置與 CI e2e 先填其他欄位才選交付方式，hydration 已完成，所以沒出現。 | 選取前先等 React 接手這個 select（`waitForFulfillmentHydration`：元素上出現 React 的 `__reactProps$` 屬性，最多 20 秒），新步驟 `FULFILLMENT_HYDRATED`；`failureDom` 多 `fulfillmentHydrated`（布林）與 `documentReadyState`（固定 enum）。另修正接在後面的導覽檢查仍在找舊標題「商品管理」（現為「商品」），否則互動通過後仍會 `BROWSER_JOURNEY_FAILED`。 |
| 42064920668 `staging-funnel-smoke` | `stage=PUBLISH`、`reason=PUBLISH_FAILED`、`failureStep=NONE` | **推斷（高可信）**：資料前置條件。smoke 建在「Staging Synthetic Project」（runner 以 `/projects/new` 建立，預設為草稿）底下的名單型網站，發布屬於「不需發布專案就公開」的獨立發布（#478／#482）。`vendorEmailVerificationState` 先找 email 等於商家 email（`wp4-synthetic-vendor-v1@invalid.example`）的使用者，fixture 沒有這個帳號，於是退回「任一 active owner 已驗證」；唯一的 owner `wp4_synthetic_owner_v1` 由 `src/lib/wp4-sandbox-fixture.ts` 建立時沒有 `emailVerifiedAt`，`20261025120000_user_email_verified_at` 也不回填，所以 `independentPublishAllowance` 回 `emailUnverified`，server 拒絕發布（#487）。舊 runner 在這條路徑是 `return` 而不是丟例外，所以沒有 `failureStep`。 | 發布前先開管理頁的「發布狀態：草稿」chip，讀 server 的公開網址診斷並只保留固定分類（`publishPreflight`）；若是資料前置條件就不按「發布」，直接以 `PUBLISH_BLOCKED_EMAIL_UNVERIFIED`／`PUBLISH_LIMIT_REACHED`／`PUBLISH_DISABLED_BY_PLATFORM`／`PUBLISH_BLOCKED_LIVE_REQUIRES_PROJECT` 結束。發布階段每個停止點都設 `failureStep`（`EDITOR_LEAVE`／`PUBLISH_PREFLIGHT`／`PUBLISH_BUTTON_ENABLED`／`PUBLISH_RESULT`）與 `failureCategory`（`CONDITION_NOT_MET`／`DATA_PRECONDITION`），另記 `publishOutcome` 與 `publishActionStatus`，stdout 多一行 `staging_funnel_publish=preflight=…; outcome=…; reason=…; failureStep=…`。 |
| 同上 | `operationsGetFailures=3`、`editorGetFailures=1`（`lastStatus=200`、`Finished=0`） | **推斷**：不是錯誤。這兩個計數只比對路徑，三個請求都收到 200 回應、沒有一個「finished」，符合 App Router 的 RSC 串流（導覽 fetch 或 Link prefetch）在離開頁面或被新導覽取代時被中止（`net::ERR_ABORTED`）。create、模板、編輯器都正常完成，與這個推斷一致。 | receipt 多 `operationsGetKinds`／`editorGetKinds`（`document`／`rsc`／`prefetch`／`other`）與 `operationsGetFailureKinds`／`editorGetFailureKinds`（`aborted`／`other`），下次 run 可直接確認。 |
| 42064928350 `wp4-payuni-sandbox-payment-only` | `step=CARD_NUMBER; error=TIMEOUT; page=PAYUNI_UPP; mainFrameMatches=0; childFrames=0` | **未確定**。「一次付清」與 `radioOptionpayGroupCredit` 都找得到，卡號 placeholder `16 碼或 19 碼` 在主頁與 iframe 都沒有。可能是 PayUni Sandbox UPP 改版（欄位改名／改 placeholder、需先點「信用卡」分頁），也可能是卡號欄位由 runner egress 擋掉的外部腳本渲染（WP4 egress 只放行 `sandbox-api`／`sandbox-vendor.payuni.com.tw`）。repo 與 PayUni 文件沒有新版 UPP 的欄位描述可以對照。 | 保留舊 placeholder 為第一選擇；逾時才退到標準 autofill 屬性（`cc-number`／`cc-exp`／`cc-csc`／`type=email`，必須恰好一個可見元素），卡號仍找不到時才點「信用卡」分頁（恰好一個可見元素才點，點完重新勾一次付清）再找。診斷行多 `fieldSource`、`creditTab` 與 `failed_payuniScript`／`failed_payuniOther`／`failed_externalScript`／`failed_externalOther`（PayUni 頁開啟後子資源失敗數）；另印一行 `wp4_payuni_page_structure=<JSON>`：每個 frame 的非 hidden `input`／`select`／`textarea` 的 `type`、`name`、`placeholder`、`aria-label`、`autocomplete` 與是否可見，以及可見按鈕／分頁／label 文字。 |

run 42077292610 的頁面結構證實 PayUni Sandbox UPP 的卡號 placeholder 已改為 `**** **** **** ****`（到期日 `MM/YY`、CVV `***` 不變，主框架無 iframe，也沒有 `cc-*` autocomplete），已更新 selector：新 placeholder 為主路徑、舊的 `16 碼或 19 碼` 保留為後備（診斷 `fieldSource=LEGACY_PLACEHOLDER`），所有 placeholder 比對一律 `exact`，避免 CVV 的 `***` 同時命中卡號欄。

**頁面結構摘要的去識別化規則**（`sanitizeStructureText`、`sanitizePayUniPageStructure`）：在頁面內只讀上述屬性，從不讀 `value`；hidden input 只計數；連結不讀 `href`。回到 Node 後每個字串再過白名單：Email 改成 `EMAIL`、URL（含 query）改成 `URL`、全形數字先轉半形、連續 3 位以上數字改成 `#`（卡號、CVV、金額、交易編號）、只留 ASCII 英數、少數標點與 CJK 字元，屬性值截斷到 40 字、按鈕文字 20 字，每個 frame 最多 25 個欄位與 25 個控制項、最多 4 個 frame。

這一輪只改 `scripts/staging-browser-smoke.mjs`、`scripts/staging-funnel-smoke.mjs`、`scripts/mvp-payuni-sandbox-e2e.mjs` 與測試；沒有動 `secure-staging-runner.mjs` 或任何 workflow，所以 `APPROVED_BACKUP_BLOBS` 不用重新登記。

**Owner／資料前置**

1. funnel smoke 要能發布，合成商家必須通過獨立發布條件，二選一：
   - 讓合成 owner（`wp4_synthetic_owner_v1`）的 `emailVerifiedAt` 有值。這個帳號用 `invalid.example` 網域，收不到驗證信，只能由 owner 決定是否在 staging 以受控的資料修正標記（不得用正式資料庫）；或
   - 讓「Staging Synthetic Project」成為已發布專案（專案內的網站不受 Email 驗證與上限限制），但專案發布需要可販售商品等前置條件。
2. 即使 Email 已驗證，smoke 每次都建立並發布一個新的名單型網站且不取消發布；免費商家最多同時 3 個，第 4 次起會得到 `PUBLISH_LIMIT_REACHED`。需要 owner 擇一：給合成商家有效付費方案或已驗證付款方式（解除上限）、定期在 staging 取消發布舊的 `staging-synthetic-*` 網站，或另案讓 smoke 在公開頁驗證後自行取消發布。
3. PayUni：下一次 payment-only 若仍失敗，先看 `wp4_payuni_page_structure` 找新版欄位名稱；若 `failed_externalScript`／`failed_payuniScript` 大於 0，代表欄位可能由被 egress 擋掉的腳本渲染，要另案在 `secure-staging-validation.yml` 放行對應主機（屆時才需要重新登記 workflow blob）。`payuni-issued-recovery-browser.mjs` 與 `payuni-sandbox-external-qa.mjs` 仍使用舊 placeholder，確認新版欄位後一起更新。

**重新派送注意**：`93f26e00` 的 buyer 交易已被這次 payment-only 預約，要合併本分支、讓 alias 指到新部署後用新 sha 重跑；每個 sha 仍只派送 payment-only 與 reconciliation 其中之一。browser smoke 與 funnel smoke 不碰付款，可先派送；funnel smoke 在資料前置完成前預期會停在 `PUBLISH_BLOCKED_EMAIL_UNVERIFIED`，這是正確的分類，不是新的失敗。

## 執行與網路邊界

依賴安裝、contract tests 與 PostgreSQL image pull 都在注入 Secret 前完成。
Secret-aware step 只允許連線：

- GitHub API（TCP 443）：部署紀錄、受保護 master 檢查
- 固定 staging alias `celebrate-deal-staging.carry-digital-nomad.in.net`（TCP 443），僅限 WP4／LINE 等會送
  業務請求的步驟；WP2 不放行任何應用主機。Preview host 不再列入 allowlist，因為任何 runner 都不會連它
  （Q1 步驟沿用原本同時列出兩者的 allowlist）
- staging Supabase database hostname 與指定 port（WP2、LINE）

Runner 的 IPv4/IPv6 OUTPUT policy 在 child process 執行期間為 fail-closed；來源 database
工具使用 host network，隔離 restore container 使用 `--network none`、tmpfs 與
一次性 ownership label。

來源 database 的第一個 transaction 是 `BEGIN READ ONLY`。允許的 staging 操作只有 SELECT 與 `pg_dump`；
所有 restore writes 只發生在 disposable PostgreSQL。

## Receipt

WP2 僅允許上傳這兩種固定檔案：

`$RUNNER_TEMP/celebratedeal-secure-receipts/wp2-readonly-restore-receipt.json`

`$RUNNER_TEMP/celebratedeal-secure-receipts/wp2-readonly-restore.dump.age`

Canonical validator 會拒絕 symlink、Runner temp 外路徑、額外 schema 欄位、URL、
credential、raw rows、raw dump、staging database writes 與超出 budget 的 side
effects。WP2 receipt 與加密 archive 的 artifact 都保留 30 天。

WP2 會在原始 dump 刪除前，以獨立 staging recipient 加密，驗證密文格式與
SHA-256，另將固定 `.dump.age` 檔上傳為 30 天的加密 artifact。密文上傳前會再次
核對固定路徑、receipt digest 與 age 格式；不會上傳原始 dump。receipt 的
`retention.recoverability` 固定為 `NOT_PROVEN`，`migrationAuthorization` 固定為
`BLOCKED`：公鑰加密與 artifact 上傳無法證明離線私鑰仍可解密。必須由授權持有者
下載密文、以對應私鑰離線解密並在隔離 PostgreSQL 實際還原、核對 checksum 和
資料摘要，另形成可審查的 recovery evidence，才可討論 staging migration。

原始 dump 只在這次 runner 的隔離暫存區存活，結束時會清除；PASS 證明當次
`public` schema 的邏輯備份可以還原到一次性 PostgreSQL，並留下加密備份。
真正套用 pending migration 前，仍須證明密文可由離線私鑰解密並重新還原，
不能只引用這份 receipt。

## 啟用順序

1. 透過 PR 將 workflow、runner、tests 與本文件合併到 `master`。
2. 沿用既有 `master` branch protection 與受保護 Preview Environment；既有
   staging DB／Supabase 綁定已由受保護 run 驗證，不要求重新提供。
3. 為此新 gate 確認有獨立的 `STAGING_BACKUP_AGE_RECIPIENT` 公鑰 Variable，
   且對應私鑰由授權持有者安全保管；不得把私鑰貼入 task 或 repository。
4. 確認可從既有受保護 Environment 注入上述 DB Secret 與公開 URL Variable，
   只記錄綁定檢查結果，不列舉或輸出值。
5. 從 `master` 執行 `Secure staging validation`，輸入固定 task、完整 source SHA
   與 exact Preview deployment hostname。
6. 檢視 sanitized receipt，核對加密 artifact 的 SHA-256；由授權持有者完成離線解密及還原證明。

新公鑰綁定未驗證或解密還原尚未實測時，保留備份 gate 不得成為 migration
授權。舊的隔離還原演練 [run 36059754159](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36059754159)
已通過，但當時會刪原始 dump，不能替代這份新密文的回復證據。

## 無 Secret 的本機驗證

```powershell
npm run secure:staging:contract
npm run secret:scan
```

`npm run secure:staging:wp2` 只保留給核准的 GitHub Environment runner，不得透過
`.env*`、`vercel env pull` 或 `vercel env run` 執行。
