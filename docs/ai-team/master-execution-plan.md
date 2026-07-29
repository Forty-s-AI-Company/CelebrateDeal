# CelebrateDeal 滾動式 Master Execution Plan

PLAN_STATUS：READY_FOR_TERRA
PLAN_VERSION：1
PLANNED_AT：2026-07-29T01:59:43+08:00
SOURCE_INPUT：docs/ai-team/master-planning-input.md
CURRENT_BASELINE_COMMIT：c9fb0822e7bb883bcc197e1b26328592492466d6
FIRST_MILESTONE：M1
FIRST_MILESTONE_WP_COUNT：2
FIRST_EXECUTABLE_WP：M1-PLANNING-COMMIT
RECOMMENDED_EXECUTOR_MODEL：gpt-5.6-terra／High
USER_AUTHORIZATION_REQUIRED_TO_START：NO
PRODUCTION_ACCESS_REQUIRED：NO
SELF_HASH_CANONICAL_SHA256：4E11CC82ABE8B74D9A47D07C6BAD70171397A44A636D8AF4C859D68F93FBC24D

> 本文件是 living plan。M1 詳細規劃；M2、M3 保留中等粒度；更後面的工作只保留方向與候選 Work Package。每個 Milestone 完成後必須停止，由 Sol 依最新程式碼、Git 與 canonical evidence 重新校準。

## 1. Executive summary

CelebrateDeal 目前第一優先仍是關閉 WP-08 的本機 deterministic evidence。最新 canonical evidence 已比部分 launch 文件更新：

- run `20260728170501031` 後來產生的 final summary 證明 Browser E2E 為 `39 passed／0 failed`。
- `wp08_*`、`wp17_*`、`wp18_*` 三組 disposable schemas 的 bootstrap、13 migrations deploy/status 與 marker-gated cleanup 均通過。
- WP-17／WP-18 coverage owner bridge 已存在於 runner，但該次 run 在 coverage 前因 lint 失敗，因此 WP-08 尚未取得同一次 `119 files／939 passed／0 failed／0 skipped` 的 coverage closure。
- lint 直接根因是 runner 將 `TEMP`／`TMP`／`HOME` 與 Playwright transform cache 放在 snapshot source tree 內，導致 ESLint 掃描生成的 CommonJS cache。
- pre-run／post-run source manifest 唯一差異為 runner 執行期間遭更新的 ignored `.ai-team/state/goal-state.json`；control-plane state 不應混入產品 source-integrity manifest，而且 runner 執行期間也不得更新。

M1 依序執行：

1. `M1-PLANNING-COMMIT`：先獨立提交兩份規劃文件。
2. `WP-22`：修正 runner runtime isolation，保留 coverage owner bridge，執行一次完整 WP-08 canonical run。
3. `WP-23`：只在 WP-22 全部通過後，整理 launch evidence 與關閉 WP-08。

本計畫不授權 M2、正式環境、正式資料、正式 Secret、部署或外部付費操作。

## 2. Current verified baseline

### 2.1 Repository baseline

- Branch：`chore/ai-team-v5.1-migration`
- HEAD：`c9fb0822e7bb883bcc197e1b26328592492466d6`
- staged files：0
- Current readiness：Automatable `57/100`；Full Commercial Launch `45/100`
- 現行 PostgreSQL migrations：13
- 最新 WP-08 Browser：39 passed／0 failed
- 最新 WP-08 coverage：未在同一次修正後 runner 執行；舊 run 為 937 passed／2 skipped
- WP-19 verified coverage：119 files／939 passed／0 failed／0 skipped

### 2.2 Dirty inventory ownership

本表是 Terra 啟動前的 fail-closed ownership baseline。寫入本文件後共 11 個 dirty paths；所有 ownership 均已明確，沒有 `UNKNOWN`，也沒有無法安全分離的 mixed hunks。

