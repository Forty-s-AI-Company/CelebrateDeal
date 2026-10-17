import assert from 'node:assert/strict';
/** Synthetic two-connection ordering: payment commits while order relink is uncommitted. */
export async function verifyOrderWindowLinkRace(db,scope,payment,{nextStart,nextEnd}) {
 const revision=async(start,end)=>(await db.$queryRawUnsafe(
  'SELECT public.wp20_metric_order_window_revision($1,$2::timestamptz,$3::timestamptz) AS revision',scope.vendorId,start,end))[0].revision;
 const [original]=await db.$queryRawUnsafe('SELECT id FROM "CommerceOrder" WHERE "vendorId"=$1 AND "primaryPaymentTransactionId"=$2',scope.vendorId,payment.id);
 assert.ok(original);
 const initial=await revision(scope.startAt,scope.endAt),laterInitial=await revision(nextStart,nextEnd);
 let paymentCommittedRevision;
 try {
  await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='3s'");
   await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1',original.id);
   await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,'outside-window-liveness-order');
   // A separate transaction sees the original committed relation, not this relink.
   await db.$transaction(async paymentTx=>{
    await paymentTx.$executeRawUnsafe("SET LOCAL lock_timeout='3s'");
    await paymentTx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticLinkRace:1}}});
   },{timeout:10000});
   paymentCommittedRevision=await revision(scope.startAt,scope.endAt);
   assert.ok(paymentCommittedRevision>initial);
   assert.equal(await revision(nextStart,nextEnd),laterInitial);
  },{timeout:15000});
  // Link commit supplies the event in the destination window even though the
  // payment trigger could not see that uncommitted destination relation.
  assert.ok(await revision(scope.startAt,scope.endAt)>paymentCommittedRevision);
  assert.ok(await revision(nextStart,nextEnd)>laterInitial);
  const [linked]=await db.$queryRawUnsafe(`SELECT o.id,p.metadata->>'syntheticLinkRace' AS marker FROM "CommerceOrder" o
   JOIN "PaymentTransaction" p ON p.id=o."primaryPaymentTransactionId" AND p."vendorId"=o."vendorId"
   WHERE o.id=$1 AND o."vendorId"=$2`,'outside-window-liveness-order',scope.vendorId);
  assert.equal(linked?.marker,'1');
 } finally {
  // Restore only the known synthetic rows; source events remain append-only.
  await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1','outside-window-liveness-order');
   await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,original.id);
   await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});
  },{timeout:15000});
 }
 // Reverse schedule: the payment trigger runs before the relink is visible,
 // but its new metadata becomes visible after the relink commits. A reader in
 // between must not retain a valid revision for the old payment contents.
 let afterLinkRevision;
 try {
  await db.$transaction(async paymentTx=>{
   await paymentTx.$executeRawUnsafe("SET LOCAL lock_timeout='3s'");
   await paymentTx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticLinkRace:2}}});
   await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='3s'");
    await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1',original.id);
    await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,'outside-window-liveness-order');
   },{timeout:10000});
   afterLinkRevision=await revision(nextStart,nextEnd);
   const [visible]=await db.$queryRawUnsafe('SELECT metadata FROM "PaymentTransaction" WHERE id=$1',payment.id);
   assert.deepEqual(visible.metadata,payment.metadata);
  },{timeout:15000});
  assert.ok(await revision(nextStart,nextEnd)>afterLinkRevision,'destination window must invalidate when pending payment metadata commits');
 } finally {
  await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1','outside-window-liveness-order');
   await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,original.id);
   await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});
  },{timeout:15000});
 }
 return {status:'PASS',schedule:'both payment/relink commit orders',oldWindowInvalidated:true,newWindowInvalidated:true,committedMetadataVisible:true};
}
