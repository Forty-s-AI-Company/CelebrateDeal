from pathlib import Path
root=Path.cwd()
evidence=root/'docs/ai-team/evidence/product-audit-20261011/WP-11/referral-navigation'
before=(evidence/'before-0.txt').read_text(encoding='utf-8')
after=(root/'src/app/r/[code]/route.ts').read_text(encoding='utf-8')
start=after.index('  if (limited) {')
end=after.index('  const { code } = await params;',start)
assert after[:start]+'  if (limited) return limited;\n'+after[end:]==before
assert '60, 60_000' in after[:start]
print('Only limiter response branch changed; attribution path and limiter settings preserved.')
