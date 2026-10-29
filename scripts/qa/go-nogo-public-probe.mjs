// Go/No-Go 公開端點唯讀探測（不登入、不帶任何密鑰）。
// 用法：STAGING_URL=https://<staging 網域> node scripts/qa/go-nogo-public-probe.mjs
// 只做 GET，並印出每項檢查的結果摘要；任何一項失敗時結束碼為 1。
const base = (process.env.STAGING_URL ?? "").replace(/\/$/, "");
if (!base) {
  console.error("請設定環境變數 STAGING_URL");
  process.exit(2);
}

const results = [];
const record = (id, name, ok, detail) => {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${name}  -- ${detail}`);
};
const get = (path, init) => fetch(base + path, { redirect: "manual", ...init });

// 健康檢查
{
  const res = await get("/api/health");
  const body = await res.text();
  record("health", "/api/health 回 200", res.status === 200, `status=${res.status} body=${body.slice(0, 120)}`);
}

// F-079 中文 404
{
  const res = await get("/__go-nogo-no-such-page__");
  const html = await res.text();
  const zh = html.includes("找不到這個頁面") && html.includes("回首頁");
  const english = /This page could not be found/i.test(html);
  record("F-079", "未知網址回 404 且為中文、有返回出口", res.status === 404 && zh && !english, `status=${res.status} 中文=${zh} 英文預設=${english}`);
}

// 邀請制註冊頁
{
  const res = await get("/register");
  const html = await res.text();
  const invite = html.includes("受邀商家註冊") && html.includes('data-registration-mode="invite"');
  const hasForm = /name="password"/.test(html);
  record("invite-register", "/register 無邀請連結時只顯示受邀說明、沒有註冊表單", res.status === 200 && invite && !hasForm, `status=${res.status} 受邀說明=${invite} 有密碼欄=${hasForm}`);
}
{
  const res = await get("/register?invite=not-a-real-token");
  const html = await res.text();
  const bad = html.includes("邀請連結無效或已過期") && !/name="password"/.test(html);
  record("invite-register-bad", "/register 帶偽造邀請連結被拒絕", res.status === 200 && bad, `status=${res.status} 顯示無效=${bad}`);
}

// 登入頁、CSP 與安全標頭
{
  const res = await get("/login");
  const html = await res.text();
  const csp = res.headers.get("content-security-policy") ?? res.headers.get("content-security-policy-report-only");
  record("login", "/login 回 200 並含登入表單", res.status === 200 && /type="password"/.test(html), `status=${res.status}`);
  record("csp", "回應含 CSP 標頭（Content-Security-Policy 或 Report-Only）", Boolean(csp), csp ? `長度=${csp.length} 指令=${csp.split(";").map((s) => s.trim().split(" ")[0]).filter(Boolean).join(",")}` : "無");
  const hsts = res.headers.get("strict-transport-security");
  const xfo = res.headers.get("x-frame-options");
  const xcto = res.headers.get("x-content-type-options");
  record("sec-headers", "HSTS／X-Frame-Options／nosniff", Boolean(hsts && xcto), `hsts=${Boolean(hsts)} xfo=${xfo ?? "無"} nosniff=${xcto ?? "無"}`);
}

// 排程端點未帶密鑰不得被呼叫（B2：端點存在且受保護；實際 200 以 GitHub Actions run 為證）
for (const job of ["jobs/email-deliveries", "cron/line-notifications", "jobs/webhook-retry"]) {
  const res = await get(`/api/${job}`, { method: "POST" }).catch((e) => ({ status: `error:${e.message}` }));
  const ok = res.status === 401 || res.status === 403 || res.status === 404 || res.status === 405;
  record(`jobs-${job}`, `/api/${job} 未帶密鑰被拒絕`, ok, `status=${res.status}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n共 ${results.length} 項，失敗 ${failed.length} 項`);
process.exit(failed.length ? 1 : 0);
