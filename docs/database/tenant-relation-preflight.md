# Tenant Relation Preflight

在 staging migration 與 seed 前執行。任一查詢有結果即停止 release，不可在 UI 層忽略。

```sql
SELECT l.id, l."vendorId", v."vendorId" AS related_vendor
FROM "Live" l JOIN "Video" v ON v.id = l."videoId"
WHERE l."vendorId" <> v."vendorId";

SELECT l.id, l."vendorId", f."vendorId" AS related_vendor
FROM "Live" l JOIN "RegistrationForm" f ON f.id = l."formId"
WHERE l."vendorId" <> f."vendorId";

SELECT l.id, l."vendorId", t."vendorId" AS related_vendor
FROM "Live" l JOIN "MessageTemplate" t ON t.id = l."messageTemplateId"
WHERE l."vendorId" <> t."vendorId";

SELECT l.id, l."vendorId", s."vendorId" AS related_vendor
FROM "Live" l JOIN "InteractionScript" s ON s.id = l."interactionScriptId"
WHERE l."vendorId" <> s."vendorId";

SELECT lp.id, l."vendorId" AS live_vendor, p."vendorId" AS product_vendor
FROM "LiveProduct" lp
JOIN "Live" l ON l.id = lp."liveId"
JOIN "Product" p ON p.id = lp."productId"
WHERE l."vendorId" <> p."vendorId";

SELECT e.id, s."vendorId" AS script_vendor, r."vendorId" AS role_vendor
FROM "InteractionEvent" e
JOIN "InteractionScript" s ON s.id = e."scriptId"
JOIN "InteractionRole" r ON r.id = e."roleId"
WHERE s."vendorId" <> r."vendorId";

SELECT e.id, s."vendorId" AS script_vendor, p."vendorId" AS product_vendor
FROM "InteractionEvent" e
JOIN "InteractionScript" s ON s.id = e."scriptId"
JOIN "Product" p ON p.id = e."productId"
WHERE s."vendorId" <> p."vendorId";
```

修復必須由資料 owner 確認正確關聯後執行，不得自動把 foreign relation 指向任意同類資源。
