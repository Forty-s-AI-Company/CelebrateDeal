import assert from 'node:assert/strict';
/** Catalog facts and exact synthetic ledger deltas, with all source guards on. */
export async function verifyOrderPaymentFenceFacts(db,scope,payment) {
 const triggers=await db.$queryRawUnsafe(`SELECT t.tgname AS name,p.proname AS function,t.tgenabled AS enabled
  FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE t.tgrelid='public."PaymentTransaction"'::regclass AND NOT t.tgisinternal ORDER BY t.tgname`);
 assert.deepEqual(triggers.map(x=>x.name),['PaymentTransaction_metric_no_truncate','PaymentTransaction_metric_source','PaymentTransaction_metric_tenant_revision','PaymentTransaction_metric_window_revision']);
 assert.ok(triggers.every(x=>x.enabled==='O'));
 const publications=await db.$queryRawUnsafe(`SELECT pubname,schemaname,tablename FROM pg_publication_tables
  WHERE schemaname='public' AND tablename='PaymentTransaction' ORDER BY pubname`);
 assert.equal(publications.length,0,'unexpected payment CDC/publication requires review');
 const [fk]=await db.$queryRawUnsafe(`SELECT convalidated AS validated,condeferrable AS deferrable,
  pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='public."CommerceOrder"'::regclass AND conname='CommerceOrder_primaryPayment_tenant_fkey'`);
 assert.equal(fk?.validated,true);assert.equal(fk.deferrable,false);
 assert.match(fk.definition,/FOREIGN KEY \("vendorId", "primaryPaymentTransactionId"\) REFERENCES "PaymentTransaction"\("vendorId", id\) ON UPDATE CASCADE ON DELETE RESTRICT/u);
 let deltas;
 await assert.rejects(db.$transaction(async tx=>{
  await tx.paymentTransaction.update({where:{id:payment.id},data:{status:'paid'}});
  const beforePayment=await tx.paymentTransaction.findUniqueOrThrow({where:{id:payment.id}});
  const [original]=await tx.$queryRawUnsafe('SELECT id FROM "CommerceOrder" WHERE "vendorId"=$1 AND "primaryPaymentTransactionId"=$2',scope.vendorId,payment.id);
  assert.ok(original);
  const counts=async()=>{
   const [row]=await tx.$queryRawUnsafe(`SELECT
    (SELECT count(*) FROM "LiveMetricOrderWindowSource" WHERE "vendorId"=$1 AND "orderCreatedAt">=($2::timestamptz AT TIME ZONE 'UTC') AND "orderCreatedAt"<($3::timestamptz AT TIME ZONE 'UTC')) AS old_window,
    (SELECT count(*) FROM "LiveMetricOrderWindowSource" WHERE "vendorId"=$1 AND "orderCreatedAt">=($3::timestamptz AT TIME ZONE 'UTC')) AS later_window,
    (SELECT count(*) FROM "LiveMetricOrderTenantSource" WHERE "vendorId"=$1) AS tenant,
    (SELECT count(*) FROM "LiveMetricOrderSource" WHERE "vendorId"=$1) AS scoped,
    (SELECT count(*) FROM "LiveMetricCoverageAudit" WHERE "vendorId"=$1) AS audits`,scope.vendorId,scope.startAt,scope.endAt);
   return row;
  };
  const before=await counts();
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1',original.id);
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,'outside-window-liveness-order');
  const after=await counts();
  assert.deepEqual(await tx.paymentTransaction.findUniqueOrThrow({where:{id:payment.id}}),beforePayment,'MVCC fence must leave every payment field unchanged');
  deltas=Object.fromEntries(Object.keys(before).map(key=>[key,Number(after[key]-before[key])]));
  assert.deepEqual(deltas,{old_window:1,later_window:1,tenant:2,scoped:2,audits:0});
  throw new Error('terminal-payment-fence-rollback');
 },{timeout:15000}),{message:'terminal-payment-fence-rollback'});
 const nonblocking=[];
 const [linkedOrder]=await db.$queryRawUnsafe('SELECT id FROM "CommerceOrder" WHERE "vendorId"=$1 AND "primaryPaymentTransactionId"=$2',scope.vendorId,payment.id);
 for(const isolationLevel of ['RepeatableRead','Serializable']) {
  let sqlState;
  try {
   await assert.rejects(db.$transaction(async tx=>{
    // Establish the immutable snapshot before another connection changes the
    // relation; the payment write begins only after that connection commits.
    await tx.$queryRawUnsafe('SELECT metadata FROM "PaymentTransaction" WHERE id=$1',payment.id);
    await db.$transaction(async writer=>{
     await writer.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1',linkedOrder.id);
     await writer.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,'outside-window-liveness-order');
    },{timeout:10000});
    await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticNonblocking:1}}});
   },{isolationLevel,timeout:15000}),error=>{
    sqlState=error?.meta?.code??error?.code;
    return ['40001','P2034'].includes(sqlState);
   });
   // A fresh-snapshot retry may now safely publish its new metadata.
   await db.$transaction(tx=>tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticNonblocking:1}}}),{isolationLevel,timeout:10000});
   nonblocking.push({isolationLevel,sqlState,staleWriteRejected:true,freshRetry:'PASS'});
  } finally {
   await db.$transaction(async writer=>{
    await writer.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1','outside-window-liveness-order');
    await writer.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,linkedOrder.id);
    await writer.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});
   },{timeout:10000});
  }
 }
 const vendor=await db.vendor.create({data:{name:'Synthetic window cascade',slug:'window-cascade-facts',email:'window-cascade@example.test',passwordHash:'synthetic-unused'}});
 try {
  await db.$executeRawUnsafe('INSERT INTO "LiveMetricOrderWindowSource" ("vendorId","orderCreatedAt") VALUES ($1,$2)',vendor.id,scope.startAt);
  await db.vendor.delete({where:{id:vendor.id}});
  const [left]=await db.$queryRawUnsafe('SELECT count(*)::integer AS count FROM "LiveMetricOrderWindowSource" WHERE "vendorId"=$1',vendor.id);
  assert.equal(left.count,0);
 } finally {await db.vendor.deleteMany({where:{id:vendor.id}});}
 return {status:'PASS',triggers,publications,foreignKey:fk,terminalPaymentFieldsUnchanged:true,deltas,nonblocking,vendorCascade:'PASS',scope:'Actual disposable catalog only; deployed databases and external CDC not inspected'};
}
