# WP11 本機驗收設定與已知限制

本scope只驗收固定loopback ingress + Next開發伺服器 + disposable PostgreSQL + 合成資料，不代表實際Cloudflare或Vercel驗收。付款路由與共用limiter未修改。

ENTRY_CLIENT_IP_TRUST_MODE與ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE必須明確配對。已測Next配置為cloudflare/cloudflare，由固定代理覆寫既有x-celebratedeal-live-chat-ingress與cf-connecting-ip。ENTRY_CLIENT_IP_INGRESS_SECRET僅由隔離process注入合成值。缺失或不匹配時拒絕，不能直接發佈到未配置的環境。

runtime/node僅供會提供request.ip的受控adapter；一般Next dev/start沒有該欄位，不支援用這個模式直接啟動四入口。此為已知可用性限制，未自動加入任何部署設定。

entry與live-chat共用同一proof header。若edge全域注入同一值，兩個設定來源必須一致；不同值只有明確路徑分流注入才可能運作。本次無live-chat部署改動，雲端契約仍待輸入。

初審／followup需保留原始findings。runtime配置誤用與proof設定漂移為MINOR；provider-order測試無spy為NIT，不宣称已修。review隱去credential-reference宣告，精確語意另述；不得稱literal完全無刪節review。實際來源hash與測試收據供本機scope驗收。
