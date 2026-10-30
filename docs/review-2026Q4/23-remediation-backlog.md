# 23 修復 Backlog（E-01 前置）

> 基線 `78621ca3`。依 `10-findings-register.md` 的去重列，按「風險 × 商業價值 ÷ 估工」排序並分成 L0～L3。唯讀；估工沿用原報告，缺的標「未估」。原任務指定檔名 `20-remediation-backlog.md`，因編號 20 已被死碼報告使用，改存為本檔。

## 0. 先講結論

1. **L0 核心（不可繞過）18 項，合計 11.75–22.25 人日**；另有 **L0 可繞過 22 項，18.2–34.7 人日**，以及 6 項零工程或條件式的設定與決策。核心本身就超過 10 人日，但分成兩條 engineer-hard 與一條 engineer 並行時，最長的一條約 5–9.5 人日，落在 10 個工作天內（見 §3.2，不含 reviewer 等待與 owner 決策延遲）；可繞過的項目時間不夠就改用設定或人工流程撐過封測。
2. L0 核心依分數排序的前 10 項：1. F-101：移除內部備註，依 `resolvePolicyStatus` 顯示生效日；2. F-079：`(viewer)` 與根層繁中 not-found；global-error 加重新整理與回首頁；3. F-103：預設勾選或改名「可用於腳本發言」、腳本頁無角色時給連結；4. F-031：①env 文件與備份 runbook 註明 `CSRF_SECRET` 為資料根金鑰、禁止輪替、還原必備；5. F-090：`vercel.json` 寫 `regions: ["hnd1"]`、pooler URL 參數、preflight 檢查並記錄 `VERCEL_REGION`；6. F-110：`formatDateTime` 預設 `Asia/Taipei`；標籤改「台灣時間」；7. F-024：rebase #436、反轉 `auth.test.ts:224`、表驅動 `/admin/**` 測試；8. F-026：唯讀查 `relrowsecurity` 與 `has_table_privilege('anon', …)`；有權限即補全表 RLS migration；9. F-168：QA 帳號建立因子、TOTP seed 放 staging secret、runner 以 seed 算碼；10. F-042：選定排程器（Cloudflare Worker cron 或 Vercel Cron）、4 個 POST-only job 補可排程入口、改 `scheduler-config` 測試、runbook。
3. 分數只反映「單位人日的風險降低」，不代表開工順序。三個長項（F-037 PayUni 回呼、F-042 排程、F-058 備份演練）分數較低，但封測客戶的錢、通知與資料可回復性都依賴它們，**第一天就要開工**。
4. owner 外部動作有四個硬期限：PayUni Token（T1，決定 F-002 能否繞過）、LINE 官方帳號方案 **10-27 前**、Supabase 方案升級（F-058 的前提）、法定資料與律師審閱的商家服務條款（F-104、F-114 的前提）。見 §7。
5. 原報告標「封測前必修」但本檔放到 L1 的主要是：月結與撥款相關的四項（封測免費、最早 12 月才有第一次月結）、訂單號唯一鍵（封測量低）、退款死碼（封測只用 PayUni）、狀態徽章與工程術語（不會卡住，創辦人導入時說明）。理由見各列。

## 1. 前提與排序方法

### 1.1 封測前提（來自 goal plan 與 owner 決策）

- 2026-11-01 封測，免費提供給幾位客戶；距今約 10 個工作天（§2.3）。封測不等於 Production 上線；Production 部署與正式付款仍需另行授權（§9.2）。
- 封測期間付款走 Sandbox 還是正式，owner 尚未決定（§9.2）。本檔以「可能有真實買家付款」為保守前提；若確定只走 Sandbox，F-058 可依原報告降為 MAJOR，但報名與留言仍是真實個資，備份仍建議做。
- 平台方案費封測不收（billing 隱藏），第一次商家月結最早在 12 月初，所以月結與撥款類缺陷放在 L1，並以「封測期間不鎖月結、不撥款」作為過渡。
- 聯盟開放但只累計不出款；虛擬使用者採不標示版；台灣為主市場；重寫選項開放但封測一律跑現有程式碼（§2.3、§9）。

### 1.2 分數公式

分數＝R（風險）× V（商業價值）÷ E（估工中位數，人日）。

- **R**：BLOCKER＝5、MAJOR＝3、MINOR＝2、NIT／未分級＝1；若後果屬「封測客戶卡住、錢算錯、資料外洩、無法復原」任一類，再加 1（上限 5）。
- **V**：依模組在封測的市場價值。直播、報名表單／Funnel、商品結帳、LINE 通知＝5（市場研究的封測核心模組）；auth／tenant、跨模組共用 UI＝4；infra／CI、tracking、affiliate＝3（infra 中直接影響正式環境可用性的排程、備份、Sentry、區域、migration 防護個別調為 4～5）；billing、courses＝2（封測隱藏）；admin ops 與純文件／CI 衛生＝1。個別調整在表中以分數算式呈現。
- **E**：區間取中位數，最小以 0.5 人日計（避免 15 分鐘的小項分數失真）；未估者與「隨某項一起做的子項」不計分，排在該層最後。

### 1.3 層級定義

| 層級 | 放什麼 |
|---|---|
| L0 核心 | 不修就會讓封測客戶卡住、錢算錯、資料外洩或無法復原，且沒有可靠的設定或人工繞法 |
| L0 可繞過 | 同樣屬於上述後果，但封測期間可改用設定或人工流程撐住；時間夠就修，不夠就照「繞過方式」執行 |
| L0 設定 | 零或極少工程、由 owner 在外部服務完成的設定與決策 |
| L1 | 封測期間可修：不會卡住封測、或觸發條件在封測後段才出現（例如第一次月結） |
| L2 | 公開上線前必須處理 |
| L3 | 之後／重構，不阻擋上線 |

### 1.4 估工換算

S＝0.5、M＝0.5–2、L＝2–4、S–M＝0.5–2、M–L＝1–4（人日）；小時以 8 小時＝1 人日換算（15 分鐘、1 小時記 0.05～0.1）；「方案 b 0.5／方案 a 5 以上」記 0.5–5。合併列取涵蓋最完整的來源數字，不重複相加。

## 2. 各層合計

| 層級 | 項數 | 人日（低–高） |
|---|---:|---|
| L0 核心 | 18 | 11.75–22.25 人日 |
| L0 可繞過 | 22 | 18.2–34.7 人日 |
| L0 設定／決策 | 6 | 0.5–0.5 人日（另 2 項未估） |
| **L0 合計** | **46** | **30.45–57.45 人日（另 2 項未估）** |
| L1 | 48 | 39.05–66.05 人日（另 1 項未估） |
| L2 | 65 | 53.8–75.3 人日 |
| L3 | 21 | 43.15–59.65 人日 |

一列 finding 可能拆成不同層的段落（例如 F-031 的①在 L0、②③在 L2），所以項數是「段落數」。人日不含 reviewer 時間。

## 3. L0 封測前必修

### 3.1 核心（不可繞過）

