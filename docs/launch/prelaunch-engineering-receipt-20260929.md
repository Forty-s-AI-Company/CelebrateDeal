# Prelaunch 工程與非正式環境驗證收據

日期：2026-09-29（Asia/Taipei）

候選分支：`codex/prelaunch-engineering-20260929`

來源基準：`bdbae2f53491afd518b97ee597e117d6a585b55c`（`origin/master`）
範圍：隔離 worktree、合成資料、disposable PostgreSQL；正式付款、退款、寄信、資料庫與 Stream 資源均未操作。

## AI Team 路由與 ownership

Requested／effective team：`ai-team-pro`。Canonical router 對 WP1 選 Luna high、WP2 Critical 候選選 Sol high；主代理保有整合、修改、測試與最終判斷權。Critical review 計畫先試 Opus；agy 唯讀呼叫因 host command permission 無法完成實質審查，記為 `HOST_PERMISSION_BLOCKED`，未標成 PASS。改由獨立 Astra high reviewer 唯讀檢查 WP2／WP4，review findings 由主代理修復並重新測試；實際 provider 觀測不到的 model／effort 欄位記 `unknown`。本次單一 reviewer、depth 1、dispatch budget 4、max parallel 1、automatic spawn false；未啟動正在修改的 AI Team 修改自己。

## WP1：來源與阻擋盤點

逐項執行庫存見 [prelaunch-executable-inventory-20260929.md](prelaunch-executable-inventory-20260929.md)。固定 Staging 的四份既有成功收據都綁 `5d5b8146`；核心桌面／手機、R2、單次 PayUni Sandbox 付款、Stream 資源旅程各有自己的成功範圍。付款收據的 `reconciled=false`，Stream 的 `accountCredentialIsolation` 與 `nonProductionScope` 為 `UNVERIFIED`。這些舊收據不繼承至本候選 SHA。

## WP2：付款方式一次性授權候選

