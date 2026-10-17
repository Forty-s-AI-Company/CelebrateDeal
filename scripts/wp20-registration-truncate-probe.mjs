import assert from 'node:assert/strict';
/** Only called inside the owned disposable database; even unexpected success rolls back. */
export async function verifyRegistrationTruncateProtection(db) {
 const cases=[];
 for (const table of ['FormSubmission','Live','RegistrationForm','LiveMetricRegistration']) {
  let rejected=false;
  await assert.rejects(db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SAVEPOINT truncate_probe');
   try { await tx.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`); }
   catch(error) { rejected=['23514','0A000'].includes(error?.meta?.code); }
   await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT truncate_probe');
   // Roll back the outer transaction as well; never commit a probe mutation.
   throw new Error('truncate-probe-rollback');
  }),{message:'truncate-probe-rollback'});
  assert.equal(rejected,true,`Source truncate must be rejected: ${table}`);
  cases.push({table,rejected:true});
 }
 return {status:'PASS',cases};
}
