# G7-32 團隊發布與分享操作回饋 checkpoint

日期：2026-08-09

狀態：`ACCEPTED_LOCAL`。團隊模板發布、夥伴頁儲存／公開與 Live 合作分享現在都有明確且對應正確操作列的 pending、disabled、success、failure 與可存取回饋；停止公開、停用分享及會使舊連結失效的重新產生操作都有明確確認。

## 實際修改

- 夥伴頁儲存與發布 form、button 新增 `aria-busy`、`aria-disabled`、pending label 與 screen-reader live message，錯誤使用 assertive alert。
- 停止公開夥伴頁前明確確認；一般發布不增加阻擋。
- 團隊模板 create／publish 依動作顯示「建立中」或「發布中」，表單與按鈕同步 busy／disabled，錯誤為 assertive alert。
- 移除原本會阻擋模板 publish 的 client confirm；immutable version 說明仍保留在表單內。
- Live 合作分享以 `pageId:promoterMembershipId + operation kind` 綁定 pending。只有實際送出的列顯示 busy 與 pending message，其餘列暫時 disabled 防止並行錯送，但不會冒充正在處理。
- 停用分享連結前確認；重新產生活躍連結會明確告知舊連結立即失效。第一次建立不顯示多餘確認。
- 夥伴頁與 Live 分享的 clipboard 成功、失敗與重試都有可見回饋；缺 Clipboard API 或 permission rejection 不再顯示假成功。
- Live 分享 copy feedback 綁定實際 URL，新 URL 不會沿用舊 URL 的「已複製／複製失敗」狀態。
- Clipboard success timer 使用 effect cleanup；連點會取消舊 timer 再重設，不累積多個 timer。

## Ownership 與安全邊界

- Server actions、auth、CSRF、team／membership ownership 與 DB mutation 邏輯沒有更動；本 WP 只修改 client interaction feedback 與其 tests。
- Hidden `pageId`、`teamId`、`promoterMembershipId` 仍由既有 server action 重新授權，不因 pending UI 成為可信 ownership。
- 沒有讀取或輸出 `.env*`、secret、Token、Cookie、正式客戶或付款資料。
- 沒有 schema、migration、DB、外部服務、正式寄信、付款、退款或 Production 操作。

## Fresh deterministic evidence

- 最終 UTC：`2026-08-09T08:38:07.8310300Z`。
- Final related regression：6 test files、`42/42 PASS`、failed=`0`、exit code=`0`。
- 關鍵 cases：create／publish 不被 confirm 阻擋、stop public confirm、active share regenerate／disable confirm、兩 targets row-scoped busy、全域防並行 disabled、clipboard success／missing API／rejection、old URL feedback 不沿用到 new URL、timer cleanup、server action regressions。
- Scoped ESLint：PASS，exit code=`0`。
- Full `npm run typecheck -- --pretty false`：PASS，exit code=`0`。
- Tracked scoped `git diff --check`：exit code=`0`；只有既有 Windows LF／CRLF warning，沒有 whitespace error。兩個既有 untracked Live-share files 由 scoped ESLint、typecheck 與 tests 驗證。
- React review checklist：conditional hooks=`none`；pending state 對應實際表單列；互動元件保留 keyboard native form/button 行為；無新增 client data fetch、waterfall 或 bundle dependency。
- Fixed-function score reconciliation：`4/4 PASS`、exit code=`0`；evidence path／SHA-256、固定 inventory、canonical 74.0 與 blocker 宣告一致。
- 本 WP 沒有執行 Browser、staging、Sandbox、disposable PostgreSQL 或 Production；未執行項目不列為 PASS。

## 如實保留的中間失敗

