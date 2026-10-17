import subprocess, json, time

def command(*args):
    result=subprocess.run(["redis6-cli","--raw",*args],capture_output=True,text=True,timeout=5)
    assert result.returncode==0
    return result.stdout.strip()
assert command("SET","wp11:durability-check","synthetic-only","EX","120")=="OK"
command("SHUTDOWN","SAVE")
p=subprocess.run(["redis6-server","--bind","127.0.0.1","--port","6379","--appendonly","yes","--dir","/vercel/sandbox/wp11-store","--daemonize","yes"],capture_output=True,timeout=5)
assert p.returncode==0
for _ in range(20):
    try:
        if command("PING")=="PONG":break
    except Exception:pass
    time.sleep(.1)
assert command("GET","wp11:durability-check")=="synthetic-only"
assert command("DEL","wp11:durability-check")=="1"
print(json.dumps({"redis_restart_persistence":"PASS","synthetic_key_removed":True}))
