# 04 新 skill 草稿索引與觸發測試（D-03）

> 日期 2026-10-19，分支 `codex/goal-review-2026q4`，基線 `78621ca3`。草稿全部放在 `docs/skills-2026Q4/drafts/<name>/SKILL.md`，**尚未**放進 `.claude/skills/`，也未經 `skill-creator` eval。字數指正文中文字元數（不含 frontmatter），7 份介於 312 至 666 字。

## 1. 草稿總表

| Skill | 草稿 | 主要來源 | 正文中文字數 | 建議的放入條件 |
|---|---|---|---:|---|
| `celebratedeal-nextjs16-conventions` | `drafts/celebratedeal-nextjs16-conventions/SKILL.md` | B-05（`15-nextjs-conventions.md`）、`AGENTS.md` | 369 | B05-01／02 修復 PR 合併後，把清單中已修的項目改成「回歸檢查」 |
| `celebratedeal-prisma-migration-safety` | `drafts/celebratedeal-prisma-migration-safety/SKILL.md` | B-04（`14-data-migration.md`） | 333 | 與 B04-11（`db:migrate` 加 loopback 防護）同步，否則禁止事項只是文字 |
| `celebratedeal-payuni-sandbox` | `drafts/celebratedeal-payuni-sandbox/SKILL.md` | B-03（`13-payments-finance.md`）、`docs/launch/payuni-token-contract-20260929.md`、sandbox runner 文件 | 414 | B03-01／04 修復後，欄位語意段改寫成「已驗證事實」；Token 段需 owner 確認申請狀態 |
| `celebratedeal-market-research-ledger` | `drafts/celebratedeal-market-research-ledger/SKILL.md` | 計畫 §8.3、市場研究報告格式 | 475 | 可直接採用 |
| `celebratedeal-evidence-receipt` | `drafts/celebratedeal-evidence-receipt/SKILL.md` | 計畫 §8.3、`reports/review-2026Q4/*-receipt.md` | 366 | 可直接採用；與 `celebratedeal-release-gate` 互相引用 |
| `celebratedeal-tw-compliance` | `drafts/celebratedeal-tw-compliance/SKILL.md` | 市場研究「封測前要先解決的是金流定性和退款告知」「AI 只該輔助真人」 | 666 | 需 owner 與律師看過清單措辭；條號一律不入 skill 作為定案 |
| `celebratedeal-worktree-hygiene` | `drafts/celebratedeal-worktree-hygiene/SKILL.md` | B-10（`20-dead-code-residue.md` §4）、`AGENTS.md` | 312 | 可直接採用；worktree 清理完成後仍保留作為新工作的 SOP |

既有 skill 的形式是「一句 description＋連到 `docs/domain-workflows.md` 錨點」。新草稿比較長（含檢查清單），原因是這些主題目前在 `domain-workflows.md` 沒有對應章節。若 owner 偏好既有形式，可把清單搬進 `docs/domain-workflows.md` 新章節，SKILL.md 只留 description 與連結。

## 2. 觸發測試句

每個 skill：應觸發 2～3 句（使用者可能的說法）、不應觸發 1 句（容易混淆的反例）。

### celebratedeal-nextjs16-conventions
- 應觸發：「幫我把 billing 的 error.tsx 重試按鈕修好」「這個頁面的 Image 要加 priority，順便看一下有沒有棄用」「新增一個 server action 表單，送出鈕怎麼做才符合專案慣例」
- 不應觸發：「幫我寫一個純 TypeScript 的金額格式化函式並補單元測試」（沒有 Next API）

### celebratedeal-prisma-migration-safety
- 應觸發：「幫 PaymentTransaction 加 refunded <= gross 的 CHECK」「schema 新增一個 model，migration 要怎麼寫」「我想在本機跑 prisma migrate dev」
- 不應觸發：「幫我寫查訂單列表的 Prisma 查詢並加分頁」（只用 client 查詢，沒有 schema 或 migration 變更）

### celebratedeal-payuni-sandbox
- 應觸發：「PayUni 回呼顯示失敗卻被記成已付，幫我查」「跑一次 Sandbox 付款驗證」「要上綁卡功能，Token 要先申請什麼」
- 不應觸發：「結帳頁的優惠券折扣算錯，幫我修」（金額邏輯，沒有碰 PayUni 欄位或 Sandbox）

### celebratedeal-market-research-ledger
- 應觸發：「幫我補一份蝦皮與 91APP 的費率比較，附來源」「更新市場研究裡 LINE 官方帳號的方案價格」「把這篇競品文章整理進報告」
- 不應觸發：「幫我寫登入頁的繁中文案」（產品文案，不是外部資料研究）

