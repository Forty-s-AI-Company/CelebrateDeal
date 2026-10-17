# WP-11 非 Production 入口部署檢查

本文件僅涵蓋本機與獨立 Preview。Production 拓撲尚未驗證，屬 release blocker，不可將 Preview 證據視為 Production 部署核可。

| 環境 | 來源設定 | 限流儲存 | 驗證要求 |
| --- | --- | --- | --- |
| Vercel 獨立 Preview／staging Preview | ENTRY_CLIENT_IP_TRUST_MODE=vercel-native、ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE=vercel、ENTRY_CLIENT_IP_TOPOLOGY=direct-vercel；EXPECTED_PROJECT_ID 必須匹配平台 VERCEL_PROJECT_ID，VERCEL_ENV 必須 preview | upstash_redis；連線資訊由核准 process／平台 secret provider 注入 | `/api/health/entry` 200 且兩個實際出口來源 probe 通過；不能用自行偽造的 header 取代部署 probe |
| 本機 owned ingress | cloudflare/cloudflare proof 模式；代理覆寫來源 IP 及 proof header | memory 僅本機單程序 | localhost ingress 使用合成 proof，確認直接 origin／偽造 proof 被拒，瀏覽器流程成功 |
| 本機提供 request.ip 的 runtime adapter | runtime/node | 本機 memory | 必須證明 adapter 實際提供 ip；Next Request 不會因 header 存在而自動獲得 runtime IP |
| Preview 上受控 proof ingress | cloudflare/cloudflare 或 trusted-proxy/vercel；ENTRY_CLIENT_IP_INGRESS_SECRET 經平台注入 | upstash_redis | 實測代理覆寫 proof 與來源 IP；不能假設 fronting proxy 的 egress 就是使用者 IP |

完整變數名稱為 `ENTRY_CLIENT_IP_EXPECTED_PROJECT_ID`。不得讀取 `.env*`、列舉 secret store 或輸出憑證。Redis 設定只由應用程式在執行時使用；readiness 僅回報固定類別，不回傳值。

`/api/health/entry` 的 `topologyProbeRequired: true` 表示此檢查只證明設定格式與必要欄位存在，未證明外部網路、Redis 可連線或來源覆寫行為。實際 smoke 另須包含 portal、voucher、admission、referral、chat GET/POST、private chat 與 purchase broadcasts；只登入頁 200 不足以驗收。

已明確設定 ENTRY 模式的部署，入口及直播聊天使用同一個 ENTRY proof 與解析器。無效的 ENTRY 設定不退回舊聊天設定。未設定 ENTRY 時僅保留舊聊天來源契約相容性，入口 readiness 仍失敗，因此不可視為完整 WP-11 部署。

原始 IP 用於業務存取判斷；native IPv6 /64 只用於限流 bucket。未知 IP 的聊天讀取／購買廣播在觸及限流器及業務資料庫前回應 503，不共用 unknown bucket。推薦入口 503 會產生固定 `platform_referral_source_unavailable` 事件，不附帶 request 資料；429 不產生該事件。

`cloudflare_waf` 沒有本次新增路由的遠端規則證據，遠端 memory 沒有跨实例共享額度，readiness 不將兩者視為本次可接受部署。Production 仍為未驗證／未授權狀態。

回滾僅回復該獨立 Preview 的精確 patch 或刪除本次建立的 Preview；不得修改既有 staging alias、使用者 dirty 工作樹或停用安全檢查來通過驗證。
