# CelebrateDeal Blockers

更新日期：2026-07-11

## Repo 內 Release Findings

- 2026-07-11 release reviews 找到的 PayUni malformed callback fail-open、staging smoke pending order、settlement/commission lock race、晚到退款跨月債務、legacy/missing-subscription migration、fee refund 上限、非原子 booking migration 與混合 paymentMode 月結 P1，均已修正並有 regression／migration drill 證據。
- unknown/demo payment provider、platform admin 邊界、payout 跨租戶、危險 URL、relation ownership、付款冪等、attribution snapshot、負餘額 carry 與 fee refund 累計均採 fail-closed、DB constraint 或可稽核 ledger。
- 目前 repo 內沒有已知 P0/P1；本機 gate 通過只代表可進入 Staging QA，不代表外部服務或正式收費已驗收。

## External Required

1. Cloudflare Stream：修正 `code=10000 Authentication error`，確認 Account ID、token scope、direct upload、Live Input、真實 ready callback 與官方 signing secret。
2. PayUni：使用 sandbox dashboard 驗收 checkout form post、paid/refunded/duplicate webhook 與 reconciliation。
3. Resend：驗證寄件網域，實收 password reset 與交易通知。
4. Durable rate limit：在 staging/production 啟用 Upstash Redis 或 Cloudflare WAF，驗證 checkout/form/analytics/affiliate-clicks 的 429 或 edge block。
5. Supabase：建立 staging/production database，執行 migration、snapshot、restore drill，並完成 RLS 採用決策。
6. Sentry/PostHog：確認 staging event、source maps、funnel 與 alert rules。
7. Vercel/GitHub：設定 staging secrets、required reviewers、deployment branch policy 與 native secret scanning。
8. Antigravity CLI：2026-07-11 `agy --print --sandbox`、`agy quota` 與 `agy auth status` 均在 non-interactive probe 逾時；CLI help/model discovery 可用，但需真人確認 Antigravity 登入、quota 或首次啟動 UI。現階段流程模式為 `hybrid`，Codex/Ollama fallback 均不得宣稱 Antigravity QA passed。
9. AI pipeline attestation：staging/CI 必須產生並安全保存 `AI_PIPELINE_ATTESTATION_KEY`，只提供給 parent orchestrator；不得提交 repo 或透傳 child adapters。未設定時 release gate 會 fail closed。
10. Coordinator trust root：基礎 trust-root commit 已建立；本輪 autonomy/quota 控制面修改需完成獨立 review、tests 與新 commit 後，才能重新執行 attested regression。任何未提交或與 `sourceRevision` 不一致的 trust input 仍會 fail closed。

## Product Boundary

- 現有 Course 是公開銷講與免費報名 MVP，不是付費 gated LMS。若商業方案需要購買後私有課程權限、退款撤權與 signed playback，需另立產品垂直切片；這不阻擋目前定義的免費銷講 Staging QA，但不得在銷售文案中宣稱已具備。

## Hard Blocker Policy

只有需要付費、CAPTCHA／OTP／真人驗證、私人帳密、正式顧客資料、不可逆資料庫操作或法律／稅務／合約決策時，才標記 Hard Blocker。其餘項目必須先完成 mock、fixture、adapter、測試與 runbook。
