已完成 [#610](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/610)。未驗證：沒有在瀏覽器實際操作編輯器 ||||| 順序 | ID | 項目 | 風險 | 規模 | 完成標準 | 狀態 |
|---|---|---|---|---|---|---|
| 1 | Q-01 | 兩個不穩定 e2e（救援碼、學員推播） | 一般 | S | merge queue 連續 10 次不因這兩個測試失敗；不加 retry／skip | 進行中：[#607](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/607)。推播測試根因未確認，PR 加了診斷；下次失敗依 `worker=` 狀態續查 |
| 2 | P-573 | Dependabot 正式相依（React 19.3.1 等 6 個，#573） | 一般 | S | 重新產生 lockfile（`magicast` 缺鎖檔）；完整 CI 與 e2e 通過 | 未開始 |
| 3 | P-572 | Dependabot 開發相依（Playwright 1.65 等，#572） | 一般 | S | 同上；確認 `.github/actions/playwright-chromium` 快取 | 未開始 |
| 4 | P-569 | GitHub Actions 版本升級（#569） | 高（動到 production workflow） | S | 更新 TAP 契約測試第 624 項認可的 blob；逐一確認 action 主版本變更；審查 | 未開始 |
| 5 | P-561 | staging 首次成功路徑 runner（#561） | 高（註冊、Turnstile 略過條件） | S | 同步 master、CI 通過、對目前 head 補一次審查；workflow 實跑待 staging 授權 | 未開始 |
| 6 | Q-10 | `payment_paid` 自動化補跑 job | 高 | M | 回應後工作被中止時，下一輪 job 補跑且不重複（設計文件 §8）；PG 測試 | 未開始 |
| 7 | Q-06 | Email 序列「買了就停」（`stopOnPurchase`） | 高 | M | 已付款訂單的買家不再收到後續步驟；退款不恢復；租戶隔離測試 | 未開始 |
| 8 | Q-04 | 課後信 job 遇 serialization failure 中止整輪 | 一般 | S–M | 單筆失敗不影響同輪其他寄送；有重試上限 | 未開始 |
| 9 | Q-14 | `CourseLesson.chapterId` 收緊 NOT NULL | 高（migration） | S | 修復腳本兩個查詢皆 0 後才加；登記 `PRISMA_INVARIANTS.md`。staging 驗證待授權 | 未開始 |
| 10 | Q-15 | 課程章節排序、刪除、搬移單元 | 一般 | M | 學員進度與證書不受影響；e2e | 未開始 |
| 11 | U-03 | 編輯器 inspector 對付款元件的說明與 restricted 狀態同步 | 一般 | S | 已綁商品時不再顯示「尚未連接」；`coupon` 維持說明文字 | 未開始 |
| 12 | Q-02 | 其他 e2e hydration 競態（accessibility、announcement-center、commerce-orders、course-player） | 一般 | S–M | 先重現或取得 CI 樣本再改 | 未開始 |
| 13 | Q-03 | 範本庫 `TemplateCard` 對比不足 | 一般 | S | 先在 master 重現；axe 無新增違規 | 未開始 |
| 14 | Q-12 | 延遲步驟細節（快照損壞重試、連帶撤回、補跑輪流；地址索引另列高） | 一般 | S–M | 各自有測試 | 未開始 |
| 15 | Q-13 | 規則被鎖超過 2 秒時漏建延遲步驟 | 一般 | M | 先重現；補建不重複 | 未開始 |
| 16 | Q-11 | 三個隱藏 trigger 接上呼叫端（`form_no_show`、`viewer_watch_progress`、`webinar_attended_duration_gte`） | 一般 | M×3 | 每個 trigger 一個 PR；接上後才在後台顯示 | 未開始 |
| 17 | Q-09 | `payment_paid` 的延遲步驟 | 高（金流、migration） | L | `DelayedStepRun` 加訂單欄位；到點重讀訂單；退款後不寄 | 未開始 |
| 18 | U-04 | 通用元件採用（28 個手寫輸入框、Toast、Tabs 分批遷移） | 一般 | M，分批 | 每批視覺與 a11y 不退步 | 未開始 |
| 19 | Q-05 | 發布檢查改成純讀 preflight | 一般 | M | 檢查不取得發布鎖、不寫入 | 未開始 |
| 20 | R-02 | `.gitattributes`（LF） | 一般 | S | 不造成全 repo 換行 diff | 未開始 |
| 21 | R-07 | 外部排程 Cloudflare Worker 檔進 repo | 一般 | S | `wrangler.toml` 與 worker 可直接部署；部署由 owner 做 | 未開始 |
| 22 | D-01 | 文件與程式不一致（ROADMAP 課程列、GO-NO-GO §0／§7／F-019、OWNER-ACTIONS 補 Dependency graph 與 S4） | 一般 | S | 逐項對照程式後修正 | 未開始 |
| 23 | R-05 | 兩租戶 action 矩陣其餘部分（F-134） | 高（租戶） | M–L | 先盤點未涵蓋的 action，再補回歸測試 | 未開始（範圍待盤點） |
| 24 | R-04 | L3 重構（`actions.ts` 拆分、結帳抽服務、付款 reconciler、adapter 契約） | 高 | L | 每步行為不變、測試不弱化；一次一個模組 | 未開始 |
| 25 | R-10 | 首次成功路徑 runner 每次執行留下的合成商家、直播與報名的清理或停用（只認 `cdfs-` 前綴） | 高（刪資料） | M | 只動 runner 建立的資料；先停用再刪；留收據 | 未開始 |

## B. 需要 owner 先做產品決定

| ID | 項目 | 要決定的事 | 建議 |
|---|---|---|---|
| U-10、U-11 | 通用折扣碼與編輯器 `coupon` 元件 | 要不要做；折扣後佣金以哪個金額計算 | 做；佣金以折扣後實付金額計算 |
| Q-08 | Email 序列與延遲步驟的寄送上限 | 一個商家一天最多寄幾封、排程多久跑一次（影響追銷信可能晚多久到） | 開通第一個商家前再決定 |
| Q-17 | 常青場課後信 | 沒看直播的報名者要不要寄；跨裝置是否要補記 | 只寄給看過的人 |
| Q-07 | 不綁直播的序列與 LINE 步驟 | 要不要做 | 封測回饋後再排 |
| U-12 | 多方案／買家訂閱 | 要不要做（依賴 PayUni 約定 Token，只能在正式站驗證） | 封測後 |
| U-13 | 自訂網域 | 要不要做 | 封測後 |
| U-01 | onboarding 殘留 | 舊任務（測試訂單、Logo、邀請成員）是否加回；`/merchant-onboarding` 是否保留 | 不加回；保留 |
| R-03 | 文件封存搬移 | 何時做（DECISIONS 寫封測後） | 封測後 |
| — | CodeQL 是否設必要檢查；買家可見的 AI 內容是否標示 | — | CodeQL 先不設；AI 內容標示 |

## C. 等 owner 的金鑰、帳號或 Production 授權

詳細步驟在 `docs/goal-beta-prep-2026Q4/OWNER-ACTIONS.md`。這裡只列被擋住的工程項目。

| 被擋的工程項目 | 擋它的事 |
|---|---|
| AI M1–M4（情境引導、一句話建場、文案、課程大綱） | Cloudflare AI Gateway 與 Workers AI token |
| 含退款的對帳 runner 實跑（R-06）、財務 QA | O-14 `PAYUNI_QA_FINANCE_TOTP_SECRET` |
| 還原演練、F-058／F-074、Supabase 遷東京（O-15） | O-4 Supabase 升級與備份 |
| Dependency review 檢查（每個 PR 都失敗，非必要檢查） | GitHub Dependency graph 與 Private vulnerability reporting |
| LINE E2E | staging 環境的 LINE secrets |
| #561 workflow 實跑、合併後切 staging alias | staging 授權（見執行規則）、`VERCEL_TOKEN` 權限 |
| 外部排程生效（R-07） | owner 以 `wrangler` 部署 |
| CSP 轉強制（R-01） | Cloudflare WAF rate rule；累積違規報告 |
| 政策頁內容、F-103「部分互動」字樣 | O-9～O-11 法定資料與律師意見 |
| 資料保存排程啟用（R-09） | 確認 `scheduled-jobs.yml` 的觸發方式後由 owner 同意開啟 |
| staging 合成資料清理（R-08） | 備份與 owner 同意 |
| Production 部署與 migration | O-19、O-20、O-26、正式金流授權 |

## 尚未判斷

- F-059 財務表 `onDelete` 是否全面不連帶刪除；F-015 `/lp` 快取；F-137、F-148 workflow 權限是否最小。處理 D-01 時一併查證，查完移到 A 或標為已完成。
