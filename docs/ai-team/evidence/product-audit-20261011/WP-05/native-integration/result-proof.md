# 網址成功旗標的伺服器依據

已修正：shared URL中的submitted=verification_required不能單獨觸發成功/停用表單。成功native303且同源、formId有效、返回path在公開表單allowlist時，才附上AES-GCM結果回條；僅formId/path/expiry，沒有姓名、Email或答案。既有用途分離加密helper、HttpOnly/SameSiteStrict/secure-mode與__Host規則，60秒TTL，3800字元上限，不新增schema或加密Secret。缺加密設定時不冒稱成功，也不回滾已完成報名。

共用boundary與獨立/form成功分支都驗證相同回條；form/path不符、缺少、改寫、過期都不顯示成功。JSON實際成功後的client狀態不變；原提交validation/dedup/Email確認core未改。

這是短效結果提示，不是一次性flash，不是Email確認、存取授權或防重送鍵。同瀏覽器60秒內重新開啟同form/path可看到最近成功；單一cookie被另一表單成功覆蓋時，舊頁會恢復表單。沒有承諾跨tab保存全部成功狀態。query錯誤旗標的stale warning仍是UI-3未完成部分。

單元涵蓋缺值、其他form/path、精確expiry、改寫密文、非成功、異源與缺加密設定。真實browser runner先驗证原400回填→成功，再使用全新context開啟成功query網址，確認欄位可填且沒有假確認訊息；測試不讀取瀏覽器cookie，不輸出cookie或原始表單內容；僅在程序內斷言自建合成輸入。

首輪browser FAIL找到/form另有舊成功分支；保留browser-result-proof-before-form-fix.json，修復為共用驗證，沒有降低成功斷言。此輪仍須最終review；尚未完成整體WP05。


後續失敗定位：送出端可建立回條，但返回頁未帶回；固定分類診斷確認回條已保存、時鐘差0、有效期60秒。Lax試驗未改善，已撤回為Strict；最終修正為成功Location在通過公開Origin與server-internal目的驗證後，正規化到configured public origin，保留path/query/hash。這與失敗重試既有canonical origin策略一致。Internal-origin單元測試與實際4個browser案例驗證。

臨時x-wp05-result-debug與data-wp05-proof診斷皆已finally還原；產品來源沒有診斷輸出。診斷只保留固定原因、存在與設定metadata，未保存實際回條值。新版harness只攔截外部origin並abort，本機瀏覽器導覽不經route.continue覆寫；外部網路仍禁用。
