"""Fixed owned Preview only; output fixed categories/counts, never raw headers or credentials."""
import http.client,json,sys,time,concurrent.futures,collections
HOST="celebrate-deal-staging-pee8uidcp-a25814740s-projects.vercel.app"
def hit(method,path,extra=()):
 c=http.client.HTTPSConnection(HOST,timeout=25)
 try:
  c.putrequest(method,path)
  c.putheader("Origin","https://celebrate-deal-staging.carry-digital-nomad.in.net");c.putheader("x-celebratedeal-client","web")
  if method in ["POST","DELETE"]:c.putheader("Content-Type","application/json");c.putheader("Content-Length","2")
  for key,value in extra:c.putheader(key,value)
  c.endheaders(b"{}" if method in ["POST","DELETE"] else None)
  r=c.getresponse();content=r.read(65536)
  try:body=json.loads(content)
  except Exception:body={}
  return r.status,body
 finally:c.close()
def forged(i):
 value=f"192.0.2.{i%240+1}"
 return [(key,value) for key in ["x-vercel-forwarded-for","cf-connecting-ip","x-real-ip","x-forwarded-for"]]
mode=sys.argv[1]
if mode=="readiness":
 status,body=hit("GET","/api/health/entry")
 allowed={"ok","entry","topologyProbeRequired"}
 print(json.dumps({"http_status":status,"native_configured":body.get("entry")=="preview_native_configured","configuration_ready":body.get("ok") is True,"topology_probe_required":body.get("topologyProbeRequired") is True,"shape_valid":set(body)==allowed}))
elif mode=="matrix":
 cases=[("chat-get","GET","/api/live-chat/messages",400),("chat-post","POST","/api/live-chat/messages",400),("private-get","GET","/api/live-chat/private",400),("private-post","POST","/api/live-chat/private",400),("admission-release","DELETE","/api/live-admission",400),("voucher-preview","GET","/api/automation/vouchers/redeem?token=invalid",400),("voucher-confirm","POST","/api/automation/vouchers/redeem",403),("portal-preview","GET","/portal/wp11-synthetic/access?token=invalid",303),("portal-confirm","POST","/portal/wp11-synthetic/access",303),("referral-invalid","GET","/r/%20",307)]
 rows=[]
 for name,method,path,expected in cases:
  status,body=hit(method,path,forged(200));rows.append({"case":name,"http_status":status,"expected_status":expected,"passed":status==expected,"source_unavailable":body.get("error")=="Request source unavailable","provider_unavailable":body.get("error")=="Rate limit provider unavailable"})
 print(json.dumps({"mode":mode,"rows":rows,"passed":all(r["passed"] for r in rows),"business_database_success_claimed":False}))
elif mode=="headers":
 cases={"baseline":[],"ipv4":[("x-vercel-forwarded-for","192.0.2.123")],"ipv6":[("x-vercel-forwarded-for","2001:db8::123")],"duplicate":[("x-vercel-forwarded-for","192.0.2.123"),("x-vercel-forwarded-for","192.0.2.124")],"case":[("X-Vercel-Forwarded-For","192.0.2.123")],"list":[("x-vercel-forwarded-for","192.0.2.123,192.0.2.124")],"empty":[("x-vercel-forwarded-for","")],"combined":forged(222)}
 rows=[]
 for name,headers in cases.items():
  status,body=hit("GET","/api/live-chat/messages",headers);rows.append({"case":name,"http_status":status,"passed":status==400})
 print(json.dumps({"mode":mode,"rows":rows,"passed":all(r["passed"] for r in rows)}))
elif mode=="one":
 status,body=hit("POST","/api/live-admission",forged(239));print(json.dumps({"mode":mode,"http_status":status,"validation_reached":status==400 and body.get("error")=="Invalid admission request","rate_limited":status==429 and body.get("error")=="Too many requests"}))
elif mode=="burst":
 start=time.monotonic()
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(lambda i:hit("POST","/api/live-admission",forged(i)),range(123)))
 elapsed=time.monotonic()-start;counts=collections.Counter(str(s) for s,b in results)
 print(json.dumps({"mode":mode,"requests":123,"duration_seconds":round(elapsed,3),"http_counts":dict(counts),"validation_400_count":sum(s==400 and b.get("error")=="Invalid admission request" for s,b in results),"confirmed_429_count":sum(s==429 and b.get("error")=="Too many requests" for s,b in results),"within_window":elapsed<60}))
else:raise ValueError("unsupported fixed probe")