| 相對路徑 | Git 狀態 | 目前 diff 摘要 | Ownership | 預計處理單位 | WP-22 可修改 | WP-23 可修改 | Terra 必須保持不動 | Mixed hunks | Baseline SHA-256 |
|---|---|---|---|---|---|---|---|---|---|
| `docs/launch/current-snapshot-regression-baseline.md` | tracked modified | 新增歷史 WP-08 38/1 follow-up | HISTORICAL_WP08 | WP-23 | NO | YES | WP-22 期間 YES | NO | `BF4871E2CB7BE325E4FFE011D3A0CC7C59824C2DA2CD89EDF6F11A464A471B5C` |
| `docs/launch/evidence-index.md` | tracked modified | 新增歷史 WP-08 receipts 與 38/1 結論 | HISTORICAL_WP08 | WP-23 | NO | YES | WP-22 期間 YES | NO | `7445BF8B42FACEA2C2A96E920D076B3C81C554D7D8745F7D03644DE93CA80122` |
| `docs/launch/manual-blockers.md` | tracked modified | 新增歷史 password-reset blocker | HISTORICAL_WP08 | WP-23 | NO | YES | WP-22 期間 YES | NO | `780AFA1A3E0DC8DEA2E8377005FEDEAC00C5ECDF728A36B391ACA0291B6E084D` |
| `docs/launch/next-work-packages.md` | tracked modified | WP-08 從舊待辦改為 38/1 rework | HISTORICAL_WP08 | WP-23 | NO | YES | WP-22 期間 YES | NO | `FE9495356490F15A96FEB69703DDF0E391749D44E028BE6FDF9DCCAD153B4AFC` |
| `docs/launch/production-readiness-baseline.md` | tracked modified | 新增歷史 WP-08 38/1 readiness 說明 | HISTORICAL_WP08 | WP-23 | NO | YES | WP-22 期間 YES | NO | `FD554032804984176303517EB37EB676E696C65EB93F45E9CE934E4A3D861BEE` |
| `docs/launch/tool-blockers.md` | tracked modified | 新增 TB-18 Chromium cache closure | HISTORICAL_WP08 | WP-23 | NO | YES | WP-22 期間 YES | NO | `3E06F190C087A926C478358F585C95291AF951F15BA79C6ECF31EB8C9853BA47` |
| `tests/e2e/smoke.spec.ts` | tracked modified | 公開 commerce test 新增 trace 與 screenshot | PUBLIC_COMMERCE | WP-22 僅採納既有 hunk | NO | NO | 除精確 stage 外 YES | NO；兩個 hunk 屬同一 artifact gate | `85F369DA012D4CB1098F8E0D2B95D5A01E92860D7C640231F48A7B6DD3B42AF8` |
| `.ai-team/scripts/Invoke-Wp08ProductBrowserQa.ps1` | untracked | 344 行 WP-08 isolated runner 與三 schema bridge | WP-22 | WP-22 | YES | NO | WP-23 期間 YES | NO | `7A96E82F57DC11610992A43A14CD584E7FF865E6469684ED9B31D02E3353FF7D` |
| `docs/ai-team/master-planning-input.md` | untracked | Sol 全站事實盤點與規劃輸入 | MASTER_PLANNING_INPUT | M1-PLANNING-COMMIT | NO | NO | planning commit 後 YES | NO；整份為單一 planner artifact | `4FC8DD1DB569B276122E174EF922482A082A7315D90EF18A9A781F387CB1F1D1` |
| `docs/launch/wp08-product-browser-qa-20260728.md` | untracked | 歷史 WP-08 38/1 evidence 報告 | HISTORICAL_WP08 | WP-23 | NO | YES | WP-22 期間 YES | NO | `319AB1A9B4F383182DB4541CF65DF0923B1A4A248B554018345ABE1325A41651` |
| `docs/ai-team/master-execution-plan.md` | untracked | 本 rolling Master Plan | MASTER_PLAN | M1-PLANNING-COMMIT；後續 checkpoint | checkpoint only | checkpoint only | full runner 期間 YES | NO；整份為單一 planner artifact | 見 Header `SELF_HASH_CANONICAL_SHA256` |

`SELF_HASH_CANONICAL_SHA256` 的算法：以 UTF-8 讀取本檔，先將 Header 的整行值正規化為 `SELF_HASH_CANONICAL_SHA256：SELF_HASH`，再計算 SHA-256。這避免文件將自身 hash 寫入自身造成循環。

### 2.3 Ownership fail-closed 規則

- Terra 開始前必須重新計算 11 個 paths 的 Git 狀態與 SHA-256。
- planning commit 後，`master-planning-input.md` 與 `master-execution-plan.md` 應由 untracked 轉成 tracked clean；其餘 inventory 不得漂移。
- 新增未知 path、staged change、hash 不符或出現無法安全分離的 hunk，一律停止。
- 不得以 restore、checkout、reset、clean 或 stash 讓 inventory 看起來符合。