| 序 | ID | 項目 | 派工 | reviewer | 依賴 | 估工（人日） | 分數 R×V÷E |
|---:|---|---|---|---|---|---|---|
| 1 | F-101 | 移除內部備註，依 `resolvePolicyStatus` 顯示生效日 | engineer | 否 | owner 確認 #435 條款版本 | 0.5 | 5×5÷0.5＝50.0 |
| 2 | F-079 | `(viewer)` 與根層繁中 not-found；global-error 加重新整理與回首頁 | engineer | 否 | — | 0.5 | 4×5÷0.5＝40.0 |
| 3 | F-103 | 預設勾選或改名「可用於腳本發言」、腳本頁無角色時給連結 | engineer | 否 | — | 0.5 | 4×5÷0.5＝40.0 |
| 4 | F-031 | ①env 文件與備份 runbook 註明 `CSRF_SECRET` 為資料根金鑰、禁止輪替、還原必備 | docs | 否 | — | 0.5 | 4×4÷0.5＝32.0 |
| 5 | F-090 | `vercel.json` 寫 `regions: ["hnd1"]`、pooler URL 參數、preflight 檢查並記錄 `VERCEL_REGION` | engineer | 否 | owner 確認 production 區域與 Supabase pooler | 0.5 | 4×4÷0.5＝32.0 |
| 6 | F-110 | `formatDateTime` 預設 `Asia/Taipei`；標籤改「台灣時間」 | engineer | 否 | — | 0.5 | 4×4÷0.5＝32.0 |
| 7 | F-024 | rebase #436、反轉 `auth.test.ts:224`、表驅動 `/admin/**` 測試 | engineer-hard | 是 | F-168（B11-01）先完成；owner 說 OK 才合併 | 0.5–1 | 5×4÷0.75＝26.7 |
| 8 | F-026 | 唯讀查 `relrowsecurity` 與 `has_table_privilege('anon', …)`；有權限即補全表 RLS migration | engineer-hard | 是（若有 migration） | owner 授權唯讀查詢 | 0.5 | 3×4÷0.5＝24.0 |
| 9 | F-168 | QA 帳號建立因子、TOTP seed 放 staging secret、runner 以 seed 算碼 | engineer-hard | 否（隨 #436 一併審） | F-024 合併前 | 0.5–1 | 4×4÷0.75＝21.3 |
| 10 | F-042 | 選定排程器（Cloudflare Worker cron 或 Vercel Cron）、4 個 POST-only job 補可排程入口、改 `scheduler-config` 測試、runbook | engineer-hard | 是 | owner 選排程器與方案 | 1–2 | 5×5÷1.5＝16.7 |
| 11 | F-104 | 方案 A：標籤改選填、移除 fallback、改寫四處文案與條款揭露、統一用語 | engineer | 否 | F-103 同檔先做；律師審商家服務條款 | 0.5–2 | 4×5÷1.25＝16.0 |
| 12 | F-107 | 欄位改「直播網址」、由標題產生預設、撞名回欄位錯誤、草稿存檔即時檢查 | engineer | 否 | 動到 `actions.ts:816`，與其他 `actions.ts` 寫入者錯開 | 0.5–2 | 4×5÷1.25＝16.0 |
| 13 | F-113 | 腳本改選配或一鍵套用預設腳本；導引只列必要項目 | engineer | 否 | owner 決策（若維持強制則本項 0 人日） | 0.5–2 | 4×5÷1.25＝16.0 |
| 14 | F-143 | 明確關閉 cookies／queryParams／stackFrameVariables、headers 白名單、scrubber＋單元測試 | engineer | 否 | — | 1 | 4×4÷1＝16.0 |
| 15 | F-058 | owner 升級方案後做一次隔離還原演練，記錄 RTO 與帳務彙總一致性；補 staging age 金鑰 | engineer-hard | 否（收據由主對話檢查） | owner 升級 Supabase 方案；F-031①；F-074 | 1–2 | 5×4÷1.5＝13.3 |
| 16 | F-114 | 註冊加必勾選條款與隱私連結並記錄版本與時間；標題改「建立你的商家帳號」 | engineer-hard | 是（若新增 schema） | 律師完成商家服務條款；#435 條款 owner 簽核 | 0.5–2 | 4×4÷1.25＝12.8 |
| 17 | F-037 | 只有 `SUCCESS`＋`TradeStatus=1`＋允許的 `PaymentType` 才算 paid；UPP 限刷卡；eventId 改 `TradeNo:TradeStatus`；真實格式 fixture 與 DB 回歸測試 | engineer-hard | 是 | owner／T2 提供去識別化 Sandbox Notify 樣本 | 2–3.5 | 5×5÷2.75＝9.1 |
| 18 | F-074 | runbook 明定擴充 schema、還原腳本預建擴充（F-058 的子項，不單獨排序） | engineer-hard | 否 | 與 F-058 同一次演練 | 0.25 | — |
| | | **合計** | | | | **11.75–22.25 人日** | |

### 3.2 依賴順序與並行

同一時間每個檔案只有一個 writer。建議三條工作線並行，加一個 docs：

| 工作線 | 順序（ID） | 主要檔案 | 估計工作天 |
|---|---|---|---|
| A：engineer-hard（auth 與付款） | F-168 → F-024 → F-037 → F-114 | `scripts/*refund*`、`src/lib/auth.ts`、`src/lib/payment-providers/payuni.ts`、`src/lib/payment-webhooks.ts`、`src/app/register/*` | 約 3.5–7.5 人日 |
| B：engineer-hard（資料與營運） | F-026 → F-042 → F-058 → F-074 | migration（RLS）、`vercel.json` 或排程器設定、`src/app/api/jobs/*`、備份 runbook | 約 2.75–4.75 人日 |
| C：engineer（首次成功路徑） | F-101 → F-110 → F-079 → F-090 → F-103 → F-104 → F-107 → F-113 → F-143 | `commerce-checkout-form.tsx`、`format.ts`、`(viewer)/not-found`、`interaction-roles-workbench.tsx`、`live-stepper-form.tsx`、`actions.ts:816`、`live-publish-readiness.ts`、`sentry.*.config.ts`、`vercel.json` | 約 5–9.5 人日 |
| docs | F-031 | `docs/staging-production-env-vars.md`、備份 runbook | 約 0.5 人日 |

衝突與前置：

- F-168 必須在 F-024 合併前完成，否則 staging Sandbox QA 鏈停在 `/mfa/setup`；F-024 合併需要 reviewer 審過與 owner 說 OK。
- F-037 需要 owner／T2 提供去識別化的 PayUni Sandbox Notify 樣本；樣本到之前先寫失敗測試（紅），樣本到後補真實 fixture。
- F-090（線 C）與 F-042（線 B）可能都改 `vercel.json`：若排程器選 Vercel Cron，F-090 改由線 B 一併處理。
- F-103 與 F-104 改同一批互動角色檔案，必須同一個 writer 依序做；F-104 依 owner 已選的不標示版（方案 A）實作，條款揭露文字等律師。
- F-107 動 `actions.ts:816`；L0 期間沒有其他工作線寫 `actions.ts`，L1 的 F-039 等財務項必須等它合併後再開。
- F-058 等 owner 升級 Supabase 方案；F-031 的根金鑰說明要先寫進 runbook，演練才能驗證「還原時保存當時的 secret」。
- 派工前置：主工作樹先執行 `npm run db:generate`（F-174），否則 `npm run typecheck` 在本機會失敗。

