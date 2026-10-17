"""Probe only the fixed isolated Preview; retain boolean-only evidence."""
import json, pathlib, shutil, subprocess
OUT = pathlib.Path(__file__).resolve().parent
ROOT = OUT.parents[5]
CWD = ROOT / ".ai-team/tmp/wp11-source-candidate"
URL = "https://celebrate-deal-staging-39to87c3a-a25814740s-projects.vercel.app"
CASES = {
 "baseline": [],
 "ipv4_forgery": ["x-vercel-forwarded-for: 192.0.2.123"],
 "ipv6_forgery": ["x-vercel-forwarded-for: 2001:db8::123"],
 "duplicate": ["x-vercel-forwarded-for: 192.0.2.123", "x-vercel-forwarded-for: 192.0.2.124"],
 "mixed_case": ["X-Vercel-Forwarded-For: 192.0.2.123"],
 "comma_list": ["x-vercel-forwarded-for: 192.0.2.123,192.0.2.124"],
 "empty": ["x-vercel-forwarded-for;"],
 "all_forged": ["x-vercel-forwarded-for: 192.0.2.123", "x-forwarded-for: 192.0.2.124", "x-real-ip: 192.0.2.124", "cf-connecting-ip: 192.0.2.124"],
}
results=[]
for name, headers in CASES.items():
 cmd=[shutil.which("vercel.cmd"),"curl","/api/wp11-ingress-diagnostic","--deployment",URL,"--scope","a25814740s-projects","--","--silent","--max-time","30","--request","POST","--write-out","HTTP_STATUS:%{http_code}"]
 for header in headers: cmd += ["--header",header]
 p=subprocess.run(cmd,cwd=CWD,capture_output=True,text=True,encoding="utf-8",errors="replace")
 body,_,code=p.stdout.rpartition("HTTP_STATUS:")
 try:
  data=json.loads(body)
  allowed=["single","valid","equalsSentinel","includesSentinel","matchesRealIp"]
  assert set(data)==set(allowed) and all(isinstance(x,bool) for x in data.values())
 except Exception: data=None
 passed=p.returncode==0 and code.strip()=="200" and data is not None and data["single"] and data["valid"] and not data["equalsSentinel"] and not data["includesSentinel"]
 row={"case":name,"exit_code":p.returncode,"http_status":code.strip(),"booleans":data,"passed":passed};results.append(row);print(json.dumps(row),flush=True)
receipt={"deployment_id":"dpl_hs6Sc9UKEEJFwovyLWBEAp2Av18c","status":"PASS_SINGLE_EGRESS" if all(x["passed"] for x in results) else "FAIL","results":results,"second_egress":"NOT_VERIFIED","limiter_behavior":"NOT_VERIFIED","raw_output_persisted":False,"database_operations":False}
(OUT/"vercel-header-diagnostic-result.json").write_text(json.dumps(receipt,indent=2),encoding="utf-8")
