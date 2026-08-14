# FUNC-2026-08-07-46｜Verified payment method callback boundary

## 結果

完成 provider-neutral 的付款方式驗證回呼產品邊界。已簽章且由 provider adapter 降維的 setup callback，會以 `WebhookEvent(provider,eventId)` 做冪等收件，再於 Serializable transaction 內重新驗證 vendor 與啟用中的 membership，最後只寫入 verified opaque payment method reference。相同事件 replay 回安全 duplicate；scope 不一致、membership ownership 失效、日期不合法或 provider reference 重用會 fail closed。

回呼事件保存的 payload 只包含 schema、event type、provider、event ID、vendor ID 與 scope type，不保存 raw body、provider payment method reference、card data 或 setup token。未配置 setup callback adapter 時回 501；簽章失敗在 normalization 與資料庫之前回 401。

這是可上線販售流程中的本地後端功能閉環。PayUni 的正式 setup adapter、UPP 參數與 Sandbox receipt 尚未完成，因此本輪沒有宣稱外部付款或 CAT04 驗收通過。

## 實作範圍

- `src/lib/payment-method-reference.ts`
  - 新增 provider-verified setup input boundary、日期驗證、vendor／membership revalidation、cross-scope reference conflict protection 與 verified upsert。
  - 增加 runtime scope validation，避免未來 adapter 的 runtime payload 繞過 TypeScript union。
- `src/lib/payment-providers/types.ts`
  - 新增可選的 setup callback signature verification 與 verified-only payload normalization contract；沒有猜測 PayUni 欄位。
- `src/app/api/webhooks/payment-methods/route.ts`
  - 新增簽章、sanitized event receipt、replay idempotency、Serializable apply 與安全錯誤邊界。
- `docs/codex-goal/API_CONTRACT_REGISTRY.md`
  - 登錄 `POST /api/webhooks/payment-methods` 的 request、replay、錯誤與外部 adapter gate。

## 驗證

- targeted payment／reference／webhook regression：8 files／82 tests，82 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint：PASS，0 errors、0 warnings。
- `git -c core.autocrlf=false diff --check`：PASS，exit 0。
- 沒有 schema／migration 變更；沒有 staging、PayUni、Production、外部付款、部署、push 或 merge 操作。

## 分數與限制

- canonical readiness total 仍為 73.5；CAT04=6.0、CAT10=4.5；`current_goal_score_change=0`。
- 本地 callback boundary 已完成，但沒有 provider-specific PayUni setup implementation、authorized staging reconciliation 或 PayUni Sandbox provider receipt，不能增加 CAT04。
- CAT10 的 merchant onboarding、客服／財務 SLA、法律／隱私／退款政策、外部 monitoring receiver、release owner acceptance 仍需真人或外部可追溯 evidence。
- Global coverage 本輪未重跑；coverage gate 維持獨立 QUAL 工作，沒有降低 threshold、inventory、exclude、skip 或 assertion。

## 安全界線

沒有讀取或輸出 `.env*`、credential、token、cookie、正式 secret、正式客戶資料或付款資料；沒有操作正式 DB、正式付款／退款／寄信、deployment，也沒有重試 FIN-08AA、WP-196、WP-197。
