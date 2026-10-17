# WP-11 whole requirement audit

已完成且有實際evidence：四入口可信IP保護、portal/voucher兩階段與並發/重試、referral限流、DELETE限流與租約、明確Preview native helper、本機140targeted、9真實PG、Chromium/Firefox各7journeys、雙egress各8headercases、真實Redis120/60s桶隔離、provider outage503、資源清理。

尚未達成：F-18原始finding是共用rate-limit.ts的clientIp直接信任headers；它仍被多個非付款API/server actions直接使用。不可把四入口子項當成全域finding解決。清單見shared-ip-callsite-audit.json。已正規化identity與subject-only bucket應區別處理，不能盲目改import造成recipient limiter/聊天回歸。付款excluded四路由不變。

整包獨立review輸出TRUNCATED_REVIEW、observed unknown，沒有合格whole-review，不能READY。原始transportreceipt保留；下一步分API/source-action與已驗證identity群組修正/審查。現有subscope READY仍只代表其原scope。

本輪操作都在獨立worktree；原worktree只有明確報告路徑唯讀。兩個既有deployment狀態均READY且未切換alias。暫時probe/host/Sandbox已移除。
