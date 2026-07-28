# Manual Blockers

| ID | 阻擋 | 原因 | 人工動作 | 完成證據 |
|---|---|---|---|---|
| MB-01 | AGY 登入 | CLI 回報未登入 | 在正常互動式 `agy` 完成登入，不把憑證交給 Codex | `agy models` 可在 60 秒內回傳 |
| MB-02 | 安全測試 env／disposable DB | **已由 WP-04 解除**：temporary Windows PostgreSQL 已停止，Docker 的 `celebratedeal_ci` 可在 `127.0.0.1:54329` 安全使用 | 無需動作 | `wp-04-regression-baseline-20260727155807-8d6acbd8` 完整 receipts |
| MB-03 | Candidate migrations | **WP-13 已完成 candidate 11 的 NULL source identity 與 status DB policy remediation**；正式資料庫仍須在人工授權後以同一 fail-closed preflight 盤點 legacy rows | 不得對正式 DB 自動套用；如遇 active NULL source 或未知 status，先人工 mapping／forward data fix | `.ai-team/reports/wp-13-commission-dedup-status-20260728030948149/final-verdict.md` |
| MB-04 | Supabase ACL | 正式平台權限 | 平台 owner 人工驗證 | grants/RLS evidence |
| MB-05 | PayUni | 商家、正式金流與 callback | 僅在 sandbox/人工授權後執行 | sandbox receipt；Production 另行核准 |
| MB-06 | Observability | Sentry/PostHog/Cloudflare 外部服務 | 人工確認測試專案與 delivery | 外部 dashboard receipt |
| MB-07 | Accessibility | 真實 screen-reader journey | NVDA/VoiceOver 人工測試 | journey checklist |
| MB-08 | Commercial launch | DNS、法務、客服、商家 onboarding | Owner/法務/營運確認 | signed checklist |

WP-14 已由使用者完成 AGY 互動式登入並以 `agy models` 驗證；Fast／Deep 複核均已完成。MB-01 不再阻擋 WP-14，但其他工作包仍須在其執行當下重新驗證登入狀態。

WP-07 沒有新增人工帳號、正式 Secret 或正式服務 blocker；Gemini Deep 已由使用者互動式唯讀審查完成並回傳 PASS，無此工作包的未解人工 blocker。

WP-09 沒有新增人工帳號、正式授權、正式 Secret 或正式服務 blocker；舊 `.codex/agents/*.toml` 的治理去留只列為下一個窄範圍決策，不阻擋本切片 manifest 結案。

WP-17 未新增人工 blocker；所有資料為 synthetic loopback disposable schema，未要求正式帳號、授權、Secret 或人工外部操作。

WP-18 未新增人工 blocker；coverage 阻擋是既有 WP-17 DB test 的合成環境旗標缺漏，無須正式帳號、授權或資料庫操作。
