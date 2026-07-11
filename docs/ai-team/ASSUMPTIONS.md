# Assumptions Ledger

| ID | 日期 | 假設 | 影響 | 驗證方式 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| A-001 | 2026-07-10 | 專案專屬 Skills 放在 `.agents/skills`，由 npx skills 共用給 Codex、Antigravity 與 Antigravity CLI。 | 避免複製三份漂移內容。 | `npx skills list --json` 與三個 agent 安裝輸出。 | Accepted |
| A-002 | 2026-07-10 | Custom agent 的 relative `skills.config.path` 以 project root 為解析基準。 | 讓 repo 可攜，不硬編碼使用者路徑。 | `codex exec --strict-config`/AI setup validator。 | Verify locally |
| A-003 | 2026-07-10 | Orchestrator 的 `team-config.yaml` 使用 JSON-compatible YAML，避免新增 Python PyYAML 依賴。 | Windows/Linux 皆可用 Python stdlib 執行。 | `python automation/orchestrator.py --dry-run`。 | Accepted |
| A-004 | 2026-07-10 | 目前外部商城沒有統一訂單 API/Webhook。 | click 不得視為 conversion。 | 每個商城 adapter 個別驗收。 | External required |
| A-005 | 2026-07-10 | Prompt 內模型名稱是期望設定，不代表本輪執行環境實際採用相同模型。 | 報告不得虛報模型。 | 只有 runtime 可回報時才標記 actual。 | Accepted |
| A-006 | 2026-07-10 | 本機 Codex CLI 已升級至 v0.144.1，但 requested model 是否可用仍須由每次 runtime evidence 證明。 | Non-interactive orchestrator 保留明確 fallback。 | requested model 被 CLI 拒絕時使用 `gpt-5.4`，並分開記錄 requested/actual。 | Accepted |
| A-007 | 2026-07-10 | Repo 尚未建立 `docs/product/`，產品完成矩陣需由本輪依 schema、routes、UI 與測試證據重建。 | 不可把 prompt 中的功能清單直接視為已實作。 | 建立 `docs/product/PRODUCT_COMPLETION_MATRIX.md` 並逐項連結證據。 | Accepted |
| A-008 | 2026-07-10 | 外部直銷商城目前沒有可信任的訂單 API/Webhook。 | 外部商品 click 只能作為導流事件，佣金 conversion 必須由人工確認或可信 provider evidence 建立。 | Adapter fixture、狀態機與 reconciliation 測試。 | External required |
| A-009 | 2026-07-10 | MVP 歸因採 30 天 last-touch，僅限同一瀏覽器的 signed HttpOnly cookie。 | URL ref 只提出候選；停權、過期、跨 vendor 或被竄改 token 不產生佣金；跨裝置不承諾自動合併。 | `attribution.test.ts`、checkout metadata 與 webhook commission tests。 | Accepted |
## A010 — COURSE-001 是銷講與免費報名，不是付費 LMS 存取權

- 狀態：Accepted for staging MVP
- 決策：目前 `Enrollment` 代表免費課程／活動報名，公開 UI 與名單頁明示「報名不代表付款」。商品 CTA 仍經 server-side Product checkout，只有可信 paid webhook 能建立付款與佣金。
- 不宣稱：Enrollment 不授予私有 VOD 播放權，不把 lead、click 或報名標成 paid conversion。
- 後續 P0：若產品要販售受保護課程內容，必須另做 paid transaction → active enrollment、全額退款撤權、一次性 claim、HttpOnly access session 與 Cloudflare signed playback，不能沿用目前公開預覽 URL 假裝完成。

## A011 — Visual baseline 隔離非產品動態內容

- 狀態：Accepted
- 決策：Visual test 以 CSS 隱藏 Next.js development portal，並遮罩時間、識別碼、Email、金額等測試資料；不修改 production UI。
- 目的：baseline 只追蹤版面、響應式與元件視覺退化，不因每次 seed 的動態值產生假警報。

## A012 — 商家影片上傳的 MVP 上限

- 狀態：Accepted for staging MVP
- 決策：目前瀏覽器 direct upload 使用 Cloudflare 一次性 URL 與基本 POST，上限 200 MB；檔案不經 Next.js server，也不回傳 stream key。
- 後續：大型檔案與不穩網路需改用 tus/resumable upload，完成前 UI 不宣稱支援大型長影片。

## A013 — 付款費用快照與退款上限

- 狀態：Accepted for staging MVP
- 決策：gateway fee 只在首次可信 paid event 擷取，平台交易費則由 server 依該交易發生時的 VendorSubscription 費率計算並凍結；後續不同 event ID 的 paid replay 不可改寫兩者。
- 退款：RefundRecord 是 principal／gateway fee／platform fee refund 的帳本真相來源，PostgreSQL trigger 同步 PaymentTransaction counters，DB CHECK 禁止累計退款超過原始 paid snapshot。
- 外部驗證：PayUni sandbox 仍需確認實際 gateway fee 與 fee-refund 欄位語意；provider 欄位不作為平台費率真相來源。
- 歷史限制：目前 VendorSubscription 沒有狀態歷史表；migration 依 startedAt/endedAt 重建當時費率，runtime 則只接受 active/trialing。正式方案若允許追溯改費率，需新增 append-only subscription version ledger。
# Dual CLI automation assumptions (2026-07-11)

- `agy.exe` is the installed Antigravity CLI because its help and model discovery match the requested non-interactive QA capabilities; runtime login and quota are verified separately by smoke execution.
- JSON-compatible files keep the `.yaml` extension where the existing repository already uses that convention, avoiding a new PyYAML dependency.
- Role registry manifests are provider-neutral contracts; existing `.codex/agents/*.toml` remain the native Codex subagent definitions and are not replaced.
- Antigravity cannot enforce a JSON schema natively in the detected CLI, so prompts require JSON and the adapter validates output before treating a run as passed.
- Product and financial behavior is outside this automation-only upgrade unless a deterministic regression exposes a real breakage.
- The requested QA filenames were absent at repair time. `reports/ai-team-qa/FINAL_DELIVERY.md` and its linked reports are treated as the auditable equivalent source; missing files are not recreated as if they were original QA evidence.
- A CLI flag/capability probe proves interface availability, not authentication or quota. Only a successful provider-native smoke can satisfy a provider-specific stage.
- Pipeline evidence authenticity uses a coordinator/CI-only `AI_PIPELINE_ATTESTATION_KEY`. The key is never stored in the repository or forwarded to Codex/Antigravity child processes; a missing key blocks stage completion and release.
- Empty backlog is an operational idle state, not a setup failure. The auto-cycle performs deterministic discovery and schedules the next scan without fabricating product work.
- Ollama is a docs/reports/metadata-only continuity provider. It cannot complete a Codex or Antigravity stage and never satisfies provider-native QA.
- A provider reset time is accepted only when it parses in local time and is in the future. Missing or expired values schedule an hourly probe.
- Windows Credential Manager provides encrypted-at-rest persistence, not isolation from every process running as the same Windows identity. Production-like unattended operation therefore assumes a dedicated coordinator Windows account; its Task Scheduler principal, Credential Manager entry and filesystem ACL remain External required workstation setup.
- Runtime discovery candidates may be marked eligible, but unsigned candidate JSON cannot directly drive a Git commit. Only a committed trusted backlog task executed in an isolated worktree can reach the commit sink.
