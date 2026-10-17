import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
const { POST } = await import(pathToFileURL(path.resolve(".ai-team/tmp/wp11-source-candidate/src/app/api/wp11-ingress-diagnostic/route.ts")).href);
let passed = 0;
const request = value => new Request("https://synthetic.invalid/api/wp11-ingress-diagnostic", {method:"POST",headers:value === null ? {} : {"x-vercel-forwarded-for":value}});
for (const mode of [undefined,"production","development"]) {
  process.env.VERCEL="1"; process.env.VERCEL_PROJECT_ID="prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn";
  if (mode === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV=mode;
  assert.equal((await POST(request("192.0.2.123"))).status,404); passed++;
}
process.env.VERCEL_ENV="preview";
process.env.VERCEL_PROJECT_ID="synthetic-wrong-project";
assert.equal((await POST(request("192.0.2.123"))).status,404); passed++;
process.env.VERCEL_PROJECT_ID="prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn";
for (const value of [null,"", "192.0.2.123", "2001:db8::123", "192.0.2.123,192.0.2.124", "garbage"]) {
  const response=await POST(request(value)); const body=await response.json();
  assert.equal(response.status,200); assert.equal(response.headers.get("cache-control"),"no-store");
  assert.deepEqual(Object.keys(body).sort(),["equalsSentinel","includesSentinel","matchesRealIp","single","valid"]);
  assert.ok(Object.values(body).every(x=>typeof x === "boolean"));
  assert.equal(body.valid,["192.0.2.123","2001:db8::123"].includes(value)); passed++;
}
const receipt={status:"PASS",cases:passed,scope:"diagnostic gating and boolean-only contract; not platform overwrite proof"};
fs.writeFileSync("docs/ai-team/evidence/product-audit-20261011/WP-11/trusted-entry/diagnostic-local-result.json",JSON.stringify(receipt,null,2)); console.log(JSON.stringify(receipt));
