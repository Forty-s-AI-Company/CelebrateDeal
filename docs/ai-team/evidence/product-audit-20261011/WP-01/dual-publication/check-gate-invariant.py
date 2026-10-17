from pathlib import Path
import subprocess
name="src/app/actions/sales-workspace-actions.ts"
base=subprocess.check_output(["git","show","HEAD:"+name],text=True,encoding="utf-8")
current=Path(name).read_text(encoding="utf-8")
def extract(text):
 start=text.index("export async function publishSalesProjectAction")
 end=text.index("export async function ",start+1)
 return text[start:end].strip()
assert extract(base)==extract(current)
assert not subprocess.check_output(["git","diff","--name-only","HEAD","--","prisma/schema.prisma","prisma/migrations"])
