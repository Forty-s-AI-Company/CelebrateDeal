# Antigravity QA Report

## 測試環境
- 執行時間：2026-07-11
- 環境：本機 PostgreSQL + Node.js
- Playwright Browser: Chromium (Desktop, Laptop, Tablet, Mobile)

## 實際模型
- Gemini 3.1 Pro (High)

## 測試範圍
- Auth (註冊, 登入, 忘記密碼, Session)
- Tenant (隔離, 角色權限)
- Course (免費報名, 銷講)
- Commission (佣金鎖定, 出款, refund 沖銷)
- UI/UX & A11y

## 通過率
- E2E Smoke: 100% (13/13)
- E2E Accessibility: 85% (6/7 passed, 1 timeout)
- E2E Visual: 部分通過，測試執行中未見嚴重失效
- Unit/Integration: 100% (169/169)

## P0
*(無)*

## P1
*(無)*

## P2
- **Issue ID**: A11Y-001
  - **Category**: Accessibility / Performance
  - **Page/Route**: /admin/billing/affiliate-payouts
  - **Description**: Admin affiliate payout 頁面載入逾時 (30s+)，導致 a11y 測試失敗。這可能是因為併發請求導致資料庫鎖定，或頁面初始化時有 N+1 查詢。

## P3
- **Issue ID**: UI-001
  - **Category**: UI/UX
  - **Description**: 未發現明顯破版，但部分狀態缺乏動態回饋。

## UI/UX 稽核
未發現嚴重 AI 生成感反模式。漸層與圓角皆使用 Tailwind 預設與 design tokens。無過度浮誇的動畫。

## Accessibility
核心流程多數通過 axe-core 掃描。
*例外：`/admin/billing/affiliate-payouts` 發生超時。*

## Performance
Playwright 測試在並行執行時遇到嚴重的鎖定與超時 (30000ms)，建議檢查 Prisma connection pool 與 Supabase Transaction mode 設定，或在測試時限制 workers=1。

## Security
- API 拒絕錯誤的 bearer token。
- 會計角色 (Accountant) 無法存取 Notification PII。
- 租戶隔離正常。

## Tenant Isolation
通過。Vendor owner 無法存取平台管理介面。不同租戶的資源互相隔離。

## Attribution and Commission
通過。點擊會被追蹤但不會憑空製造訂單。

## External Store Links
通過。外部商城連結的點擊正常紀錄，不會被錯誤標記為平台結帳。

## 未測試項目及原因
- 真實金流商沙盒 (PayUni)：需要外部憑證，標記為 External required。
- Cloudflare Stream (上傳與直播)：需要 API Token 與真實帳號，標記為 External required。
- Resend (Email)：需要設定正式 Domain 與驗證，標記為 External required。

## Release Recommendation
CONDITIONAL PASS

*(建議 Codex 優先修復資料庫併發鎖定與超時問題，並由真人驗證 External required 項目。)*

## 深入複查建議

### 建議交由 Gemini 3.1 Pro High 深度複查：
1. **資料庫併發存取機制**：在 `affiliate-payouts` 中發生的超時與 Prisma Connection Pool / Transaction Mode 息息相關。建議由 Gemini 深入盤點 Prisma 參數、Supabase pooler 行為，並審查是否能引入樂觀鎖 (Optimistic Locking) 或讀寫分離來徹底解決。
2. **多租戶資料隔離 (Tenant Isolation)**：目前雖然應用層 (Application layer) 已實作檢查，但缺乏 PostgreSQL RLS (Row Level Security)。建議交由 Gemini 設計針對 supabase RLS 的移轉方案與驗證策略。

### 建議交由 Claude Sonnet 4.6 Thinking 提供第二意見：
1. **複雜狀態的 UI 動態回饋**：部分畫面（例如載入大量帳單資料時）的 Skeleton 或 Empty states 設計仍稍顯不足。Claude 在處理複雜的狀態機與使用者動線 (User flows) 上有更好的 UX 直覺。
2. **無障礙體驗 (Accessibility)**：針對螢幕閱讀器與鍵盤導航的優化細節，可讓 Claude 進行進階的 DOM Tree 與 ARIA attributes 二次稽核。
