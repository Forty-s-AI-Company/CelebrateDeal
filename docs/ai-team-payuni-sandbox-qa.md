# AI Team PayUni Sandbox QA

AI Team 的 `delivery-qa` 外部驗收現在會在變更成功合併到 staging source revision 後執行一次。測試使用 headless Playwright 操作 staging 直播頁，並驗證：

1. PayUni Sandbox 結帳與付款回呼
2. PayUni 查詢結果與 CelebrateDeal 訂單對帳
3. 由 CelebrateDeal 財務後台發起 Sandbox 退款、退款狀態回查，以及 `PaymentTransaction=refunded`、單筆 `RefundRecord=processed` 的冪等性驗收

## Staging 版號 Gate（每次測試前必做）

PayUni Sandbox QA 不得直接沿用瀏覽器目前看到的頁面或上一包 receipt。開始付款、callback、provider query、退款或對帳前，先確認：

- 精確 Vercel project 與 staging host 正確，且不是主站 Production。
- staging alias 指向目前 workspace 對應的最新 `READY` deployment ID／URL。
- deployment revision／digest、route/build status 與本次要驗收的 workspace 一致。

若 staging 不是最新版本、alias 仍指向舊 deployment，或無法證明版本一致，必須先更新到同一個 staging project，再重新確認 `READY`、alias 與精確 route；在 freshness gate 通過前，PayUni request、callback、退款、provider query、reconciliation 與 Browser assertion 全部不得開始。部署失敗或版本無法比對時，保存遮罩化 evidence 並以 `DEFERRED_WAITING_STAGING_VERSION`／`TOOL_BLOCKED` 停止，不得用舊版測試結果代表新版。

每次新 WP、新 deployment、workspace dirty 變更或 alias 變更都要重新執行此 Gate。Receipt 只保存 project、host、deployment ID／URL、revision／digest、build／route status 與 timestamp，不保存 `.env*`、secret、token、cookie 或 raw body。

AI Team 的安全規則與測試入口已整理到 `docs/ai-team/testing-playbook.md` 與 `docs/ai-team/security-checklist.md`。實際命令為 `npm run qa:payuni:sandbox`；它只會使用呼叫端已安全注入的 **process environment**，絕不讀取 `.env*`、不接受 dotenv、也不輸出變數值。

啟動前，受控的 secret provider 或工作階段 process environment 必須提供 Sandbox 專用的付款、callback、synthetic card 與 QA 登入設定。Runner 只記錄各必要設定是否存在（`true`／`false`）；缺少任何必要值會在任何網路請求前以 `LOGIN_REQUIRED` 結束。不得用 `.env.local`、shell sourcing、複製 secret 到命令列、或手動貼入卡號作為替代。

Runner 固定只允許 `https://sandbox-api.payuni.com.tw`，拒絕 Production、相似網域、userinfo、非 HTTPS 與任何顯式連接埠；HTTP redirect 會 fail closed。已知正式網域 `celebratedeal.carry-digital-nomad.in.net` 亦會被 Staging callback 驗證拒絕。

Staging callback host 必須可由未登入的外部服務直接連線。QA 會在輸入測試
卡前以不追蹤 redirect 的短時限 probe 檢查 `GET /api/health`；只有 `2xx` 或明確的 `405` 可繼續，其他回應、DNS／網路失敗、redirect 或私有／loopback host 都會直接停止。
不得在 `ReturnURL`、`NotifyURL`、PayUni Dashboard 或任何使用者可見網址加入
`x-vercel-protection-bypass` 或 `VERCEL_AUTOMATION_BYPASS_SECRET`。PayUni 會保存
NotifyURL，且付款完成後會把 ReturnURL 顯示給付款者。

若 Preview 受 Vercel Authentication 保護，請由環境 owner 建立獨立且公開的非 Production Staging host，再將受控環境中的 callback 設定指向該 host。不要以 Shareable Link 或 automation bypass URL 取代公開 callback host；本 WP 不會部署、建立 DNS 或公開 tunnel。

若設定未注入，AI Team 會記錄 `LOGIN_REQUIRED`，零 PayUni request 後停止，不會反覆建立交易。若 callback 不可達或 host 不安全，會記錄 `TOOL_BLOCKED`。只有全部 preflight 通過後才可建立合成 Sandbox 訂單；若驗收失敗，該 revision 會停在 `external-qa-failed`，等待下一個受控修正後重新驗收。

收據只保存 revision、通過的檢查摘要、錯誤分類與輸出雜湊，不保存卡號、HashKey、HashIV、Webhook Secret 或原始瀏覽器輸出。