## 3. Removed／merged／superseded WP

- `WP-16-GR-01`：已被 WP-16 Git 工作樹歸零 closure supersede，只保留歷史 evidence。
- `WP-01`：淘汰為獨立 Work Package；改成實際需要 AGY 時才執行的 time-of-use preflight。
- `WP-02`：移出產品 critical path；TB-04 保留為 non-blocking tooling issue，本機 Playwright runner 是目前 canonical fallback。
- `WP-03`＋`WP-11`：合併為延後的 Git checkpoint hygiene 工作，必須另取得人工授權。
- `WP-06`：本機 candidate remediation 已由 WP-12、WP-13、WP-14 關閉；只保留需人工授權的正式 legacy data／backup／rollback review。
- `WP-10`：拆到 M4～M6，不再用一個 WP 同時承載 Supabase、PayUni、observability、DNS、法務與營運。
- `WP-20`：COMPLETE，不重開。
- `WP-21`：保留為 coverage bridge integration 的歷史 remediation；最新 runtime-isolation blocker交由 WP-22。
- `WP-08`：仍是原始 closure target；Browser-only PASS 或 remediation PASS 都不能取代完整 all-gate closure。

## 4. Dependency graph

```mermaid
flowchart LR
  PLAN["M1-PLANNING-COMMIT"] --> WP22["WP-22 runner isolation與完整重驗"]
  WP19["WP-19 coverage owner contract"] --> WP22
  WP20["WP-20 password-reset remediation"] --> WP22
  WP21["WP-21 runner candidate"] --> WP22
  WP22 --> WP23["WP-23 WP-08 evidence closure"]
  WP23 --> SOL1["Sol recalibration"]
  SOL1 --> M2["M2 security與權限"]
  SOL1 --> M3["M3 data／migration readiness"]
  M2 --> M4["M4 external commercial sandbox"]
  M3 --> M4
  M4 --> M5["M5 release reliability"]
  M5 --> M6["M6 commercial launch"]
```

## 5. Milestone roadmap

| Milestone | 名稱 | 商業／技術目的 | 包含 WP | 依賴順序 | 平行性 | 完整 integration gate | Readiness 預期影響 | Sol 重校準 | 人工授權點 | 停止條件 |
|---|---|---|---|---|---|---|---|---|---|---|
| M1 | WP-08 deterministic local closure | 建立可信的本機 Browser、coverage、quality與cleanup同次證據 | WP-22、WP-23；前置planning commit | planning commit → WP-22 → WP-23 | 不可平行 | 同一runner全綠＋文件一致 | 允許重評類別2、6、7、8；不自動加分 | YES | 無額外授權 | M1完成、任一安全／測試／Git停止條件 |
| M2 | Security與authorization residuals | 重建WP-07未覆蓋候選與tenant權限證據 | 待Sol切片 | M1後 | 唯讀盤點可平行；寫入仍單一Worker | auth matrix、DB contract、targeted Browser | Automatable可能提升 | YES | 外部ACL另授權 | 產品決策、正式ACL或scope擴張 |
| M3 | Data、migration、backup／rollback readiness | 將WP-06殘項轉為非正式rehearsal與授權式legacy review | 待Sol切片 | M1後；WP-12～14已完成 | disposable rehearsal可與M2概念平行 | backup／restore／rollback receipts | 資料完整性類別可能提升 | YES | 任何正式資料盤點 | 正式DB、legacy mapping或破壞性操作 |
| M4 | External commercial sandbox | 分別驗證Supabase ACL、PayUni sandbox與observability | 待Sol切片 | M2＋M3 | 各外部gate概念獨立；寫入不平行 | sandbox、idempotency、delivery receipts | Commercial readiness可能提升 | YES | Secret、帳號、sandbox服務 | 付費、正式金流、正式Secret |
| M5 | Release、deployment與reliability | 部署／rollback rehearsal、telemetry與screen-reader | 候選 | M4 | 人工檢查可分流 | rollback rehearsal、delivery、人工journey | Release／UX類別可能提升 | YES | 部署與外部dashboard | 正式部署或不可逆操作 |
| M6 | Commercial operations | DNS、法務、客服與商家onboarding | 候選 | M5 | 人工owner可分工 | signed manual checklist | Full Commercial Launch最終判定 | YES | 全部為人工gate | 任一owner未簽核 |

