from pathlib import Path
root=Path.cwd();out=root/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-integration'
before=(out/'before-0.txt').read_text(encoding='utf-8')
after=(root/'src/app/api/form-submissions/route.ts').read_text(encoding='utf-8')
a=before[before.index('export async function POST'):before.index('function submissionResponse(')]
b=after[after.index('async function processSubmission'):after.index('function submissionResponse(')]
b=b.replace('async function processSubmission(request: Request, retryFormData?: FormData | null)', 'export async function POST(request: Request)').replace('retryFormData !== undefined ? retryFormData : await readFormDataBody(request)', 'await readFormDataBody(request)')
assert a==b
assert not (root/'src/app/loading.tsx').exists()
assert not (root/'src/app/p/[slug]/loading.tsx').exists()
assert (root/'src/app/(app)/loading.tsx').is_file()
assert (root/'src/app/checkout/[vendorId]/[productId]/loading.tsx').is_file()
print('Submission validation/dedup/verification core unchanged; public loading boundary invariant holds.')
