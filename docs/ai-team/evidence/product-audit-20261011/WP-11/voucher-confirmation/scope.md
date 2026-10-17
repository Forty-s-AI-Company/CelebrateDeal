# WP-11 voucher confirmation

唯一 writer 主代理。GET/HEAD 預覽只讀；POST 經既有 browser confirmation 與 canonical origin，使用原 claimTokenHash 的原子 compare-and-swap 旋轉成新的 checkout bearer，使 email link 不能重放。Checkout 仍使用相同 cookie 名稱及原 resolver，付款路由與 schema 不改。不可將旋轉記成付款或 redeemedAt/usedOrderId；checkout 之後仍執行原規則。

共享 helper 新增固定 voucher 呈現／cookie namespace，portal 預設行為不變；納入原 portal route/test 回歸與跨流程 challenge 隔離。單一 writer，native dispatch0，external review 必要。延後的 IP 信任拓撲不在本次 scope。

验收：GET/HEAD不旋轉且不設 checkout cookie；POST成功、錯 origin、challenge替換／過期、used/expired、並發12僅一成功、舊憑證失效且新憑證原checkout resolver有效、錯租戶／商品拒絕；Chromium/Firefox與axe；獨立Critical review。

改動檔案：
- src/lib/capability-confirmation.ts
- src/lib/capability-confirmation.test.ts
- src/lib/automation-voucher-exchange.ts
- src/lib/automation-voucher-exchange.db.test.ts
- src/app/api/automation/vouchers/redeem/route.ts
- src/app/api/automation/vouchers/redeem/route.test.ts