## 6. Detailed first Milestone — M1

### 6.1 Milestone contract

- Milestone ID：M1
- 名稱：WP-08 deterministic local closure
- 商業／技術目的：補齊可信的 app-level Browser 與完整 coverage evidence，消除過時 launch 摘要。
- 包含 WP：WP-22、WP-23；另有非 WP 的 `M1-PLANNING-COMMIT`。
- 依賴順序：planning commit → WP-22 → WP-23。
- 可平行項目：無。
- 完整 integration gate：WP-22 同次 full runner 全部通過；WP-23 receipts與launch文件一致。
- Readiness 預期影響：只提供 Sol 重評依據；Terra 不直接提高 57／45。
- 完成後 Sol 重校準：YES。
- 人工授權點：M1 三筆本機 commit 已由使用者明確授權；沒有其他授權。
- 正式環境：禁止。
- 停止條件：M1完成即停止；不得自動進入M2。

### 6.2 M1-PLANNING-COMMIT（非 WP）

目的：在任何 WP-22 修改前，先建立乾淨、可恢復的規劃基線。

唯一可 stage 路徑：

- `docs/ai-team/master-planning-input.md`
- `docs/ai-team/master-execution-plan.md`

Commit：

```text
docs(ai-team): add rolling master execution plan
```

Gate：

1. staged 起始為空。
2. planning input SHA-256 必須等於 inventory baseline。
3. 兩份規劃文件不得有 mixed hunks。
4. `git diff --cached --name-only` 必須恰好等於兩個 allowlisted paths。
5. staged diff review、`git diff --cached --check`、secret scan通過。
6. commit成功後重新確認其餘9個dirty paths與hash均未變。

任一條件不符就停止，不得開始 WP-22。

### 6.3 WP-22 — WP-08 runner runtime isolation與完整重驗

**WP ID**：WP-22
**名稱**：WP-08 runner runtime isolation與完整重驗
**優先級**：P0
**目的**：保留已存在的WP-17／WP-18 owner bridge，排除runner runtime自我污染，完成WP-08同次all-gate closure。
**依賴**：M1 planning commit、WP-19、WP-20、WP-21 candidate、loopback PostgreSQL與本機Chromium。
**目前證據**：run `20260728170501031` 的Browser為39/0，三schema migrate／cleanup PASS；lint掃描snapshot內Playwright transform cache而FAIL；coverage未執行。
**Root cause**：runner把TEMP／TMP／HOME／cache放在snapshot source tree；manifest另錯納ignored Goal state。
**預估時間**：60～90分鐘。
**風險等級**：MEDIUM-HIGH。
**建議模型**：gpt-5.6-terra／High。
**需要人工授權**：NO；使用者已授權精確本機commit。
**涉及正式環境**：NO。
**涉及 migration**：YES，但只允許既有13 migrations在三個loopback marker-gated disposable schemas執行deploy/status；不建立或修改migration。

#### 精確修改範圍

允許實際修改：

- `.ai-team/scripts/Invoke-Wp08ProductBrowserQa.ps1`
- `docs/ai-team/master-execution-plan.md`：只能在post-run manifest建立後更新execution checkpoint。
- `.ai-team/state/goal-state.json`：ignored checkpoint，只能在post-run後更新，不stage。
- `.ai-team/logs/goal-progress.md`：ignored progress，只能在post-run後更新，不stage。

`tests/e2e/smoke.spec.ts` 的預設是**不得修改**。WP-22只可在hash仍等於 `85F369DA012D4CB1098F8E0D2B95D5A01E92860D7C640231F48A7B6DD3B42AF8`，且diff恰好只有下列PUBLIC_COMMERCE hunks時採納並精確stage：

- 約第1142行：test callback加入`testInfo`，並啟動`page.context().tracing.start({ screenshots: true, snapshots: true, sources: false })`。
- 約第1154～1155行：建立`wp08-public-commerce.png`與`wp08-public-commerce-trace.zip`。

