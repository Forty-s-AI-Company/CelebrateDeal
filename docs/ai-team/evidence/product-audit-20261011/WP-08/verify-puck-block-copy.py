from pathlib import Path
import json,hashlib,subprocess
out=Path(__file__).resolve().parent
base="efb8b7e9a737ea30ea691870318d85bf74830331"
proof=json.loads((out/"puck-block-exact-copy-proof.json").read_text(encoding="utf-8"))
rows=[]
for item in proof:
 f=item["file"]
 before=subprocess.run(["git","show",base+":"+f],capture_output=True,check=True).stdout.decode("utf-8").replace("\r\n","\n")
 actual=Path(f).read_text(encoding="utf-8")
 expected=before
 for old,new in item["only_changes"].items():
  assert old in expected
  expected=expected.replace(old,new)
 assert expected==actual,f
 rows.append({"file":f,"base":base,"before_sha256":hashlib.sha256(before.encode()).hexdigest(),"after_sha256":hashlib.sha256(actual.encode()).hexdigest(),"only_changes":item["only_changes"],"status":"PASS"})
(out/"puck-block-reproducible-proof.json").write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding="utf-8")
print("PASS: exact source equality outside six display replacements at explicit base")
