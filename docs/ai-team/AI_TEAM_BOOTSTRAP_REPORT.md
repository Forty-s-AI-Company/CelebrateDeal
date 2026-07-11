# AI Team Bootstrap Report

## 本輪目標

在不重構 CelebrateDeal 產品核心的前提下，建立可長程運作的 Codex AI 團隊、專案 Skills、設計/QA 規格、測試 evidence 與 non-interactive orchestrator，並以現有產品的真實風險作為第一批 backlog。

## 實際完成

- 建立根目錄 `AGENTS.md`，固定多租戶、金流、UI、子代理、Definition of Done 與回報規則。
- 建立 `.codex/config.toml` 與 11 個 project custom agents。
- 安全審查並以 project copy 安裝 3 個外部 Skills；建立與驗證 6 個 CelebrateDeal Skills。
- 建立 CURRENT_STATE、Assumptions、Skills lock、Blockers、設計規格與 QA 矩陣。
- 擴充 Playwright 為 1440/1280/768/390 viewport，保留 HTML、trace、screenshot、video。
- 新增 axe accessibility、visual comparison、Vitest coverage gate 與 Lighthouse runner。
- 建立 GitHub Actions CI artifact、staging release gate（只驗證，不部署）。
- 建立 Python orchestrator、backlog、state、PowerShell entry、Antigravity `qa-issues.json` ingestion 與 dry-run report。
- 修正登入頁低對比連結，axe 由 fail 轉為 pass。
- 將唯讀安全盤點發現的 critical/high 風險寫入 `BLOCKERS.md` 與 P0 backlog，禁止以綠色 build 宣稱可販售。

## 建立的代理

以下為子代理設定檔的預期設定，不代表本輪主執行環境實際模型：

| Agent | Model | Reasoning | 權限 | 職責 |
| --- | --- | --- | --- | --- |
| orchestrator | gpt-5.6-sol | high | Parent sandbox | 依賴排序、派發、整合與品質 gate |
| product-architect | gpt-5.6-sol | high | Parent sandbox | 產品流程、角色、資料契約、驗收 |
| explorer | gpt-5.6-terra | low | read-only | 程式地圖與依賴證據 |
| frontend-engineer | gpt-5.6-terra | medium | Parent sandbox | React/Next.js UI、狀態、RWD、效能 |
| ux-design-lead | gpt-5.6-sol | high | read-only | IA、design system、UX/visual audit |
| backend-engineer | gpt-5.6-terra | medium | Parent sandbox | API、service、webhook、job |
| database-security-engineer | gpt-5.6-sol | high | Parent sandbox | Schema、migration、RLS、RBAC、交易 |
| attribution-commission-engineer | gpt-5.6-sol | high | Parent sandbox | 歸因、佣金、退款、對帳 |
| test-engineer | gpt-5.6-terra | medium | Parent sandbox | Unit/API/E2E/Visual/A11y regression |
| security-reviewer | gpt-5.6-sol | high | read-only | Tenant、付款、注入與 secret review |
| release-manager | gpt-5.6-sol | high | Parent sandbox | Release decision、rollback、external gate |

Codex CLI `--strict-config` 實測回報 `CONFIG_OK 11`。本機 CLI v0.134.0 尚不支援 gpt-5.6-terra/sol；orchestrator 僅在 CLI 明確回報版本不支援時使用 `gpt-5.4` fallback，並寫入 `runtimeModel`。升級 CLI 後仍優先使用設定檔模型。

## 安裝的 Skills

外部：

- `web-design-guidelines`（Vercel）。
- `vercel-react-best-practices`（Vercel）。
- `frontend-design`（Anthropic）。

專案：

- `celebratedeal-product-domain`。
- `celebratedeal-design-system`。
- `celebratedeal-multi-tenant-security`。
- `celebratedeal-attribution-commission`。
- `celebratedeal-browser-qa`。
- `celebratedeal-release-gate`。

六個專案 Skills 全部通過 `skill-creator/scripts/quick_validate.py`。來源、SHA、風險與用途記錄於 `docs/ai-team/SKILLS_LOCK.md`。

## 建立的測試工具

- Vitest V8 coverage，gate：statements 75、branches 60、functions 75、lines 75。
- Playwright HTML reporter、trace/screenshot/video failure retention。
- Chromium desktop/laptop/tablet/mobile projects。
- axe-core WCAG 2.1 AA smoke。
- Playwright visual snapshots。
- Lighthouse native ESM runner。
- tracked-file secret scanner。
- AI agent/skill validator 與 Python orchestrator unit tests。

## 執行結果

