# 06 行銷與封測內容製作選項（D-05，輕量版）

> 日期 2026-10-19。本檔只盤點本 session 可用的 hyperframes 系列 skill 能產出什麼，**沒有產生任何影片，也沒有執行 `npx hyperframes`**。判斷依據是各 skill 的 description，以及 `product-launch-video`、`website-to-video` 的 SKILL.md 開頭流程。

## 1. 可用 skill 與適合的素材

| Skill | 適合產出 | 需要的輸入 | CelebrateDeal 用法 |
|---|---|---|---|
| `product-launch-video` | 30～90 秒產品 demo、功能揭示、封測招募影片 | 產品 URL（或貼上腳本／brief）、品牌色與字型（可由 URL 擷取）、logo、角度／長度／比例／語言 | 90 秒「從報名到成交」產品 demo；封測邀請短片。商業 URL 的預設路徑 |
| `website-to-video` | 15～30 秒網站導覽、社群短片 | 可擷取的公開頁面 URL | 導覽公開的漏斗頁或政策頁；產品宣傳改走 `product-launch-video` |
| `faceless-explainer` | 無出鏡的觀念解說、how-to、清單式影片 | 文字稿、文章或主題 brief；不需要網站 | onboarding 教學（建立第一場銷講、設定聯盟）、「官方腳本角色」標示說明 |
| `motion-graphics` | 10 秒內動態圖形：關鍵數字、logo sting、字卡、UI 動畫，可輸出透明疊層 | logo、文字、數字、品牌色 | 封測招募的片頭片尾、功能亮點字卡、社群貼文動態版 |
| `embedded-captions` | 為講師口述影片加字幕（36 種視覺風格，預設 `anchor` 安靜字幕） | 單一人物口述影片（多鏡頭會被切段）；本機轉錄，不需 API key | 講師說明影片的字幕；封測商家自己的出鏡素材 |
| `talking-head-recut` | 口述影片加圖卡、下標、數據卡、子母畫面（原影片不剪動） | 口述／訪談影片 | 創辦人導入影片、商家訪談精華 |
| `slideshow` | 可導覽的簡報（非 MP4），含講者備註 | 內容大綱、品牌 | 商家 onboarding 簡報、封測說明會；使用前需確認需求 |
| `pr-to-video` | 以 PR diff 做成的變更說明影片 | GitHub PR | 給內部或商家的更新紀錄；非行銷素材 |
| `music-to-video` | 節拍同步影片 | 音樂檔或情緒描述 | 優先級低 |
| `media-use` | 為影片解析 BGM、音效、圖片、圖示、旁白與去背，並建立素材台帳 | 需求描述 | 供上述 skill 內部呼叫；旁白依登入狀態可能走雲端或本機引擎 |
| `figma` | 匯入 Figma 畫面與品牌 token | figma.com 連結 | 若設計稿在 Figma，作為品牌來源 |
| `hyperframes`、`hyperframes-core`／`-creative`／`-animation`／`-keyframes`／`-registry`／`-cli`、`general-video` | 入口與基礎層：路由、組件契約、動畫、CLI；`general-video` 用於長篇或多場景自由製作 | — | 由上述 skill 自動帶入 |

## 2. 建議的第一批素材（封測用）

1. **90 秒產品 demo**（`product-launch-video`）：商家視角走完「建立銷講頁、報名、結帳、看後台」。
2. **onboarding 教學短片 3～5 支**（`faceless-explainer`，每支 60～90 秒）：建立第一場、設定商品與付款、邀請聯盟、看報表。
3. **講師說明影片字幕**（`embedded-captions`，`anchor` 風格）：用於創辦人導入與商家素材。
4. **社群短卡與片頭片尾**（`motion-graphics`）。

## 3. 輸入素材清單（先備齊再開工）

- 品牌：色碼、字型、logo（SVG 或透明 PNG）、一句話定位（依市場研究結論：誠實銷講，不誇大）。
- 畫面：staging 或本機的**合成資料**截圖或可擷取頁面；後台畫面不可含真實商家、客戶、金額。
- 腳本：每支影片的 brief（受眾、角度、長度、比例 16:9／9:16、語言：繁體中文），以及 owner 核准的宣稱。
- 音訊：旁白來源（真人錄音或 TTS）、BGM 授權來源；`media-use` 會把素材登記到台帳。

## 4. 先決條件與風險

- **可公開瀏覽的頁面**：`product-launch-video` 與 `website-to-video` 的擷取步驟需要工具能開啟的 URL。staging 若有 Vercel 部署保護或登入牆，擷取會失敗；備案是用本機 `npm run dev`（合成資料、`celebratedeal_*` loopback DB），或手動截圖走各 skill 的「無擷取」路徑。此點**尚未實測**。
- **合成資料**：畫面中的姓名、Email、金額、訂單號都用合成資料；不得出現 `.env*` 內容、PayUni 金鑰、卡號、真實 LINE 帳號。截圖先人工過目再交給影片流程。
- **工具環境**：skill 內容顯示會執行 `npx hyperframes`（需要 Node 與可渲染的瀏覽器環境），並先顯示登入狀態（未登入時語音／BGM 走本機引擎）；`embedded-captions` 首次需下載約 168 MB 的去背模型。以上均**未在本機驗證**；下載檔案屬需向 owner 確認的動作。
- **宣稱與合規**：影片內不得有虛構觀看數、購買通知、見證或假倒數；AI 旁白或 AI 生成畫面要標示；成效數字只用自己的紀錄。遵守 `celebratedeal-tw-compliance` 草稿。
- **競品與版權**：不放競品畫面與文案；音樂、圖片、字型須有授權。
- **流程**：這些 skill 有使用者核准的關卡（brief、storyboard、驗收），由主對話與 owner 逐關核准，不可無人值守一路跑完；成品放在 `videos/<project>/`，不放入 `src/`，不納入 CI。
- **成本**：單人團隊建議先做第 1、3 項，驗證品質與耗時再擴大。
