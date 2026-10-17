from pathlib import Path
import os,subprocess,sys,time,urllib.request,json,shutil,socket
root=Path.cwd();out=root/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration'
for name in ['.env','.env.local','.env.development','.env.development.local']:
 if (root/name).exists(): raise RuntimeError('Refusing Next environment file loading')
with socket.socket() as probe: probe.bind(('127.0.0.1',31026))
env={k:os.environ[k] for k in ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','LOCALAPPDATA','APPDATA'] if k in os.environ}
env.update(NODE_ENV='development',NEXT_TELEMETRY_DISABLED='1',DATABASE_URL='postgresql://wp05_synthetic:wp05_synthetic_only@127.0.0.1:64506/celebratedeal_test',DIRECT_URL='postgresql://wp05_synthetic:wp05_synthetic_only@127.0.0.1:64506/celebratedeal_test',CSRF_SECRET='wp05-native-synthetic-only-key-material-20261012',JOB_SECRET='wp05-native-synthetic-only-job-material-20261012',NEXT_PUBLIC_APP_URL='http://127.0.0.1:31026',RATE_LIMIT_PROVIDER='memory',SENTRY_DISABLE_AUTO_UPLOAD='true')
node=shutil.which('node')
server=subprocess.Popen([node,'node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','31026'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 ready=False
 for _ in range(90):
  if server.poll() is not None: raise RuntimeError('Owned server exited')
  try:
   urllib.request.urlopen('http://127.0.0.1:31026/registration-error',timeout=5);ready=True;break
  except Exception: time.sleep(1)
 if not ready: raise RuntimeError('Server readiness timeout')
 result=subprocess.run([node,str(out/'browser-lp-js.cjs'),str(out/'browser-lp-js-result-deadline-current.json')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=300)
 print(json.dumps({'browser_exit':result.returncode,'report':str(out/'browser-lp-js-result-deadline-current.json')}),flush=True)
 sys.exit(result.returncode)
finally:
 if server.poll() is None: subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 server.wait(timeout=15)