### 3.3 核心中仍可部分繞過的項目（時間不夠時）

| ID | 部分繞過方式 | 代價 |
|---|---|---|
| F-114 | 每位封測商家另簽封測協議（含服務條款與虛擬使用者責任），註冊頁同意紀錄延到 L1 | 人工保存協議；條款版本無系統紀錄 |
| F-113 | owner 決定「綁商品仍強制腳本」時本項 0 人日，由創辦人代套預設腳本 | 不想用虛擬使用者的講師仍要有一份腳本 |
| F-058 | Supabase Pro 每日備份開啟後，隔離還原演練可延到封測第一週 | 第一週內若出事，RTO 未知 |
| F-042 | 暫用 GitHub Actions `schedule` 驅動 POST job（B09-01 選項 B），正式排程器封測後再換 | 延遲 5～10 分鐘以上，閒置 60 天會被停用 |

### 3.4 可繞過（以設定或人工流程撐過封測）

| ID | 項目 | 估工（人日） | 繞過方式 | 不繞過時的派工／reviewer | 分數 |
|---|---|---|---|---|---|
| F-041 | 幣別限定 TWD（伺服器驗證＋DB CHECK）、非 TWD 拒絕結帳 | 0.5 | 創辦人導入時逐一確認封測商品幣別為 TWD | engineer-hard／是 | 4×5÷0.5＝40.0 |
| F-112 | 補 `@theme` token 或改用既有色票（樣式部分，屬 B07 批次 A 的 S 級） | 0.5 | LINE 綁定由創辦人陪同完成，錯誤由創辦人在後台判讀 | engineer／否 | 4×5÷0.5＝40.0 |
| F-078 | 改 `retry`＋共用 `RouteErrorPanel` | 0.5 | 使用者手動重新整理（F5）即可恢復 | engineer／否 | 4×4÷0.5＝32.0 |
| F-019 | 手動走查常青直播；不生效就隱藏設定區塊 | 0.5 | 創辦人導入時不開啟常青設定、不對封測客戶宣稱常青場 | engineer／否 | 3×5÷0.5＝30.0 |
| F-088 | `cache()` 每請求一次、改 `select`、復原碼移出 | 0.5–1 | 先確保 Production 函式區域與 DB 同在東京（F-090）並觀察 Dashboard；慢但不逾時即可延到 L1 | engineer-hard／是 | 4×4÷0.75＝21.3 |
| F-141 | 補 `captureOperationalError`、每個 job 成功寫 heartbeat | 0.5–1 | 創辦人每日檢查寄送紀錄頁與排程器執行紀錄 | engineer／否 | 4×4÷0.75＝21.3 |
| F-052 | 平台層 `AFFILIATE_PAYOUT_OUTCOMES_ENABLED=false`，拒絕標記 paid | 0.5 | 封測期間平台不鎖定、不撥款任何有聯盟佣金商家的月結，就不會產生 AffiliatePayout；條款寫明只累計不出款 | engineer-hard／是 | 3×3÷0.5＝18.0 |
| F-043 | 付款事實先入帳、超賣標記待處理並建立退款或工單；UPP 設 `TradeLExpireSec` ≤ 保留 TTL | 1–1.5 | 封測商品不設庫存上限；創辦人每日檢查 failed WebhookEvent 並人工退款 | engineer-hard／是 | 4×5÷1.25＝16.0 |
| F-077 | prop 改 `retry`、測試改為檢查 runtime 實際傳入的 props | 0.1 | 使用者手動重新整理（F5）即可恢復 | engineer／否 | 4×2÷0.5＝16.0 |
| F-089 | 訂閱查詢併入 `Promise.all`、onboarding 移到 Suspense 或延後取 | 1 | 同 F-088：區域對齊後若無逾時可延到 L1 | engineer／否 | 4×4÷1＝16.0 |
| F-102 | 預覽頁固定動作列＋owner 專用真實觀眾預覽；假預覽標「示意畫面」 | 0.5–2 | 創辦人導入時示範從側欄「直播間 → 編輯」回到流程，並說明手機預覽為示意 | engineer／否 | 4×5÷1.25＝16.0 |
| F-105 | 封測先隱藏講師端彈幕開關與暖場控制台（或掛載＋CSS＋reduced-motion＋e2e） | 0.5–2 | 創辦人導入時告知不要使用彈幕與暖場控制台；腳本角色改用聊天室發言 | engineer／否 | 4×5÷1.25＝16.0 |
| F-108 | 確認頁加前往直播間與行事曆、過期頁帶回活動連結與重寄、補垃圾信提示 | 0.5–2 | 報名成功信與開播提醒信直接放直播間連結（模板內容由創辦人代填） | engineer／否 | 4×5÷1.25＝16.0 |
| F-109 | 各觸發條件預設文案、註冊時自動建立「報名成功」模板 | 0.5–2 | 創辦人導入時代為建立報名成功模板 | engineer／否 | 4×5÷1.25＝16.0 |
| F-004 | 全站改用單一 `getRequestClientIp`＋偽造標頭測試矩陣 | 1–1.5 | owner 確認正式網域為 Cloudflare 代理（橘雲）且沒有其他入口，風險即消失，可延到 L1 | engineer-hard／是 | 4×4÷1.25＝12.8 |
| F-169 | bootstrap 輸出一次性登記連結、登記前 email OTP 或重新輸入密碼、`mfaVerifiedAt` 晚於 `enabledAt` | 1–2 | #436 合併前，owner 讓所有 platform admin（含 staging QA 帳號）完成 TOTP 登記並更換 bootstrap 密碼；之後不再以密碼建立新 admin | engineer-hard／是 | 4×4÷1.5＝10.7 |
| F-060 | 一般索引補進 schema（`map:`）、allowlist＋`migrate diff --exit-code` CI 檢查 | 1–1.5 | 封測期間規定：新 migration 一律手寫、禁止提交 `migrate dev` 輸出，reviewer 逐行檢查 DROP INDEX | engineer-hard／是 | 4×3÷1.25＝9.6 |
| F-016 | ①`/api/admin/ops/**` 在 production 一律 404（驗 secret 之前） | 0.5 | owner 確認 Production 的 `JOB_SECRET` 與 Preview／GitHub Actions 用的值不同，即可延到 L2 | engineer-hard／是 | 4×1÷0.5＝8.0 |
| F-021 | Prettier 格式化 7 檔（單獨 commit） | 0.1 | 若 F-002 延後，跟著延到 L1 | engineer／否 | 1×4÷0.5＝8.0 |
| F-092 | 衝突改回 retryable 503；以單列計數器原子遞增取代整月 SUM | 2–4 | 封測場次控制在同時在線 20 人以下；超過時由創辦人現場監看 429 並即時調整 | engineer-hard／是 | 4×5÷3＝6.7 |
| F-025 | 新增不可進後台的 `partner` 角色＋portal-only 負向測試 | 1–4 | 聯盟封測開放但只累計：封測期間不把夥伴入口授權給外部夥伴，也不為外部人建立 accountant／support 成員；夥伴佣金由商家人工告知 | engineer-hard／是 | 4×3÷2.5＝4.8 |
| F-002 | 新增 `courses`／`platform_billing`／`card_binding_gate` 旗標，綁卡閘門收斂為 `isCardBindingRequired()` | 4–6 | T1（PayUni Token）若在 10-24 前打通，由創辦人為每位封測商家代綁 Sandbox 測試卡，Funnel 發布即不被擋；課程、billing 選單以「不開帳號權限＋導入時告知」處理 | engineer-hard／是 | 4×2÷5＝1.6 |
| | **合計** | **18.2–34.7 人日** | | | |

