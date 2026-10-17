import assert from "node:assert/strict";

/** Real SQL guard checks inside the caller's rollback-only synthetic fixture. */
export async function verifyCompletionPublish(tx, lease, revision, verifiedAt) {
  const facts=[{personId:"source-matrix-registration",firstCompletedAtMs:+verifiedAt+1}];
  const publish=async (rows=facts, count=1, worker=lease.workerId, source=revision)=>{
    const [result]=await tx.$queryRawUnsafe('SELECT public.wp20_metric_completion_publish($1,$2,$3,$4,$5,$6::bigint,$7::integer,$8::jsonb) AS changed',lease.vendorId,lease.liveId,lease.versionId,lease.reportId,worker,source,count,JSON.stringify(rows));
    return result.changed;
  };
  const rowCount=async()=>Number((await tx.$queryRawUnsafe('SELECT count(*) AS n FROM "LiveMetricCompletionProjection" WHERE "reportId"=$1',lease.reportId))[0].n);
  assert.equal(await publish(facts,1,"wrong-worker"),0);
  assert.equal(await publish(facts,1,lease.workerId,revision+BigInt(1)),0);
  assert.equal(await rowCount(),0);
  const rejected=async action=>{
    await tx.$executeRawUnsafe("SAVEPOINT completion_guard_probe");
    let code=null;
    try {await action();}catch(error){code=error?.meta?.code??null;}
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT completion_guard_probe");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT completion_guard_probe");
    assert.equal(code,"23514");
  };
  await rejected(()=>publish([null]));
  await rejected(()=>publish([42]));
  await rejected(()=>publish([{...facts[0],personId:"foreign-registration"}]));
  await rejected(()=>publish([{...facts[0],firstCompletedAtMs:+verifiedAt-1}]));
  await rejected(()=>publish([{...facts[0],firstCompletedAtMs:+verifiedAt+0.5}]));
  await rejected(()=>publish([{...facts[0],extra:true}]));
  await rejected(()=>publish(facts,2));
  assert.equal(await rowCount(),0);
  assert.equal(await publish(),1);
  assert.equal(await publish(),1);
  assert.equal(await rowCount(),1);
  await rejected(()=>publish([{...facts[0],firstCompletedAtMs:+verifiedAt+2}]));
  const [stored]=await tx.$queryRawUnsafe('SELECT rows FROM "LiveMetricCompletionProjection" WHERE "reportId"=$1',lease.reportId);
  assert.deepEqual(stored.rows,facts);
  const [metadata] = await tx.$queryRawUnsafe('SELECT "rowCount" FROM "LiveMetricCompletionProjection" WHERE "reportId"=$1',lease.reportId);
  assert.equal(metadata.rowCount,facts.length);
  await rejected(()=>tx.$executeRawUnsafe('UPDATE "LiveMetricCompletionProjection" SET "rowCount"=0 WHERE "reportId"=$1',lease.reportId));
  // Use the real claim API and database clock; never bypass the report guard.
  await tx.$executeRawUnsafe("SAVEPOINT completion_expiry_probe");
  const expiredId = `${lease.reportId}-expiry`;
  const [created] = await tx.$queryRawUnsafe(`SELECT public.wp20_metric_report_create(
    $1,$2,$3,$4,"windowStartAt" + interval '1 millisecond',"windowEndAt","inputRevision","expiresAt") AS changed
    FROM "LiveMetricReport" WHERE id=$5`,lease.vendorId,lease.liveId,lease.versionId,expiredId,lease.reportId);
  assert.equal(created.changed,1);
  const claim = async (worker, milliseconds) => (await tx.$queryRawUnsafe(
    `SELECT public.wp20_metric_report_claim($1,$2,$3,$4,$5,clock_timestamp()+$6::integer*interval '1 millisecond') AS changed`,
    lease.vendorId,lease.liveId,lease.versionId,expiredId,worker,milliseconds))[0].changed;
  const publishExpired = async worker => (await tx.$queryRawUnsafe(
    'SELECT public.wp20_metric_completion_publish($1,$2,$3,$4,$5,$6::bigint,1,$7::jsonb) AS changed',
    lease.vendorId,lease.liveId,lease.versionId,expiredId,worker,revision,JSON.stringify(facts)))[0].changed;
  assert.equal(await claim("expired-worker",100),1);
  await tx.$executeRawUnsafe("DO $$ BEGIN PERFORM pg_sleep(0.15); END $$");
  assert.equal(await publishExpired("expired-worker"),0);
  assert.equal(Number((await tx.$queryRawUnsafe('SELECT count(*) AS n FROM "LiveMetricCompletionProjection" WHERE "reportId"=$1',expiredId))[0].n),0);
  assert.equal(await claim("replacement-worker",60000),1);
  assert.equal(await publishExpired("expired-worker"),0);
  assert.equal(await publishExpired("replacement-worker"),1);
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT completion_expiry_probe");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT completion_expiry_probe");
  for(const role of ["anon","authenticated","service_role"]){
    const [rights]=await tx.$queryRawUnsafe(`SELECT has_function_privilege($1,'public.wp20_metric_completion_publish(text,text,text,text,text,bigint,integer,jsonb)','EXECUTE') AS allowed`,role);
    assert.equal(rights.allowed,false);
  }
}
