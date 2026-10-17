import assert from 'node:assert/strict';
import fs from 'node:fs';
/** Run the real signed POST while only arranging row locks on the owned DB. */
export async function verifyCallbackDeadlock(db,call,body,{vendorId,injection,service}) {
 const proof={status:'FAIL',attempts:[],callbackBlocked:false,sideCommitted:false};
 const [order]=await db.$queryRawUnsafe('SELECT id,"primaryPaymentTransactionId" AS payment FROM "CommerceOrder" WHERE "vendorId"=$1',vendorId);
 assert.ok(order?.payment);
 let releaseSide,announceSide,callbackPid;
 const sideGate=new Promise(resolve=>{releaseSide=resolve;});
 const sideReady=new Promise(resolve=>{announceSide=resolve;});
 const side=db.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
  await tx.$queryRawUnsafe('SELECT id FROM "CommerceOrder" WHERE id=$1 FOR UPDATE',order.id);
  const [pid]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');announceSide(pid.pid);
  await sideGate;
  await tx.$executeRawUnsafe('UPDATE "PaymentTransaction" SET metadata=metadata WHERE id=$1',order.payment);
 },{timeout:15000});side.catch(()=>{});
 const proxy=new Proxy(db,{get(target,key){
  if(key==='$transaction')return async(callback,options)=>{
   if(typeof callback!=='function'||options?.isolationLevel!=='Serializable')return target.$transaction(callback,options);
   const attempt={status:'RUNNING'};proof.attempts.push(attempt);
   try {
    const value=await target.$transaction(async tx=>{
     await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout='50ms'");
     const [pid]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');callbackPid=pid.pid;
     return callback(tx);
    },options);attempt.status='COMMITTED';return value;
   } catch(error) {
    attempt.status='ABORTED';attempt.retryable=service.isDatabaseWriteConflict(error);attempt.stage=service.paymentWebhookErrorStage(error);
    attempt.deadlock=/deadlock detected|40P01/.test(String(error?.message??''));
    attempt.code=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'UNKNOWN';
    throw error;
   }
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 let callback;
 try {
  const sidePid=await Promise.race([sideReady,side.then(()=>{throw new Error('side-ended-before-ready');})]);
  globalThis[injection]=proxy;
  callback=call(body);callback.catch(()=>{});
  for(let attempt=0;attempt<120;attempt++) {
   if(callbackPid){const [state]=await db.$queryRawUnsafe('SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked',sidePid,callbackPid);if(state.blocked){proof.callbackBlocked=true;break;}}
   await db.$queryRawUnsafe('SELECT pg_sleep(0.025)::text');
  }
  assert.equal(proof.callbackBlocked,true);releaseSide();
  const response=await callback;proof.httpStatus=response.status;
  await side;proof.sideCommitted=true;
  assert.equal(response.status,200);
  assert.equal(proof.attempts.length,2);
  assert.equal(proof.attempts[0].status,'ABORTED');assert.equal(proof.attempts[0].deadlock,true);assert.equal(proof.attempts[0].retryable,true);
  assert.ok(['INVENTORY','ORDER_TRANSITION'].includes(proof.attempts[0].stage),'deadlock must come from the real callback lifecycle');
  assert.equal(proof.attempts[1].status,'COMMITTED');
  const commissions=await db.affiliateCommission.findMany({where:{vendorId,sourceType:'webhook',sourceId:order.payment},select:{id:true,commissionAmountCents:true}});
  assert.equal(commissions.length,1);assert.equal(commissions[0].commissionAmountCents,5000);
  const ledgers=await db.affiliateCommissionLedgerEntry.findMany({where:{vendorId,affiliateCommissionId:commissions[0].id},select:{entryType:true,amountCents:true}});
  assert.deepEqual(ledgers,[{entryType:'accrual',amountCents:5000}]);
  const events=await db.webhookEvent.findMany({where:{vendorId},select:{status:true,retryCount:true}});
  assert.deepEqual(events,[{status:'processed',retryCount:0}]);
  const paidEvents=await db.commerceOrderEvent.count({where:{vendorId,orderId:order.id,eventType:'payment.paid'}});
  assert.equal(paidEvents,1);
  const paymentAudits=await db.auditLog.count({where:{vendorId,action:'payment_webhook_paid'}});assert.equal(paymentAudits,1);
  proof.cardinality={paymentAudits,commissions:commissions.length,ledgerEntries:ledgers.length,processedEvents:events.length,paidOrderEvents:paidEvents};
  proof.status='PASS';return proof;
 } finally {
  releaseSide();await Promise.allSettled([side,...(callback?[callback]:[])]);globalThis[injection]=db;
  fs.writeFileSync('docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/payment-callback-deadlock-proof.json',JSON.stringify(proof,null,2));
 }
}
