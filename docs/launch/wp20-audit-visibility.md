# WP-20：audit 可見性與交易設定保護

狀態：增量修正已驗證；WP-20／完整 Goal 仍為 IN_PROGRESS，沒有要求 READY 驗收。

## 實際重現與修正

在自建 disposable PostgreSQL，以真實 registration／order producer 對完整空來源產生正向 proof，另放入明示的合成缺漏 gap。受限 NOLOGIN／NOSUPERUSER／NOBYPASSRLS／NOINHERIT 角色只看得到 covered、看不到 gap。從先前獨立審查 SHA256 精確恢復的舊 reader，確實把 registrations 與 orders 誤判為 complete。

舊來源使用混合 CRLF／LF。恢復時只反向本次三處包裝差異及原行尾，必須吻合不可變的舊 review hash；不是另寫一個近似的舊函式來製造結果。`audit-visibility-legacy-reader.json` 綁定該來源，原始錯誤行為標成 REPRODUCED，沒有標成產品安全 PASS。

所有 audit 查詢現在使用 `withMetricReadVisibility`；visit source reconciliation 也沿用同一共用函式。它不增加 grant 或繞過 RLS：需要被 RLS 過濾的角色會明確失敗，不能把部分可見證據當完整。

- 要求 primary／RepeatableRead，保存 caller 原本的 RLS 與 statement timeout，維持較嚴格逾時，上限 5 秒。
- 同一物件在第一個 await 前拒絕重入；backend PID 加精確交易 epoch 識別不同 facade 的同一交易。協調狀態以 process registry 共用，涵蓋不同 server bundle。
- 取得交易獨占後再讀一次設定，採用鎖內快照作為真正的原值，避免 alias 延後解析到其他 guard 的暫時 off 設定。
- 設定後核對 backend／交易 epoch／RLS／timeout。即使 autocommit client 的預設隔離為 RR、設定剛好相同，也不能冒充明確交易。
- 結束時還原兩項設定。25P02 表示交易已 abort，保留原錯誤；其他還原失敗則保留兩個錯誤，以 AggregateError 明確要求 rollback，不靜默留下設定。

產品沒有新增 schema、grant、policy 或角色。測試建立的權限與 policy 全在自建 DB，已清除。既有 125 visits／viewing 正向 coverage 禁止閘門保持；沒有把這次可見性修正當成完整來源或正向 proof。

## 目前來源版本的證據

268 個相關單元測試、ESLint、完整 TypeScript 檢查通過。126 migrations 的 disposable suite 共 40 項：39 PASS、1 REPRODUCED；container／temp cleanup 通過。

實測包含真實 producer／enqueue／claim／RR reader、受限角色隱藏 gap 的舊錯誤、修正版拒絕、同物件／alias 並行、不同 server bundle 的共用保護、延後 metadata 解析、設定還原、JavaScript 加還原失敗要求 rollback，以及單連線 autocommit RR client。延續的 visit 對帳／時窗／quota／RLS／失敗邊界也執行，沒有跳過斷言或降低 coverage 門檻。

Permission scope 經 initial、followup、final、post-lock 四份獨立深度審查，原 findings 全數保留。最新範圍沒有 BLOCKER／MAJOR／MINOR，留一項 NIT：不受 guard 管理的其他程式若在同一交易中任意改 GUC，仍可能影響讀取。實際報表 loader 依序 await 四種 coverage，沒有並行修改 RLS／timeout；此處接受單一流程擁有交易的契約，不宣稱防禦任意 SQL caller。該 NIT 沒有從 reviewer 原文刪除或降級。

最新 review 供應完整 guard／coverage reader 與 reconciliation entry prefix；readSources／classifier 未再供應，改以與先前合格來源的正規化 body hash 相同來重用證據。不能把 prefix review 宣稱成完整底層／schema／部署認證。實際 provider 為 Claude CLI，observed claude-opus-5-5、effort unknown；工程路由 Sol xhigh，主代理 observed unknown。

## 保留失敗與未完成

本輪初次整合曾在既有 boundary-report 排隊回 unavailable，當時沒有原因碼；補固定 queue reason 後未重現。另一輪在 immutability-and-db-clock 段落 AssertionError，當時沒有精確斷言位置，不能僅憑檔名或段落推定是時鐘回退。現在加上固定檔案行號與相對時差診斷；最新完整執行通過。兩次根因都尚未確認，保留原收據、不宣稱已修好。先前 baseline-report 的未解釋 Error 也保留。

公開 SSR lifetime quota／永久 loss、鎖競爭與 metrics 失敗影響表單的 MAJOR 尚未修正。實際最小權限部署角色、來源 epoch／全入口範圍、typed positive proof／原子 writer fence、真正 signed Next HTTP、完整五項非零 E2E、負載／soak 尚未驗證。全部 matched 或空來源仍 unknown，這是暫時安全底線，不是 WP-20 的最終成功定義。

下一步直接對照已核准 M1／M2 合成驗收與 read-model integration：以可信 producer／fence 支持非零五項結果，並保留資料不足語意；處理配額／可用性已知 MAJOR，不用提高門檻、刪 unmatched 或永久 unavailable 取代需求。7 天只用於完看後訂單資格，不能截短觀看期間。D-2～D-6 依賴項繼續 WAITING_AUTHORIZATION 並跳過。

## ownership、回滾與路徑

root 唯一 writer，外部審查依序唯讀，parallel=1／depth=1／automatic_spawn=false。全部修改在獨立 worktree `C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal`，基底 efb8b7e9，未操作原 dirty 工作樹。沒有 push、deploy、正式 DB／付款／客戶資料操作，也沒有讀取 `.env*`、Secret Store、child environment 或 raw logs。

回滾只反向本輪程式／測試，保留來源與缺漏；不能單獨退回會把被過濾 audit 認證完整的 reader。若停用新接線，相關指標維持 unavailable，不移除 125 gate、不降低 revision、不復活 cache／lease。

Evidence 根目錄為 `docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/`，前綴 `audit-visibility-`：route、validation、db、legacy-reader、reconciliation-baseline、各 review／review-source、review-disposition、checkpoint、changed-files 及失敗收據。整體完成仍為 WP-01／05／06／07／08／10／11／15，8/20（40%），原同步 20 SSI 的 7 成功／13 失敗維持 FAIL。
