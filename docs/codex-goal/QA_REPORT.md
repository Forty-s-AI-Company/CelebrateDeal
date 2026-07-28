# CelebrateDeal QA Report

最後更新：2026-07-25 22:21（Asia/Taipei）

## 執行環境

- OS：Windows 原生
- PowerShell：7.7.0-preview.3
- Node.js：22.23.1
- npm：10.9.8
- PostgreSQL client/server tooling：18.3 installed; client tools are not on PATH in current shell, but expected PostgreSQL 18 executable paths exist
- Playwright：1.61.1
- Chrome：可用
- Repo branch：`codex/payuni-sandbox-external-qa`

## 本輪基準

| 檢查 | 結果 | 備註 |
|---|---|---|
| Goal 起始 tracked dirty 基準 | 通過 | 0；目前工作樹已有經記錄且未 stage 的 Goal patches，不再誤報為 clean |
| 既有 untracked artifacts 保護 | 通過 | 未修改、未 stage |
| `.next/lock` | 通過 | 不存在 |
| port 31023 listener | 通過 | 無 |
| 殘留 Next/Playwright process | 通過 | 無；Codex runtime 排除 |
| `DATABASE_URL` loopback | 通過 | 只輸出 boolean |
| `DIRECT_URL` loopback | 通過 | 只輸出 boolean |
| dev/test DB name | 通過 | 只輸出 boolean |

## 測試矩陣

| 類型 | 本輪狀態 | 證據 |
|---|---|---|
| lint | 通過 | 全倉 ESLint |
| typecheck | 通過 | `tsc --noEmit` |
| strict production index typecheck | 通過 | `noUncheckedIndexedAccess=true`；Production source 0 errors |
| unit | 通過 | 112 files／880 tests |
| unit coverage | 通過 | 完整來源 global 64.32/58.03/61.31/66.28；`src/lib` 86.41/80.69/88.39/88.95；CI thresholds 已啟用 |
| build | 通過 | strict-index 後 production compile；72 app routes |
| release-mode E2E | 通過 | 最終完整 39/39：28 smoke＋8 accessibility＋3 performance |
| npm audit production | 通過 | 0 vulnerabilities |
| backup tooling static | 通過 | PowerShell static suite |
| repository secret/archive scan | 通過 | tracked＋non-ignored untracked；0 findings |
| browser/axe | 通過（目前固定路徑） | release-mode Chromium；8/8，涵蓋 public、owner、dynamic commerce、MFA/admin、keyboard/focus、reduced-motion、mobile target；首輪 live panel ARIA finding 修正後重跑通過 |
| performance | 通過（目前固定路徑） | release-mode Chromium；3/3，account routes、authenticated dashboard 與公開直播導購頁固定預算 |
| security | 掃描完成／Codex 複審中 | Backend manifest 已 completed/sealed；final report 52 個 reportable medium-confidence findings |
| security scan candidate pool | 已收斂 | GUI validation queue 曾顯示 66；final reportable 52，High 25／Medium 12／Low 15；仍需與目前 dirty fixes 逐項交叉核對 |
| MFA targeted regression | 通過 | `src/app/actions.test.ts` 94/94 |
| Payment/refund/webhook targeted regression | 通過 | 4 files／124 tests；包含 callback invariants、retry claim、route failure guard、MFA |
| Payment DB concurrency regression | 通過 | concurrent logical order／commission、late callback、over-refund；isolated PostgreSQL |
| Payment provider/order scope regression | 通過 | same vendor/order、different provider 不會綁錯 transaction；29/29 suite 通過 |
| Password reset targeted regression | 通過 | sequential replay＋concurrent atomic claim；isolated PostgreSQL |
| Typecheck after auth patch | 通過 | `tsc --noEmit` |
| Typecheck after payment patch | 通過 | `tsc --noEmit` |
| Lint after payment patch | 通過 | 全倉 ESLint |
| Payment batch secret scan | 通過 | 8 個 security-sensitive files，0 個可行動 finding |
| Authorization/tenant targeted regression | 通過 | 6 files／68 tests；attribution、visitor scope、public lifecycle、active product |
| Team template edit ownership regression | 通過 | 1 file／1 test；template version 與 webinar 都限制目前 membership owner |
| Public lifecycle／analytics binding regression | 通過 | 3 files／23 tests；form、affiliate click、analytics；另 analytics 7/7 product binding |
| Cloudflare provider status／form trust | 通過（自動化） | pure/action/component 4 files／110 tests；DB route stale/recovery included in 45/45 |
| Authorization batch secret scan | 通過 | 12 個 security-sensitive files，0 findings |
| Isolated PostgreSQL listener | 通過 | temporary PostgreSQL 18.3 僅綁 loopback；9/9 migrations 已套用 |
| API contract executable inventory | 通過 | 27/27 routes 都存在 registry entry 與 sibling route test |
| Prisma invariant executable inventory | 通過 | 51/51 models、9/9 migrations 都存在 canonical entry |
| Form submission DB concurrency | 通過 | 2 個 concurrent requests 收斂為 1 row；1 個 duplicate |
| Tenant-ledger FK DB regression | 通過（本機候選） | 4 個 same-tenant writes 通過；4 個 cross-tenant writes 均為 `P2003` |

