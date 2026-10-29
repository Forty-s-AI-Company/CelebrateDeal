# Webinar 範本批次 2（06～10）不跑版 QA 證據

- 指令：`npm run qa:template-layout -- --templates=webinar-travel-story,webinar-fitness-video,webinar-marketing-summit,webinar-career-value,webinar-language-series --stress`（不帶 `--base-url`，全新鏡像目錄＋`next dev`）
- 日期：2026-10-28，分支 `ai/webinar-templates-batch-2`
- 結果：85 個回合（5 個範本 × 8 種寬度 × 一般／壓力文案，加上 375×667 首屏檢查），**0 項失敗**。完整結果見 `report.json`。
- 截圖：一般文案 1440／1280／1024／768／390／375／360／320 全頁截圖；壓力文案只保留 1440 與 390。原始 PNG 轉成 JPEG（品質 72）以控制大小。
- 人工檢查：每個範本都看過 1440、768、390 的截圖（標題斷行、孤字、留白與對齊）。L-8、L-9 與 axe 對比複查未自動化。
- 共用元件問題與替代做法：`docs/product/webinar-templates/notes/batch-2.md`。
