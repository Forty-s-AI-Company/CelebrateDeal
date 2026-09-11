# 09 — 直播功能整合驗收

日期：2026-09-12  
範圍：01～08 直播功能整合驗收與必要修復

## 結論

本次未發現可由目前本機 targeted tests 重現、且需要立即修改的產品程式缺陷，因此沒有改動直播 runtime、權限、資料 schema 或既有觀看／下單流程。整合驗收**未達完整端到端通過**：資料庫、正式登入、外部影音服務、真機／Safari、跨網路延遲與遠端 CI 未完成驗證。

## 實際驗證證據

| 項目 | 結果 | 實際證據與界線 |
|---|---|---|
| 1. 建立活動、橫／直式、PPT／攝影機排版、去背 | 部分通過 | `npx vitest run` 的 presenter、orientation、background、live page／playback 相關測試通過；交接 PNG／browser evidence 標為 PASS。未驗證外部攝影機、MediaMTX／HLS 實播、完整登入流程與實體裝置。 |
| 2. 兩觀眾私人聊天隔離、講師回覆隔離 | 測試通過，E2E 未完成 | `src/lib/live-chat*`、兩個聊天 API route 與元件測試包含隔離契約；private-chat browser evidence 是真 React + 合成 API，不是正式登入 E2E。`private-chat-disposable-qa.mjs --verify-receipt` 實際回傳 `PRIVATE_CHAT_RECEIPT_INVALID`，故不得引用為有效 DB receipt。 |
| 3. 文字、選擇題、快捷回應、貼圖卡片 | 通過合約／元件層 | interaction-card、live-question、interaction API 與 UI 測試通過；交接 browser evidence 為真 React + 合成 API。未完成外部影音實播下的正式多觀眾 E2E。 |
| 4. 預錄時間觸發、暫停、快轉、重連 | 通過可測範圍 | playback、timeline、scripted roles 測試及既有 timeline DB/browser evidence 覆蓋 server clock、currentTime、pause／seek、重連及不補播規則。未固定 cohort 的常青 JIT/daily/on-demand 與外部播放器仍是已知限制。 |
| 5. 公開互動才進彈幕、講師／觀眾開關 | 通過合約／API／UI | `live-danmaku`、card、scripted roles 測試涵蓋 private chat、private card、單選及角色排除，講師總開關與觀眾個人開關；browser evidence 使用合成 HTTP API，輪詢仍有最終一致延遲，未驗證跨網路零延遲。 |
| 6. 預設角色暖場且不污染真人統計 | 通過 domain／DB 契約 | scripted roles 測試與 DB evidence 覆蓋 `scripted_role` 投影、來源標示及不建立真人 response／chat／觀看／訂單紀錄；未驗證真實登入及高併發。 |
| 7. 手機橫直拿、鍵盤、全螢幕替代、桌面 | 通過瀏覽器模擬範圍 | 390×844／844×390、鍵盤操作、44px 控件、16px 輸入、無水平溢出與頁內全螢幕均有既有 browser evidence／元件測試。未驗證 iOS Safari、Android Chrome、原生影片全螢幕疊加。 |
| 8. 觀看、聊天、下單回歸 | 通過本機 targeted suite | `npm run test:interactions`：27 files、285 tests passed；其中包含 viewer live page、playback、chat、checkout／commerce。未執行完整 release E2E，不能宣稱平台級無回歸。 |
| 9. GitHub Actions 與 Production 邊界 | 設定通過，遠端未驗證 | `.github/workflows/ci.yml` 觸發 `push`／`pull_request`，包含 lint、typecheck、coverage、unit／interaction tests、DB concurrency、build；未發現 Production deploy job。未 push、未觸發遠端 CI。 |

### 本次本機命令

- `npm run test:interactions`：27 個測試檔、285 項通過。
- 直播專用 targeted Vitest：16 個測試檔、188 項通過；1 個 DB 測試檔、5 項 skipped，原因是本機 DB／環境條件，未標示 PASS。
- `npm run lint`：命令啟動後在本機 session 未於可接受時間內完成，未取得成功退出證據；不可標示通過。
- `npm run typecheck`：因前一命令 session 未完成而未取得獨立成功退出證據；不可標示通過。
- `interaction-card-checks.mjs`、`interaction-timeline-checks.mjs`：目前不存在，交接文件所述命令無法執行。
- `presenter-checks.mjs` 等 checks：執行時 Prisma Windows query engine 發生 EPERM rename lock，未完成；不是產品 PASS／FAIL 證據。

## 必要修復判定

本次沒有修改產品程式：targeted tests 未指出可安全、最小化修復的 runtime 缺陷。已識別的問題屬驗收工具／證據缺口（無效 receipt、交接命令與現存檔案不一致、Prisma engine lock），不以改測試、降低 assertion 或新增 mock 來掩蓋。

## 尚未驗證與外部依賴

- 正式或 staging 登入、兩名真實觀眾跨瀏覽器權限流程。
- Cloudflare Stream／MediaMTX／HLS 實播、攝影機、PPT 分享、去背 worker 長時間資源回收。
- iOS Safari、Android Chrome、桌面 Safari，以及真機橫直旋轉、鍵盤與原生全螢幕限制。
- 真實跨網路時鐘延遲、彈幕高併發壓力、長時間播放與 reconnect。
- GitHub-hosted CI 實際 run；本地 workflow 靜態檢查不等於遠端成功。
- 交接文件所引用的 DB receipts 中，至少私密聊天 receipt 驗證失敗；其餘 evidence 仍只能視為既有 sanitized／合成邊界證據。

## 回滾方式

本次沒有產品程式修復可回滾。若需回復本次模式設定，精確撤回 `.codex/config.toml` 的 ai-team-pro 設定變更即可；不得使用廣域 restore/reset，也不得撤回其他既有工作。驗收文件可單獨刪除或修訂，不影響 runtime 資料。

## Checkpoint

本文件與本次明確的 `.codex/config.toml` 模式切換變更已保留。建立 commit 前會再次檢查工作樹；若 `.git/index.lock` 或權限仍阻擋，將如實回報無 commit hash。