來源：歷史WP-08 public commerce artifact gate。
採納理由：runner明確要求這兩個public-only artifacts，且最新39/0 Browser evidence已包含此hunk。
安全邊界：不得加入其他test修改；若hash或hunk漂移，從WP-22 commit排除並停止，不得restore、覆寫或丟棄。

#### 不處理範圍

- 任何產品程式碼。
- protected DB tests。
- `vitest.synthetic-db-coverage.config.ts`。
- Prisma schema、migration、model。
- package scripts或lockfile。
- coverage threshold、assertion、skip／exclude。
- 任何launch文件內容。
- readiness重新計分。

#### 實作步驟

1. 重驗branch、HEAD、staged=0、planning commit與剩餘inventory hashes。
2. 將runtime root移至snapshot的run-specific安全sibling。
3. TEMP、TMP、HOME、USERPROFILE、npm cache、Playwright transform cache不得位於snapshot source tree。
4. runtime root建立marker、嚴格驗證絕對路徑，finally中marker-gated cleanup。
5. source manifest改用Git tracked files加明確allowlisted untracked source，不再以全樹遍歷後過濾。
6. snapshot與manifest排除`.env*`、`.private`、Goal state、logs、reports、receipts、snapshot、runtime、TEMP、TMP、HOME、cache及ignored generated artifacts。
7. 保留六個coverage bridge variables、三schema identity與synthetic coverage config invocation。
8. 完成修改與targeted static gates後建立pre-run manifest。
9. full runner期間禁止更新Master Plan、Goal state或任何control-plane source。
10. runner結束後立即建立post-run manifest並比較。
11. 只有pre-run與post-run manifest完全相同，才可更新checkpoint與進入commit。

#### Source manifest contract

- 合法WP-22修改發生在pre-run manifest之前；不得比較修改前與修改後manifest。
- pre-run與post-run inventory必須相同且hash byte-identical。
- Git tracked files全部納入，但依安全規則排除`.env*`、`.private`與control-plane/generated paths。
- allowlisted untracked source只允許目前runner與仍待WP-23處理的WP-08 evidence文件；任何新增untracked path停止。
- runner不得把generated files寫入產品source tree。

#### Targeted tests

- PowerShell parser PASS。
- runner runtime root、marker與cleanup靜態契約 PASS。
- owner bridge、三schema identity、config invocation靜態契約 PASS。
- `.env*`／`.private`／control-plane exclusion契約 PASS。
- `npm run secret:scan` PASS。
- runner與smoke精確diff review PASS。
- `git diff --check` PASS。

#### Coverage fixed gate

目前固定 expected discovery count：

- 119 files
- 939 passed
- 0 failed
- 0 skipped

依據：

- WP-19 canonical run `20260728213657260` 已取得119／939／0／0。
- 後續WP-08舊coverage取得937 passed＋2 skipped，總discovery仍為939。
- WP-22不允許修改test inventory，因此可把119／939作固定gate。

若count改變，視為source drift並停止；不得降低threshold、動態接受較少測試、排除test或新增skip。

#### Integration gates

- npm ci：PASS
- secret scan：PASS
- Prisma validate／generate：PASS
- wp08／wp17／wp18 bootstrap：PASS
- 三schema 13 migrations deploy/status：PASS
- Playwright discovery：exactly 39
- Browser E2E：39 passed／0 failed／0 skipped
- lint：PASS
- typecheck：PASS
- strict-index：PASS
- coverage：119 files／939 passed／0 failed／0 skipped
- global與`src/lib` thresholds：維持既有值且PASS
- public-only screenshot與trace：恰好兩份
- external side-effect scan：PASS
- 三schema cleanup：PASS
- snapshot與runtime cleanup：PASS
- source Git與pre/post manifest：unchanged

#### 完成條件

全部targeted tests與integration gates通過；sanitized receipts完整；source未污染；Git ownership安全。

#### Commit 邊界

Commit：

```text
test(qa): isolate wp08 runner runtime
```

可stage：

- `.ai-team/scripts/Invoke-Wp08ProductBrowserQa.ps1`
- `tests/e2e/smoke.spec.ts`的兩個既有PUBLIC_COMMERCE hunks
- `docs/ai-team/master-execution-plan.md`的WP-22 checkpoint

不得stageGoal state、logs、reports、receipts或任何launch文件。

#### Rollback

