# 審查驗證補充（待獨立複審）
原始 review: ../visit-writer/review-current.json。不得更改原 finding。
Finding 0 的 report-finish/visit race 缺口：已新增真實PostgreSQL雙連線、兩種取得鎖順序的驗證。透過pg_backend_pid和pg_blocking_pids證明第二個交易確實等待第一個，再解除barrier；visit先寫時finish=false，finish先完成時late visit使report stale，兩者最終result與lease皆null。
Finding 7：包裝實際recordMetricVisit的交易，在已取得visitor鎖後暫停。另一個不同backend的FK insert在writer釋放鎖之前成功，statement_timeout限制2秒；不是改用替代測試鎖。避免FOR UPDATE造成不必要阻塞的修正已取得實測證據。
測試有transaction與barrier timeout、finally解鎖、等待pending交易settle、清除指定合成資料，owned runner teardown PASS。DB126 checks/98 migrations/schema/lint PASS。
尚未補齊其他precision、coverage、cleanup lifecycle findings；本文件不表示WP20驗收通過。下一次複審須提供完整runner及sanitized receipts，避免再次誤認只有mock tests。
