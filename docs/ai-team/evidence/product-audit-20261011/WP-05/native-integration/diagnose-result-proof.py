from pathlib import Path
import subprocess,sys
r=Path.cwd();o=r/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration'
a=r/'src/lib/registration-submission-receipt.ts';b=r/'src/app/api/form-submissions/route.ts';c=o/'browser-result-proof.cjs'
original={p:p.read_bytes() for p in [a,b,c]}
try:
 s=a.read_text(encoding='utf-8').replace('if (response.status !== 303 || !data || !Number.isFinite(now)) return;', 'if (response.status !== 303 || !data || !Number.isFinite(now)) return "precondition";').replace('if (!location || request.headers.get("origin") !== origin) return;', 'if (!location || request.headers.get("origin") !== origin) return "origin";').replace('!registrationRetrySourcePath(target.pathname)) return;', '!registrationRetrySourcePath(target.pathname)) return "destination";').replace('if (value.length > 3800) return;', 'if (value.length > 3800) return "size";').replace('response.headers.set("Cache-Control", "no-store");', 'response.headers.set("Cache-Control", "no-store"); return "issued";').replace('catch { /* 提示無法建立不得影響已成功提交，也不記錄識別值。 */ }','catch { return "exception"; }')
 a.write_bytes(s.encode('utf-8'))
 s=b.read_text(encoding='utf-8').replace('  attachRegistrationResult(request, response, formData);','  response.headers.set("x-wp05-result-debug", attachRegistrationResult(request, response, formData) ?? "unknown");');b.write_bytes(s.encode('utf-8'))
 s=c.read_text(encoding='utf-8').replace("report.lastSubmissionStatus=response.status();", "report.lastSubmissionStatus=response.status(); report.resultDiagnostic=await response.headerValue('x-wp05-result-debug');");c.write_bytes(s.encode('utf-8'))
 subprocess.run([sys.executable,str(o/'run-browser-result-proof.py')],check=False)
finally:
 for p,data in original.items():p.write_bytes(data)
 print('Temporary fixed-category instrumentation removed')
