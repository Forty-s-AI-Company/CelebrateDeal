import { verifyOrderPaymentDeadlock } from './wp20-order-payment-deadlock.mjs';
import { verifyOrderPaymentFenceFacts } from './wp20-order-payment-fence-facts.mjs';
import { verifyOrderWindowLinkRace } from './wp20-order-window-link-race.mjs';
import assert from 'node:assert/strict';
/** Exercise the source ledger directly; report/producer integration is tested by the caller. */
export async function verifyOrderWindowSource(db,scope,service) {
 const nextStart=new Date(scope.endAt.getTime()+30000),nextEnd=new Date(scope.endAt.getTime()+120000);
 const revision=async(tx,start=scope.startAt,end=scope.endAt)=>(await tx.$queryRawUnsafe(
  'SELECT public.wp20_metric_order_window_revision($1,$2::timestamptz,$3::timestamptz) AS revision',scope.vendorId,start,end))[0].revision;
 await assert.rejects(db.$transaction(async tx=>{
  const before=await revision(tx);
  const laterBefore=await revision(tx,nextStart,nextEnd);
  await tx.$executeRawUnsafe(`UPDATE "CommerceOrder" SET status='cancelled' WHERE id='outside-window-liveness-order'`);
  assert.equal(await revision(tx),before);
  assert.ok(await revision(tx,nextStart,nextEnd)>laterBefore);
  const [order]=await tx.$queryRawUnsafe(`SELECT id FROM "CommerceOrder" WHERE "vendorId"=$1
   AND "createdAt">=($2::timestamptz AT TIME ZONE 'UTC') AND "createdAt"<($3::timestamptz AT TIME ZONE 'UTC') LIMIT 1`,scope.vendorId,scope.startAt,scope.endAt);
  assert.ok(order);
  const movedBefore=await revision(tx,nextStart,nextEnd);
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "createdAt"=$1 WHERE id=$2',new Date(nextStart.getTime()+1000),order.id);
  assert.ok(await revision(tx)>before);
  assert.ok(await revision(tx,nextStart,nextEnd)>movedBefore);
  throw new Error('window-source-probe-rollback');
 }),{message:'window-source-probe-rollback'});
 for(const role of ['anon','authenticated','service_role']) {
  const [rights]=await db.$queryRawUnsafe(`SELECT
   has_table_privilege($1,'public."LiveMetricOrderWindowSource"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS table_access,
   has_sequence_privilege($1,'public."LiveMetricOrderWindowSource_id_seq"','USAGE,SELECT,UPDATE') AS sequence_access,
   has_function_privilege($1,'public.wp20_metric_order_window_revision(text,timestamptz,timestamptz)','EXECUTE') AS revision_access`,role);
  assert.deepEqual(rights,{table_access:false,sequence_access:false,revision_access:false});
 }
 const beforeGuards=await revision(db);assert.ok(beforeGuards>0n);
 for(const sql of [
  'UPDATE "LiveMetricOrderWindowSource" SET "orderCreatedAt"="orderCreatedAt" WHERE "vendorId"=$1',
  'DELETE FROM "LiveMetricOrderWindowSource" WHERE "vendorId"=$1',
  'TRUNCATE "LiveMetricOrderWindowSource" RESTART IDENTITY CASCADE',
 ]) {
  await assert.rejects(db.$executeRawUnsafe(sql,...(sql.includes('$1')?[scope.vendorId]:[])),
   error=>error?.meta?.code==='23514');
 }
 assert.equal(await revision(db),beforeGuards);
 const [payment]=await db.$queryRawUnsafe(`SELECT p.id,p.metadata FROM "CommerceOrder" o
  JOIN "PaymentTransaction" p ON p.id=o."primaryPaymentTransactionId" AND p."vendorId"=o."vendorId"
  WHERE o."vendorId"=$1 AND o."createdAt">=($2::timestamptz AT TIME ZONE 'UTC')
   AND o."createdAt"<($3::timestamptz AT TIME ZONE 'UTC') LIMIT 1`,scope.vendorId,scope.startAt,scope.endAt);
 assert.ok(payment);
 // Roll back the synthetic relink so later paid-order assertions retain their fixtures.
 const beforeRelink=await revision(db),laterBeforeRelink=await revision(db,nextStart,nextEnd);
 await assert.rejects(db.$transaction(async tx=>{
  const [linked]=await tx.$queryRawUnsafe('SELECT id FROM "CommerceOrder" WHERE "primaryPaymentTransactionId"=$1 AND "vendorId"=$2',payment.id,scope.vendorId);
  assert.ok(linked);
  const initial=await revision(tx),laterInitial=await revision(tx,nextStart,nextEnd);
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1',linked.id);
  const unlinked=await revision(tx);
  assert.ok(unlinked>initial);
  assert.equal(await revision(tx,nextStart,nextEnd),laterInitial);
  // Unlinked payment changes have no order window; the subsequent link must emit it.
  await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticRelink:1}}});
  assert.equal(await revision(tx),unlinked);
  assert.equal(await revision(tx,nextStart,nextEnd),laterInitial);
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,'outside-window-liveness-order');
  const linkedLater=await revision(tx,nextStart,nextEnd);
  assert.ok(linkedLater>laterInitial);
  assert.equal(await revision(tx),unlinked);
  await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticRelink:2}}});
  assert.ok(await revision(tx,nextStart,nextEnd)>linkedLater);
  assert.equal(await revision(tx),unlinked);
  throw new Error('window-link-probe-rollback');
 },{timeout:15000}),{message:'window-link-probe-rollback'});
 assert.equal(await revision(db),beforeRelink);
 assert.equal(await revision(db,nextStart,nextEnd),laterBeforeRelink);
 const linkRace=await verifyOrderWindowLinkRace(db,scope,payment,{nextStart,nextEnd});
 let snapshotRevision;
 const laterBeforePayment=await revision(db,nextStart,nextEnd);
 try {
  await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   snapshotRevision=await revision(tx);
   await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticWindowRace:1}}});
   assert.equal(await revision(tx),snapshotRevision);
  },{isolationLevel:'RepeatableRead',timeout:15000});
  assert.ok(await revision(db)>snapshotRevision);
  assert.equal(await revision(db,nextStart,nextEnd),laterBeforePayment);
 } finally {await db.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});}
 const paymentFenceFacts=await verifyOrderPaymentFenceFacts(db,scope,payment);
 const deadlock=await verifyOrderPaymentDeadlock(db,scope,payment,{nextStart,nextEnd},service.isDatabaseWriteConflict);
 return {status:'PASS',apiRolesDenied:3,immutableAndNoTruncate:'PASS',paymentWindowRevision:'PASS',repeatableReadSnapshot:'PASS',outsideWindowUnchanged:true,movedDateFencesBothWindows:true,
  relinkWindows:'PASS',unlinkedPaymentThenLink:'PASS',rollbackRestoresRevisions:'PASS',
  linkRace,paymentFenceFacts,deadlock,scope:'Source ledger including payment commit before order relink commit; other schedules remain pending'};
}
