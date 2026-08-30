# G7-15 商品管理 Browser 驗收與 Server Action 修復

- Work Package：`G7-15`
- 執行模式：`PRELAUNCH_DEV_AUTONOMOUS`
- final evidence time：`2026-08-08T20:17:15.929Z`
- 結果：`LOCAL_ACCEPTED`
- staging／正式媒體 provider／Production：`NOT_RUN`

## 產品結果

1. 商品建立、圖片上傳失敗復原、重複 Slug、草稿保存、上架、預覽、外部 checkout 警示、搜尋與狀態篩選均完成 authenticated Browser 驗收。
2. Browser 證明 R2 未設定時會明確顯示失敗、提供重試與移除，不會假裝上傳成功；移除後可繼續儲存商品。
3. 發現並修正 production Server Action bug：Client 原本從 `"use server"` 模組 runtime 匯入 initial state，第一次回傳表單錯誤時 HTTP 500。initial state 與型別已移到純共享模組，Server Action 模組只保留 async action 匯出。
4. 建立商品前新增 tenant-scoped Slug 查詢，正常重複輸入直接回傳可復原錯誤；資料庫 unique constraint 與 P2002 race-window 防線仍保留。
5. Browser 新增 foreign product edit／preview 404，補強商品層租戶隔離；既有訂單層 tenant isolation 與 encrypted PII envelope 驗收仍通過。
6. 收據現在綁定 13 個 runner／test／商品 source SHA-256、五個精確 Browser contract 名稱與四張截圖 digest；執行結束前會確認 attested source 未變動。

## 驗證結果

| 驗證 | 結果 | 範圍 |
|---|---:|---|
| 商品 deterministic tests | `33/33 PASS` | action、表單、pending button、列表、預覽、checkout |
| Browser runner contracts | `5/5 PASS` | receipt parser、redaction、Axe／RWD classification、exact contract names |
| Disposable PostgreSQL | `PASS` | PostgreSQL 16 tmpfs、dynamic loopback、44 migrations |
| Production build | `PASS` | hermetic source mirror、Webpack production build |
| Chromium Browser | `5/5 PASS` | 商品 desktop/mobile、訂單 desktop/mobile、公開 checkout |
| 商品流程 | `PASS` | upload recovery、duplicate draft preservation、create、activate、preview、external checkout、filter |
| Accessibility／RWD | `PASS` | Axe serious/critical=0、mobile overflow、keyboard skip link |
| Tenant／PII | `PASS` | foreign product edit/preview 404、foreign order 404、encrypted envelope 不出現在 HTML |
| TypeScript／scoped ESLint | `PASS` | final source、test、runner scope |
| Read-only final review | `NO_P0_P1_FINAL` | correctness、安全、tenant、資料完整性、Server Action、evidence lineage |
| Cleanup | `PASS` | server、exact-label container、tmpfs、temp mirror 均清除 |

## Evidence lineage

- Final Browser receipt：`docs/ai-team/evidence/g7-04-browser-qa-7602fc38597fc488.json`
- Receipt SHA-256：`40339bf5523e285e77ce5e31c3f2e3f50c9ba6f054585373b49e0f6ad9c1bfb6`
- Browser screenshots：`docs/ai-team/evidence/g7-04-browser-qa-7602fc38597fc488-screenshots/`
- Machine-readable report：`.ai-team/reports/g7-15-product-catalog-browser-20260809.json`
- Source manifest：`docs/ai-team/evidence/g7-15-source-manifest-20260809.txt`
- Artifact digests：`docs/ai-team/evidence/g7-15-artifact-digests-20260809.txt`
- receipt 沿用歷史 `G7-04` schema／workPackage 名稱；本文件只引用其 current-source、具名 contract 與 source-lineage 結果，不改寫原始 provenance。

## 如實保留的失敗與修復過程

- 初期 Browser runs 曾因 `role=status`／`role=alert` 同時命中 Next live region 而失敗，後續改用精確訊息或表單 scope，沒有弱化文案 assertion。
- 人工延遲 Server Action 的攔截路線無法提供可信 action state，已停止該路徑；儲存 pending 由 deterministic shared submit-button test 驗證，Browser 保留媒體 pending／disabled 與實際提交結果。
- 真實 production Browser 連續證明 duplicate Slug POST 回 500，促成 Server Action shared-state 修復；修後 final run 為 5/5 PASS。
- 第一張 PASS receipt 的商品截圖 metadata 使用錯誤 camelCase 檔名，未作 final evidence；final receipt 使用實際 basename 並通過 digest readback。
- Reviewer 首輪指出 receipt 未綁 source digest／具名 contract 的 P1；final runner 已修復，複核結果 `NO_P0_P1_FINAL`。

## 分數與邊界

- 固定可販售功能 inventory 的「商品管理」由原本缺 authenticated Browser 證據，形成 local candidate `8.0/10`。分數依據為完整商家工作流、錯誤復原、租戶隔離、desktop/mobile、Axe、production build 與 fresh DB；正式媒體 provider、staging 與真人 acceptance 尚未執行，因此不評為 9 分以上。
- 外部 checkout 目前接受 `http:`／`https:`，是否強制 HTTPS 仍是 P2 產品政策決策；final reviewer 未將其判為 P0/P1。
- canonical total 維持 `73.5`，`CAT04=6.0`、`CAT10=4.5`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。本地功能候選分數不直接改寫外部／真人證據缺口。
- 沒有讀取 `.env*`，沒有執行 staging、PayUni Sandbox、Production、正式付款／退款／寄信，也沒有重試 FIN-08AA、WP-196 或 WP-197。

## Ownership、回滾與下一步

- 工作區原本已有大量使用者與舊 WP 變更；本 WP 只接管 source manifest 所列 G7-15 files／hunks，不 stage、不 commit、不 push。
- 回滾範圍限於 product action shared state、duplicate Slug UX、commerce Browser 商品案例、receipt source lineage／contract 驗證與對應 tests；不得回滾其他既有 checkout、order、PII、inventory 或 G7 功能。
- 依使用者要求，本 checkpoint 完成後停下。下一次恢復先依固定 inventory 選擇仍缺最新 Browser／產品完整性證據的最高價值項目；CAT04／CAT10 外部與真人 blocker 繼續列待辦後跳過。

