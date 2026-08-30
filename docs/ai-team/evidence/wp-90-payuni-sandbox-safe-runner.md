# WP-90 — PayUni Sandbox 安全執行器與條件式 Receipt Closure

## 範圍與結論

- 日期：2026-07-30
- 類別：CAT-04 金流、訂閱、退款與帳務
- 執行前分數：4.0／10
- 本包分數：維持 4.0／10（沒有外部 Sandbox receipt，不預支分數）
- 外部結果：`LOGIN_REQUIRED`
- Production：未連線、未使用 credential、未建立付款或退款。

本包把既有 PayUni QA 入口改為只接收受控的 process environment；不讀取 `.env*`，也不允許 dotenv 或 `--env-file`。Runner 先產生僅含 key／boolean 的 availability，再檢查固定官方 Sandbox host 與公開 callback。任一環節不合格都會在付款、callback probe、PayUni API、Browser 或退款操作前 fail closed。

## 本次實際 receipt

在沒有任何 Sandbox process environment 的工作階段執行 `npm run qa:payuni:sandbox`：

- exit：預期的 `1`
- terminal receipt：`executionStatus=LOGIN_REQUIRED`
- availability：全部必要項為 `false`；沒有值、長度、前後綴、hash、卡號、merchant ID 或 request body。
- persisted artifact：`reports/ai-team/qa-payuni-sandbox/20260730T081245303Z.json`
- artifact：只含 schema、UTC、固定失敗狀態、四項未驗證 gate 與安全 failure category；不含交易或 credential。
- 零外部請求證明：`main()` 的第一個可觀察動作是 `assertSandboxExecutionEnvironment()`；在本次缺設定路徑中丟出 `SandboxExecutionBlockedError`，因此不會到達 app URL、callback probe、Browser checkout、PayUni query 或 refund 呼叫。

這是 blocker receipt，不能取代 PayUni Sandbox 付款／失敗／退款／對帳 receipt。

## Deterministic evidence

- `node --check scripts/payuni-sandbox-external-qa.mjs`：PASS
- `npx vitest run scripts/payuni-sandbox-external-qa.test.mjs scripts/payuni-sandbox-external-qa-artifact.test.mjs`：PASS，2 files／30 tests。
- 測試覆蓋：缺少 process environment 時 `LOGIN_REQUIRED` 與 value-free receipt、官方 Sandbox host、Production／相似網域／userinfo／HTTP／顯式 port 拒絕、callback `2xx`／`405` 可達與 localhost／redirect／5xx 拒絕、既有 callback timeout／provider／artifact redaction regression。
- `git diff --check`：PASS（僅 CRLF conversion warning）。
- staged index：empty。

## 安全邊界

- outbound provider allowlist：固定 `https://sandbox-api.payuni.com.tw`；redirect=`error`。
- callback：僅公開 HTTPS、無 userinfo／自訂 port，拒絕 loopback、localhost、private IPv4；probe 採 5 秒 timeout、redirect=`error`，只接受 `2xx` 或 `405`。
- 沒有 Vercel bypass cookie 路徑；文件禁止以 bypass、tunnel 或 `.env.local` 作為替代。
- 不修改 payment route、webhook handler、Prisma schema、資料庫、部署、DNS 或 Production 配置。

## CAT-04 仍缺的 7.5 證據

需要由受控 secret provider 將 Sandbox 專用設定注入 Process Environment，並提供已確認公開的非 Production callback host。之後才可在同一安全入口取得：

1. synthetic `cd_sandbox_<run-id>` payment initiation／成功 callback receipt；
2. 失敗或取消 payment receipt；
3. callback signature／非法 signature 與 duplicate idempotency deterministic／integration evidence；
4. 全額及適用時部分 Sandbox refund receipt，及 duplicate／over-refund rejection；
5. PayUni Sandbox 與本機訂單、invoice、subscription／credit、audit 的 reconciliation receipt。

在這些 receipt 齊備並通過 Sol acceptance 前，CAT-04 不可升至 7.5，也不可標示為 `SANDBOX_READY`。
