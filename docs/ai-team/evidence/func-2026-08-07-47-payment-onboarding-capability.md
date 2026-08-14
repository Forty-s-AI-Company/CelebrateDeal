# FUNC-2026-08-07-47｜Payment onboarding capability and event collision closure

## 結果

完成付款方式 onboarding 的三個本地 P1 修正，讓商家看到的狀態與實際可用能力一致：

1. setup action 與 Dashboard 只有在 provider 同時具備 setup session、signed callback verification 與 verified-only payload normalization 時，才視為可發起設定。缺任一能力時，商家頁不再顯示可點擊的設定按鈕，避免導向一個永遠無法寫入 reference 的流程。
2. `POST /api/webhooks/payment-methods` 遇到同一 provider／event ID 已被其他 webhook event type 使用時，回安全 409 `event_id_collision` 並寫入 bounded audit；不把付款事件誤判為 setup replay，也不改寫既有付款 event。
3. 商家 Dashboard onboarding checklist 新增「設定付款方式」，只在目前 vendor 有 verified 且未過期的 payment method reference 時標記完成，並以 vendor scope 與 expiry 條件查詢。

這輪仍沒有猜測 PayUni setup 欄位或宣稱外部 adapter 完成。官方公開資料確認 PAYUNi 支援續期收款與 Token 綁卡能力，但未提供本專案可直接驗證的 setup callback／UPP 欄位契約，因此 PayUni adapter 與 Sandbox receipt 仍是外部規格與授權 gate。

## 實作範圍

- `src/lib/payment-method-setup.ts`
  - 新增 coherent setup capability predicate，並以 type predicate 讓 server action 安全呼叫完整 capability。
- `src/app/actions/payment-method-actions.ts`
  - action gate 從單一 setup session method 改為三件能力一致存在。
- `src/app/(app)/billing/payment-methods/page.tsx`
  - provider 未具備完整能力時顯示不可操作狀態，不呈現可點擊 setup form。
- `src/app/api/webhooks/payment-methods/route.ts`
  - 增加 payment／setup webhook event ID collision fail-closed boundary。
- `src/lib/dashboard-checklist.ts`、`src/app/(app)/dashboard/page.tsx`
  - 將有效付款方式納入商家 onboarding checklist。

## 驗證

- targeted regression：10 files／73 tests，73 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- 沒有 schema／migration 變更；沒有 staging、PayUni API、Production、外部付款、部署、push 或 merge 操作。

## 分數與限制

- canonical readiness total 仍為 73.5；CAT04=6.0、CAT10=4.5；`current_goal_score_change=0`。
- PayUni `createPaymentMethodSetupSession`、setup callback signature verification、payload normalization 與 Sandbox receipt 仍未完成，不能增加 CAT04。
- 已驗證 reference 尚未接到 recurring renewal／overage auto-charge orchestration；本輪只修正 onboarding capability 與 fail-closed routing，不把它誤寫成自動扣款完成。
- CAT10 真人 merchant、support／finance SLA、legal/privacy/refund review、external monitoring delivery 與 release owner acceptance 仍 pending。
- Global coverage 本輪未重跑；沒有降低 threshold、inventory、exclude、skip 或 assertion。

## 外部規格查核

- PAYUNi 續期收款說明：<https://www.payuni.com.tw/period>
- PAYUNi 公開 API／服務說明 PDF：<https://www.payuni.com.tw/docs/Public/Uploads/2024-07-17/669727506d19e.pdf>

這些公開資料足以支持「能力存在」的判斷，不足以安全產生本專案所需的 setup callback payload mapping；未以推測欄位修改 adapter。

## 安全界線

沒有讀取或輸出 `.env*`、credential、token、cookie、正式 secret、正式客戶資料或付款資料；沒有操作正式 DB、正式付款／退款／寄信、deployment，也沒有重試 FIN-08AA、WP-196、WP-197。
