# Manual Blockers

治理版本：`solo-founder-launch/v1`。每個仍可阻擋 release 的條件都必須符合 [Hard Blocker Provenance Rule](solo-founder-launch-standard.md#hard-blocker-provenance)。

| ID | 分類 | Provenance | 阻擋／目前狀態 | 人工動作 | 完成證據 |
|---|---|---|---|---|---|
| MB-01 | WARNING | `AI_TEAM_BEST_PRACTICE` | AGY CLI 未登入；不阻擋產品 launch | 需要時由使用者互動式登入 | `agy models` 結果 |
| MB-02 | CLOSED | `DIRECT_PRODUCTION_RISK` | **已由 WP-04 解除**：disposable PostgreSQL 可安全使用 | 無需動作 | WP-04 sanitized receipts |
| MB-03 | RELEASE_CRITICAL | `DIRECT_PRODUCTION_RISK` | Candidate migration／legacy rows 必須在正式 DB 前 fail-closed 盤點 | 經授權 owner 做 mapping／forward data fix；不得自動套用未知資料 | WP-13 verdict＋production migration receipt |
| MB-04 | RELEASE_CRITICAL | `EXTERNAL_PROVIDER` | Supabase ACL／RLS／grants 尚需 provider owner 驗證 | 平台 owner 唯讀確認 default deny 與 residual ACL | grants／RLS receipt |
| MB-05 | RELEASE_CRITICAL | `EXTERNAL_PROVIDER` | PayUni merchant、callback、signature 與正式金流設定尚未完成 | 僅在 Sandbox／明確授權下執行，Production 另行核准 | sanitized provider receipt |
| MB-06 | WARNING + MINIMUM_REQUIRED | `DIRECT_PRODUCTION_RISK` | 完整 Sentry／PostHog／Cloudflare delivery packet 非必要；最低 error observability 與 escalation 必須存在 | Owner 確認安全錯誤分類、通知路徑與 support SOP | minimum observability receipt；完整 dashboard 可作 follow-up |
| MB-07 | WARNING | `DEFENSE_IN_DEPTH` | Screen-reader journey 尚未完成人工驗收；基本 accessibility 不得移除 | 依 QA journey 做 NVDA／VoiceOver 驗證 | journey checklist |
| MB-08 | MIXED_SPLIT | `LEGAL_REGULATION` / `TRACKED_PROJECT_REQUIREMENT` / `DIRECT_PRODUCTION_RISK` | 法規適用政策、customer support／onboarding 與 production configuration 分開判定 | Owner 完成適用政策、客服路徑與 production domain/config | 對應 policy、support、provider receipts |
| MB-09 | RELEASE_CRITICAL | `EXTERNAL_PROVIDER` / `DIRECT_PRODUCTION_RISK` | 目前沒有可信 evidence 證明 current environment、PayUni account／environment、order、reference、amount、payment／refund／callback state 完整一致；fresh CAT04 flow 不是唯一要求，FIN-08AA、WP-196、WP-197 不可重跑 | 先檢查可重用 transaction；若既有 binding 不足，再由 owner 選擇最小 non-Production provider verification | equivalent controlled reconciliation evidence |
| MB-10 | MIXED_SPLIT | `LEGAL_REGULATION` / `TRACKED_PROJECT_REQUIREMENT` / `DIRECT_PRODUCTION_RISK` | CAT10 responsibility、適用政策、support／finance SOP 與 release decision 仍可能 pending；五位不同真人不是 blocker | 依 [CAT10 packet](cat10-human-owner-acceptance-packet-20260807.md) 由一人或多位真人完成 responsibility ledger | sanitized responsibility receipt＋`GO`／`HOLD`／`NO_GO` |

WP-14 已由使用者完成 AGY 互動式登入並以 `agy models` 驗證；Fast／Deep 複核均已完成。MB-01 不再阻擋 WP-14，但其他工作包仍須在其執行當下重新驗證登入狀態。

WP-07 沒有新增人工帳號、正式 Secret 或正式服務 blocker；Gemini Deep 已由使用者互動式唯讀審查完成並回傳 PASS，無此工作包的未解人工 blocker。

WP-09 沒有新增人工帳號、正式授權、正式 Secret 或正式服務 blocker；舊 `.codex/agents/*.toml` 的治理去留只列為下一個窄範圍決策，不阻擋本切片 manifest 結案。

WP-17 未新增人工 blocker；所有資料為 synthetic loopback disposable schema，未要求正式帳號、授權、Secret 或人工外部操作。

WP-18 未新增人工 blocker；coverage 阻擋是既有 WP-17 DB test 的合成環境旗標缺漏，無須正式帳號、授權或資料庫操作。

WP-08 歷史 password-reset audit assertion failure 已在 canonical run `20260729050408559` 完成全套回歸驗證；目前沒有 WP-08 人工 blocker。此結果不解除外部服務、部署、法務或營運的既有人工 Gate。
