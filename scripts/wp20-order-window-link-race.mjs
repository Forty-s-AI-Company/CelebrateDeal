import assert from 'node:assert/strict';
/** Require real lock contention, not sleeps or an assumed transaction ordering. */
export async function verifyOrderWindowLinkRace(db,scope,payment,{nextStart,nextEnd}) {
 const revision=async(start,end)=>(await db.$queryRawUnsafe(
  'SELECT public.wp20_metric_order_window_revision($1,$2::timestamptz,$3::timestamptz) AS revision',scope.vendorId,start,end))[0].revision;
 const [original]=await db.$queryRawUnsafe('SELECT id FROM "CommerceOrder" WHERE "vendorId"=$1 AND "primaryPaymentTransactionId"=$2',scope.vendorId,payment.id);
 assert.ok(original);
 const relink=async tx=>{
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1',original.id);
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,'outside-window-liveness-order');
 };
 const restore=()=>db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=NULL WHERE id=$1','outside-window-liveness-order');
  await tx.$executeRawUnsafe('UPDATE "CommerceOrder" SET "primaryPaymentTransactionId"=$1 WHERE id=$2',payment.id,original.id);
  await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:payment.metadata}});
 },{timeout:15000});
 const schedules=[];
 const levels=['ReadCommitted','RepeatableRead','Serializable'];
 for(const leaderIsolation of levels) for(const followerIsolation of levels) for(const first of ['payment','relink']) {
  const initial=await revision(scope.startAt,scope.endAt),laterInitial=await revision(nextStart,nextEnd);
  let release,started,following;
  const gate=new Promise(resolve=>{release=resolve;});
  const ready=new Promise(resolve=>{started=resolve;});
  const update=tx=>tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticLinkRace:first}}});
  const leader=db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
   const [pid]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
   await (first==='payment'?update(tx):relink(tx));
   started(pid.pid);await gate;
  },{isolationLevel:leaderIsolation,timeout:15000});
  // Attach rejection handling immediately; the main path still asserts success.
  leader.catch(()=>{});
  try {
   const leaderPid=await Promise.race([ready,leader.then(()=>{throw new Error('leader-ended-before-ready');})]);
   let followerReady;
   const followerPidPromise=new Promise(resolve=>{followerReady=resolve;});
   following=db.$transaction(async tx=>{
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
    const [pid]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');followerReady(pid.pid);
    await (first==='payment'?relink(tx):update(tx));
   },{isolationLevel:followerIsolation,timeout:15000});
   following.catch(()=>{});
   const followerPid=await Promise.race([followerPidPromise,following.then(()=>{throw new Error('follower-ended-before-ready');})]);
   let blocked=false;
   for(let attempt=0;attempt<60;attempt++) {
    const [state]=await db.$queryRawUnsafe('SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked',leaderPid,followerPid);
    if(state.blocked){blocked=true;break;}
    await db.$queryRawUnsafe('SELECT pg_sleep(0.025)::text');
   }
   assert.equal(blocked,true,'payment/link writers must serialize before publishing inconsistent relation');
   release();await leader;
   const followerResult=await following.then(()=>({status:'committed'}),error=>({status:'rejected',code:error?.meta?.code??error?.code}));
   if(followerResult.status==='rejected') {
    assert.ok(['40001','P2034'].includes(followerResult.code),'only serialization aborts qualify for a fresh-snapshot retry');
    await db.$transaction(tx=>first==='payment'?relink(tx):update(tx),{isolationLevel:followerIsolation,timeout:15000});
   }
   assert.ok(await revision(scope.startAt,scope.endAt)>initial);
   assert.ok(await revision(nextStart,nextEnd)>laterInitial);
   const [linked]=await db.$queryRawUnsafe(`SELECT p.metadata->>'syntheticLinkRace' AS marker FROM "CommerceOrder" o
    JOIN "PaymentTransaction" p ON p.id=o."primaryPaymentTransactionId" AND p."vendorId"=o."vendorId"
    WHERE o.id=$1 AND o."vendorId"=$2`,'outside-window-liveness-order',scope.vendorId);
   assert.equal(linked?.marker,first);
   schedules.push({first,leaderIsolation,followerIsolation,status:'PASS',blockingObserved:true,followerResult});
  } finally {release();await Promise.allSettled([leader,...(following?[following]:[])]);await restore();}
 }
 // A bounded lock timeout must roll back the entire attempted relink.
 const beforeTimeout=await revision(scope.startAt,scope.endAt),laterBeforeTimeout=await revision(nextStart,nextEnd);
 await db.$transaction(async holder=>{
  await holder.$queryRawUnsafe('SELECT id FROM "PaymentTransaction" WHERE id=$1 FOR NO KEY UPDATE',payment.id);
  await assert.rejects(db.$transaction(async contender=>{
   await contender.$executeRawUnsafe("SET LOCAL lock_timeout='150ms'");
   await relink(contender);
  },{timeout:5000}),error=>error?.meta?.code==='55P03');
  const [stillLinked]=await db.$queryRawUnsafe('SELECT "primaryPaymentTransactionId" AS payment FROM "CommerceOrder" WHERE id=$1',original.id);
  const [destination]=await db.$queryRawUnsafe('SELECT "primaryPaymentTransactionId" AS payment FROM "CommerceOrder" WHERE id=$1','outside-window-liveness-order');
  assert.equal(stillLinked.payment,payment.id);
  assert.equal(destination.payment,null);
  assert.equal(await revision(scope.startAt,scope.endAt),beforeTimeout);
  assert.equal(await revision(nextStart,nextEnd),laterBeforeTimeout);
 },{timeout:10000});
 // Once the blocker releases, a fresh transaction can relink and be restored.
 try {await db.$transaction(relink,{timeout:10000});}
 finally {await restore();}
 // Keep a RepeatableRead payment snapshot from before a committed relink.
 // Hold its commit after UPDATE to observe whether that commit invalidates the
 // destination window, or rejects the stale snapshot with a serialization error.
 let releaseLeader,leaderReady,releaseFollower,followerDone;
 const leaderGate=new Promise(resolve=>{releaseLeader=resolve;});
 const leaderSignal=new Promise(resolve=>{leaderReady=resolve;});
 const followerGate=new Promise(resolve=>{releaseFollower=resolve;});
 const followerSignal=new Promise(resolve=>{followerDone=resolve;});
 const rrLeader=db.$transaction(async tx=>{
  await relink(tx);const [pid]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');leaderReady(pid.pid);await leaderGate;
 },{timeout:15000});rrLeader.catch(()=>{});
 let rrFollower,rrOutcome;
 try {
  const leaderPid=await Promise.race([leaderSignal,rrLeader.then(()=>{throw new Error('leader-ended-before-ready');})]);
  let readyPid;const pidSignal=new Promise(resolve=>{readyPid=resolve;});
  rrFollower=db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
   const [pid]=await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');readyPid(pid.pid);
   await tx.paymentTransaction.update({where:{id:payment.id},data:{metadata:{...payment.metadata,syntheticRrRace:1}}});
   followerDone();await followerGate;
  },{isolationLevel:'RepeatableRead',timeout:15000});rrFollower.catch(()=>{});
  const followerPid=await Promise.race([pidSignal,rrFollower.then(()=>{throw new Error('follower-ended-before-ready');})]);
  let blocked=false;
  for(let attempt=0;attempt<60;attempt++){
   const [state]=await db.$queryRawUnsafe('SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked',leaderPid,followerPid);
   if(state.blocked){blocked=true;break;}await db.$queryRawUnsafe('SELECT pg_sleep(0.025)::text');
  }
  assert.equal(blocked,true);releaseLeader();await rrLeader;
  const result=await Promise.race([followerSignal.then(()=>({status:'updated'})),rrFollower.then(()=>({status:'committed'}),error=>({status:'rejected',code:error?.meta?.code??error?.code}))]);
  rrOutcome=result;
  if(result.status==='rejected')assert.ok(['40001','P2034'].includes(result.code));
  else {
   const beforeCommit=await revision(nextStart,nextEnd);
   releaseFollower();await rrFollower;
   assert.ok(await revision(nextStart,nextEnd)>beforeCommit,'RepeatableRead payment commit must invalidate destination window');
  }
 } finally {releaseLeader();releaseFollower();await Promise.allSettled([rrLeader,...(rrFollower?[rrFollower]:[])]);await restore();}
 return {status:'PASS',schedules,repeatableReadRace:'PASS',repeatableReadOutcome:rrOutcome,lockTimeoutRollback:'PASS',recoveryAfterLockRelease:'PASS',oldWindowInvalidated:true,newWindowInvalidated:true,committedMetadataVisible:true};
}