建議：線 C 在核心完成後的空檔，優先做分數高且便宜的 F-041、F-112、F-078、F-019，可大幅減少創辦人的人工負擔。

### 3.5 設定與決策（零或極少工程）

| ID | 項目 | 由誰 | 估工 |
|---|---|---|---|
| F-152 | owner 設 Production 環境 reviewer＋僅 master；staging build 只跑 `migrate status` | owner＋E | 0.5 |
| F-095 | owner 決定封測是否用瀏覽器直播；不用就在 UI 隱藏或標 beta | owner→E | 未估 |
| F-153 | owner 開啟三項；加最小 `dependabot.yml` | owner | 0 |
| F-086 | owner 在 Vercel 啟用 Skew Protection；上線避開直播時段寫入 release runbook | owner | 0 |
| F-149 | owner 改為 `all_external_contributors` | owner | 0 |
| F-174 | 派工前在主工作樹執行 `npm run db:generate`；preflight 加「schema 比 client 新就警告」 | 主對話 | 未估 |

## 4. L1 封測期間可修（39.05–66.05 人日（另 1 項未估））

觸發條件：月結與撥款類必須在**第一次鎖定商家月結之前**完成（F-038、F-039、F-040、F-044、F-073）；容量類在**同時在線超過 50 人或導入廣告流量之前**完成（F-091、F-015）。

