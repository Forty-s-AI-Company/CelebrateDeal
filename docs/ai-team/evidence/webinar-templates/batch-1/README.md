# Webinar 範本批次 1（01–05）不跑版 QA 證據

- 腳本：`npm run qa:template-layout -- --templates=<id> --stress --base-url=http://127.0.0.1:31127`（本機 `next dev`，合成資料，harness 沒有活動排程，所以日期一律顯示「時間公布中」）
- 寬度：1440、1280、1024、768、390、375、360、320（降級檢查）＋ 375×667 首屏，每個寬度都跑一般文案與壓力文案
- 結果：5 個範本 × 17 回合 = 85 回合，**0 項失敗**
- 截圖：每個範本保存所有寬度的一般文案，以及 1440／390 的壓力文案；縮成 640px 寬 JPG（原始全頁 PNG 在 `artifacts/funnel-template-qa/`，不入庫）
- 02 與 03 的截圖來自單獨重跑：合併跑 5 個範本時，dev server 偶發 1 次「30 秒內未就緒」（02@1440 壓力）與 3 次 React hydration 警告（03@1440、360、320 壓力），單獨重跑兩次（03）／一次（02）各 17 回合都是 0 失敗，在瀏覽器手動重載 03 五次也沒有錯誤，判斷是平行負載下的偶發狀況，記錄於 `docs/product/webinar-templates/notes/batch-1.md`

| 範本 | 寬度 | 文案 | 失敗 |
|---|---|---|---|
| `webinar-ai-minimal` | None | 一般 | 0 |
| `webinar-ai-minimal` | None | 壓力 | 0 |
| `webinar-ai-minimal` | None | 一般 | 0 |
| `webinar-ai-minimal` | None | 壓力 | 0 |
| `webinar-ai-minimal` | None | 一般 | 0 |
| `webinar-ai-minimal` | None | 壓力 | 0 |
| `webinar-ai-minimal` | None | 一般 | 0 |
| `webinar-ai-minimal` | None | 壓力 | 0 |
| `webinar-ai-minimal` | None | 一般 | 0 |
| `webinar-ai-minimal` | None | 壓力 | 0 |
| `webinar-ai-minimal` | None | 一般 | 0 |
| `webinar-ai-minimal` | None | 壓力 | 0 |
| `webinar-ai-minimal` | None | 一般 | 0 |
| `webinar-ai-minimal` | None | 壓力 | 0 |
| `webinar-ai-minimal` | None | 一般 | 0 |
| `webinar-ai-minimal` | None | 壓力 | 0 |
| `webinar-ai-minimal` | 375x667 | 一般 | 0 |
| `webinar-saas-split` | None | 一般 | 0 |
| `webinar-saas-split` | None | 壓力 | 0 |
| `webinar-saas-split` | None | 一般 | 0 |
| `webinar-saas-split` | None | 壓力 | 0 |
| `webinar-saas-split` | None | 一般 | 0 |
| `webinar-saas-split` | None | 壓力 | 0 |
| `webinar-saas-split` | None | 一般 | 0 |
| `webinar-saas-split` | None | 壓力 | 0 |
| `webinar-saas-split` | None | 一般 | 0 |
| `webinar-saas-split` | None | 壓力 | 0 |
| `webinar-saas-split` | None | 一般 | 0 |
| `webinar-saas-split` | None | 壓力 | 0 |
| `webinar-saas-split` | None | 一般 | 0 |
| `webinar-saas-split` | None | 壓力 | 0 |
| `webinar-saas-split` | None | 一般 | 0 |
| `webinar-saas-split` | None | 壓力 | 0 |
| `webinar-saas-split` | 375x667 | 一般 | 0 |
| `webinar-design-workshop` | None | 一般 | 0 |
| `webinar-design-workshop` | None | 壓力 | 0 |
| `webinar-design-workshop` | None | 一般 | 0 |
| `webinar-design-workshop` | None | 壓力 | 0 |
| `webinar-design-workshop` | None | 一般 | 0 |
| `webinar-design-workshop` | None | 壓力 | 0 |
| `webinar-design-workshop` | None | 一般 | 0 |
| `webinar-design-workshop` | None | 壓力 | 0 |
| `webinar-design-workshop` | None | 一般 | 0 |
| `webinar-design-workshop` | None | 壓力 | 0 |
| `webinar-design-workshop` | None | 一般 | 0 |
| `webinar-design-workshop` | None | 壓力 | 0 |
| `webinar-design-workshop` | None | 一般 | 0 |
| `webinar-design-workshop` | None | 壓力 | 0 |
| `webinar-design-workshop` | None | 一般 | 0 |
| `webinar-design-workshop` | None | 壓力 | 0 |
| `webinar-design-workshop` | 375x667 | 一般 | 0 |
| `webinar-finance-host` | None | 一般 | 0 |
| `webinar-finance-host` | None | 壓力 | 0 |
| `webinar-finance-host` | None | 一般 | 0 |
| `webinar-finance-host` | None | 壓力 | 0 |
| `webinar-finance-host` | None | 一般 | 0 |
| `webinar-finance-host` | None | 壓力 | 0 |
| `webinar-finance-host` | None | 一般 | 0 |
| `webinar-finance-host` | None | 壓力 | 0 |
| `webinar-finance-host` | None | 一般 | 0 |
| `webinar-finance-host` | None | 壓力 | 0 |
| `webinar-finance-host` | None | 一般 | 0 |
| `webinar-finance-host` | None | 壓力 | 0 |
| `webinar-finance-host` | None | 一般 | 0 |
| `webinar-finance-host` | None | 壓力 | 0 |
| `webinar-finance-host` | None | 一般 | 0 |
| `webinar-finance-host` | None | 壓力 | 0 |
| `webinar-finance-host` | 375x667 | 一般 | 0 |
| `webinar-realestate-countdown` | None | 一般 | 0 |
| `webinar-realestate-countdown` | None | 壓力 | 0 |
| `webinar-realestate-countdown` | None | 一般 | 0 |
| `webinar-realestate-countdown` | None | 壓力 | 0 |
| `webinar-realestate-countdown` | None | 一般 | 0 |
| `webinar-realestate-countdown` | None | 壓力 | 0 |
| `webinar-realestate-countdown` | None | 一般 | 0 |
| `webinar-realestate-countdown` | None | 壓力 | 0 |
| `webinar-realestate-countdown` | None | 一般 | 0 |
| `webinar-realestate-countdown` | None | 壓力 | 0 |
| `webinar-realestate-countdown` | None | 一般 | 0 |
| `webinar-realestate-countdown` | None | 壓力 | 0 |
| `webinar-realestate-countdown` | None | 一般 | 0 |
| `webinar-realestate-countdown` | None | 壓力 | 0 |
| `webinar-realestate-countdown` | None | 一般 | 0 |
| `webinar-realestate-countdown` | None | 壓力 | 0 |
| `webinar-realestate-countdown` | 375x667 | 一般 | 0 |
