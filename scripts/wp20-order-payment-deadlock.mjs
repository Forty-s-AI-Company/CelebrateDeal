import fs from 'node:fs';
import assert from 'node:assert/strict';
/** Intentionally crossed row locks. This is evidence, not production retry logic. */
export async function verifyOrderPaymentDeadlock(db,scope,payment,{nextStart,nextEnd},isDatabaseWriteConflict) {
 const [original]=await db.$queryRawUnsafe('SELECT id FROM "CommerceOrder" WHERE "vendorId"=$1 AND "primaryPaymentTransactionId"=$2',scope.vendorId,payment.id);
 assert.ok(original);
 const revision=async(start,end)=>(await db.$queryRawUnsafe('SELECT public.wp20_metric_order_window_revision($1,$2::timestamptz,$3::timestamptz) AS revision',scope.vendorId,start,end))[0].revision;
 const restore=()=>db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1','outside-window-liveness-order');
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,original.id);
  await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});
 },{timeout:15000});
 const results=[],diagnostics=[];
 for(const orderIsolation of ['ReadCommitted','RepeatableRead','Serializable']) for(const paymentIsolation of ['ReadCommitted','RepeatableRead','Serializable']) {
  const before=await revision(scope.startAt,scope.endAt),laterBefore=await revision(nextStart,nextEnd);
  let announceOrder,releaseOrder,announcePayment;
  const orderReady=new Promise(resolve=>{announceOrder=resolve;});
  const orderGate=new Promise(resolve=>{releaseOrder=resolve;});
  const paymentReady=new Promise(resolve=>{announcePayment=resolve;});
  const linkDestination=tx=>tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,'outside-window-liveness-order');
  const paymentOperation=async tx=>{
   await tx.$queryRawUnsafe('SELECT id FROM "CommerceOrder" WHERE id=$1 FOR UPDATE','outside-window-liveness-order');
   await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticDeadlock:1}}});
  };
  const orderTx=db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
   await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1',original.id);
   const [pid]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');announceOrder(pid.pid);
   await orderGate;await linkDestination(tx);
  },{isolationLevel:orderIsolation,timeout:15000});orderTx.catch(()=>{});
  let paymentTx;
  try {
   const orderPid=await Promise.race([orderReady,orderTx.then(()=>{throw new Error('order-ended-before-ready');})]);
   paymentTx=db.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
    await tx.$queryRawUnsafe('SELECT id FROM "CommerceOrder" WHERE id=$1 FOR UPDATE','outside-window-liveness-order');
    const [pid]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');announcePayment(pid.pid);
    await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticDeadlock:1}}});
   },{isolationLevel:paymentIsolation,timeout:15000});paymentTx.catch(()=>{});
   const paymentPid=await Promise.race([paymentReady,paymentTx.then(()=>{throw new Error('payment-ended-before-ready');})]);
   let blocked=false;
   for(let attempt=0;attempt<60;attempt++) {
    const [state]=await db.$queryRawUnsafe('SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked',orderPid,paymentPid);
    if(state.blocked){blocked=true;break;}await db.$queryRawUnsafe('SELECT pg_sleep(0.025)::text');
   }
   assert.equal(blocked,true);releaseOrder();
   const outcomes=await Promise.allSettled([orderTx,paymentTx]);
   assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
   const loser=outcomes.findIndex(x=>x.status==='rejected');
   const error=outcomes[loser].reason,code=error?.meta?.code??error?.code;
   const diagnostic={
    orderIsolation,paymentIsolation,loser,code:/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(code??'')?code:'UNKNOWN',
    deadlockMessage:/deadlock detected|40P01/.test(String(error?.message??'')),serializationMessage:/40001|serialization failure/.test(String(error?.message??'')),
    lockTimeoutMessage:/lock timeout|55P03/.test(String(error?.message??'')),type:['PrismaClientKnownRequestError','PrismaClientUnknownRequestError','PrismaClientRustPanicError'].includes(error?.name)?error.name:'OTHER',
   };
   diagnostics.push(diagnostic);
   if(code===undefined){assert.equal(diagnostic.type,'PrismaClientUnknownRequestError');assert.equal(diagnostic.deadlockMessage,true);}
   assert.equal(isDatabaseWriteConflict(error),true,'actual product retry classifier must accept this database conflict');
   if(loser===0)await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1',original.id);await linkDestination(tx);
   },{isolationLevel:orderIsolation,timeout:15000});
   else await db.$transaction(paymentOperation,{isolationLevel:paymentIsolation,timeout:15000});
   assert.ok(await revision(scope.startAt,scope.endAt)>before);
   assert.ok(await revision(nextStart,nextEnd)>laterBefore);
   const [state]=await db.$queryRawUnsafe(`SELECT o."primaryPaymentTransactionId" AS payment,p.metadata->>'syntheticDeadlock' AS marker
    FROM "CommerceOrder" o JOIN "PaymentTransaction" p ON p.id=o."primaryPaymentTransactionId" AND p."vendorId"=o."vendorId" WHERE o.id=$1`,'outside-window-liveness-order');
   assert.equal(state.payment,payment.id);assert.equal(state.marker,'1');
   const [old]=await db.$queryRawUnsafe('SELECT "primaryPaymentTransactionId" AS payment FROM "CommerceOrder" WHERE id=$1',original.id);assert.equal(old.payment,null);
   results.push({orderIsolation,paymentIsolation,blocked:true,aborted:loser===0?'order':'payment',code:code??'UNKNOWN_DRIVER_DEADLOCK',productClassifierAccepted:true,freshRetry:'PASS',factsAndRevisions:'PASS'});
  } finally {releaseOrder();await Promise.allSettled([orderTx,...(paymentTx?[paymentTx]:[])]);await restore();}
 }
 fs.writeFileSync('docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/order-payment-deadlock-diagnostic.json',JSON.stringify({status:'PASS',diagnostics},null,2));
 return {status:'PASS',results,diagnostics,scope:'Forced database deadlock with explicit test retry; does not prove application retry or synchronized20 acceptance'};
}
