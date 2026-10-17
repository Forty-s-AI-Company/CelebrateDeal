import assert from 'node:assert/strict';
/** Owned disposable database only. Destructive probes always roll back. */
export async function verifyOrderTenantLedger(db,vendorId) {
 for(const role of ['anon','authenticated','service_role']) {
  const [rights]=await db.$queryRawUnsafe(`SELECT
   has_table_privilege($1,'public."LiveMetricOrderTenantSource"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS table_access,
   has_sequence_privilege($1,'public."LiveMetricOrderTenantSource_id_seq"','USAGE,SELECT,UPDATE') AS sequence_access,
   has_function_privilege($1,'public.wp20_metric_order_tenant_revision(text)','EXECUTE') AS revision_access,
   has_function_privilege($1,'public.wp20_metric_order_tenant_changed()','EXECUTE') AS trigger_access`,role);
  assert.deepEqual(rights,{table_access:false,sequence_access:false,revision_access:false,trigger_access:false});
 }
 const [before]=await db.$queryRawUnsafe('SELECT public.wp20_metric_order_tenant_revision($1) AS revision',vendorId);
 assert.ok(before.revision>0n);
 for(const sql of [
  'UPDATE "LiveMetricOrderTenantSource" SET "vendorId"="vendorId" WHERE "vendorId"=$1',
  'DELETE FROM "LiveMetricOrderTenantSource" WHERE "vendorId"=$1',
  'TRUNCATE "LiveMetricOrderTenantSource" RESTART IDENTITY CASCADE',
  'TRUNCATE "CommerceOrder" RESTART IDENTITY CASCADE',
  'TRUNCATE "PaymentTransaction" RESTART IDENTITY CASCADE',
 ]) {
  let state=null;
  await assert.rejects(db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SAVEPOINT tenant_ledger_probe');
   try {await tx.$executeRawUnsafe(sql,...(sql.includes('$1')?[vendorId]:[]));}
   catch(error){state=error?.meta?.code;}
   await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT tenant_ledger_probe');
   throw new Error('tenant-ledger-probe-rollback');
  }),{message:'tenant-ledger-probe-rollback'});
  assert.equal(state,'23514');
 }
 const [after]=await db.$queryRawUnsafe('SELECT public.wp20_metric_order_tenant_revision($1) AS revision',vendorId);
 assert.equal(after.revision,before.revision);
 // Grant only the private counting capability to a disposable worker role;
 // it must see the real count without direct table access or RLS false zero.
 await assert.rejects(db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('CREATE ROLE wp20_tenant_revision_probe NOLOGIN');
  await tx.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO wp20_tenant_revision_probe');
  await tx.$executeRawUnsafe('GRANT EXECUTE ON FUNCTION public.wp20_metric_order_tenant_revision(text) TO wp20_tenant_revision_probe');
  await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_tenant_revision_probe');
  const [rights]=await tx.$queryRawUnsafe(`SELECT has_table_privilege(current_user,'public."LiveMetricOrderTenantSource"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS direct`);
  assert.equal(rights.direct,false);
  const [actual]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_order_tenant_revision($1) AS revision',vendorId);
  assert.equal(actual.revision,before.revision);
  throw new Error('tenant-worker-probe-rollback');
 }),{message:'tenant-worker-probe-rollback'});
 const identityCases=[];
 for(const table of ['CommerceOrder','PaymentTransaction']) {
  const [row]=await db.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE "vendorId"=$1 LIMIT 1`,vendorId);
  assert.ok(row);
  let outcome;
  await assert.rejects(db.$transaction(async tx=>{
   const [initial]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_order_tenant_revision($1) AS revision',vendorId);
   await tx.$executeRawUnsafe('SAVEPOINT identity_probe');
   let rejectedCode;
   try {await tx.$executeRawUnsafe(`UPDATE "${table}" SET id=$1 WHERE id=$2`,row.id+'-identity-probe',row.id);}
   catch(error){rejectedCode=error?.meta?.code;if(!['23514','23503'].includes(rejectedCode))throw error;}
   if(rejectedCode) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT identity_probe');
    const [unchanged]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_order_tenant_revision($1) AS revision',vendorId);
    assert.equal(unchanged.revision,initial.revision);outcome='rejected-'+rejectedCode;
   } else {
    const [changed]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_order_tenant_revision($1) AS revision',vendorId);
    assert.ok(changed.revision>initial.revision);outcome='revision-increased';
   }
   throw new Error('identity-probe-rollback');
  }),{message:'identity-probe-rollback'});
  identityCases.push({table,outcome});
 }
 return {status:'PASS',identityCases,apiRolesDenied:3,immutableUpdate:'PASS',immutableDelete:'PASS',truncateRejected:'PASS',sourceTablesTruncateRejected:'PASS',leastPrivilegeCount:'PASS'};
}