不在M1中自動rollback已提交commit。若後續需要回復，由獨立授權的recovery Task使用`git revert <WP-22 commit>`；不得reset／checkout。執行中資源只由marker-gated cleanup移除。

#### Checkpoint要求

記錄root cause、修改檔案、run ID、receipt hashes、test matrix、commit hash、remaining dirty inventory與未解風險。

#### 可自動進入下一WP的條件

- WP-22全部gate PASS。
- commit成功。
- staged重新為空。
- Git狀態只剩WP-23 allowlist文件。
- 沒有未知path、mixed hunks或hash漂移。

#### 必須停止的條件

- 任一產品gate FAIL。
- coverage出現failed、skipped或count漂移。
- cleanup不完整。
- 需修改產品、test、Vitest config、Prisma或package files。
- smoke hash／hunk不符。
- source manifest漂移。
- 第二次相同失敗、必要工具阻擋或scope超出WP-22。

### 6.4 WP-23 — WP-08 closure與launch evidence reconciliation

**WP ID**：WP-23
**名稱**：WP-08 closure與launch evidence reconciliation
**優先級**：P0
**目的**：以WP-22 canonical receipts關閉原始WP-08，消除38/1、coverage skip與pre-snapshot歷史敘述衝突。
**依賴**：WP-22 COMPLETE且commit成功。
**目前證據**：現有launch文件仍停在歷史38/1或較早blocker。
**Root cause**：canonical receipts的更新時間晚於部分launch摘要。
**預估時間**：30～60分鐘。
**風險等級**：LOW。
**建議模型**：gpt-5.6-terra／High。
**需要人工授權**：NO；使用者已授權精確本機commit。
**涉及正式環境**：NO。
**涉及 migration**：NO。

#### 精確修改檔案

版本控制文件：

- `docs/ai-team/master-execution-plan.md`
- `docs/launch/current-snapshot-regression-baseline.md`
- `docs/launch/evidence-index.md`
- `docs/launch/manual-blockers.md`
- `docs/launch/next-work-packages.md`
- `docs/launch/production-readiness-baseline.md`
- `docs/launch/tool-blockers.md`
- `docs/launch/wp08-product-browser-qa-20260728.md`

ignored control-plane checkpoint；允許修改但不得stage：

- `.ai-team/state/goal-state.json`
- `.ai-team/logs/goal-progress.md`

#### 必須保持不動

- `.ai-team/scripts/Invoke-Wp08ProductBrowserQa.ps1`
- `tests/e2e/smoke.spec.ts`
- `docs/ai-team/master-planning-input.md`
- 全部產品、test、Prisma、migration、Vitest與package files

#### 實作步驟

1. 解析WP-22 final summary與receipt hashes。
2. 驗證所有必要gate、source manifest與cleanup都是PASS。
3. WP-08標記COMPLETE；WP-21保留歷史；WP-22標記COMPLETE。
4. 逐一更新8個allowlisted版本控制文件。
5. 移除過時現況敘述，但保留清楚標示為歷史的38/1 evidence。
6. readiness維持57／45，註明待Sol重新計分。
7. 更新Goal checkpoint與Master Plan execution record。

#### Targeted tests

- JSON receipts可解析。
- 必要gate matrix全部PASS。
- Master Plan必要章節與引用路徑存在。
- 8個文件對WP-08／21／22狀態一致。
- `npm run secret:scan` PASS。
- `git diff --check` PASS。

#### Integration gate

- 不再把38/1或pre-snapshot failure描述成最新狀態。
- 不宣稱正式、sandbox、部署或商業上線通過。
- readiness未由Terra自行增加。
- staged diff恰好是WP-23 allowlist。

#### 完成條件

文件、Goal checkpoint、Master Plan與receipts一致；commit成功；staged為空。

#### Commit邊界

```text
docs(launch): close wp08 deterministic evidence
```

只stage上述8個版本控制文件；Goal state與logs不得stage。

#### Rollback

由另行授權的recovery Task使用`git revert <WP-23 commit>`；不影響WP-22程式commit與既有receipts。

#### Checkpoint要求

記錄WP-08 final verdict、WP-22／23 commits、receipt hashes、Git狀態、readiness未重算原因與交回Sol的下一步。

#### 可自動進入下一WP的條件

無。WP-23完成即代表M1完成，必須停止。

#### 必須停止的條件

