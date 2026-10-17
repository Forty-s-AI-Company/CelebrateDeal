"""Disposable Redis HTTP protocol bridge. Synthetic fixture only, no business DB."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac, json, re, subprocess
SCRIPT = """
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
local ttl = redis.call("PTTL", KEYS[1])
return { current, ttl }
"""
TEST_AUTH = "Bearer wp11-synthetic-fixture-only-no-real-data"
def redis(*args):
    result = subprocess.run(["redis6-cli", "--raw", *args], capture_output=True, text=True, timeout=3)
    if result.returncode: raise ValueError("fixture_store_error")
    return result.stdout.strip().splitlines()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def send(self, code, payload):
        body=json.dumps(payload).encode(); self.send_response(code)
        self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(body)));self.end_headers();self.wfile.write(body)
    def do_GET(self):
        if self.path != "/health": return self.send(404,{"error":"not_found"})
        try: self.send(200,{"ready":redis("PING")==["PONG"],"fixture":True})
        except Exception: self.send(503,{"ready":False})
    def do_POST(self):
        if not hmac.compare_digest(self.headers.get("Authorization", ""),TEST_AUTH):return self.send(401,{"error":"fixture_access_denied"})
        try:
            length=int(self.headers.get("Content-Length","0"))
            if not 0 < length <= 2048:return self.send(400,{"error":"invalid_fixture_payload"})
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,list) or len(data)!=6:return self.send(400,{"error":"invalid_fixture_payload"})
            op,script,numkeys,key,limit,window=data
            if op!="EVAL" or script!=SCRIPT or numkeys!=1 or limit not in {"30", "60", "120"} or window!="60000" or not isinstance(key,str) or not re.fullmatch(r"celebratedeal:rl:(?:entry-vercel-native:(?:live-admission|live-admission-release|platform-referral-entry|automation-voucher-redeem|automation-voucher-confirm|student-portal-access-preview|student-portal-access-confirm)|live-chat-read|live-chat-write|private-live-chat-read|private-live-chat-write|live-purchase-broadcasts):[0-9a-f:.]+",key):
                return self.send(400,{"error":"out_of_fixture_scope"})
            result=redis("EVAL",script,"1",key,limit,window)
            if len(result)!=2:raise ValueError("invalid_store_response")
            self.send(200,{"result":[int(result[0]),int(result[1])]})
        except Exception:self.send(503,{"error":"fixture_store_unavailable"})
ThreadingHTTPServer(("0.0.0.0",3000),Handler).serve_forever()