| 序 | ID | 項目 | 嚴重度 | 派工 | reviewer | 依賴／備註 | 估工（人日） | 分數 |
|---:|---|---|---|---|---|---|---|---|
| 1 | F-015 | 對 `/lp/*` 100 並發量測 | MAJOR | engineer | 否 | — | 0.5 | 3×5÷0.5＝30.0 |
| 2 | F-045 | 兩條退款路徑共用 post-refund hook | MINOR | engineer-hard | 是 | — | 0.5 | 3×5÷0.5＝30.0 |
| 3 | F-046 | 超過時間窗後允許有權限者人工釋放並 audit | MINOR | engineer-hard | 是 | — | 0.5 | 3×5÷0.5＝30.0 |
| 4 | F-048 | 正式 provider 只接受既有 checkout 交易、移除 payload 佣金覆寫 | MINOR | engineer-hard | 是 | 與 F-037 同批 | 0.5 | 3×5÷0.5＝30.0 |
| 5 | F-067 | eventId 納入事件類型與退款識別；向 PayUni 確認通知規格 | MINOR | engineer-hard | 是 | 與 F-037 的 eventId 調整同 PR | 0.5 | 3×5÷0.5＝30.0 |
| 6 | F-106 | 共用 `statusLabel(kind, value)`＋enum 全覆蓋測試 | MAJOR | engineer | 否 | — | 0.5 | 3×5÷0.5＝30.0 |
| 7 | F-049 | 嚴格整數 regex、必填理由、上限與第二人覆核 | MINOR | engineer-hard | 是 | — | 0.5 | 3×4÷0.5＝24.0 |
| 8 | F-065 | `db:migrate` wrapper 先 `assertLocalTestDatabase`；staging buildCommand 加 `:?` 檢查 | MINOR | engineer-hard | 是 | — | 0.5 | 3×4÷0.5＝24.0 |
| 9 | F-115 | 移除或接 `/api/health` | MAJOR | engineer | 否 | — | 0.5 | 3×4÷0.5＝24.0 |
| 10 | F-116 | 加「已付款訂單」與「已確認金額」卡 | MAJOR | engineer | 否 | — | 0.5 | 3×4÷0.5＝24.0 |
| 11 | F-142 | 加需 `CRON_SECRET` 的 readiness（job 最後成功時間、佇列深度） | MAJOR | engineer | 否 | F-141 | 0.5 | 3×4÷0.5＝24.0 |
| 12 | F-083 | 全部換 `SubmitButton`／`FormSubmitButton`＋lint 規則 | MAJOR | E＋H | 是（金流相鄰） | — | 0.5–1 | 4×4÷0.75＝21.3 |
| 13 | F-040 | 缺欄位回 undefined、不覆寫；金流費改依合約費率在伺服器計算 | MAJOR | engineer-hard | 是 | F-037 同檔先合併；會計師確認費率 | 1 | 4×5÷1＝20.0 |
| 14 | F-050 | `crypto.randomBytes` 訂單號＋重複資料 preflight＋partial unique index＋P2002 換號重試 | MAJOR | engineer-hard | 是 | — | 1 | 4×5÷1＝20.0 |
| 15 | F-047 | 已簽章非 SUCCESS 視為 failed 事件並保存有界錯誤碼 | MINOR | engineer-hard | 是 | 與 F-037 同批 | 0.5 | 2×5÷0.5＝20.0 |
| 16 | F-120 | 統一 `formatTwd()` 輸出 NT$1,234 | MINOR | engineer | 否 | — | 0.5 | 2×5÷0.5＝20.0 |
| 17 | F-128 | 改「回上一頁」、改寫 403 文案 | MINOR | engineer | 否 | — | 0.5 | 2×5÷0.5＝20.0 |
| 18 | F-003 | 刪不可達碼；非 PayUni provider fail-closed | MAJOR | engineer-hard | 是 | 封測期間 `PAYMENT_PROVIDER` 只用 PayUni | 1–1.5 | 4×5÷1.25＝16.0 |
| 19 | F-127 | 還原焦點、補 Escape 與外點關閉 | MINOR | engineer | 否 | — | 0.5 | 2×4÷0.5＝16.0 |
| 20 | F-072 | 已發布或有流量的頁面改封存（`archivedAt`）、FK 改 Restrict | MINOR | engineer-hard | 是 | 封測期間先告知商家已上線頁面改下架、不要刪除 | 1 | 3×5÷1＝15.0 |
| 21 | F-038 | 月結只計買家訂單交易＋精確金額 DB 回歸測試 | BLOCKER | engineer-hard | 是 | 封測期間不鎖月結、不撥款 | 0.5–1 | 5×2÷0.75＝13.3 |
| 22 | F-055 | 共用 `runSerializable`（退避＋jitter）＋staging 50 併發壓測。**2026-10-30 狀態**：helper 已合併；50 併發壓測改在 loopback disposable PostgreSQL 完成（不跑 staging），`npm run test:db:stress`，一般 DB 測試另跑 10 併發。結帳、限量快閃、付款 webhook、直播通知四條路徑沒有超賣、每個付款事件只有一次 paid、沒有未被攔下的 P2034。另發現兩項未修：結帳 revision 釘選讓同時下單每輪只有一人成功；直播通知不同收件人同時具現化 47/50 用完重試。證據與建議見 `docs/operations/serializable-retry-callsites.md`〈50 併發壓測〉 | MINOR | engineer-hard | 是 | F-090 | 1–1.5 | 3×5÷1.25＝12.0 |
| 23 | F-073 | 商家撥款帳號 action（只寫 envelope）＋遮罩 CHECK＋backfill 分批 | MINOR | engineer-hard | 是 | — | 1 | 3×4÷1＝12.0 |
| 24 | F-118 | 手機改「第 N 步／共 8 步」＋下拉；控件 44px；切換後聚焦標題 | MAJOR | engineer | 否 | — | 0.5–2 | 3×5÷1.25＝12.0 |
| 25 | F-098 | `tracesSampler`：輪詢 0～0.01、付款與 webhook 高取樣 | MINOR | engineer | 否 | 可與 F-143 同 PR | 0.5 | 2×3÷0.5＝12.0 |
| 26 | F-091 | (1) 可見性閘門 (3) 簽章入場 token＋blacklist 快取；先做 50／100／300 合成觀眾壓測 | MAJOR | E＋H | 是（(3)） | F-090 | 2 | 4×5÷2＝10.0 |
| 27 | F-027 | owner／finance 高風險 action 要求已註冊 MFA 或 step-up | MINOR | engineer-hard | 是 | — | 0.5–2 | 3×4÷1.25＝9.6 |
| 28 | F-028 | 帳號層限流改用 DB 或 Upstash（不受 provider 影響） | MINOR | engineer-hard | 是 | F-024（MFA）合併後 | 0.5–2 | 3×4÷1.25＝9.6 |
| 29 | F-111 | 依詞彙表逐頁改；flag 關閉時不渲染課程／聯盟欄位；lint 禁止工程詞 | MAJOR | engineer | 否 | F-002 的旗標 | 0.5–2 | 3×4÷1.25＝9.6 |
| 30 | F-133 | 改成兩租戶行為測試 | MAJOR | engineer | 否 | — | 1.5–2 | 4×4÷1.75＝9.1 |
| 31 | F-093 | `requireSignedURLs`、入場後簽發短效 token、既有影片批次更新 | MAJOR | engineer-hard | 是 | — | 2–3 | 4×5÷2.5＝8.0 |
| 32 | F-064 | `production-migrate.yml`（核准、備份 run ID、timeout）＋失敗 SOP | MINOR | engineer-hard | 是 | F-058（備份） | 1.5 | 3×4÷1.5＝8.0 |
| 33 | F-081 | 兩頁加 `generateMetadata`（標題、描述、OG 圖） | MINOR | engineer | 否 | — | 0.5–2 | 2×5÷1.25＝8.0 |
| 34 | F-121 | focus-visible ring、邊框與文字色調整 | MINOR | engineer | 否 | — | 0.5–2 | 2×4÷1.25＝6.4 |
| 35 | F-122 | 底部 5 項＋「更多」抽屜 | MINOR | engineer | 否 | F-002 | 0.5–2 | 2×4÷1.25＝6.4 |
| 36 | F-123 | 以 `/onboarding` 為單一事實來源 | MINOR | engineer | 否 | — | 0.5–2 | 2×4÷1.25＝6.4 |
| 37 | F-146 | 加 `timeout-minutes: 60` | MAJOR | engineer | 否 | — | 0.05 | 3×1÷0.5＝6.0 |
| 38 | F-039 | 退款月份用伺服器時間、鎖定後寫入下期 adjustment ledger、允許負向結轉 | BLOCKER | engineer-hard | 是 | F-038；owner 決定負餘額政策 | 1.5–2 | 5×2÷1.75＝5.7 |
| 39 | F-070 | 個資請求處理 runbook＋`anonymize-customer` 腳本＋保存期限清理 job | MINOR | D＋H | 是（腳本） | — | 2–3 | 3×4÷2.5＝4.8 |
| 40 | F-126 | 補 12 條路由、stepper 8 步與錯誤狀態掃描 | MINOR | engineer | 否 | — | 0.5–2 | 2×3÷1.25＝4.8 |
| 41 | F-134 | 兩租戶夾具＋表驅動 action 矩陣（先做金流與 PII 6 項） | MAJOR | engineer | 否 | — | 3–4 | 4×4÷3.5＝4.6 |
| 42 | F-044 | 依 owner 二選一：b 月結不扣佣金／a 補聯盟出款流程 | MAJOR | engineer-hard | 是 | owner＋律師（金流定性）＋會計師（扣繳） | 0.5–5 | 4×3÷2.75＝4.4 |
| 43 | F-117 | 擴充 `Field`、action 回 `fieldErrors`、聚焦第一個無效欄位（先商品與直播） | MAJOR | engineer | 否 | — | 2–4 | 3×4÷3＝4.0 |
| 44 | F-017 | 改寫宣稱並把代理列為可驗證前置條件 | MINOR | docs | 否 | F-004 的 owner 回答 | 0.2 | 2×1÷0.5＝4.0 |
| 45 | F-147 | push 限 master、concurrency cancel-in-progress | MINOR | engineer | 否 | — | 0.05 | 2×1÷0.5＝4.0 |
| 46 | F-076 | 與 F-031①、F-058、F-064 一起改版 | NIT | docs | 否 | — | 0.25 | 1×2÷0.5＝4.0 |
| 47 | F-001 | 伺服器端 `requireFeature` 與模組×入口測試矩陣 | MAJOR | engineer-hard | 是 | F-021 先格式化 | 3–4 | 3×4÷3.5＝3.4 |
| 48 | F-112 | 三步驟教學、錯誤分類、頁首說明 LINE 用途（含在原 M 估工內，未單獨估） | MAJOR | engineer | 否 | owner 決定封測 LINE 範圍 | 未估 | — |
| | | **合計** | | | | | **39.05–66.05 人日（另 1 項未估）** | |

另：接手事項 T6（PWA 推播測試偶發失敗、三個後台首次進入無骨架畫面、早期審查留下的通知小問題）不是 Phase B 的 finding，未估，建議封測第一週一併處理。

## 5. L2 公開上線前（53.8–75.3 人日）

