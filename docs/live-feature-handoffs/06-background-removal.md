# 06 講師透明人像去背

日期：2026-09-11。狀態：LOCAL_IMPLEMENTED_AND_VERIFIED；真人畫質、真機及長時間記憶體 release evidence 尚未取得。

## 完成範圍與合約

- `/lives/[id]/presenter` 增加本次裝置工作階段的去背開關，預設關閉；載入、啟用、失敗、不支援、過慢均有狀態與一般攝影機回退。
- 只對獨立攝影機來源處理。橫式子母畫面沿用四角及 15–35% 大小；並排、直式上下區域沿用 04／05 幾何，不改直式版型。
- 去背影格直接畫入既有 PPT 合成 canvas，再由原本 WHIP → MediaMTX → WHEP 傳送。觀眾不需執行模型，亦不依賴串流支援透明 alpha。沒有新增資料庫欄位、API 或媒體第三方服務。
- 開關不保存到活動；載入／失敗時送出一般攝影機畫面。切換攝影機、mute／ended、停止或元件卸載會終止 worker、關閉暫存 ImageBitmap；再次使用來源需手動重新開啟去背。原本來源 tracks／video／合成 tracks 由 presenter-media 釋放。
- 不拆解既有合成預錄影片，也不新增分離預錄來源的同步合成。

主要檔案：`src/lib/presenter-background.ts`、`src/lib/presenter-media.ts`、`src/components/presenter-studio.tsx`、`public/presenter-segmentation/worker.js`，及對應測試、`scripts/background-removal-{checks,browser-qa}.mjs`。

## 模型、隱私與效能設計

