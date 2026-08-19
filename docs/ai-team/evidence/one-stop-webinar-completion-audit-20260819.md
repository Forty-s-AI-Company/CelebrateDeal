# CelebrateDeal 一條龍研討會完成稽核（2026-08-19）

本文件只記錄目前工作樹與實際指令可支持的證據；沒有把未執行的 browser、資料庫或 staging 驗收寫成通過。

| Work Package | 需求面向 | 目前證據 | 判定 |
| --- | --- | --- | --- |
| WP0 | 基線、環境預檢、既有品質流程 | `scripts/preflight.ts`、`scripts/preflight-build-contract.test.ts`；CI 與 production build 使用合成 runtime 設定 | production build、TypeScript 與 targeted ESLint 已通過 |
| WP1 | 場次／角色／通知資料、上傳、富文字與日期 UX | `prisma/schema.prisma`、`20260815090000_g8_01_one_stop_webinar_domain`、`20260815100000_g8_02_interaction_role_semantics`、`src/lib/rich-text.ts`、`src/components/media-upload-field.tsx` | 元件／領域測試與 migration runner 已驗證；隔離 schema 的 57/57 migrations 通過 |
| WP2 | 影片、商品、品牌、報名頁、Email、角色、黑名單後台 | `src/components/media-upload-field.tsx`、`src/components/form-builder.tsx`、`src/components/message-template-form.tsx`、`src/app/(app)/blacklists/page.tsx` | 後台與營運保護測試已通過；production build 可產生全部頁面 |
| WP3 | 直播建立導引、發布檢查、草稿與預覽 | `src/components/live-stepper-form.tsx`、`src/lib/live-publish-readiness.ts`、`src/app/(app)/lives/new/page.tsx` | 發布／導引測試已通過；完整流程的資源綁定由 WP7 瀏覽器測試覆蓋 |
| WP4 | 報名驗證、確認與提醒／課後 Email、退訂、黑名單、冪等 | `src/lib/form-submission-verification.ts`、`src/lib/live-notification-delivery.ts`、`src/lib/post-live-followup.ts`、`src/lib/email-delivery-operations.ts` | 路由／領域、營運保護與 DB integration 已通過；5 個 DB 檔案共 26 tests passed |
| WP5 | 等候／播放、指定秒數留言與商品浮窗、真實與排程角色區隔 | `src/components/live-playback.tsx`、`src/components/live-chat-panel.tsx`、`tests/e2e/wp7-one-stop-webinar-flow.spec.ts` | 系統 Chrome 實際瀏覽器驗收通過；包含手機 RWD、排程留言、指定秒數商品浮窗與 axe blocking 檢查 |
| WP6 | 內部結帳跨頁同一播放器、直接結帳不偽造播放 | `src/components/persistent-live-playback.tsx`、`src/components/checkout-overlay.tsx`、`tests/e2e/commerce-orders.spec.ts` | WP7 runtime 實際確認同一 video 節點、播放狀態延續、待付款訂單與直接／刷新結帳不虛構直播；另修正小窗攔截表單點擊 |
| WP7 | 分離真實／模擬分析、公告、CI、RWD 與一條龍驗收 | `src/app/(app)/lives/[id]/analytics/page.tsx`、`src/components/announcement-center.tsx`、`.github/workflows/ci.yml`、`scripts/g7-commerce-browser-qa.mjs` | WP7 Playwright 2/2 passed；staging 未部署，原因是 Vercel 額度已滿 |

## 本輪可重現的通過證據

- 商家／觀眾端元件與領域：`npx vitest run ...`，12 個檔案、160 tests passed。
- 營運保護：`npx vitest run ...`，15 個檔案、93 tests passed。
- Email、課後通知、直播分析與結帳歸因：5 個檔案、63 tests passed。
- browser runner 靜態契約：`node --test scripts/g7-commerce-browser-qa.test.mjs`，33 tests passed。
- 隔離 PostgreSQL：`celebratedeal_e2e` 的 `g7_04_browser_9d8cc1fe02b64b2a` schema，既有 migration 57/57 套用成功；測試結束後已刪除 disposable database。
- WP7 runtime browser：本輪暫存 runner 使用系統 Chrome 執行，2/2 tests passed；runner 已在驗收後清理，涵蓋手機報名／直播／商品浮窗／結帳與直接結帳頁。
- WP7 runtime 證實 `video` 節點在結帳跨頁保持同一個 DOM identity，播放位置／互動狀態延續，並建立 `pending_payment` 訂單而沒有建立 paid 訂單。
- 公告與 production 設定契約：3 個檔案、9 tests passed。
- `npx vitest run` 最終 targeted suite：4 files、120 tests passed；`npm run typecheck`、targeted ESLint 與 `npx next build --webpack` 均通過。

## 尚未完成的項目與原因

1. staging 驗收：Vercel 今日額度已滿；本輪沒有 push、merge、Production deploy 或 staging deploy。這是線上環境尚未驗收，不是本機功能未完成。
2. 正式寄信與外部媒體服務：本輪使用測試信箱／合成媒體 URL，尚未呼叫正式 Resend、Cloudflare 或正式客戶資料。
3. 正式金流：依原計畫排除；目前只建立 `pending_payment` demo 訂單，不代表已完成收款。

## Vercel 額度恢復後的最小驗收順序

1. 使用 staging 測試信箱與 staging 媒體服務部署，不使用正式客戶或付款資料。
2. 線上驗收最新消息 v13、報名驗證、直播互動、商品浮窗、持續播放器與 demo 結帳。
3. staging 通過後，再另行授權正式寄信、Live Input 與正式金流設定。
