# WP-11 Preview native 入口本機實作

授權：使用者核准本 session 非Production開發與Preview驗證。主代理唯一writer，automatic_spawn false，depth0。基底仍 efb8b7e9；只寫獨立worktree。

產品scope：trusted-entry-rate-limit.ts，加native.test.ts與native-provider.test.ts。共用limiter、既有IP proof resolver、付款callers與schema不得改動。原六個protected hashes均一致。

正常native配置必須明確要求mode vercel-native、source vercel、topology direct-vercel、runtime VERCEL 1、VERCEL_ENV preview、expectedProject非空且等於runtime project、provider upstash_redis。缺項與不符全部503。原proof模式保持。新模式只讀單一平台來源header；caller supplied其他IP headers不影響桶。IPv4-mapped IPv6合併IPv4，IPv6 /64；native prefix區分其他模式。環境每request讀取，原request body保留。

驗證：107 targeted全部PASS，lint與typecheck PASS。Native provider test使用真實entry+legacy limiter，HTTP fetch是明確協定fixture，不是實際Redis、不是遠端兩出口測試。Preview單出口8種header診斷證據另存trusted-entry；不得升格為正常流量限流通過。

部署：本scope未部署，未設定Preview環境變數；現有WP11 Preview仍舊版本且fail closed。平台preview環境注入檢查只讀具名非secret routing fields，entry config未設定，provider未指定/不在支援enum；不是遠端現存deployment完整env證明。

本機acceptance需獨立Critical實作審查及assess_acceptance。遠端enable另需第二出口/隔離durable limiter證據與拓撲確認。Production不在範圍。

回滾：精確還原本scope的trusted-entry-rate-limit.before.ts.txt，移除兩個本scope新增test；保留其他WP變更及原worktree。部署環境本輪未變動。

補強：caller supplied native config仍重新驗證每request完整環境條件。Upstash必填設定缺失/空值，重複呼叫均503且零HTTP呼叫；bucket完整key-set與IPv6等價格式已驗證。/64是baseline政策，不能防止持有更大網段者輪換不同/64。runtime project metadata屬operator configuration guard，不是對惡意operator的密碼學attestation。

最終本機gate：READY，revision 9f742df82910060b7a4eebeb89003de388105d583cdb38455e25907ee64b88c9。最終合格獨立審查observed claude-opus-5-5、effort unknown；無BLOCKER/MAJOR/MINOR，1 NIT（可選server reason-code observability）保留。AGY複審observed unknown且編碼損毀，未作最終裁決；原receipt保留，改用canonical Claude CLI adapter，router以真實attempted_models及實測CLI model重新解析review plan。