使用 MediaPipe Tasks Vision 0.10.32 與 Selfie Segmenter general float16，CPU delegate、獨立 dedicated worker、VIDEO 模式。runtime 與模型均 Apache-2.0；保留 LICENSE。模型授權依[官方 model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf)，runtime 依 [MediaPipe repository](https://github.com/google-ai-edge/mediapipe)。

模型 249,537 bytes，SIMD WASM 11,453,626 bytes，JS wrapper 與 SIMD loader 合計約 342 KB；正常 SIMD 首次下載合計約 12.05 MB（未壓縮，不含小型 worker）。不支援 SIMD 時選用 10,647,962-byte non-SIMD WASM。兩版本都隨網站部署，但瀏覽器只載入所需版本。確切來源、SHA-256、修改說明見 [assets receipt](background-removal-assets.json)。上游模型網址含 latest，部署使用已下載且記錄雜湊的固定本機檔案，不在瀏覽器請求 latest。

開啟後才載入，全部請求網站同源 `/presenter-segmentation/`。攝影機影像僅在本機主執行緒與 worker 間轉移；原有直播傳送行為不變。輸入等比縮至最多 640×480、最多 15fps、一次一張，合成仍使用既有 30fps。載入限時 20 秒，單張限時 2 秒，連續 10 張超過 150ms 自動回退。這些是保護門檻，不代表所有裝置都能達標。

## 實際驗證

| 驗證 | 實際結果 |
| --- | --- |
| `node scripts/background-removal-checks.mjs` | PASS：完整 `tsc --noEmit`、指定 ESLint、4 檔 25 項單元測試。[receipt](background-removal-checks.json) |
| 單元情境 | 開關、縮圖／單張排程、載入錯誤／逾時、不支援、過慢回退、晚到影格、camera mute／替換、停止釋放與穩定輸出軌。 |
| `node scripts/background-removal-browser-qa.mjs` | PASS：18 個檢查，真 MediaPipe worker＋WHIP／MediaMTX／WHEP，遠端實際解碼像素、關閉恢復、載入失敗、分享來源更換與停止；0 page errors。[receipt](background-removal-browser-evidence.json) |
| 120 秒持續處理 | 每 20 秒觀察皆為 1 個 worker 且影格數增加；整輪 1,264 張，900 張處理時間樣本中位數 28.7ms、P95 43ms、最大 262.1ms，未達連續過慢門檻。3 個曾建立的 worker 最後全部終止。 |
| Worker／資產 | worker ESLint、`node --check`、資產每筆 bytes／SHA-256 檢查 PASS；只精確排除 3 個第三方 runtime JS 的 ESLint，自寫 worker 保持 lint。 |
| `git diff --check` | PASS，Git 僅提示 CRLF 換行。 |

實測條件：Windows 10 build 19045、Intel i7-7700 3.60GHz（8 logical CPUs）、24 GiB RAM、headless Microsoft Edge 152.0.4191.66。合成攝影機 640×360、PPT 1024×768，輸出 1920×1080；模型 CPU worker。處理時間是 worker inference＋合成，不是端到端影音延遲，也未量測 GPU／worker 記憶體。120 秒樣本约 10.4fps，不宣稱達到 15fps 上限。

已目視檢查[啟用畫面與回傳監看](background-removal-active.png)。測試的無人紅色攝影機被去除後，觀眾實際影格可見下方藍色 PPT；此證據不代表人像保留品質。auth／DB／攝影機為 harness 邊界，未部署外部媒體主機或測 NAT／TURN、正式登入及現用 DB。

第一次瀏覽器測試 runtime wrapper／OffscreenCanvas 初始化失敗，確實回退一般攝影機；修正後再跑真 worker／遠端像素與最終持續測試皆通過，沒有降低 assertion。

未取得實體攝影機或手機真機證據。頭髮細絲／半透明邊緣、快速手部移動殘影、不同膚色與衣服／背景對比、逆光、多人入鏡尚未驗證。不得把合成無人影像的像素測試視為真人去背品質驗收。

建議人工實測條件：記錄 CPU／GPU／RAM、OS、瀏覽器版本與攝影機解析度；在均勻光、低光、逆光下，以單色牆、雜亂房間、衣服與背景近色各測 2 分鐘，測髮絲、手指張開、快速揮手與移出／回到畫面。PPT 使用細文字，四角與兩端大小分別查看觀眾回傳畫面。至少連播 30 分鐘，每 5 分鐘記錄 FPS、CPU 與記憶體，再重複開關 20 次、切換攝影機與分享來源、離頁／返回，確認記憶體無持續上升、裝置燈熄滅與無殘留 worker。桌面 Edge／Chrome、macOS Safari、iOS Safari、Android Chrome 需分別驗證。

## 自查、CI 與回滾

安全：固定同源資產、無新增影像上傳與權限／租戶契約變更。效能：有界影格、worker 隔離、逾時終止與 CPU fallback。可維護性：處理控制器獨立，沿用原版型／推流合約，重要資源生命週期有測試。

既有 `.github/workflows/ci.yml` 在每次 push／PR 執行 ESLint、typecheck、單元測試與 coverage，沿用；無新增 Production 部署。未讀秘密、操作外部 DB、push／merge／部署。

回滾：先關閉去背；撤回本次 presenter-media／presenter-studio 接線及新增 controller、worker、資產即可，無資料 migration。共享檔案含 01–05 未提交成果，不得整檔還原。後續彈幕與互動仍應合規隔離私人內容，無去背模型依賴。

已讀 AGENTS、session guide、構想、04／05 handoff、workflow policy 與本機 Next.js use-client 文件。ai-team-pro router 已套用，但 `.codex/config.toml` 寫入遭權限拒絕，未繞過，未宣稱模型設定完整同步。主代理負責整合，獨立 worker 僅負責模型／runtime 與處理 worker 資產；未使用不可用的 Claude 審查。

Checkpoint：最後嘗試精確 `git add -- docs/live-feature-handoffs/06-background-removal.md`，`.git/index.lock` 寫入遭 Permission denied。未 stage、未建立 commit，沒有 commit hash；未繞過權限。既有大量未提交變更全部保留，未使用廣域 stage 納入未知 ownership。
