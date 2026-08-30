# FIN-2026-08-08-84｜Affiliate payout paid-reference closure

記錄時間：2026-08-08（Asia/Taipei）
結果：\`COMPLETE_LOCAL_FINANCE_P1_NO_SCORE_CHANGE\`

## 本輪完成的產品功能

補上聯盟佣金「commission → payout → paid」最後一段的可追溯出款依據：

- \`recordAffiliatePayoutOutcomeAction\` 在 \`paid\` transition 要求 1～200 字的人工出款／provider outcome reference；缺漏、空白或超長會 fail closed。
- \`AffiliatePayout.outcomeReference\` 以 additive nullable 欄位保存；歷史資料沒有 reference 時保留 \`null\`，不回填或推測不存在的證據。
- \`/affiliates/commissions\` 的 paid 操作要求輸入 reference，並顯示已保存的出款 reference。
- paid audit snapshot 同時保存 payout、reference、reason 與 transition time；void transition 會清除 reference。
- 原有 vendor finance authorization、MFA／CSRF boundary、commission ledger balance 檢查與 Serializable transaction 保留。

這完成的是本機產品與資料模型閉環，不代表銀行、PayUni 或其他外部 payout provider 已執行。

## Deterministic verification

- action／affiliate commission page：2 files、160/160 PASS、0 failed、0 skipped。
- PostgreSQL marker-gated disposable DB：\`actions.payout-db.test.ts\` 3/3 PASS；包含實際 paid transition、reference 持久化與 commission status paid。
- tenant ledger invariant：1 file、4/4 PASS（先前 marker-gated disposable schema run）。
- 最終 DB run：\`20260808063816_7341\`；wp17／wp18 兩個新 schema，34 migrations 各自 deploy/status PASS，兩個 marker cleanup PASS。
- Prisma validate：PASS；Prisma generate：PASS。
- scoped ESLint：PASS。
- \`npx tsc --noEmit\`：PASS。
- \`npm run build\`：PASS；Next production build static pages 89/89。
- \`git -c core.autocrlf=false diff --check\`：PASS；migration 無 trailing whitespace。
- 既有 loopback migration receipt：34 migration、validate/deploy/status、container cleanup 與 temp cleanup 全 PASS。

## 診斷紀錄

以下結果均如實保留，沒有列為 PASS：

- 初次直接 SQL invocation 因 PowerShell quoting 在 schema 建立前失敗，未計入成功。
- 舊 affiliate fixture 缺少 product source 的金額欄位，先觸發資料庫 check constraint；補上真實必要 fixture 後未再以弱化 assertion 掩蓋。
- 初版 DB harness 缺少 \`monthRange\`、\`requireVendorFinance\` 與 \`requestAuditMeta\` mock；逐一補齊後才取得成功結果。
- 一次暫存 runner 的 PowerShell interpolation 產生 \`/=schema\`，被 local database safety 正確拒絕；這是 runner 問題，不是產品或 migration PASS。
- 初版 afterEach 嘗試刪除 append-only \`AffiliateCommissionLedgerEntry\`，被 \`P0001\` trigger 正確拒絕；修正為只以完整 marker-gated disposable schema 清理，未刪除 immutable ledger row。

## 分數與未完成邊界

Canonical readiness truth 維持 **73.5**：CAT04=6.0、CAT10=4.5，\`current_goal_score_change=0\`，\`SANDBOX_READY=false\`、\`PRODUCTION_READY=false\`。本地 affiliate payout reference gate 不冒充 CAT04 所需的全新 authorized staging／PayUni Sandbox transaction、refund／reconciliation evidence，也不冒充 CAT10 真人 merchant／support／finance／privacy-legal／release owner 簽核或 external monitoring delivery／ack／recovery。

本輪沒有 Production、正式資料庫、正式付款／退款／銀行轉帳、寄信、PayUni Sandbox、staging、deployment、push 或 merge；沒有讀取或輸出 secrets、正式客戶資料或付款資料。沒有重試 FIN-08AA、WP-196 或 WP-197。

沒有降低 coverage threshold、source inventory、exclude、skip、assertion 或資料驗證強度；global coverage 仍保留 QUAL-74 的真實 FAIL_REMAINING_SOURCE_INVENTORY 結果，不阻擋本輪功能與 disposable DB 驗證。

## 回滾與下一步

回滾範圍限於本輪 affiliate payout action／UI、Prisma schema／additive migration、對應 tests 與 evidence／control-plane metadata；migration 僅在 loopback disposable schema 執行。此段落完成後停止，不自動啟動 CAT04 外部交易或 CAT10 真人簽核。
