// 政策頁唯讀觀察：是否仍有待填占位字樣、是否列出營運者資料（對應 O-9／O-10／O-11 的現況，不代表簽核）。
//   STAGING_URL=... node scripts/qa/go-nogo-policy-probe.mjs
const base = (process.env.STAGING_URL ?? "").replace(/\/$/, "");
if (!base) { console.error("請設定 STAGING_URL"); process.exit(2); }
const paths = ["/policies", "/policies/terms", "/policies/privacy", "/policies/refunds", "/support"];
const placeholders = ["待填", "待確認", "TODO", "XXX", "○○", "OOO", "請填", "owner 核准", "待 owner", "待律師", "草案"];
for (const p of paths) {
  const res = await fetch(base + p);
  const html = await res.text();
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const hits = placeholders.filter((w) => text.includes(w));
  const effective = text.match(/(?:自|於)?\s*\d{4} 年 \d{1,2} 月 \d{1,2} 日[^。]{0,12}生效/u)?.[0] ?? "";
  const operator = /營運者|統一編號|統編|負責人/.test(text);
  console.log(`${p} status=${res.status} 占位字樣=${JSON.stringify(hits)} 生效日=${effective || "未找到"} 出現營運者/統編/負責人字樣=${operator}`);
  if (process.env.DUMP === p) console.log(text.slice(0, 3000));
}
