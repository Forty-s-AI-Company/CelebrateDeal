# WP05 最新審查與補強

security-review-portable-cli.json：實際 Claude CLI / claude-opus-5-5，effort unknown，terminal REVIEW_COMPLETED；無 BLOCKER/MAJOR，3 MINOR。僅審查提供的 storage/response/boundary/context/fields/migration 與 route snippets，不涵蓋完整 UI 或測試收據。

1. 共用128列可被惡意占滿及全域 advisory lock 等待：仍未解，不自行視為 owner 已接受。WP11 IP信任待輸入，但可信IP本身也不能阻止分散來源；須保留容量公平性及pool可用性問題。
2. 交易隔離依賴部署預設：已明確指定 ReadCommitted。真實 PostgreSQL 測試分別使用 ReadCommitted/RepeatableRead client預設，先SHOW確認，8併發僅1成功且總列128。沒有改全域DB/role設定，不能宣稱測過部署端設定。
3. 寫入密文長度：新增與reader相同上限。既有 sensitive-data 格式實際為v1加base64url(iv/tag/ciphertext)，額外字元43，小於原64預留；補最大metadata與32×2000控制字元roundtrip測試通過。

最新 snapshot：sha256:908e6c167031285a1c61dd45aa0704053211d042417f50c34ca776196b067584
checks-minor-repair：storage-unit、postgresql、lint、typecheck PASS。先前14份portable checks及24browser cases屬修正前snapshot，沒有移植成最新PASS；UI未變，但最新完整整合回歸尚未執行。

本次沿既有批次dispatch_count=3使用最後一次CLI fallback，MaxTotalAttempts=1；保留AGY限流歷史與WP11 CLI成功之可用性證據。此批次額度已耗盡，不重置或另名重試。ui-review-portable-prompt.txt僅準備、未dispatch，不能當review收據；其snapshot已非最新。

完整WP05仍IN_PROGRESS/REVIEW_BLOCKED，WP08不得解鎖。兩個MINOR的程式修正仍未經獨立複審。
