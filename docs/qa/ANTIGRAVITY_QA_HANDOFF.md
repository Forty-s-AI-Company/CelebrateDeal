# Antigravity QA Handoff

更新日期：2026-07-11

## 啟動

```powershell
docker start celebratedeal-postgres
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run db:migrate:status
npm run dev
```

App：`http://localhost:31023`

只有使用 disposable 本機 QA DB 時才執行 `npm run db:seed`；development seed 會清除既有 demo 資料。

## 測試身份

- 商家 owner：`demo@celebratedeal.local` / `demo1234`
- Platform admin：不要建立固定 bypass 帳密。Admin browser tests 由 Playwright fixture 建立短效 session、標記 MFA verified，結束後清除。
- 未登入、accountant、platform admin MFA gate：由 `tests/e2e/smoke.spec.ts` 與 `tests/e2e/accessibility.spec.ts` 建立隔離 fixture。

## 自動 gate

```powershell
npm run e2e:smoke
npm run e2e:a11y
npm run e2e:visual
npm run lighthouse
```

## 人工／Browser QA 範圍

1. Auth、未登入 redirect、workspace onboarding/invitation、password reset、admin MFA gate。
2. Dashboard、直播建立/發布、ready VOD/Live Input fail-closed、公開 live 手機 tabs、商品浮出、表單與官方互動角色。
3. Course 建立/發布、免費 enrollment、duplicate、容量、黑名單、報名不等於付款。
4. Product platform/external checkout、安全 URL、affiliate-specific fallback、click 不等於 purchase。
5. First/last-touch、1–90 天期限、停用 affiliate、lead vs paid conversion。
6. Payment webhook malformed/duplicate/out-of-order/refund、reconciliation、settlement generate/adjust/lock concurrency、affiliate payout pending/approved/paid/reversed。
7. Notification outbox、quota、retry、recipient PII role denial。
8. Desktop 1440、laptop 1024、tablet 768、mobile 390；鍵盤、focus-visible、loading/error/empty/disabled。
9. 瀏覽器 console、failed requests、hydration、layout overlap、影片實際 pixels 與 reduced motion。

## 報告位置

- 先讀：`docs/live-commerce-mvp-report.md`
- 先讀：`docs/product/PRODUCT_COMPLETION_MATRIX.md`
- 先讀：`docs/qa/RELEASE_CHECKLIST.md`
- 先讀：`BLOCKERS.md`
- 輸出：`docs/qa/antigravity-autonomous-qa-report.md`
- Issues：`qa-issues.json`
- Screenshots：`docs/codex_review/screenshots/`

外部 Cloudflare、PayUni、Resend、Upstash/WAF、Supabase、Sentry/PostHog 與 Vercel/GitHub dashboard 項目必須標 `External required`，不得用 fixture PASS 代替。
