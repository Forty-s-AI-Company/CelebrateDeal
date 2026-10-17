from pathlib import Path
p=Path('docs/ai-team/evidence/product-audit-20261011/WP-20/availability')
old=(p/'page.tsx.before.txt').read_text(encoding='utf-8')
new=Path('src/app/(app)/lives/[id]/analytics/page.tsx').read_text(encoding='utf-8')
a=new.index('// These requested metrics need distinct source contracts;')
b=new.index('function record(value: unknown)',a)
new=new[:a]+new[b:]
a=new.index('      <section className="mb-6" aria-labelledby="core-metric-availability-title">')
b=new.index('      </section>\n',a)+len('      </section>\n')
new=new[:a]+new[b:]
assert new==old, 'Changes extend beyond the declared constant and UI insertions'
print('Existing queries and computations unchanged')
