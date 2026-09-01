# CelebrateDeal 文件權威與時效地圖

最後更新：2026-07-25 20:58（Asia/Taipei）

## 讀取順序

1. 目前 revision 的真實執行狀態：`docs/codex-goal/PROGRESS.md`。
2. 分數與剩餘 Gate：`docs/codex-goal/QUALITY_SCORECARD.md`。
3. 需求到測試：`docs/codex-goal/REQUIREMENTS_TRACEABILITY.md`。
4. 測試與 finding：`docs/codex-goal/QA_REPORT.md`、`CODE_REVIEW_REPORT.md`。
5. 人工／產品缺口：`MANUAL_ACTIONS.md`、`DECISIONS_NEEDED.md`。
6. 日期早於目前 revision 的 audit/report 只代表當日快照，不得覆蓋上述 canonical 狀態。

## 文件類別

| 類別 | 文件 | 用途 | 可否當成目前通過證據 |
|---|---|---|---|
| Canonical current | `docs/codex-goal/*`（Plan/Runbook 除外） | 目前 revision 的狀態、證據與缺口 | 可；仍需讀該項狀態 |
| Execution contract | `CELEBRATEDEAL_PLAN.md`、`GOAL_RUNBOOK.md` | 長程 Goal 規則、初始基準 | 不可把初始分數當現況 |
| Operational runbook | database、backup/restore、rate-limit、external-service、PayUni、MFA、password reset | 說明如何安全操作 | 不可；runbook 存在不等於演練通過 |
| Product/reference plan | infrastructure、go-live master、launch breakdown、live-commerce MVP | 架構與範圍參考 | 不可；其中「目前狀態」可能過期 |
| Historical snapshot | 檔名含 `2026-07-21`、`2026-07-22` 或 validation/readiness report | 保存當日稽核事實 | 只可證明該日，不可推論目前狀態 |
| UX/product research | `bombmy_analysis/`、`codex_review/` | 競品、UX 假設與截圖 | 不可；需轉成核准需求或 decision |

## Current canonical documents

| 文件 | 負責內容 |
|---|---|
| `docs/codex-goal/PROGRESS.md` | phase、已完成項、目前 findings、下一步 |
| `docs/codex-goal/QUALITY_SCORECARD.md` | Q/M/F/G 分數與證據 |
| `docs/codex-goal/REQUIREMENTS_TRACEABILITY.md` | 27 項需求→實作→測試→manual/decision |
| `docs/codex-goal/ARCHITECTURE_BOUNDARIES.md` | 依賴方向與架構債 |
| `docs/codex-goal/AUTHORIZATION_MATRIX.md` | route/action 的 role/tenant/MFA |
| `docs/codex-goal/API_CONTRACT_REGISTRY.md` | 63 route contract rows |
| `docs/codex-goal/PRISMA_INVARIANTS.md` | 51 models／9 migrations |
| `docs/codex-goal/QA_REPORT.md` | 可重現 QA evidence |
| `docs/codex-goal/CODE_REVIEW_REPORT.md` | validated findings |
| `docs/codex-goal/MANUAL_ACTIONS.md` | 只能由 owner/外部平台完成的 Gate |
| `docs/codex-goal/DECISIONS_NEEDED.md` | 未核准產品與政策決策 |
| `docs/codex-goal/ARTIFACT_INDEX.md` | dated raw evidence 索引 |

## 已知容易誤讀的舊敘述

- 2026-07-09／07-21 文件中的「尚未有 Staging callback domain／migration／restore」只代表當時快照。
- 「External Required」代表需要外部證據，不代表目前一定失敗或通過；以 `MANUAL_ACTIONS.md` 為準。
- 「E2E 已通過」若未附目前 revision 的 dated report，不可取代目前 QA。
- 「env 名稱存在」「Dashboard 分頁存在」「有 runbook」均不可當成外部 Gate 通過。
- 競品分析中的功能缺口先進 `DECISIONS_NEEDED.md`，不得直接升格成 defect。

## 更新規則

1. 新證據先寫入新的 `reports/quality/<UTC>-*.md`，不覆蓋舊報告。
2. 再更新 canonical QA/Progress/Scorecard/Artifact Index。
3. 歷史報告保持原貌；除非有安全問題，不回寫當時結論。
4. Operational runbook 只在程序改變時更新，不拿來記錄每次執行結果。
5. 只有 Definition of Done 達成時才建立 `FINAL_REPORT.md`。
