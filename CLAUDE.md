@AGENTS.md

## Claude 團隊分工

主對話負責判斷難度、拆解任務、整合結果與最後決定，並自行決定每個子代理的模型與努力程度。

主對話在 Fable 上執行時不寫程式：所有程式修改都派給 `engineer-hard` 或 `engineer`。Opus 與 Sonnet 都解決不了時，先通知使用者，經同意才交給 Fable。文件、設定與 git 操作可在主對話完成。

| 子代理 | 模型 | 何時使用 |
|---|---|---|
| `engineer-hard` | Opus, high | 付款、checkout、退款、佣金、auth／權限、租戶邊界、migration、併發、大型重構 |
| `engineer` | Sonnet, medium | 一般功能、UI、非金流 API、修 bug、補測試 |
| `reviewer` | Opus, high | 上述高風險變更合併前的獨立審查；只回報 findings，不改程式 |
| `docs` | Haiku, low | 文件、PR 描述、整理清單與測試輸出 |

派工時給子代理明確的目標、檔案範圍、完成標準與分支；同一時間每個檔案只有一個 writer。主對話負責推送與開 PR，並親自檢查子代理的結果再回報。

領域技能在 `.claude/skills/celebratedeal-*`。
