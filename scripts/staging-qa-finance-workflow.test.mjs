import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import yaml from "js-yaml";

const workflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/staging-qa-finance-bootstrap.yml", import.meta.url), "utf8"));
const job = workflow.jobs.bootstrap;
const execution = job.steps.find(step => step.name === "Create or verify fixed synthetic account");
test("finance bootstrap secrets remain protected and never enter dependency installation", () => {
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
  assert.match(job.if, /github.ref == 'refs\/heads\/master' && github.ref_protected/u);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.permissions.deployments, "read");
  assert.ok(job.steps.findIndex(step => step.name === "Verify exact deployment lineage before secrets") < job.steps.indexOf(execution));
  for (const step of job.steps.filter(step => step !== execution)) assert.equal(/secrets\./u.test(JSON.stringify(step)), false);
  assert.equal(execution.env.PAYUNI_ENV, "sandbox");
  assert.equal(/\bnpx\b|\bnpm\b/u.test(execution.run), false);
});

test("bootstrap publishes only its fixed sanitized result after success or failure", () => {
  const upload = job.steps.at(-1);
  assert.match(upload.if, /always\(\)/u);
  assert.equal(upload.with.path, "${{ runner.temp }}/qa-finance-bootstrap/completion.json");
  assert.equal(upload.with['retention-days'], 7);
  assert.match(execution.run, /"stage":"network-configuration"/u);
  assert.equal(/\*|\.log/u.test(upload.with.path), false);
});
test("finance bootstrap blocks unrestricted IPv4 and IPv6 before credentials are used", () => {
  const run = execution.run;
  for (const command of ["sudo iptables -F OUTPUT", "sudo iptables -P OUTPUT DROP", "sudo ip6tables -F OUTPUT", "sudo ip6tables -P OUTPUT DROP"]) {
    assert.ok(run.indexOf(command) < run.indexOf("./node_modules/.bin/tsx"));
  }
  assert.ok(run.indexOf("sudo iptables -F OUTPUT") < run.indexOf("sudo iptables -P OUTPUT DROP"));
  assert.ok(run.indexOf("sudo ip6tables -F OUTPUT") < run.indexOf("sudo ip6tables -P OUTPUT DROP"));
  assert.match(run, /trap restore_network EXIT/u);
  assert.match(run, /sudo iptables-restore/u);
  assert.match(run, /sudo ip6tables-restore/u);
});
test("network destination builder admits only the fixed staging database identity", () => {
  const code = execution.run.match(/node <<'NODE' > "\$destinations"\n([\s\S]*?)\nNODE/u)[1];
  function evaluate(url) {
    let output = "";
    try {
      vm.runInNewContext(code, { URL, process: { env: { STAGING_DATABASE_URL: url, CELEBRATEDEAL_DEPLOYMENT_HOST: "synthetic-preview.vercel.app" },
        exit: () => { throw new Error("rejected"); }, stdout: { write: text => { output += text; } } } });
    } catch { return null; }
    return output;
  }
  assert.match(evaluate("postgresql://synthetic@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres"), /db\.ocbugvgojrunvenozsbx\.supabase\.co\t5432/u);
  assert.match(evaluate("postgresql://synthetic@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres"), /synthetic-preview\.vercel\.app\t443/u);
  assert.match(evaluate("postgresql://postgres.ocbugvgojrunvenozsbx@aws-0.example.pooler.supabase.com:6543/postgres"), /\t6543/u);
  for (const url of ["postgresql://synthetic@db.production.supabase.co/postgres", "postgresql://postgres.production@aws-0.example.pooler.supabase.com/postgres", "https://db.ocbugvgojrunvenozsbx.supabase.co",
    "postgresql://synthetic@db.ocbugvgojrunvenozsbx.supabase.co/postgres?%68ost=127.0.0.1"]) assert.equal(evaluate(url), null);
});