| 序 | ID | 項目 | 嚴重度 | 派工 | reviewer | 依賴／備註 | 估工（人日） | 分數 |
|---:|---|---|---|---|---|---|---|---|
| 1 | F-124 | 範本改中性占位並提示確認屬實 | MINOR | engineer | 否 | — | 0.5 | 3×5÷0.5＝30.0 |
| 2 | F-053 | IP＋簽章失敗限流、失敗 audit 合併 | MINOR | engineer-hard | 是 | — | 0.5 | 2×5÷0.5＝20.0 |
| 3 | F-096 | heartbeat／stop 分支前移 | MINOR | engineer | 否 | — | 0.5 | 2×5÷0.5＝20.0 |
| 4 | F-129 | 預設隱藏、漸層改中性 | MINOR | engineer | 否 | — | 0.5 | 2×5÷0.5＝20.0 |
| 5 | F-054 | void 時 reconcile pending payout、負餘額結轉 | MINOR | engineer-hard | 是 | — | 0.5 | 3×3÷0.5＝18.0 |
| 6 | F-080 | 改 `loading="eager"`＋`fetchPriority="high"` | MINOR | engineer | 否 | — | 0.5 | 2×4÷0.5＝16.0 |
| 7 | F-082 | 文件化或對 `/live/[slug]` 加輕量預檢 | MINOR | engineer | 否 | — | 0.5 | 2×4÷0.5＝16.0 |
| 8 | F-085 | 改為精準路徑 revalidate | MINOR | engineer | 否 | F-089 | 0.5 | 2×4÷0.5＝16.0 |
| 9 | F-099 | 移到 `(app)` layout 或 dynamic；tus 改動態 import | MINOR | engineer | 否 | — | 0.5 | 2×4÷0.5＝16.0 |
| 10 | F-131 | 改由環境變數或後台設定 | MINOR | engineer | 否 | owner 申請網域信箱 | 0.5 | 2×4÷0.5＝16.0 |
| 11 | F-170 | 規格或 lint 涵蓋 route handler | MINOR | engineer | 否 | — | 0.25 | 2×4÷0.5＝16.0 |
| 12 | F-062 | status 預設改 pending、金額與狀態 CHECK（NOT VALID→VALIDATE） | MAJOR | engineer-hard | 是 | — | 1.5 | 4×5÷1.5＝13.3 |
| 13 | F-066 | partial unique index＋重複資料 preflight | MINOR | engineer-hard | 是 | — | 0.25 | 3×2÷0.5＝12.0 |
| 14 | F-130 | 付款完成信附查看訂單安全連結 | MINOR | engineer | 否 | T2 在 LINE 內建瀏覽器實測 | 0.5–2 | 3×5÷1.25＝12.0 |
| 15 | F-013 | 加 `import "server-only"`、搬常數 | MINOR | engineer | 否 | — | 0.5 | 2×3÷0.5＝12.0 |
| 16 | F-063 | CI 檢查新 migration 名稱必須大於 master 最新者 | MINOR | engineer-hard | 否 | — | 0.5 | 2×3÷0.5＝12.0 |
| 17 | F-069 | health／preflight 檢查 `TimeZone='UTC'` | MINOR | engineer | 否 | — | 0.25 | 2×3÷0.5＝12.0 |
| 18 | F-059 | 財務 FK 改 RESTRICT（NOT VALID→VALIDATE）、Vendor 軟關閉 | MAJOR | engineer-hard | 是 | — | 1.5 | 4×4÷1.5＝10.7 |
| 19 | F-061 | 獨立 create-if-missing bootstrap 腳本或前向 migration | MAJOR | engineer-hard | 是 | — | 0.5–1 | 4×2÷0.75＝10.7 |
| 20 | F-056 | route 內補斷言 | NIT | engineer-hard | 是 | — | 0.1 | 1×5÷0.5＝10.0 |
| 21 | F-029 | 邀請 token＋接受流程，所有分支回同一訊息 | MINOR | engineer-hard | 是 | — | 0.5–2 | 3×4÷1.25＝9.6 |
| 22 | F-051 | 記帳為 setup 交易並自動退款或改授權取消 | MINOR | engineer-hard | 是 | — | 0.5–1 | 3×2÷0.75＝8.0 |
| 23 | F-094 | 保留政策＋伺服器端刪除 job＋不錄影選項 | MINOR | engineer | 否 | — | 0.5–2 | 2×5÷1.25＝8.0 |
| 24 | F-119 | 衝突時提供複製我的版本或差異保留 | MINOR | engineer | 否 | — | 0.5–2 | 2×5÷1.25＝8.0 |
| 25 | F-162 | reviewer 確認 `createPlatformPlanCheckout` 只由 route 呼叫後刪除 | MINOR | engineer-hard | 是 | — | 0.25 | 2×2÷0.5＝8.0 |
| 26 | F-032 | 改用 `trustedRequestOrigin()` | NIT | engineer | 否 | — | 0.5 | 1×4÷0.5＝8.0 |
| 27 | F-033 | 狀態變更請求缺 Origin 一律拒絕 | NIT | engineer-hard | 是 | — | 0.5 | 1×4÷0.5＝8.0 |
| 28 | F-034 | helper 移到 `src/lib` | NIT | engineer | 否 | — | 0.5 | 1×4÷0.5＝8.0 |
| 29 | F-091 | (2) 聊天與互動合併為單一 since 輪詢 | MAJOR | engineer | 否 | — | 3 | 4×5÷3＝6.7 |
| 30 | F-015 | 內容跨請求快取、訪客寫入改 `after()`、proxy 輕量預檢 | MAJOR | engineer-hard | 是 | L1 量測結果 | 2–3 | 3×5÷2.5＝6.0 |
| 31 | F-019 | ab-testing、ai-funnel-assistant、interaction-card-media 依 owner 決定刪或標註 | MINOR | engineer | 否 | — | 0.25 | 3×1÷0.5＝6.0 |
| 32 | F-068 | 聚合欄位改 BIGINT | MINOR | engineer-hard | 是 | — | 1 | 3×2÷1＝6.0 |
| 33 | F-071 | 依索引建議表補索引 | MINOR | engineer-hard | 是 | — | 1 | 2×3÷1＝6.0 |
| 34 | F-035 | 加限流或時間桶去重 | NIT | engineer | 否 | — | 0.5 | 1×3÷0.5＝6.0 |
| 35 | F-012 | 抽 `lib/webhook-events.ts` 共用 | MINOR | engineer-hard | 是 | — | 2 | 2×5÷2＝5.0 |
| 36 | F-030 | DB session 或 revocation epoch，縮短 TTL | MINOR | engineer-hard | 是 | — | 0.5–2 | 3×2÷1.25＝4.8 |
| 37 | F-144 | 移除無作用設定 | MINOR | engineer | 否 | — | 0.1 | 2×1÷0.5＝4.0 |
| 38 | F-145 | 確認 builder、設 release、驗證一次 build | MINOR | engineer | 否 | — | 0.5 | 2×1÷0.5＝4.0 |
| 39 | F-148 | `permissions: contents: read`＋SHA pin | MINOR | engineer | 否 | — | 0.05 | 2×1÷0.5＝4.0 |
| 40 | F-150 | 改 tag 或 vendored fixture | MINOR | engineer | 否 | — | 0.5 | 2×1÷0.5＝4.0 |
| 41 | F-151 | 封存 q1／f2 workflow | MINOR | engineer | 否 | — | 0.5 | 2×1÷0.5＝4.0 |
| 42 | F-154 | 記錄例外並設到期日（不用 `npm audit fix`） | MINOR | docs | 否 | — | 0.1 | 2×1÷0.5＝4.0 |
| 43 | F-155 | 補原因與移除條件；CI 改 `--ignore-scripts` | MINOR | engineer | 否 | — | 0.5 | 2×1÷0.5＝4.0 |
| 44 | F-157 | 上線前列出子網域確認 | MINOR | owner＋D | 否 | — | 0.1 | 2×1÷0.5＝4.0 |
| 45 | F-160 | proxy 只在非 production 回應；隨歷史 runner 封存移除 | MINOR | engineer | 否 | — | 0.5 | 2×1÷0.5＝4.0 |
| 46 | F-166 | 依 §4.3 安全步驟逐一移除（先拆 node_modules 連結） | MINOR | 主對話 | 否 | — | 0.5 | 2×1÷0.5＝4.0 |
| 47 | F-171 | `* text=auto eol=lf`＋獨立 renormalize PR | MINOR | engineer | 否 | — | 0.1 | 2×1÷0.5＝4.0 |
| 48 | F-158 | 確認方案上限、必要時拆排程 | NIT | engineer | 否 | F-042 | 0.25 | 1×2÷0.5＝4.0 |
| 49 | F-031 | ②③`DATA_ENCRYPTION_KEYRING`（kid、decrypt-only）＋re-encrypt 腳本＋拿掉 `JOB_SECRET` fallback | MAJOR | engineer-hard | 是 | — | 3–4 | 4×3÷3.5＝3.4 |
| 50 | F-125 | Stream WebVTT 字幕上傳與播放 | MINOR | engineer | 否 | — | 2–4 | 2×5÷3＝3.3 |
| 51 | F-097 | aggregate、take＋游標分頁、select、Promise.all | MINOR | engineer | 否 | — | 2–3 | 2×4÷2.5＝3.2 |
| 52 | F-036 | `Vendor.suspendedAt`、`__Host-` cookie、admin 縮短 TTL＋step-up | NIT | engineer-hard | 是 | — | 0.5–2 | 1×4÷1.25＝3.2 |
| 53 | F-156 | 先記錄報告→補來源→移除 unsafe-eval→nonce；form-action 實測 PayUni 與 LINE | MAJOR | engineer-hard | 是 | — | 3–5 | 4×3÷4＝3.0 |
| 54 | F-018 | 刪 9 檔＋測試、搬 fixture | MINOR | engineer | 否 | — | 0.5–1 | 2×1÷0.75＝2.7 |
| 55 | F-165 | 先退役或改路徑，再搬 | MAJOR | engineer | 否 | — | 1.5 | 3×1÷1.5＝2.0 |
| 56 | F-135 | 門檻單一來源、分目錄輸出、金流與 auth 路徑下限 | MINOR | engineer | 否 | — | 1 | 2×1÷1＝2.0 |
| 57 | F-057 | 更新文件 | NIT | docs | 否 | — | 0.1 | 1×1÷0.5＝2.0 |
| 58 | F-159 | 更新文件 | NIT | docs | 否 | — | 0.05 | 1×1÷0.5＝2.0 |
| 59 | F-023 | 刪除或封存殘留 | NIT | engineer | 否 | — | 0.6 | 1×1÷0.6＝1.7 |
| 60 | F-007 | WP4 能力改注入、移出正式 bundle | MAJOR | engineer-hard | 是 | F-168（B11-01）新 QA 流程不再依賴 wp4-session | 2–3 | 4×1÷2.5＝1.6 |
| 61 | F-164 | 分批 `git mv` 到 `reports/archive/2026/` | MAJOR | docs | 否 | F-165（B10-11） | 2 | 3×1÷2＝1.5 |
| 62 | F-016 | ②獨立 smoke secret＋③ops 端點與 `/api/cloudflare/*` 建置期排除 | MAJOR | engineer-hard | 是 | F-007 | 3 | 4×1÷3＝1.3 |
| 63 | F-136 | 依 H1～H7 假說驗證；reporter 白名單輸出檔名 | MINOR | engineer | 否 | — | 1–2 | 2×1÷1.5＝1.3 |
| 64 | F-020 | 重寫現況表、上限改棘輪、改寫 DOCUMENT_AUTHORITY | MINOR | docs | 否 | — | 1.5–2.5 | 2×1÷2＝1.0 |
| 65 | F-137 | 縮小 DB 併發重跑、去重 TAP、共用 build、拆平行 job（保留 `quality` 名稱） | MINOR | engineer | 否 | — | 1.5–2.5 | 2×1÷2＝1.0 |
| | | **合計** | | | | | **53.8–75.3 人日** | |

