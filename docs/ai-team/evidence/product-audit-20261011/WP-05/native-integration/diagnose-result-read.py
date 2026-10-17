from pathlib import Path
import subprocess,sys
r=Path.cwd();o=r/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration'
a=r/'src/lib/registration-submission-receipt.ts';b=r/'src/components/registration-retry-boundary.tsx';c=r/'src/app/form/[slug]/page.tsx';h=o/'browser-result-proof.cjs'
original={p:p.read_bytes() for p in [a,b,c,h]}
try:
 s=a.read_text(encoding='utf-8');diag=s[s.index('export function verifyRegistrationResult'):].replace('verifyRegistrationResult','diagnoseRegistrationResult',1).replace(': boolean {',': string {',1).replace('return false;', 'return "missing-or-input";',1).replace('if (!result || typeof result !== "object") return false;', 'if (!result || typeof result !== "object") return "shape";').replace('return entry.formId === formId && entry.path === path && typeof entry.expiresAt === "number" && entry.expiresAt > now && entry.expiresAt <= now + REGISTRATION_RESULT_TTL_MS;', 'return entry.formId !== formId ? "form" : entry.path !== path ? "path" : typeof entry.expiresAt !== "number" ? "expiry-type" : entry.expiresAt <= now ? "expired" : entry.expiresAt > now + REGISTRATION_RESULT_TTL_MS ? "future" : "valid";').replace('catch { return false; }','catch { return "decrypt"; }');a.write_bytes((s+'\n'+diag).encode('utf-8'))
 s=b.read_text(encoding='utf-8');s='import { diagnoseRegistrationResult } from "@/lib/registration-submission-receipt";\n'+s;s+='\nexport async function diagnoseResult(formId: string, path: string) { const jar=await cookies(); const secure=registrationRetrySecureCookies((await headers()).get("host") ?? "");return diagnoseRegistrationResult(jar.get(registrationResultCookieName(secure))?.value,formId,path)+"|mode="+secure+"|plain="+Boolean(jar.get(registrationResultCookieName(false)))+"|host="+Boolean(jar.get(registrationResultCookieName(true))); }\n';b.write_bytes(s.encode('utf-8'))
 s=c.read_text(encoding='utf-8').replace('registrationRetryBoundary, verifiedRegistrationSubmission','registrationRetryBoundary, verifiedRegistrationSubmission, diagnoseResult');s=s.replace('<main className=', '<main data-wp05-proof={await diagnoseResult(form.id, `/form/${slug}`)} className=');c.write_bytes(s.encode('utf-8'))
 s=h.read_text(encoding='utf-8').replace('if(lastPage) {', 'if(lastPage) { report.resultReadDiagnostic=await lastPage.locator("main[data-wp05-proof]").getAttribute("data-wp05-proof");');h.write_bytes(s.encode('utf-8'))
 subprocess.run([sys.executable,str(o/'run-browser-result-proof.py')],check=False)
finally:
 for p,data in original.items():p.write_bytes(data)
 print('Temporary reader diagnostics removed')