- receipts不完整或任一gate不是PASS。
- 文件需要超出allowlist。
- readiness需要產品owner決策。
- Git ownership／mixed hunks不安全。
- M1完成。

## 7. Later Milestone outlines

### M2 — Security與authorization residuals

- 先由Sol重建剩餘security candidates的canonical inventory。
- 依auth、tenant authorization、public endpoints切成30～90分鐘WP。
- 不預先假設舊「52 candidates」仍完整或仍適用。
- Supabase正式ACL不納入自動WP。

### M3 — Data、migration、backup／rollback readiness

- 將WP-06剩餘工作重新命名為legacy data與rollback readiness。
- 先做loopback disposable backup／restore／rollback rehearsal。
- 正式legacy rows只允許在獨立人工授權WP盤點與mapping。

### M4 — External commercial sandbox

- Supabase ACL、PayUni sandbox、observability各自獨立WP。
- 每個外部服務各有Secret、帳號、付費與side-effect授權邊界。

### M5 — Release、deployment與reliability

- 部署與rollback rehearsal、telemetry delivery、screen-reader journey分開驗收。
- 不把本機build或Browser結果外推成正式部署PASS。

### M6 — Commercial operations

- DNS、法務、客服、商家onboarding由人工owner簽核。
- 最終Commercial Launch verdict只能建立在完整signed checklist。

## 8. Terra execution protocol

本次使用者明確授權M1長程Goal在同一Terra Task中完成planning commit、WP-22與WP-23。這是M1限定的直接執行契約；不得延伸到M2。

每完成一個WP，Terra必須：

1. 執行targeted tests。
2. 執行必要integration gate。
3. 建立sanitized evidence。
4. 精確stage該WP檔案或hunk。
5. staged diff review、diff check與secret scan。
6. 建立獨立commit。
7. 更新WP狀態。
8. 寫入checkpoint。
9. 更新Master Plan execution record。
10. 確認Git可安全進入下一WP。
11. 只選同一M1中的下一個READY單位。

不得：

- `git add .`
- `git add -A`
- `git commit -a`
- 混合不同WP
- 跳過失敗測試
- 降低assertion或threshold
- 偽造evidence
- 因Gemini QA失敗偽造deterministic gate失敗
- 自動跨越人工授權點或M1邊界

## 9. Test strategy

- M1-PLANNING-COMMIT：文件、staged allowlist、secret與diff gates。
- WP-22：runner targeted static gates＋一次canonical full runner。
- WP-23：receipt解析、文件一致性、reference、secret與diff gates；不重跑產品測試。
- Gemini Fast不是M1必要gate；若呼叫失敗，標記`TOOL_BLOCKED`且不掩蓋deterministic結果。
- 任何未執行gate不得標PASS。

## 10. Git and commit protocol

使用者只授權以下三筆本機commit：

1. `docs(ai-team): add rolling master execution plan`
2. `test(qa): isolate wp08 runner runtime`
3. `docs(launch): close wp08 deterministic evidence`

明確未授權：

- push
- merge
- rebase
- amend
- reset
- clean
- stash
- 部署
- 正式環境／資料／Secret
- M2或後續Milestone

每筆commit前必須：

1. staged起始為空。
2. 精確stage allowlisted paths／hunks。
3. `git diff --cached --name-status`符合commit邊界。
4. review完整cached diff。
5. `git diff --cached --check` PASS。
6. secret scan PASS。

## 11. Evidence and checkpoint protocol

- Raw logs、reports、receipts留在ignored位置，不得stage。
- Sanitized receipt不得包含URL credentials、Token、Cookie、Secret、正式資料或付款資料。
- 每個checkpoint記錄root cause、files、tests、receipts、commit、Git狀態與剩餘風險。
- runner執行期間禁止更新Goal state、Master Plan或progress log。
- 只有post-run manifest完成後才可更新control-plane checkpoint。
- Master Plan execution record至少包含開始時間、完成時間、commit、run ID、結果與下一步。

## 12. Stop and escalation conditions

Terra遇到以下任一情況必須停止：