## 6. L3 之後／重構（43.15–59.65 人日）

| 序 | ID | 項目 | 嚴重度 | 派工 | reviewer | 依賴／備註 | 估工（人日） | 分數 |
|---:|---|---|---|---|---|---|---|---|
| 1 | F-008 | 抽 `payment-providers/contract.ts`＋lint 規則 | MAJOR | engineer-hard | 是 | — | 1 | 3×5÷1＝15.0 |
| 2 | F-100 | 簽 PUT 加 immutable 快取；保留 PNG／WebP | NIT | engineer | 否 | — | 0.5 | 1×4÷0.5＝8.0 |
| 3 | F-132 | 統一標點、改 lucide 圖示 | NIT | engineer | 否 | — | 0.5 | 1×4÷0.5＝8.0 |
| 4 | F-172 | loginAction 直接導向設定頁 | NIT | engineer | 否 | — | 0.05 | 1×4÷0.5＝8.0 |
| 5 | F-173 | 改回 JSON 401／403 | NIT | engineer | 否 | — | 0.1 | 1×4÷0.5＝8.0 |
| 6 | F-014 | 新寫入加 `kind`＋單一 `classifyLandingContent()` | MINOR | engineer | 否 | — | 1–2 | 2×5÷1.5＝6.7 |
| 7 | F-075 | 升格為正式欄位＋FK＋回填 | MINOR | engineer-hard | 是 | — | 2 | 2×5÷2＝5.0 |
| 8 | F-022 | 拆 `auth/session`、`auth/guards`、`auth/credentials` | NIT | engineer-hard | 是 | — | 1 | 1×4÷1＝4.0 |
| 9 | F-010 | 抽 `lib/checkout/` 服務，route 只做 HTTP 轉譯 | MAJOR | engineer-hard | 是 | — | 5–8 | 3×5÷6.5＝2.3 |
| 10 | F-006 | dependency-cruiser 模組公開面規則（warn 起步） | MAJOR | engineer | 否 | — | 1–2 | 3×1÷1.5＝2.0 |
| 11 | F-011 | ≥5 次查詢的 8 頁抽 read-model | MINOR | engineer | 否 | — | 3–5 | 2×4÷4＝2.0 |
| 12 | F-161 | harness 搬出 `src/app` | MINOR | engineer | 否 | — | 1 | 2×1÷1＝2.0 |
| 13 | F-167 | 抽 `RECEIPT_DIR` 常數逐步替換 | MINOR | engineer | 否 | — | 1 | 2×1÷1＝2.0 |
| 14 | F-087 | 移除 | NIT | engineer | 否 | — | 0.5 | 1×1÷0.5＝2.0 |
| 15 | F-140 | 改 `toMatchObject` | NIT | engineer | 否 | — | 0.5 | 1×1÷0.5＝2.0 |
| 16 | F-009 | 同檔抽具名 reconciler＋註冊表（不重寫） | MAJOR | engineer-hard | 是 | — | 8–12 | 3×5÷10＝1.5 |
| 17 | F-139 | 三類標示與 `*.contract.test` 命名 | MINOR | engineer | 否 | — | 2 | 2×1÷2＝1.0 |
| 18 | F-163 | 與證據檔一起封存並從 `test:contracts` 排除 | MINOR | engineer | 否 | — | 2 | 2×1÷2＝1.0 |
| 19 | F-084 | Cache Components 遷移（不含快取設計） | NIT | engineer | 否 | — | 1–2 | 1×1÷1.5＝0.7 |
| 20 | F-138 | 清孤兒、vitest projects、playwright 工廠 | MINOR | engineer | 否 | — | 3–4 | 2×1÷3.5＝0.6 |
| 21 | F-005 | 階段 1～4（扣除已列 L1 的階段 0） | MAJOR | E＋H | 階段 3 是 | F-003；B-03 修復完成後再動財務區段 | 9–12.5 | 3×2÷10.75＝0.6 |
| | | **合計** | | | | | **43.15–59.65 人日** | |

