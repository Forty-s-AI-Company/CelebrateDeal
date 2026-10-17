# Webinar 重試binding修復

修改src/app/lp/[slug]/page.tsx與[stepPath]/page.tsx，依實際渲染branch選formId；不再一般表單優先再fallback到Webinar。缺Webinar resource時不借用其他表單身份。既有發布與runtime gate未改。

回歸fixture同時提供generic-form與webinar-form；mock只代替Webinar呈現，使用真實RegistrationRetryProvider/useRegistrationRetry檢查root及step返回路徑。修正前data-return-path空，修正後正確。這不是兩個表單同時存在的真實DBE2E；真實瀏覽器覆蓋標準Webinarroot/step、Chromium/Firefox、JS/noJS共8案例，refill/success/draftclear/noMail/cleanup均通過。

5份checks-webinar-binding PASS。原整體snapshot漏列page.test.tsx，故另建包含两個page及測試的snapshot-binding-targeted，並以同範圍重新執行targeted單元測試取得PASS；不修改或搬移舊收據。下次完整snapshot必須納入此測試。

無schema、API契約、schema欄位、Production操作或外部review dispatch。UI-6已修復；最新獨立複審未完成，不標完整WP05READY。
