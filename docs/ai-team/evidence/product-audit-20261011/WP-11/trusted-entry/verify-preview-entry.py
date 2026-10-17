"""Bounded synthetic entry checks; never persist response bodies or headers."""
import json, pathlib, subprocess, shutil
ROOT = pathlib.Path(__file__).resolve().parents[6]
OUT = pathlib.Path(__file__).resolve().parent
CANDIDATE = ROOT / ".ai-team/tmp/wp11-source-candidate"
URL = "https://celebrate-deal-staging-lo8afai2s-a25814740s-projects.vercel.app"
CASES = {
    "no_forwarding_headers": [],
    "forged_cloudflare": ["cf-connecting-ip: 203.0.113.123", "cf-ray: synthetic"],
    "forged_vercel": ["x-real-ip: 203.0.113.124", "x-vercel-forwarded-for: 203.0.113.124", "x-forwarded-for: 203.0.113.124"],
    "multi_hop": ["x-forwarded-for: 203.0.113.125, 198.51.100.2"],
    "forged_proof": ["x-celebratedeal-live-chat-ingress: synthetic-forged-proof-never-valid", "cf-connecting-ip: 203.0.113.126"],
}
results = []
for name, headers in CASES.items():
    cmd = [shutil.which("vercel.cmd"), "curl", "/api/live-admission", "--deployment", URL, "--scope", "a25814740s-projects", "--", "--silent", "--max-time", "30", "--write-out", "HTTP_STATUS:%{http_code}", "--request", "POST", "--header", "Content-Type: application/json", "--header", "x-celebratedeal-client: web", "--header", "Origin: " + URL, "--data", "{}"]
    for header in headers: cmd += ["--header", header]
    result = subprocess.run(cmd, cwd=CANDIDATE, capture_output=True, text=True, encoding="utf-8", errors="replace")
    body, _, code = result.stdout.rpartition("HTTP_STATUS:")
    passed = result.returncode == 0 and code.strip() == "503" and "Request source unavailable" in body
    row = {"case": name, "exit_code": result.returncode, "http_status": code.strip(), "expected_rejection": passed}
    results.append(row)
    print(json.dumps(row), flush=True)
receipt = {"deployment_id": "dpl_E9wbsvtxx8ChBjZnUifufjgs93dC", "results": results, "status": "PASS_REJECTION_ONLY" if all(x["expected_rejection"] for x in results) else "FAIL", "normal_flow": "NOT_VERIFIED", "database_operations": False, "raw_output_persisted": False}
(OUT / "preview-entry-matrix.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
