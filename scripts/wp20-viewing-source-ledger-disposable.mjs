import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { main } from './prisma-loopback-disposable-migration-runner.mjs';
const require=createRequire(import.meta.url),output='docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/'+(process.argv.includes('--current-audit')?'viewing-intake-audit-ledger-regression-db.json':'viewing-ledger-db.json');
const receipt={status:'FAIL',stage:'start',scope:'Persistent viewing issuance/mutation ledger with private inspection; no positive coverage'};let migration;
function assertAuditEquivalent(earlier,later){
 assert.equal(earlier.status,'enumerated');assert.equal(later.status,'enumerated');
 for(const value of [earlier,later]){
  assert.deepEqual(Object.keys(value.classification).sort(),['asOf','digest']);
  assert.deepEqual(value.intake.asOf,value.classification.asOf);
 }
 assert.ok(later.classification.asOf>=earlier.classification.asOf);
 if(+later.classification.asOf===+earlier.classification.asOf)assert.equal(later.classification.digest,earlier.classification.digest);
 else assert.notEqual(later.classification.digest,earlier.classification.digest);
 const comparable=value=>({...value,classification:undefined,intake:{...value.intake,asOf:undefined,classificationDigest:undefined,pagesUsed:undefined}});
 // Pagination changes pagesUsed; all source facts, outcomes and source digest
 // must remain exactly equal. Time-dependent classification is checked above.
 assert.deepEqual(comparable(later),comparable(earlier));
}
try {
 const envPaths=JSON.parse(fs.readFileSync('node_modules/.prisma/client/index.js','utf8').match(/"relativeEnvPaths":\s*(\{[^}]*\})/u)?.[1]??'null');assert.ok(envPaths&&Object.values(envPaths).every(x=>x===null));
 const {PrismaClient}=require('@prisma/client');
 migration=await main({afterMigrate:async({databaseUrl})=>{
  const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/celebratedeal_test');
  const db=new PrismaClient({datasourceUrl:databaseUrl});
  try {
   const [marker]=await db.$queryRawUnsafe("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");assert.match(marker.marker,/^prisma-no-dotenv:[a-f0-9]{16}$/u);
   const built=await build({stdin:{contents:'export {auditMetricViewingSources} from "./src/lib/live-metric-viewing-source-audit.ts";',resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false,logLevel:'silent'});
   const compiled={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(require,compiled,compiled.exports);const service=compiled.exports;
   const [fk]=await db.$queryRawUnsafe(`SELECT convalidated AS validated,condeferrable AS deferrable,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid='public."LiveMetricSession"'::regclass AND conname='LiveMetricSession_vendorId_liveId_versionId_registrationId_fkey'`);
   assert.equal(fk?.validated,true);assert.equal(fk.deferrable,false);
   assert.match(fk.definition,/FOREIGN KEY \("vendorId", "liveId", "versionId", "registrationId"\) REFERENCES "LiveMetricRegistration"/u);
   receipt.sameScopeRegistrationFk='VALIDATED_NOT_DEFERRABLE';
   receipt.stage='fixtures';
   const vendor=await db.vendor.create({data:{name:'Synthetic viewing',slug:'viewing-audit',email:'viewing@example.test',passwordHash:'synthetic-unused'}});
   const video=await db.video.create({data:{vendorId:vendor.id,title:'Synthetic',videoUrl:'https://example.test/synthetic.mp4',durationSec:100}});
   const form=await db.registrationForm.create({data:{vendorId:vendor.id,name:'Synthetic',slug:'viewing-audit',headline:'Synthetic',fields:[]}});
   const [clock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");const anchor=new Date(+clock.now-1000),expires=new Date(+clock.now+3600000);
   const live=await db.live.create({data:{vendorId:vendor.id,videoId:video.id,formId:form.id,title:'Synthetic',slug:'viewing-audit',scheduledAt:anchor}});
   const verifiedAt=new Date(+clock.now-5000);
   const submission=await db.formSubmission.create({data:{formId:form.id,liveId:live.id,name:'Synthetic',email:'viewing@example.test',verificationStatus:'VERIFIED',verifiedAt}});
   const admission=await db.liveViewerSession.create({data:{vendorId:vendor.id,liveId:live.id,tokenHash:'a'.repeat(64),createdAt:new Date(+clock.now-2000),lastSeenAt:clock.now,expiresAt:expires}});
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricVersion" (id,"vendorId","liveId","videoId",mode,fingerprint,"durationMs","collectionEnabled","collectionStartedAt","expiresAt") VALUES ('viewing-audit-version',$1,$2,$3,'replay',$4,100000,true,$5,$6)`,vendor.id,live.id,video.id,'a'.repeat(64),new Date(+clock.now-10000),expires);
   await db.$executeRawUnsafe(`INSERT INTO "LiveMetricRegistration" (id,"vendorId","liveId","versionId","submissionId","verifiedAt") VALUES ('viewing-audit-registration',$1,$2,'viewing-audit-version',$3,$4)`,vendor.id,live.id,submission.id,verifiedAt);
   for(const id of ['viewing-closed','viewing-empty','viewing-open'])await db.$executeRawUnsafe(`INSERT INTO "LiveMetricSession" (id,"vendorId","liveId","versionId","registrationId","admissionSessionId","anchorAt","expiresAt") VALUES ($1,$2,$3,'viewing-audit-version','viewing-audit-registration',$4,$5,$6)`,id,vendor.id,live.id,admission.id,anchor,expires);
   for(let sequence=0;sequence<2;sequence++)await db.$executeRawUnsafe(`INSERT INTO "LiveMetricInterval" (id,"vendorId","liveId","versionId","sessionId",sequence,"payloadHash","wallStartAt","wallEndAt","mediaStartMs","mediaEndMs") VALUES ($1,$2,$3,'viewing-audit-version','viewing-closed',$4,$5,$6,$7,$8,$9)`, 'viewing-interval-'+sequence,vendor.id,live.id,sequence,'b'.repeat(64),new Date(+anchor+sequence*10),new Date(+anchor+(sequence+1)*10),sequence*10,(sequence+1)*10);
   await db.$executeRawUnsafe(`UPDATE "LiveMetricSession" SET "finalSequence"="lastSequence","closedAt"=date_trunc('milliseconds',clock_timestamp()),complete=true WHERE id IN ('viewing-closed','viewing-empty')`);
   await db.$queryRawUnsafe('SELECT pg_sleep(0.005)::text');
   const [end]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   const scope={vendorId:vendor.id,liveId:live.id,versionId:'viewing-audit-version',startAt:new Date(+clock.now-10000),endAt:end.now};
   receipt.stage='enumeration';
   const one=await service.auditMetricViewingSources(db,scope,{pageSize:1});
   assert.equal(one.status,'enumerated');assert.equal(one.coverage,'unknown');assert.equal(one.sessionCount,3);assert.equal(one.intervalCount,2);
   assert.equal(one.outcomes.closed_contiguous,2);assert.equal(one.outcomes.open_session,1);
   receipt.stage='enumeration-page-equivalence';
   const full=await service.auditMetricViewingSources(db,scope);assertAuditEquivalent(one,full);
   assert.deepEqual(await service.auditMetricViewingSources(db,scope,{rows:1}),{status:'unavailable',reason:'limit_exceeded'});
   assert.deepEqual(await service.auditMetricViewingSources(db,{...scope,vendorId:'synthetic-foreign'}),{status:'unavailable',reason:'scope_or_window_unavailable'});
   receipt.stage='snapshot-race';let injected=false;
   const racingDb={$transaction:(read,options)=>db.$transaction(tx=>read(new Proxy(tx,{get(target,key){
    if(key==='$queryRaw')return async query=>{
     const rows=await target.$queryRaw(query);
     if(!injected&&query.strings.join('').includes('wp20_metric_viewing_page')){
      injected=true;await db.$executeRawUnsafe(`UPDATE "LiveMetricSession" SET "finalSequence"=-1,"closedAt"=date_trunc('milliseconds',clock_timestamp()),complete=true WHERE id='viewing-open'`);
     }return rows;
    };
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }})),options)};
   const old=await service.auditMetricViewingSources(racingDb,scope,{pageSize:1});assert.equal(old.outcomes.open_session,1);assert.equal(injected,true);
   const fresh=await service.auditMetricViewingSources(db,scope);assert.equal(fresh.outcomes.open_session,0);assert.equal(fresh.outcomes.closed_contiguous,3);assert.notEqual(fresh.digest,old.digest);
   receipt.stage='identity-revocation';
   await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:'UNVERIFIED'}});
   const revoked=await service.auditMetricViewingSources(db,scope);assert.equal(revoked.outcomes.identity_mismatch,3);assert.equal(revoked.coverage,'unknown');
   receipt.results={sessionCount:one.sessionCount,intervalCount:one.intervalCount,openVisible:true,emptyClosedVisible:true,pageSizeIndependentDigest:true,repeatableReadSnapshot:true,freshSnapshotSeesClose:true,revocationVisible:true,partialBudgetDiscarded:true,foreignScopeDenied:true,coverage:'unknown'};
   receipt.stage='viewing-ledger';
   const revision=async(client=db)=>{const [r]=await client.$queryRawUnsafe('SELECT public.wp20_metric_viewing_revision($1,$2,$3) AS value',vendor.id,live.id,scope.versionId);return r.value;};
   const [epoch]=await db.$queryRawUnsafe('SELECT "startedAt" FROM "LiveMetricViewingEpoch" WHERE "versionId"=$1',scope.versionId);
   assert.ok(epoch.startedAt>=clock.now);assert.equal(revoked.issuance.history,'unknown');assert.equal(revoked.issuance.issuedCount,BigInt(3));assert.equal(revoked.issuance.removedCount,BigInt(0));
   const ledgerRevision=await revision();assert.equal(ledgerRevision,BigInt(10));
   const grouped=await db.$queryRawUnsafe('SELECT kind,count(*) AS count FROM "LiveMetricViewingSource" WHERE "versionId"=$1 GROUP BY kind ORDER BY kind',scope.versionId);assert.deepEqual(grouped,[{kind:"interval",count:BigInt(2)},{kind:"issued",count:BigInt(3)},{kind:"state",count:BigInt(5)}]);
   await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "lastSequence"="lastSequence" WHERE id=$1','viewing-empty');assert.equal(await revision(),ledgerRevision);
   await db.$executeRawUnsafe('DELETE FROM "LiveMetricSession" WHERE id=$1','viewing-empty');
   assert.equal(await revision(),ledgerRevision+BigInt(1));
   const removed=await service.auditMetricViewingSources(db,scope);assert.equal(removed.sessionCount,2);assert.equal(removed.issuance.issuedCount,BigInt(3));assert.equal(removed.issuance.removedCount,BigInt(1));assert.equal(removed.coverage,'unknown');assert.notEqual(removed.digest,revoked.digest);
   const rejected=async(sql,code='23514')=>assert.rejects(db.$executeRawUnsafe(sql),error=>error?.meta?.code===code);
   await rejected('UPDATE "LiveMetricViewingSource" SET kind=kind');
   await rejected('DELETE FROM "LiveMetricViewingSource"');
   await rejected('TRUNCATE "LiveMetricViewingSource"');
   await rejected('UPDATE "LiveMetricViewingEpoch" SET "startedAt"="startedAt"');
   await rejected('DELETE FROM "LiveMetricViewingEpoch"');
   await rejected('TRUNCATE "LiveMetricViewingEpoch"');
   await rejected('TRUNCATE "LiveMetricSession" CASCADE');await rejected('TRUNCATE "LiveMetricInterval"');
   await rejected(`UPDATE "LiveMetricSession" SET id='identity-reassigned' WHERE id='viewing-closed'`);
   await rejected(`INSERT INTO "LiveMetricViewingSource" ("vendorId","liveId","versionId","sessionId","registrationId",kind,"anchorAt","expiresAt") SELECT "vendorId","liveId","versionId",'forged',"registrationId",'issued',"anchorAt","expiresAt" FROM "LiveMetricSession" LIMIT 1`);
   await db.formSubmission.update({where:{id:submission.id},data:{verificationStatus:'VERIFIED',verifiedAt}});
   const insertSession=async(client,id,until=expires)=>client.$executeRawUnsafe(`INSERT INTO "LiveMetricSession" (id,"vendorId","liveId","versionId","registrationId","admissionSessionId","anchorAt","expiresAt") VALUES ($1,$2,$3,'viewing-audit-version','viewing-audit-registration',$4,$5,$6)`,id,vendor.id,live.id,admission.id,anchor,until);
   await assert.rejects(insertSession(db,'viewing-empty'),error=>error?.meta?.code==='23505');assert.equal(await revision(),ledgerRevision+BigInt(1));
   const rollback=new Error('synthetic rollback');
   try{await db.$transaction(async tx=>{await insertSession(tx,'viewing-rolled-back');assert.equal(await revision(tx),ledgerRevision+BigInt(2));throw rollback;});assert.fail('rollback required');}catch(error){if(error!==rollback)throw error;}
   assert.equal(await revision(),ledgerRevision+BigInt(1));
   receipt.stage='ledger-commit-order';
   let signalStarted,allowCommit;const started=new Promise(resolve=>{signalStarted=resolve;});const gate=new Promise(resolve=>{allowCommit=resolve;});
   const pending=db.$transaction(async tx=>{await insertSession(tx,'viewing-pending');signalStarted();await gate;},{timeout:10000});
   try{await Promise.race([started,pending.then(()=>{throw new Error('missing start');})]);await insertSession(db,'viewing-committed');assert.equal(await revision(),ledgerRevision+BigInt(2));}finally{allowCommit();await pending;}
   assert.equal(await revision(),ledgerRevision+BigInt(3));
   receipt.stage='ledger-whole-row-change';
   const beforeOther=await service.auditMetricViewingSources(db,scope);
   await db.$executeRawUnsafe(`UPDATE "LiveMetricSession" SET "createdAt"="createdAt"+INTERVAL '1 millisecond' WHERE id='viewing-closed'`);
   const afterOther=await service.auditMetricViewingSources(db,scope);assert.equal(afterOther.viewingRevision,beforeOther.viewingRevision+BigInt(1));assert.notEqual(afterOther.digest,beforeOther.digest);
   await rejected(`UPDATE "LiveMetricSession" SET "lastSequence"=99,"lastElapsedMs"=99999 WHERE id='viewing-closed'`);
   receipt.stage='ledger-range-provenance';
   const [rangeClock]=await db.$queryRawUnsafe("SELECT date_trunc('milliseconds',clock_timestamp()) AS now");
   const shortExpiry=new Date(+rangeClock.now+150),rangeEnd=new Date(+shortExpiry+10);
   const provenance=async(client=db)=>{const [row]=await client.$queryRawUnsafe('SELECT * FROM public.wp20_metric_viewing_provenance($1,$2,$3,$4::timestamptz,$5::timestamptz)',vendor.id,live.id,scope.versionId,shortExpiry,rangeEnd);return row;};
   const rangeBefore=await provenance();
   await insertSession(db,'viewing-range',shortExpiry);
   assert.equal((await provenance()).issuedCount,rangeBefore.issuedCount);
   await db.$executeRawUnsafe('UPDATE "LiveMetricSession" SET "expiresAt"=$1 WHERE id=$2',expires,'viewing-range');
   await db.$queryRawUnsafe('SELECT pg_sleep(0.18)::text');
   assert.equal((await provenance()).issuedCount,rangeBefore.issuedCount+BigInt(1));
   await db.$executeRawUnsafe('DELETE FROM "LiveMetricSession" WHERE id=$1','viewing-range');
   const rangeRemoved=await provenance();assert.equal(rangeRemoved.issuedCount,rangeBefore.issuedCount+BigInt(1));assert.equal(rangeRemoved.removedCount,rangeBefore.removedCount+BigInt(1));assert.ok(rangeRemoved.removedCount<=rangeRemoved.issuedCount);
   receipt.stage='ledger-permissions';
   await db.$executeRawUnsafe('CREATE ROLE wp20_viewing_probe NOLOGIN');
   try{for(const query of ['SELECT count(*) FROM "LiveMetricViewingSource"',`SELECT public.wp20_metric_viewing_revision('a','b','c')`,'ALTER TABLE "LiveMetricViewingSource" DISABLE TRIGGER ALL',`DELETE FROM "LiveMetricVersion" WHERE id='viewing-audit-version'`])await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_viewing_probe');await tx.$queryRawUnsafe(query);}),error=>error?.meta?.code==='42501');}finally{await db.$executeRawUnsafe('DROP ROLE wp20_viewing_probe');}
   await db.$executeRawUnsafe('CREATE ROLE wp20_viewing_reader NOLOGIN');
   try{
    await db.$executeRawUnsafe('GRANT SELECT ON "LiveMetricViewingSource","LiveMetricViewingEpoch" TO wp20_viewing_reader');
    await db.$executeRawUnsafe('GRANT EXECUTE ON FUNCTION public.wp20_metric_viewing_provenance(text,text,text,timestamptz,timestamptz) TO wp20_viewing_reader');
    const expected=await provenance();
    const asReader=await db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_viewing_reader');const [hidden]=await tx.$queryRawUnsafe('SELECT count(*) AS count FROM "LiveMetricViewingSource"');assert.equal(hidden.count,BigInt(0));return provenance(tx);});
    assert.deepEqual(asReader,expected);
   }finally{await db.$executeRawUnsafe('REVOKE SELECT ON "LiveMetricViewingSource","LiveMetricViewingEpoch" FROM wp20_viewing_reader');await db.$executeRawUnsafe('REVOKE EXECUTE ON FUNCTION public.wp20_metric_viewing_provenance(text,text,text,timestamptz,timestamptz) FROM wp20_viewing_reader');await db.$executeRawUnsafe('DROP ROLE wp20_viewing_reader');}
   receipt.stage='ledger-effective-runtime-audit';
   const runtimeTables=['LiveMetricVersion','Live','LiveMetricRegistration','LiveMetricSession','LiveMetricInterval','FormSubmission','RegistrationForm'];
   await db.$executeRawUnsafe('CREATE ROLE wp20_viewing_runtime_probe NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT');
   try{
    for(const table of runtimeTables){await db.$executeRawUnsafe(`GRANT SELECT ON public."${table}" TO wp20_viewing_runtime_probe`);await db.$executeRawUnsafe(`CREATE POLICY wp20_viewing_runtime_probe ON public."${table}" FOR SELECT TO wp20_viewing_runtime_probe USING(true)`);}
    await db.$executeRawUnsafe('GRANT EXECUTE ON FUNCTION public.wp20_metric_viewing_provenance(text,text,text,timestamptz,timestamptz),public.wp20_metric_registration_revision(text,text),public.wp20_metric_playback_intake_revision(text,text,text),public.wp20_metric_playback_intake_page(text,text,text,text,integer),public.wp20_metric_viewing_page(text,text,text,timestamptz,timestamptz,text,integer,integer) TO wp20_viewing_runtime_probe');
    const [flags]=await db.$queryRawUnsafe(`SELECT rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname='wp20_viewing_runtime_probe'`);assert.deepEqual(flags,{rolsuper:false,rolbypassrls:false,rolinherit:false});
    const runtimeDb={$transaction:(read,options)=>db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_viewing_runtime_probe');return read(tx);},options)};
    const expected=await service.auditMetricViewingSources(db,scope),actual=await service.auditMetricViewingSources(runtimeDb,scope);
    assertAuditEquivalent(expected,actual);
    for(const query of ['SELECT count(*) FROM "LiveMetricViewingSource"','ALTER TABLE "LiveMetricViewingSource" DISABLE TRIGGER ALL','TRUNCATE "LiveMetricViewingSource"',`DELETE FROM "LiveMetricVersion" WHERE id='viewing-audit-version'`])await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_viewing_runtime_probe');await tx.$queryRawUnsafe(query);}),error=>error?.meta?.code==='42501');
   }finally{
    for(const table of runtimeTables){await db.$executeRawUnsafe(`DROP POLICY IF EXISTS wp20_viewing_runtime_probe ON public."${table}"`);await db.$executeRawUnsafe(`REVOKE SELECT ON public."${table}" FROM wp20_viewing_runtime_probe`);}
    await db.$executeRawUnsafe('REVOKE EXECUTE ON FUNCTION public.wp20_metric_viewing_provenance(text,text,text,timestamptz,timestamptz),public.wp20_metric_registration_revision(text,text),public.wp20_metric_playback_intake_revision(text,text,text),public.wp20_metric_playback_intake_page(text,text,text,text,integer),public.wp20_metric_viewing_page(text,text,text,timestamptz,timestamptz,text,integer,integer) FROM wp20_viewing_runtime_probe');await db.$executeRawUnsafe('DROP ROLE wp20_viewing_runtime_probe');
   }
   receipt.stage='ledger-nested-trigger-forgery';
   await db.$executeRawUnsafe('CREATE ROLE wp20_viewing_attack NOLOGIN');
   try{await assert.rejects(db.$transaction(async tx=>{
    await tx.$executeRawUnsafe('CREATE TEMP TABLE wp20_viewing_attack_input ("vendorId" text,"liveId" text,"versionId" text,"anchorAt" timestamptz,"expiresAt" timestamptz)');
    await tx.$executeRawUnsafe(`CREATE FUNCTION pg_temp.wp20_viewing_attack_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public."LiveMetricViewingSource" ("vendorId","liveId","versionId","sessionId","registrationId",kind,"anchorAt","expiresAt") VALUES(NEW."vendorId",NEW."liveId",NEW."versionId",'forged-nested','viewing-audit-registration','issued',NEW."anchorAt",NEW."expiresAt");RETURN NEW;END $$`);
    await tx.$executeRawUnsafe('CREATE TRIGGER wp20_viewing_attack_trigger AFTER INSERT ON wp20_viewing_attack_input FOR EACH ROW EXECUTE FUNCTION pg_temp.wp20_viewing_attack_fn()');
    await tx.$executeRawUnsafe('GRANT INSERT ON wp20_viewing_attack_input,public."LiveMetricViewingSource" TO wp20_viewing_attack');
    await tx.$executeRawUnsafe('GRANT USAGE ON SEQUENCE public."LiveMetricViewingSource_id_seq" TO wp20_viewing_attack');
    await tx.$executeRawUnsafe('SET LOCAL ROLE wp20_viewing_attack');
    await tx.$executeRawUnsafe('INSERT INTO wp20_viewing_attack_input VALUES($1,$2,$3,$4,$5)',vendor.id,live.id,scope.versionId,anchor,expires);
   }),error=>error?.meta?.code==='23514');}finally{await db.$executeRawUnsafe('DROP ROLE wp20_viewing_attack');}
   receipt.stage='ledger-range-and-catalog-guards';
   for(const end of [shortExpiry,new Date(+shortExpiry-1)])await assert.rejects(db.$queryRawUnsafe('SELECT * FROM public.wp20_metric_viewing_provenance($1,$2,$3,$4::timestamptz,$5::timestamptz)',vendor.id,live.id,scope.versionId,shortExpiry,end),error=>error?.meta?.code==='23514');
   assert.equal((await provenance()).viewingRevision,await revision());
   const expectedTriggers=['LiveMetricSession_scope_immutable','LiveMetricInterval_scope_immutable','LiveMetricInterval_guard','LiveMetricInterval_progress','LiveMetricSession_progress','LiveMetricSession_viewing_source','LiveMetricInterval_viewing_source','LiveMetricVersion_viewing_epoch','LiveMetricSession_viewing_no_truncate','LiveMetricInterval_viewing_no_truncate'];
   const triggers=await db.$queryRawUnsafe('SELECT tgname,tgenabled::text AS enabled FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[])',expectedTriggers);
   assert.equal(triggers.length,expectedTriggers.length);assert.ok(triggers.every(row=>row.enabled==='O'));
   const indexes=await db.$queryRawUnsafe(`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname IN ('LiveMetricViewingSource_issued_key','LiveMetricViewingSource_scope_session_idx')`);
   assert.equal(indexes.length,2);assert.match(indexes.find(row=>row.indexname==='LiveMetricViewingSource_issued_key').indexdef,/UNIQUE.*WHERE.*kind.*issued/u);assert.match(indexes.find(row=>row.indexname==='LiveMetricViewingSource_scope_session_idx').indexdef,/["\(]vendorId.*liveId.*versionId.*sessionId/u);
   const [acl]=await db.$queryRawUnsafe(`SELECT (SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('LiveMetricViewingSource','LiveMetricViewingEpoch','LiveMetricViewingSource_id_seq') AND a.grantee<>c.relowner) AS tables,(SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('wp20_metric_viewing_immutable','wp20_metric_viewing_epoch','wp20_metric_viewing_source','wp20_metric_viewing_revision','wp20_metric_viewing_provenance') AND a.grantee<>p.proowner) AS functions`);
   assert.deepEqual(acl,{tables:BigInt(0),functions:BigInt(0)});
   const types=await db.$queryRawUnsafe(`SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='LiveMetricInterval' AND column_name IN ('sequence','mediaStartMs','mediaEndMs')`);assert.equal(types.length,3);assert.ok(types.every(row=>row.data_type==='integer'));
   receipt.stage='ledger-unexpected-acl-fails-closed';
   const migrationSql=fs.readFileSync('prisma/migrations/20261016060000_live_metric_viewing_source/migration.sql','utf8');
   const aclGuard=migrationSql.match(/DO \$viewing_acl\$[\s\S]*?END \$viewing_acl\$;/u)?.[0];assert.ok(aclGuard);
   await db.$executeRawUnsafe('CREATE ROLE wp20_viewing_acl_probe NOLOGIN');
   try{await assert.rejects(db.$transaction(async tx=>{await tx.$executeRawUnsafe('GRANT SELECT ON "LiveMetricViewingSource" TO wp20_viewing_acl_probe');await tx.$executeRawUnsafe(aclGuard);}),error=>error?.meta?.code==='23514');}finally{await db.$executeRawUnsafe('DROP ROLE wp20_viewing_acl_probe');}
   receipt.stage='ledger-parent-cleanup';
   await db.$executeRawUnsafe('DELETE FROM "LiveMetricVersion" WHERE id=$1',scope.versionId);
   const [remaining]=await db.$queryRawUnsafe('SELECT (SELECT count(*) FROM "LiveMetricViewingSource" WHERE "versionId"=$1) AS source,(SELECT count(*) FROM "LiveMetricViewingEpoch" WHERE "versionId"=$1) AS epoch,(SELECT count(*) FROM "LiveMetricSession" WHERE "versionId"=$1) AS sessions',scope.versionId);
   assert.deepEqual(remaining,{source:BigInt(0),epoch:BigInt(0),sessions:BigInt(0)});
   receipt.ledger={newVersionEpoch:true,preEpochWindowUnknown:true,issued3Interval2State5Events:true,noOpNoEvent:true,deletionTombstoneRetained:true,revisionAndDigestChange:true,immutableUpdateDeleteTruncate:true,forgedDirectInsertRejected:true,reusedSessionIdRejected:true,rollbackAtomic:true,commitOrderUsesCount:true,unprivilegedRoleDenied:true,parentVersionCascadeNoOrphans:true,rangeChangesRetainIssuance:true,sourceTableTruncateRejected:true,identityMutationRejected:true,nonOwnerProvenanceNotFiltered:true,wholeRowChangeRecorded:true,unbackedProgressRejected:true,nestedTriggerForgeryRejected:true,nonOwnerDdlAndVersionDeleteDenied:true,invalidWindowRejected:true,revisionFunctionsAgree:true,triggerCatalogBindingsEnabled:true,issuedPartialIndexAndSessionIndexPresent:true,newObjectsOwnerOnlyAcl:true,intervalRawNumericTypesInteger:true,fullAuditAsNonOwnerEffectiveRoleMatches:true,runtimeRoleLedgerReadDdlTruncateDeleteDenied:true,unexpectedAclGuardRejectedAndRolledBack:true};
   receipt.stage='complete';receipt.status='PASS';
  } finally {await db.$disconnect();}
 }});
} catch(error){receipt.errorCode=/^(?:P[0-9]{4}|[0-9A-Z]{5})$/.test(error?.meta?.code??error?.code??'')?(error.meta?.code??error.code):'ASSERTION_OR_RUNNER_ERROR';}
receipt.cleanup=migration?.cleanup??'UNKNOWN';if(migration?.status!=='PASS')receipt.status='FAIL';fs.writeFileSync(output,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
