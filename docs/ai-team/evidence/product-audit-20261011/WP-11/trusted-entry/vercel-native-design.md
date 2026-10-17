# WP-11：Vercel 入口相容方案，待安全審查

現況：獨立 Preview dpl_E9wbsvtxx8ChBjZnUifufjgs93dC 已 READY。登入200，五種非受信任／偽造請求均503。這不是正常流程驗收。固定 loopback proof 的本機通過不能代表 Vercel 部署可用。

依據：https://vercel.com/docs/headers/request-headers 。Vercel 文件說明來源轉送標頭由平台處理；平台專用標頭和 Enterprise 自訂 proxy 的差異，仍必須以新 Preview 實測確認，不能只引用文件就標 PASS。

候選方案：新增 entry-only 的明確 vercel-native 模式，只在 server-side mode/source 與 Vercel runtime metadata 全部吻合時使用單一合法 x-vercel-forwarded-for。缺失、多段與格式錯誤一律拒絕。不讀任意 cf-connecting-ip/x-real-ip/XFF、不從 limiter provider 推定信任。保留既有 proof-backed Cloudflare/Vercel proxy、runtime/node、none 行為。若位於上游代理後，依實際連線來源保守共用桶；不採信未驗證 end-user IP。

Ownership：主代理唯一 writer；若實作，限 src/lib/trusted-entry-rate-limit.ts 與其測試、此 evidence 目錄與可拋棄 Preview 診斷副本。不得改付款 callers、共用 limiter、schema 或使用者原工作樹。需 router Critical security/Auth 深度審查；設計審查不替代實作最終審查或 assess_acceptance。

驗證順序：先審查信任根，再以 Preview-only 無資料庫診斷驗證平台覆寫保證；只回傳布林結果，不輸出IP/headers/credentials。證據成立後才實作模式與本機測試，做獨立實作審查，再部署真實入口進行合成 payload／偽造標頭與限流測試。未證明正常路徑與遠端資料隔離前，不跑有狀態的兌換或寫資料。

停止條件：平台未覆寫來源IP、模式能由請求標頭開啟、preview與production隔離不成立、必要安全審查有BLOCKER/MAJOR。不得透過任意接收proof或停用驗證繞過。回滾：獨立副本與新mode patch可精確移除；既有staging alias保持原指向，移除僅本輪新增的host允許項。

狀態：DESIGN_REVIEW_IN_PROGRESS。未實作本方案，未宣稱可用。


## 獨立審查後修正

審查完成，有 MAJOR，模式不得啟用。診斷已限定同專案、同team、Node runtime的獨立Preview；程式只在preview與指定projectId時執行。候選native模式進一步限Preview，production保持拒絕。第二出口與IP桶隔離尚未驗證。第三方proxy拓撲不可自動套用native；須維持既有proof模式。原始findings保留，disposition另存JSON。