`actions.ts` 拆分（F-005）在 L3 只計階段 1～4；階段 0 即 L1 的 F-003。核心模組「不重寫、以特徵化測試推進」的總量約 17–25 人天（B-01），E-02 評估重寫選項時以此為基準。

## 7. owner 外部動作清單

| # | 動作 | 期限 | 影響的列 | 來源 |
|---:|---|---|---|---|
| 1 | PayUni Sandbox 商店開通信用卡約定 Token（查 Sandbox 後台或向 PayUni 申請） | 最優先；建議 10-24 前，否則 F-002 只能以隱藏 Funnel 綁卡處理 | F-002、F-051 | T1、goal plan §9 Q6a |
| 2 | 安排一次 PayUni Sandbox 訂單端到端付款（輸入測試卡號），並保留去識別化的 Notify／Return 樣本；同時在 LINE 內建瀏覽器實測付款回跳；確認正式商店開通哪些付款方式、PayUni 是否推送退款／爭議通知 | 10-24 前（F-037 需要樣本） | F-037、F-067、F-130 | T2、B03-01、B08-02、B04-13、B07-31 |
| 3 | 合併 #436 前讓所有 platform admin（含 staging QA 帳號）完成 TOTP 登記並更換 bootstrap 密碼；審過後說 OK 合併 | F-024 審完當天 | F-024、F-168、F-169 | T3、B11-01、B11-03 |
| 4 | Supabase：決定方案（Pro 每日備份；RPO 低於 24 小時則加購 PITR）、RPO／RTO 目標、備份保管人；確認 Production 區域與 pooler；授權唯讀查詢 RLS 與 `SHOW timezone`；決定目標同時在線人數 | 10-27 前（留演練時間） | F-058、F-026、F-090、F-091、F-069 | B04-01、B02-03、B06-03、B06-05 |
| 5 | LINE 官方帳號方案決定（11-01 調價；10-27 後仍用中／高用量視為同意新價；10-28～11-02 維護期避免異動）；決定封測 LINE 提供推播、登入還是只有 Email | **10-27 前** | F-112 | 市場研究「LINE 通知」、B07-13 |
| 6 | 補政策頁法定資料：營運者法定名稱、統編或負責人、營業地址；正式簽核 #435 的條款、隱私、退款政策與 `/support` 客服信箱；申請專用網域信箱取代個人 Gmail | 10-29 前（11-01 生效） | F-101、F-131 | T4、B-11 §3、B07-32 |
| 7 | 律師：商家服務條款（虛擬使用者責任歸屬，不標示版的公平法 §21／§24 風險）與註冊同意紀錄；互動腳本範本文案；金流定性（平台是否持有商家款項、聯盟佣金代扣代付是否落入第三方支付登錄）；消保法 §18 揭露與 §19 七日解除權告知；個資法 §8 告知、子處理者與境外存放（Supabase 東京、Vercel、Sentry）；聯盟的多層次傳銷判斷 | 條款與同意 10-29 前；其餘封測期間 | F-104、F-114、F-124、F-044、F-143 | goal plan §9 Q3、市場研究法遵表、B07-04、B07-15 |
| 8 | 會計師：金流手續費由誰負擔與費率；聯盟與課程出款的扣繳、補充保費與扣繳義務人；退款負餘額結轉或向商家請款；佣金追回政策；電子發票開立主體與流程 | 第一次月結前（12 月初） | F-040、F-052、F-039、F-054、F-044 | B03-03、B03-04、B03-08、B03-18、B03-20、市場研究 |
| 9 | Vercel：啟用 Skew Protection；確認 Production 函式區域為 hnd1；各環境 `JOB_SECRET` 分開（Production 不得與 Preview 相同）；確認方案的 cron 與 `maxDuration` 上限；確認 repo 外是否已有排程 | 10-27 前 | F-086、F-090、F-016、F-042、F-158 | B05-12、B06-03、B02-09、B09-01、B09-21 |
| 10 | Cloudflare：確認正式網域是否為橘雲代理且沒有其他入口；若選 Worker cron 作排程器則建立；決定既有影片是否改 signed URL | 10-27 前（代理）；其餘封測期間 | F-004、F-017、F-042、F-093 | B01-04、B01-17、B09-01、B06-07 |
| 11 | GitHub：開啟 secret scanning、push protection、Dependabot；fork PR 核准改為所有外部貢獻者；`Production` 環境加 reviewer 並限 master；staging 環境限 master 部署；只允許 squash 合併 | 10-24 前 | F-153、F-149、F-152 | B09-10、B09-14、B09-15、T7、B-09 §4.2 |
| 12 | 產品決策（E-04）：「隱藏」的定義與封測模組清單、諮詢預約是否開；browser_live 是否納入；彈幕隱藏或交付；銷售直播是否強制腳本；雙重確認是否保留；超賣處理方式；排程器選型；封測付款走 Sandbox 或正式；封測期間是否撥款；觀眾端在線人數是否計入虛擬使用者；常青直播與 3 個未接線 lib 的去留 | 10-21 前（決定 L0 範圍） | F-001、F-002、F-095、F-105、F-113、F-108、F-043、F-042、F-019 | 各軸「需 owner 決策」欄、goal plan §9 Q3、§9.2 |
| 13 | 本機清理：移除舊 worktree（先拆 node_modules 連結、#5 先補 tag、commission policy 與 staging 回復點先確認）、刪除本機 `prisma/dev.db` 與 `error.log` | 封測後即可 | F-166、F-023 | T5、B10-13、B04-24、B10-14 |

## 8. 限制

- 分數的 R、V 是規則化的粗估，用來在同一層內排序，不是精算；跨層的決定以 §1.3 的定義為準。
- 估工全部沿用原報告，未重新估；S／M／L 換算見 §1.4。合併列不重複相加，可能低估同時修多個來源時的整合成本。
- 工作線天數是在「每個檔案同時只有一個 writer」下的粗估，不含 reviewer 等待與 owner 決策延遲。
- 是否真有真實買家付款、封測場次的同時在線人數、Production 是否用於封測，三個前提會改變 F-058、F-092、F-091、F-064 的層級，已在各列註明。
