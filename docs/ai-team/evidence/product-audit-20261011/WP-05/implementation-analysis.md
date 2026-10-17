# WP-05 開始前分析（尚未實作）

- 核對來源：整合報告 F-08/F-21、Goal Plan WP-05；實際 route 在同源、rate-limit、payload、表單可用性、寄信服務錯誤時直接回 JSON，只有成功 native POST 使用 303。
- 目前三條路徑：LeadForm（JSON submit、有錯誤欄位保留與 aria-live）、PublicSubmissionForm（JSON submit、另一套錯誤文案／成功轉址）、FunnelWebinarExperience（native POST）。不能只替換 Webinar 的 JavaScript handler 就宣稱 native POST 契約完成。
- 成功狀態需要保留既有 Email 驗證要求；503 重送要沿用 stableSubmissionId 和既有重複送出分支，不能改名單資格或新增第二筆 submission。
- 原頁 return path 與成功 redirectTo 是不同用途，不能拿 thank-you URL 當錯誤返回頁；新增欄位須更新 reserved fields，避免混進 answers。
- 欄位最大 32 x 2000 字元。PII 不得放入 query/log；單一 cookie 無法可靠保存全部合法 payload。尚未選定跨 303／無 JavaScript 的安全草稿保存方式，不得以小 fixture 掩蓋此限制。
- 若需要 schema/migration，依 Goal Plan 停止條件第 4 點先提出精確新 scope、ownership 與重路由，才處理受影響工作；不得直接擴大 schema。
- 待完成：盤點可重用短效持久保存機制；界定 403（跨源拒絕）安全返回規則及無可信來源時 fallback；定義 400/403/404/429/503 的 native/API 相容測試、JS/no-JS E2E、a11y 與 PII 不外洩驗證。
- 狀態：ANALYSIS_ONLY；未改 WP-05 產品檔案，未驗證其產品行為，沒有 PASS 宣稱。
