# Webinar 範本批次 3（11～15）不跑版 QA 證據

- 分支：`ai/webinar-templates-batch-3`（從 `ai/webinar-templates` 8c308b7e 切出）
- 執行時間：2026-10-28
- 執行指令：

```bash
npm run qa:template-layout -- --templates=webinar-healing-question,webinar-sustainability-ondemand,webinar-ecommerce-data,webinar-parenting-fit,webinar-pet-academy --stress --base-url=http://127.0.0.1:31300
```

  `--base-url` 指向本機 `next dev`，使用 worktree 的 src 與 public，不載入任何 `.env*`。

- 結果：**85 個回合，0 項失敗**。
  - 5 個範本 × 8 種寬度 × 一般／壓力文案。
  - 另加 375×667 首屏檢查。
  - 320 寬只跑降級檢查。
  - 完整結果見 `report.json`。

## 截圖

- `<id>@<寬度>.png`：一般文案的全頁截圖，寬度為 1440、1280、1024、768、390、375、360、320。
- `<id>@<寬度>-stress.png`：壓力文案的全頁截圖，寬度為 1440、390、360。
- 截圖已量化成 256 色以縮小檔案。
- 固定報名列與 Next.js 開發工具按鈕是 `position: fixed`，會出現在全頁截圖的中段，不是版面錯誤。

| 範本 | id | 設計重點 |
|---|---|---|
| 11 | `webinar-healing-question` | 米白底、鼠尾草綠與淡紫的有機形狀；大型襯線問句 H1，單欄慢節奏；求助資訊（1925）放在「不適合」欄與報名表正下方 |
| 12 | `webinar-sustainability-ondemand` | 淺綠灰底、萊姆色狀態膠囊；首屏、回放章節、頁尾依開場前、直播中、回放期、已結束自動切換；深綠葉脈頁尾 |
| 13 | `webinar-ecommerce-data` | 黑底首屏、超大橘色「NT$600 → NT$900」（Space Grotesk），右側瀏覽器框報表；之後為白底網格與 1px 細框 |
| 14 | `webinar-parenting-fit` | 米白底配黃、薄荷色塊與波浪分隔；霞鶩文楷標題像寫給家長的便條；年齡標籤、適合／不適合、情境手風琴、2 欄 FAQ |
| 15 | `webinar-pet-academy` | 機構感：導覽列、灰階合作 Logo、學院數據、時間軸、編號步驟、三位師資與學員故事卡；白底與淺綠灰交替 |

## 狀態切換（12）

QA harness 不能模擬活動狀態（notes B3-4）。四種狀態改由 `src/lib/funnel-templates/webinar/12-sustainability-ondemand.test.ts` 驗證：用固定的 `renderedAt` 各渲染一次，檢查膠囊、CTA、回放章節與報名表。
