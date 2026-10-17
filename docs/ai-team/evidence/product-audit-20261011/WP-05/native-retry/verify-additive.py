from pathlib import Path
root=Path.cwd()
e=root/'docs/ai-team/evidence/product-audit-20261011/WP-05/native-retry'
before=(e/'schema.before.txt').read_bytes()
after=(root/'prisma/schema.prisma').read_bytes()
assert after.startswith(before)
added=after[len(before):].decode('utf-8')
assert added.count('model ')==1 and 'model RegistrationFormRetryDraft' in added
sql=(root/'prisma/migrations/20261011_registration_form_retry_draft/migration.sql').read_text()
assert all(word not in sql.upper() for word in ['DROP ', 'ALTER ', 'DELETE ', 'UPDATE ', 'TRUNCATE '])
assert sql.count('CREATE TABLE')==1 and sql.count('CREATE INDEX')==1
print('Existing schema unchanged; one additive table/index only.')
