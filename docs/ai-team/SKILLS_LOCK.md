# Skills Lock

安裝日期：2026-07-10  
安裝範圍：project  
安裝模式：copy  

`npm run ai:validate` 會以 `skills-lock.json.directoryDigest` 驗證每個外部 Skill 的完整目錄內容。任何檔案新增、刪除或修改都會 fail closed；禁止在 runtime 從浮動 `main` 下載指令。
目標 agents：Codex、Antigravity、Antigravity CLI

## External Skills

| Skill | Repository | Commit SHA | 安全檢查 | 用途 |
| --- | --- | --- | --- | --- |
| `web-design-guidelines` | `vercel-labs/agent-skills` | `f8a72b9603728bb92a217a879b7e62e43ad76c81` | 只有 SKILL.md；無 scripts/hooks/MCP。使用時會讀取 Vercel 公開遠端 guideline，CLI 評為 Med Risk。 | UI、UX、accessibility 稽核 |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | `f8a72b9603728bb92a217a879b7e62e43ad76c81` | Markdown rule library；無可執行 scripts/hooks/MCP，CLI 評為 Safe/Low Risk。 | React 19 / Next.js 效能與元件 review |
| `frontend-design` | `anthropics/skills` | `9d2f1ae187231d8199c64b5b762e1bdf2244733d` | SKILL.md + LICENSE；無 scripts/hooks/MCP，CLI 評為 Safe/Low Risk。 | 避免模板式 AI 視覺，建立有產品理由的設計方向 |

安裝前已執行 `npx skills add <repo> --list`、閱讀完整 SKILL.md、檢查目錄與網路/執行指令。未安裝內容高度重疊的額外 UI Skills。

## Project Skills

| Skill | 來源 | 用途 |
| --- | --- | --- |
| `celebratedeal-product-domain` | 本 repo | 直播、活動、報名、商品、角色、組織與帳務領域 |
| `celebratedeal-design-system` | 本 repo | 品牌、tokens、元件、RWD、a11y 與 anti-AI design |
| `celebratedeal-multi-tenant-security` | 本 repo | Tenant、RBAC、RLS、ownership 與負向測試 |
| `celebratedeal-attribution-commission` | 本 repo | 推薦歸因、佣金、退款、沖銷與對帳 |
| `celebratedeal-browser-qa` | 本 repo | Playwright、視覺、a11y、console/network 與 evidence |
| `celebratedeal-release-gate` | 本 repo | 發布判定、blocker、rollback 與外部驗收 |

更新外部 Skill 前必須重做清單、SHA、內容與安全檢查，不可直接執行 `skills update -y` 後提交。