### celebratedeal-evidence-receipt
- 應觸發：「這個 WP 做完了，幫我寫收據」「我要回報測試通過，格式要怎麼寫」「把三個子代理的結果整理成驗收證據」
- 不應觸發：「幫我寫給買家的付款成功 Email 範本」（業務收據文案，不是工程證據收據）

### celebratedeal-tw-compliance
- 應觸發：「結帳頁要不要放 7 天鑑賞期說明」「預錄場要做倒數計時加庫存剩餘」「聯盟可以讓推薦人再抽下線的錢嗎」
- 不應觸發：「幫我把儀表板的圖表改成 sparkline」（純 UI，沒有個資、廣告、金流或告知問題）

### celebratedeal-worktree-hygiene
- 應觸發：「幫我清掉那 7 個舊 worktree」「node_modules 是 junction，可以直接刪資料夾嗎」「我要開新分支做下一個 WP」
- 不應觸發：「這個 PR 的 CI 紅燈，幫我看 log」（CI 診斷，不是分支或 worktree 管理）

## 3. 用 `skill-creator` 做 eval

專案可用的 `skill-creator` 是 Claude Code 內建 skill（`anthropic-skills:skill-creator`，用途：建立、修改 skill、跑 eval、做變異分析、最佳化 description 觸發率）。以下流程依其用途整理；具體腳本名稱與參數請在載入該 skill 後以其內文為準，本草稿階段**尚未執行任何 eval**，也未讀取其內文。

1. **測試副本**：eval 用的副本放 skill-creator 指定的 workspace 或暫放 `.claude/skills/`，不要直接改草稿；eval 結束再決定是否正式提交，草稿目錄保持乾淨。
2. **寫 eval prompts（內容品質）**：每個 skill 從 §2「應觸發」句挑 2 句，加一個有陷阱的情境（例如 payuni：附一份只有 `Status=SUCCESS`、`TradeStatus=2` 的合成回呼，期望判定為失敗）。每個 prompt 寫明期望行為（例如「讀了 `error.md` 才動手」「沒有執行 `migrate dev`」「沒有貼出任何金鑰」）。
3. **有／無 skill 對照**：同一組 prompt 各跑一次帶 skill、一次不帶（baseline），用子代理在乾淨的 worktree 或唯讀模式執行；涉及 DB 或外部服務的題目只跑「規劃輸出」，不真的連線。
4. **評分與檢視**：依 skill-creator 的評分與檢視流程逐項比對期望，記錄通過率、token 與耗時差異。baseline 本來就答對的檢查項目，邊際價值低，應刪除或合併。
5. **Description 觸發最佳化**：把 §2 句子擴充成 should-trigger／should-not-trigger 查詢集（每 skill 至少各 8 句，混入與 `celebratedeal-release-gate`、`celebratedeal-multi-tenant-security`、`celebratedeal-attribution-commission`、`celebratedeal-product-domain` 相鄰的邊界案例），用 skill-creator 的 description 最佳化流程在訓練／測試集上迭代。已知的潛在衝突：`payuni-sandbox` 對 `attribution-commission`、`evidence-receipt` 對 `release-gate`、`tw-compliance` 對 `product-domain`。
6. **建議通過門檻**：應觸發 ≥ 90%、不應觸發的誤觸發 ≤ 10%；有 skill 組的清單遵循率高於 baseline；若 skill 讓輸出變長但沒變準，就縮短它。
7. **收據**：eval 結果寫入 `reports/<goal>/D-03-eval-receipt.md`，列 prompt、模型 observed／unknown、通過率、未跑項目，遵守 `celebratedeal-evidence-receipt`。
8. **上線**：通過後以 PR 把通過的 skill 搬進 `.claude/skills/`，必要時同步更新 `CLAUDE.md` 的領域技能說明（需 owner 同意）。

## 4. 草稿的已知限制

- 內容反映 2026-10-19 基線的審查發現（例如 `unstable_retry`、PayUni `TradeStatus`）；對應缺陷修復後，檢查清單要改成回歸檢查，否則會誤導。
- PayUni 欄位語意來自 B-03 reviewer 的程式碼與探針判讀，本次未重新對照官方文件；進入 `.claude/skills/` 前建議由持有 Sandbox 後台權限的人核對 `TradeStatus` 代碼表。
- `tw-compliance` 只是開發前的提醒清單，不是法律意見；條號、罰則與門檻仍需律師確認。
- 本次只確認 `node_modules/next/dist/docs/` 內 `error.md`、`image.md`、`proxy.md` 檔案存在，沒有逐檔重新驗證 B-05 的結論。
- 字數用 CJK 字元計算；含英文、路徑與符號的總長度約 890～1,880 字元，若 owner 以總長度計，nextjs16、prisma、payuni 三份需再精簡。