1. 需要使用者授權或產品決策。
2. 需要正式Secret、正式DB或正式服務。
3. 需要部署、付費或破壞性操作。
4. root cause與Master Plan明顯不一致。
5. 修改範圍需要跨越WP邊界。
6. 出現安全、權限、金流或資料遺失風險。
7. 必要測試環境或工具阻擋。
8. Git ownership不明或存在無法安全分離的mixed hunks。
9. 同一WP經一次修復與一次允許重試後仍無法通過。
10. M1完成，需要Sol重新校準。
11. Master Plan過時或依賴順序失效。
12. Token、時間或上下文不足以安全繼續。

以下狀況不必停止整個Goal：

- 可在同一WP scope修復的lint或typecheck問題。
- 明確、小範圍且不降低assertion的test query bug。
- 可原樣重試一次的deterministic transient failure。
- 非必要Gemini QA `TOOL_BLOCKED`。
- 不影響後續WP的文件小錯誤。

## 13. Readiness scoring policy

- 目前Automatable Readiness維持`57/100`。
- Full Commercial Launch維持`45/100`。
- Terra不得因單一WP直接加分。
- M1完成後，Sol依最新evidence重評類別2、6、7、8。
- External、production、screen-reader、legal與operations未通過前，不提高Full Commercial Launch結論。

## 14. Recovery and resume instructions

中斷後：

1. 讀取Master Plan最後execution record、Goal state、Git log與status。
2. 驗證已完成commit與receipt hashes。
3. 已通過且hash一致的gate不重跑。
4. planning commit不存在時，從`M1-PLANNING-COMMIT`恢復。
5. WP-22尚未commit時，從其preflight與ownership驗證恢復。
6. WP-22已commit但WP-23未完成時，只執行WP-23。
7. hash漂移、未知path或scope失效時停止交回Sol。
8. 不使用reset、checkout、clean或stash恢復。

## 15. Known unknowns

- WP-17／WP-18 coverage bridge已配置且三schema migration成功，但WP-08 coverage gate尚未在修正後runner真正執行。
- run `20260728170501031` 的final summary晚於failure receipt；部分文件因此過時。
- 外部服務、正式資料、部署與商業gate仍為未驗證，不由本機結果推論。
- Git long-path checkpoint問題延後處理，不阻擋M1。
- M2後的candidate數量與實際優先級必須在M1完成後由Sol重新盤點。

## 16. Plan change log

| Version | 日期 | 變更 |
|---|---|---|
| 1 | 2026-07-29 | 建立rolling Master Plan；以最新WP-08 final summary更新根因；建立M1 planning commit、WP-22與WP-23；加入完整dirty ownership、manifest時點、smoke hunk與commit授權邊界。 |

## 17. M1 execution record

| 時間（UTC） | 單位 | 結果 | 證據／後續 |
|---|---|---|---|
| 2026-07-29T04:31:22Z | M1-PLANNING-COMMIT | PASS；commit `f2bacb1` | 兩份規劃文件精確暫存、cached diff review、diff check與secret scan均通過；其餘9個dirty path hash未漂移。 |
| 2026-07-29T04:31:22Z | WP-22 | FAIL；停止M1 | 單次 canonical run `20260729042417940` 的 unit-coverage exit 1。已執行的Browser、quality、source manifest、package lock、snapshot/runtime與三schema marker cleanup皆PASS；coverage未完成固定119／939／0／0 gate。不得執行WP-23、不得更新launch evidence或readiness；交回Sol重新規劃。 |
| 2026-07-29T05:04:08Z | WP-22-R1 | PASS；canonical run `20260729050408559` | RUNNER_INVENTORY_STALE 已修正為 HARD_PROTECTED／PRESERVE_ONLY／MUTABLE_CONTROL_PLANE ownership validation；Master Plan 排除於產品 source manifest，但由 preserve-only 前後 hash 驗證。npm ci、secret scan、Prisma、三 schema、39 Browser、lint、typecheck、strict-index、固定 119／939／0／0 coverage、source manifest、七個 hard-protected hash、preserve-only、snapshot/runtime與三 schema cleanup 全部 PASS；可進入 WP-22 commit 與 WP-23。 |
| 2026-07-29T05:12:58Z | WP-23 | PASS | 以 run `20260729050408559` 的 final summary／cleanup hashes更新 8 個 allowlisted launch evidence 文件；WP-08標記 COMPLETE，38／1與前次coverage failure僅保留歷史脈絡，readiness維持57／45並交由Sol重評。M1完成，停止於此。 |