- 第一輪 component tests：19/21 PASS、2 FAIL、exit code=`1`。原因是新測試抓到錯的空白 live region，且 direct hook invocation 缺 `useState` mock；修正 harness 後 PASS。
- 第一輪 scoped ESLint：2 complexity errors、exit code=`1`。將 pending label、live mode 與 confirm 邏輯抽成小型純函式後 PASS，沒有關閉 lint 規則。
- Reviewer 修正後的新 URL test 首輪為 35 PASS、7 FAIL、exit code=`1`。測試發現 `copyFeedback=null` 且沒有 `lastShare` 時，兩個 optional URL 都是 undefined，條件誤判後讀取 null status 的真實 runtime crash；加入 feedback existence guard 後 42/42 PASS。
- 一次 full typecheck 因測試 fixture 把 `shareUrl` 推斷為單一 literal 而 exit code=`1`；改成保留 `status` literal、允許 URL string 後 typecheck PASS。沒有弱化產品 assertion。

## Reviewer

- 第一輪唯讀 reviewer 找到 2 個 P1：模板 publish confirm 阻擋正向操作，以及 action-level pending 錯綁所有夥伴列。
- 第一輪另有 3 個 P2：save error live priority、pending test 只看單 target markup、copy timer 無 cleanup。
- 修正後 reviewer 找到 1 個新 P2：copy feedback 未綁 share URL。
- 全部修正後原 reviewer 最終複核為 `RESOLVED`，沒有未解決 P0／P1／P2。
- Reviewer 全程唯讀、沒有修改檔案，也沒有執行測試。

## Source digests

- `d16192071d86d5dd788769aea3b3f5b4bddee96127c9f885646baeb906b503cd  src/components/partner-page-editor.tsx`
- `b08120ebd2b0357df86d1a345473b39b26e38fc82d8f7374d27c224127c584d0  src/components/partner-page-editor.test.tsx`
- `93ca95e287eb1d44c17291c5b95d3b9240ef49366734638333e0b5bfe86f3872  src/components/team-template-form.tsx`
- `a0bba8551a90bd26ae8db0b6923852f2626a9e29694dbe9d005e68c0340005bb  src/components/team-template-form.test.tsx`
- `b5851f95ef246f34d3f78b771154bcfe1f897bb7566fdf993b14f441a58d0db4  src/components/team-live-share-manager.tsx`
- `e1238046595a0504744c68791449863cad339df27dffba6e042847d86446c9ba  src/components/team-live-share-manager.test.tsx`

## 分數判斷

- 固定功能 `團隊漏斗／Stream／營運後台`：`8.6 → 8.8`，UX `1.5 → 1.7`。
- 提升來源：三個高頻商家發布／分享流程具備可見且可存取的操作回饋，防止重複送出、錯列 pending、假複製成功與不知情停用公開連結。
- Latest canonical total 維持 `74.0`。此本機 UX 證據不能代替 CAT04 PayUni Sandbox／staging，也不能代替 CAT10 真人簽核與外部監控交付。
- CAT04／CAT10 保持 blocker，不阻擋其他產品工作。
- 沒有重跑 FIN-08AA、WP-196、WP-197 的 terminal endpoint、probe 或失敗命令。

## 人工與外部 blocker

- 本 WP 沒有新增需要使用者立即處理的事項。
- CAT04 仍需 fresh staging／PayUni Sandbox provider 與 reconciliation evidence。
- CAT10 仍需真人法律、隱私、退款、財務、客服 SLA、release acceptance 與外部監控交付。

## 回滾範圍

- 回滾範圍限於三個 team-funnel client components 的 pending／confirm／clipboard feedback 與對應 tests。
- 沒有 schema、migration、server action、外部服務或正式資料副作用。
- 若回滾 row-scoped pending，會恢復所有夥伴列同時顯示 busy 的錯誤回饋；不建議只回滾 tests。

## 下一個最高價值工作

繼續盤點仍使用原生 submit 或只有視覺文字、缺少 live status／錯誤恢復的商家帳務與客服操作，優先處理方案付款 handoff、退款 reconciliation 與客服狀態轉移；已完整覆蓋的 payment／payout／webhook controls 不重做。