| 驗證 | 結果 |
| --- | --- |
| npm install / audit | 通過；0 vulnerabilities（Lighthouse 固定 12.6.1，避開較新版 vulnerable dependency chain） |
| AI setup validator | 11 agents、9 skills，通過 |
| Skill quick_validate | 6/6 通過 |
| Codex strict config | `CONFIG_OK 11` |
| Orchestrator dry-run | SEC-001 -> database-security-engineer，通過 |
| Automation unit tests | 10/10 通過 |
| Secret scan | 專案 regex baseline 通過；不取代 GitHub native secret scanning |
| ESLint | 通過 |
| Typecheck | 通過 |
| Vitest | 8 files、25 tests 通過 |
| Coverage | 78.97/65.78/82.29/80.04，通過 gate |
| Production build | 60 routes，通過 |
| E2E smoke | 7/7 通過 |
| Accessibility | 1/1 通過；修正一個 serious contrast issue |
| Visual | 4/4 baseline + 4/4 comparison 通過 |
| Lighthouse | Performance 0.87、Accessibility 1、Best Practices 1、SEO 1；使用動態獨立 port |

## 修改檔案

主要新增範圍：

- `.codex/agents/**`、`.codex/config.toml`。
- `.agents/skills/**`、`skills-lock.json`。
- `automation/**`、`qa-issues.json`。
- `docs/ai-team/**`、`docs/design/**`、`docs/qa/**`、`BLOCKERS.md`。
- `tests/e2e/accessibility.spec.ts`、`tests/visual/**`。
- `scripts/lighthouse.mjs`、`scripts/secret-scan.ts`。
- `.github/workflows/ci.yml`、`staging-release-gate.yml`。
- `package.json`、`playwright.config.ts`、`vitest.config.ts`。
- `src/app/login/page.tsx`（Link semantics、focus、contrast）。

## 尚未處理的產品缺口

- 商家 onboarding、邀請、組織切換與完整角色權限 UI。
- 外部商城 confirmed conversion adapter。
- 即時聊天室/moderation。
- 自動週期月結、銀行出款與發票。
- 通知排程與完整 conversion tracking。

## 最終治理 Review 修正

- Antigravity `qa-issues.json` 僅採用固定欄位；忽略外部 prompt 與 validation。Untrusted QA 可在 `autonomy.auto_promote_qa=true` 時進入 `automatic-qa-repair-v1` policy promotion，但只會使用 Orchestrator 重建的 prompt、validation、role DAG、write scope 與 commit gate；沒有 promotion record 的 evidence 仍不能進入 workspace-write。
- 自動任務若修改 package/lockfile、CI、agents、skills、automation 或 scripts，會在執行 npm validation 前失敗。
- Validation 使用 `shell=False` 與 token allowlist，拒絕 `&&`、pipe、redirect 等 shell metacharacters。
- Staging release gate 僅接受 master，code tests 使用 disposable PostgreSQL；staging secrets 只提供給 migration status、preflight 與 required external smoke。
- External smoke 以 required check 名單阻擋 SKIP/missing result，workflow 不再有可跳過 external provider 的綠燈路徑。
- Secret scanner 擴充專案型 token/assignment 規則並掃描 untracked files；仍須啟用 GitHub native secret scanning。

## Assumptions

完整 ledger 位於 `docs/ai-team/ASSUMPTIONS.md`。重要假設是 `.agents/skills` 作為跨 Codex/Antigravity 共用 project scope，以及 gpt-5.6 設定目前只是 Prompt 預期值。

## Hard Blockers

沒有在 repo 內無法繼續的 Hard Blocker。Production 仍有 External required：Cloudflare、PayUni、Resend、Upstash/WAF、Supabase restore/RLS、Sentry/PostHog staging。

更重要的是，本輪安全盤點確認三個 release-blocking critical：demo webhook fallback、vendor finance 可觸及全平台 admin billing、vendor payout query 未限制 tenant。詳見 `BLOCKERS.md`。這些不是 External required，而是下一輪必須先修的程式問題。

## 下一輪建議

- 下一輪目的：完成 P0 多租戶與 payment webhook 安全修復，讓 release gate 從 `BLOCKED` 進入可做 staging external QA 的 `CONDITIONAL`。
- 建議 Codex 主模型：GPT-5.5。
- 建議推理程度：超高。
- 建議子代理：orchestrator、database-security-engineer、attribution-commission-engineer、test-engineer、security-reviewer、release-manager。
- 預期內容：依序完成 SEC-001/002/003、安全 URL、relation ownership、order/refund/commission idempotency，補兩租戶與對抗測試。
- 成功判定：所有 critical/high finding closed；security reviewer 無 P0/P1；完整 gate、E2E、visual/a11y、reconciliation 通過；External required 保持清楚。