## Fixture 與資料安全

- 目前 `.env.local` metadata 顯示 DB 為 loopback 與專用 dev/test DB。
- Vitest 與 Playwright 已共同使用 fail-closed DB metadata check。
- 未輸出、寫檔或記錄任何 DB URL、host、username 或 password。

## Browser、Accessibility、Performance

- Chrome executable 已確認存在。
- 完整 `npm run e2e` 最終 39/39：28 個 smoke、8 個 accessibility、3 個 performance 全部使用 production build/start lifecycle。
- `npm run e2e:a11y` 最終 8/8：public account、31 個 static authenticated owner routes、14 個 dynamic owner/public commerce routes，以及 platform-admin MFA／operations routes 無 axe critical/serious；Tab/focus、skip link、reduced-motion、mobile overflow/touch target 均通過。
- `npm run e2e:performance` 3/3：account routes、authenticated dashboard 與公開直播導購頁通過 release-mode 固定載入／資源預算。
- 首輪 axe 揭露 contrast、target size 與 sidebar overlay；修正後以完整 suite 重跑通過，不把首次失敗藏掉。
- 歷史報告不當成本輪通過證據；本輪 raw evidence 為 `reports/quality/20260725T115122Z-windows-browser-a11y-performance.md`。
- safe monitoring／public-live lifecycle 後完整 regression 為 `reports/quality/20260725T142132Z-safe-observability-public-live-lifecycle.md`。
- screen-reader 人工 journey 與真實 Production Core Web Vitals 仍為 Manual Exception／後續證據。

## Regression gaps

1. Auth/role/tenant 負向矩陣。
2. DB-I01、DB-I02、DB-I06～DB-I10 尚未完成語意決策／外部只讀 aggregate／constraint。
3. axe/keyboard/mobile/fixed-route performance 已涵蓋主要 public、owner、dynamic commerce、MFA 與 admin operations routes；仍缺複雜 error/loading/destructive/provider states、manual screen-reader 與 field CWV。
4. 外部服務由人工提供非敏感簽核。
5. Codex Security 已完成並封存 52 個 reportable medium-confidence findings；尚未與目前 dirty fixes 逐項核對的項目不可直接視為仍存在的 confirmed defects。
6. Password reset token atomic consume 已在 loopback-only temporary PostgreSQL 18 驗證 sequential 與 concurrent reuse。
7. Payment logical-order／commission concurrency、late callback、over-refund 與 cross-month ledger 已在相同 isolated DB 驗證。
8. Isolated DB 原批次：3 files／45 tests 通過；另有 form concurrency 與 tenant-ledger FK 2 files／2 tests；未連線 Supabase／Staging／Production。
9. Webinar ownership mutation guard 已有 server-side predicate，仍需 release E2E negative case。
10. Public Email disclosure、anonymous analytics trust model 與 referral source proof 尚待產品／隱私決策，不提前標示通過。
11. Vendor finance MFA 的 MVP 文件與 Goal Plan 不一致，已記為 D-004，不擅自改變登入政策。

## Phase 1 deterministic lifecycle evidence

| Round | E2E | Owned process | Listener | Lock | 後續 build |
|---|---|---:|---:|---|---|
| 1 | 25/25 | 0 | 0 | false | 通過 |
| 2 | 25/25 | 0 | 0 | false | 通過 |
| 3 | 25/25 | 0 | 0 | false | 通過 |
| PostCSS update regression | 25/25 | 0 | 0 | false | 通過 |
