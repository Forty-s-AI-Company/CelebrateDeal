"""Fixed-host synthetic probes; do not print addresses, headers or credentials."""
import http.client, json, sys, time, concurrent.futures, collections
HOST="celebrate-deal-staging-3xt6w5tpu-a25814740s-projects.vercel.app"
def hit(path,headers=()):
    connection=http.client.HTTPSConnection(HOST,timeout=20)
    try:
        connection.putrequest("POST",path)
        connection.putheader("Content-Length","2")
        connection.putheader("Content-Type","application/json")
        for key,value in headers:connection.putheader(key,value)
        connection.endheaders(b"{}")
        response=connection.getresponse();data=response.read()
        try:body=json.loads(data)
        except Exception:body={}
        return response.status,body
    finally:connection.close()
def forged(index):
    value=f"192.0.2.{index%240+1}"
    return [("x-vercel-forwarded-for",value),("x-forwarded-for",value),("x-real-ip",value),("cf-connecting-ip",value)]
mode=sys.argv[1]
if mode=="headers":
    cases={"baseline":[],"ipv4":[("x-vercel-forwarded-for","192.0.2.123")],"ipv6":[("x-vercel-forwarded-for","2001:db8::123")],"duplicate":[("x-vercel-forwarded-for","192.0.2.123"),("x-vercel-forwarded-for","192.0.2.124")],"case":[("X-Vercel-Forwarded-For","192.0.2.123")],"list":[("x-vercel-forwarded-for","192.0.2.123,192.0.2.124")],"empty":[("x-vercel-forwarded-for","")],"combined":[("x-vercel-forwarded-for","192.0.2.123"),("x-real-ip","192.0.2.124"),("x-forwarded-for","192.0.2.124")]}
    rows=[]
    for name,headers in cases.items():
        status,body=hit("/api/header",headers)
        allowed={"single","valid","equalsSentinel","includesSentinel","matchesRealIp"}
        valid=set(body)==allowed and all(isinstance(v,bool) for v in body.values())
        passed=status==200 and valid and body["single"] and body["valid"] and not body["equalsSentinel"] and not body["includesSentinel"]
        rows.append({"case":name,"http_status":status,"passed":passed,"booleans":body if valid else None})
    print(json.dumps({"mode":mode,"results":rows,"passed":all(x["passed"] for x in rows)}))
elif mode=="one":
    status,body=hit("/api/entry",forged(239));print(json.dumps({"mode":mode,"http_status":status,"synthetic_reached":body.get("synthetic") is True,"rate_limited":body.get("error")=="Too many requests","source_unavailable":body.get("error")=="Request source unavailable","provider_unavailable":body.get("error")=="Rate limit provider unavailable"}))
elif mode=="burst":
    start=time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(lambda i:hit("/api/entry",forged(i)),range(123)))
    elapsed=time.monotonic()-start
    counts=collections.Counter(str(status) for status,body in results)
    print(json.dumps({"mode":mode,"requests":123,"duration_seconds":round(elapsed,3),"http_counts":dict(counts),"synthetic_400_count":sum(s==400 and b.get("synthetic") is True for s,b in results),"confirmed_429_count":sum(s==429 and b.get("error")=="Too many requests" for s,b in results),"within_window":elapsed<60}))
else:raise ValueError("unknown bounded probe")
