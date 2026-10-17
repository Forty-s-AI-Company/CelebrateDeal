# UI review後的loading範圍修復

原review只取得diff，沒有root layout中的NavigationProgress來源。全站早已有點擊與history等待提示，因此「沒有任何pending UI」過廣；root skeleton移除仍是實際行為改變，保留MAJOR並修正，不以這項事實直接駁回。

修改：16個非報名入口的頂層segment新增loading.tsx，重用RootLoading；已有特殊loading的segment保留。首頁redirect的非同步查詢用本頁Suspense包住。/form、/lp、/p、/registration-error維持無祖先loading，避免原生303後內容被streaming隱藏。沒有搬動URL或路由資料夾，沒有修改Auth或DB查詢。

限制：segment loading不能包住同層async layout，這些等待仍依既有NavigationProgress；沒有宣稱完全重建原root-level streaming/prefetch拓撲。browser-qa和parallel checkout slot未新增boundary；checkout自身既有提示保留。

測試：路由樹檢查確保所有非排除、有page的segment具loading；原skeleton可及性斷言仍保留。實際Chromium/Firefox從/login前往/password-reset/request及/register，延遲RSC回應至觀察到pending，再放行並確認抵達且提示消失，共4案例。沒有登入、提交表單、读取或輸出Cookie/表單值；只用本機合成環境。這測到等待提示及正常抵達，不是Production效能基準，也不證明prefetch時間。

第一次typecheck捕捉HomeRedirect回傳Promise<void>；改為return redirect（never）後通過，未改導向目的或身分規則。失敗收據保留checks-loading-repair/typecheck.json。

安全複審在修復前snapshot獲READY且storage來源未再改，但不將舊receipt冒充新snapshot。UI修復仍需獨立複審，其餘MINOR見ui-findings-disposition.json。Goal保持active，不標完整WP05完成。
