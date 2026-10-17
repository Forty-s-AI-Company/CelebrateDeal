# 複審確認點（原review不改寫）

- 續租分支update後立即return，不會落入新入場的第二次容量檢查。
- LIVE_ADMISSION_MAX_ATTEMPTS為3；原本P2034 retry與Serializable交易保留。
- vi.useFakeTimers只控制Date，因此產品new Date與測試查詢new Date都是相同受控時間；不依賴實際牆鐘是否晚於fixture日期。
- active renewal案例在cap1、已有1筆有效租約、TTL-1ms時續租成功；TTL精確等號有獨立測試。
- 第二輪review findings空陣列，僅保留以上confirmation points；產品／scope外的未讀來源不因此認證。
- 此repair phase兩次實際review dispatch，各AGY RATE_LIMITED後CLI SUCCESS，共4個transport；另兩次本機輸入阻擋未外送。沒有再試同一未改善的失敗。
