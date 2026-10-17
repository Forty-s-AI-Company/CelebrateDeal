from pathlib import Path
import json,subprocess,shutil,secrets,re
root=Path.cwd();out=root/"docs/ai-team/evidence/product-audit-20261011/WP-11/current-preview";target=root/".ai-team/tmp/wp11-current-preview"
exe=shutil.which("vercel") or shutil.which("vercel.cmd")
runtime_db="postgresql://synthetic:synthetic@127.0.0.1:9/wp11_unavailable?connect_timeout=1"
build_db="postgresql://wp11_unusable:"+secrets.token_hex(24)+"@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres?connect_timeout=1"
values={"DATABASE_URL":runtime_db,"DIRECT_URL":runtime_db,"STAGING_DATABASE_URL":runtime_db,"NEXT_PUBLIC_APP_URL":"https://celebrate-deal-staging.carry-digital-nomad.in.net","NEXT_PUBLIC_SUPABASE_URL":"https://ocbugvgojrunvenozsbx.supabase.co","JOB_SECRET":secrets.token_hex(32),"CRON_SECRET":secrets.token_hex(32),"CSRF_SECRET":secrets.token_hex(32),"LIVE_CHAT_INGRESS_SECRET":secrets.token_hex(32),"RATE_LIMIT_PROVIDER":"upstash_redis","UPSTASH_REDIS_REST_URL":"https://sb-5ww3dugbuxoc.vercel.run","UPSTASH_REDIS_REST_TOKEN":"wp11-synthetic-fixture-only-no-real-data","PAYMENT_PROVIDER":"demo","PAYUNI_ENV":"sandbox","PAYUNI_LIVE_PROBE_ENABLED":"false","PAYUNI_STAGING_PLAN_TEST_ENABLED":"false","RESEND_API_KEY":"re_synthetic_disabled_for_wp11","EMAIL_FROM":"synthetic@invalid.test","SENTRY_DSN":"https://public@sentry.invalid/1","NEXT_PUBLIC_SENTRY_DSN":"","SENTRY_DISABLE_AUTO_UPLOAD":"true","SENTRY_AUTH_TOKEN":"","NEXT_PUBLIC_POSTHOG_KEY":"synthetic-disabled","NEXT_PUBLIC_POSTHOG_HOST":"https://posthog.invalid","CLOUDFLARE_R2_BUCKET":"celebrate-deal-staging","CLOUDFLARE_ACCOUNT_ID":"00000000000000000000000000000000","CLOUDFLARE_STREAM_TOKEN":"wp11_disabled_"+secrets.token_hex(24),"CLOUDFLARE_STREAM_WEBHOOK_SECRET":secrets.token_hex(32),"CLOUDFLARE_R2_ACCESS_KEY_ID":"","CLOUDFLARE_R2_SECRET_ACCESS_KEY":"","ENTRY_CLIENT_IP_TRUST_MODE":"vercel-native","ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE":"vercel","ENTRY_CLIENT_IP_TOPOLOGY":"direct-vercel","ENTRY_CLIENT_IP_EXPECTED_PROJECT_ID":"prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn"}
args=[exe,"deploy","--target","preview","--scope","a25814740s-projects","--yes","--no-wait","--json","--archive=tgz"]
for key,value in values.items():args += ["--env",key+"="+value,"--build-env",key+"="+(build_db if key in ["DATABASE_URL","DIRECT_URL","STAGING_DATABASE_URL"] else value)]
r=subprocess.run(args,cwd=target,capture_output=True,timeout=240)
try:d=json.loads(r.stdout)
except Exception:d={}
dep=d.get("deployment",{})
allowed=set("error invalid argument option unknown cannot use with together env build empty variable value supported only json dry archive deployment project forbidden unauthorized token required missing found not environment provided flag format secret exists version cli failed request too many limit size exceeded yes preview non interactive not interactive".split())
text=(r.stdout+r.stderr).decode("utf-8",errors="replace")
safe={"exit_code":r.returncode,"status":d.get("status"),"reason":d.get("reason"),"deployment":{k:dep.get(k) for k in ["id","url","readyState","target"]},"diagnostic_tokens":[w.lower() for w in re.findall("[a-zA-Z]+",text) if w.lower() in allowed][:90],"output_sizes":[len(r.stdout),len(r.stderr)],"raw_logs_persisted":False,"alias_changes":False,"platform_project_id_manually_set":False}
(out/"deploy-attempt5.json").write_text(json.dumps(safe,indent=2)+"\n");print(json.dumps(safe))