- 新增 15 分鐘 consent intent、登入 actor 與 vendor／membership 複合綁定；只存 nonce SHA-256，callback 必須經 provider 驗簽、時間及 scope 核對，且和 reference 寫入位於同一 Serializable transaction。
- 使用者明確勾選同意後才建立 intent；`form_post` 只准目前已知且依 `PAYUNI_ENV` 選定的 PayUni UPP 完整 URL。未核准 redirect 一律拒絕。
- 7 個相關測試檔共 31 項通過，含 disposable PostgreSQL rollback 與兩個不同事件競爭消耗；新 migration 在合成 PostgreSQL 套用成功。獨立 Critical 複審對此候選無 finding。
- **仍未完成：**PayUni adapter 的 setup session、簽章 callback 與 revoke 方法。官方 UPP／Token 欄位與 Sandbox merchant 核准尚無可驗證來源，故固定 Staging 沒有真實綁卡或 verified reference 收據；正常專案發布仍受 gate 阻擋。一般付款成功不可視為綁卡。
- PayUni 的[官方 UNi Embed 範例](https://github.com/payuni/UNiEmbed-uniPayment)支持「使用者同意且該次交易授權成功後才綁定」以及後續 `CreditHash` 使用；[官方 PHP SDK 說明](https://github.com/payuni/PHP_SDK/blob/main/README.md)列出 UPP、Token 查詢與取消模式。兩者未提供本候選所需的完整 callback 欄位／merchant 授權收據，故不據此猜測 setup payload。

## WP3：建立、發布與交付

- `publishSalesProjectAction` 的付款方式查詢已收緊為存在且不晚於現在的 `verifiedAt`，並仍要求 vendor scope、verified 狀態與未過期；不能用僅有 status 的資料通過。
- 專案建立、Funnel 公開頁、表單、checkout admission、訂單與 entitlement 的單元及 disposable DB 測試已納入全量測試。這些只支持本機程式路徑，**不宣稱**固定 Staging 匿名桌面／手機完整旅程通過。
- 正常 action 發布仍依賴真正 verified payment reference。合成 staging 專案保留 draft、匿名公開頁保留 NOT_FOUND；未直接改 DB 狀態。

## WP4：退款與對帳

- 退款寫入路徑在 provider 呼叫及 reservation 前新增整數、正金額、非負費用檢查；7 個不合法金額案例證明無 provider 呼叫與 DB reservation。
- 獨立審查發現並修復兩個 MAJOR：結果不明時不能僅靠暫時未增加的累計查詢釋放 reservation；帳務去重鍵改綁每筆本地 refund record，避免同一 provider trade ID 的兩次部分退款碰撞。4 個相關檔案 28 項針對性測試通過。再新增 disposable PostgreSQL 整合測試，以同一 provider ID 連續退 400＋800 分，真實 accounting 寫入兩筆 order refund／event、兩筆佣金沖銷（-40、-80 分），全額退款後撤銷數位 entitlement 並清除 access capability；單項測試通過。仍未連接外部 provider。
- 既有寫入路徑使用 Serializable reservation、剩餘金額及 fee ceiling、provider outcome ambiguous 鎖定、再由只讀 provider snapshot 對帳；舊 Sandbox WP-103／104／105 支持全額、重複與部分退款的歷史情境，本候選未重送交易。
- **仍未完成：**目前 PayUni Sandbox 單次付款收據的 `reconciled=false`；未取得同一候選下可信 provider／本地交易、退款、權限及 ledger 一致性收據。結果不明不可自動重試或標記已退。

## WP5：migration、備份與恢復

- 合成 loopback PostgreSQL 17.10 中套用全部 80 筆 migration。從來源庫產生 `public` schema custom-format dump，還原到 `--network none`、tmpfs 的另一個 disposable PostgreSQL 17 容器；來源與還原庫均為 80 筆已完成 migration、121 張 `public` 資料表，且 `PaymentMethodSetupIntent` 表存在。
- 隔離恢復時預先在 `public` 安裝 `pg_trgm`、`pgcrypto`，並從 archive TOC 排除已存在的 `public` schema 建立項目。最初直接還原因 schema 已存在及 `public.gin_trgm_ops` 缺失而失敗；修正容器初始化後，`pg_restore --exit-on-error` 成功。只聲稱 **合成應用 schema** 可還原；未宣稱完整 Supabase project、媒體或外部設定恢復。
- 舊 RC 加密備份收據的 validator 固定驗證來源 commit 的 migration tree；新增第 80 筆 migration 後仍可驗證歷史 79 筆封存，未知 validator blob 仍被拒絕。32 項備份／恢復針對性測試通過；獨立審查確認新版 validator 的執行期依賴仍在既有 blob allowlist 邊界內。
- 正式 Staging 加密備份恢復 runner 仍缺受保護 Environment 的 staging 專用 age 公鑰／私鑰與有效固定 artifact；因此 `recoverability=PROVEN_ISOLATED` 不能套用至真 Staging，候選 migration 也未獲 Staging 授權。

## WP6：營運與政策

- Email worker 的 5 次上限、有限退避、exhausted 狀態及 audit，與 webhook retry、LINE 通知及對應測試已盤點。Preview 不註冊 Cron，尚無同一候選的排程和去識別寄送收據；未對真實收件者寄信。
- [付款退款事件 SOP](../operations/payment-refund-support-incident-sop.md) 已包含 P0／P1／P2、狀態不明停止條件、角色與去識別交接模板；新增[資料請求接案 SOP](../operations/data-request-and-support-intake-sop.md)整理身分、租戶、保存衝突與正式資料操作 gate。公開 Terms／Privacy／Refund 頁仍是草稿。[CAT10 人工審查矩陣](cat10-policy-review-matrix-20260821.md) 尚未有 policy／finance／support owner acceptance。資料保存期限、刪除例外、provider 資料流與正式退款資格仍需真人決定。

## 集中 owner 工作

| 順序 | Owner 需提供的具體決定／收據 | 解除後可執行的安全工作 |
|---|---|---|
| 1 | 正式商店 Token 開關已有截圖；請先核對「賀成交AI x CelebrateDeal」Sandbox 商店的 Token／約定扣款權限。若未啟用或無法自行啟用，再向 PAYUNi 確認申請方式；另需 UPP／Token 契約、後台 IP 與 callback 欄位的非敏感證據 | 實作 adapter、簽章 callback、revoke 並以新的 Sandbox 綁卡收據驗證；其後才驗證正常發布 |
| 2 | Cloudflare Stream 測試帳號／憑證與 Production 隔離的可核對證據 | 僅在隔離確認後做新的非正式環境資源旅程；不讀既有或正式資源 |
| 3 | 受保護 Staging Environment 的專用 age key pair 配置、可用加密備份 artifact 與 Preview／資料庫隔離收據；Secret 不進文件 | 執行固定隔離恢復 runner、候選 migration 相容性及 rollback gate，再決定是否更新 Staging |
| 4 | PayUni 對帳可用的去識別 provider snapshot／權限與精確 scope | 只讀比對同一來源的付款、退款、訂單與 ledger；有 MISMATCH／UNKNOWN 即停止 |
| 5 | Staging scheduler 選擇與核准的合成寄送目標 | 驗證排程、有限重試、exhausted 告警及不重複投遞 |
| 6 | Policy／privacy／finance／support／release owner 逐項核准的版本、生效日、適用範圍、保存規則、退款條件與 escalation SLA | 更新公開政策及營運 runbook，保留去識別 acceptance receipt |

所有未有來源或真人決議的項目仍是 `UNKNOWN`／`PENDING_HUMAN`，不推論為 Production ready。

## 本機驗證結果與限制

| 檢查 | 結果 |
|---|---|
| Prisma validate／generate、PostgreSQL migration deploy | PASS；合成 loopback DB 80/80 migrations |
| TypeScript `npm run typecheck` | PASS |
| ESLint `npm run lint` | PASS；3 筆既有 `<img>` 效能警告，0 errors |
| Vitest coverage 階段 | 563 files／4,015 tests PASS；既定 coverage 門檻未調降 |
| Node 契約階段 | 1,059/1,062 PASS；3 項歷史 SHA 驗證在 Windows checkout 失敗，未修改的乾淨 master worktree 也同樣失敗。工作樹檔案的 CRLF SHA 與 manifest 記錄的 Git blob SHA 不同；未改動雜湊 assertion 或歷史 evidence。Linux PR CI 需再次確認。 |
| 獨立複審 | WP2 無 finding；WP4 的 2 個 MAJOR 與 1 個 MINOR 已修復並複審關閉。 |

既有 `.github/workflows/ci.yml` 對每次 push 執行 ESLint、單元／coverage 與 migration 檢查，符合此候選的 GitHub Actions gate；不另建重複 workflow。
