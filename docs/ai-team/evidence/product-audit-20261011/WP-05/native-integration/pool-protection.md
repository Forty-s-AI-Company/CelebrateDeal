# 滿額時的連線池保護

修正前：pool-before-tests.json / pool-before-receipt.json 確認失敗：另一連線持有草稿 advisory lock 時，8筆滿額儲存占住2連線pool，後續 SELECT 1 無法在2秒內完成。finally釋放鎖並完成合成資料清理，沒有遺留程序。

修正：鎖前檢查尚未過期列數，滿128直接回null。此查詢不是容量保證；鎖內仍檢查實體列總數，保留ReadCommitted及原上限。已過期列不會阻擋進入回收路徑。產品scope僅src/lib/registration-form-retry.ts；測試為同名.test.ts/.db.test.ts。

修正後：滿額+持鎖+8請求+2連線pool，8筆皆null且SELECT 1在釋鎖前完成；兩種client隔離預設的127+8競態仍僅1成功；實體满額但過期可回收後儲存讀回。這是本機實際PostgreSQL、合成資料，並非Production負載測試。

未解：攻擊者仍可占滿共用128列，真實使用者草稿會unavailable；非滿額時的鎖等待及整體請求洪水未獲此修正保證。未自行接受殘餘風險。未增加provider dispatch，最新獨立及UI review仍欠缺。

Snapshot: sha256:92b78cfa4c050005c10267b11d65de51a94692f55916d27ad11536d1101db97c
