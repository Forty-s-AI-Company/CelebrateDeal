import fs from "node:fs";
import path from "node:path";
import { createHash,randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { main as runMigration } from "./prisma-loopback-disposable-migration-runner.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const buildFiles=["package.json","package-lock.json","tsconfig.json","next.config.ts","postcss.config.mjs","sentry.server.config.ts","sentry.edge.config.ts","prisma.playwright.config.ts","scripts/local-database-safety.ts","playwright.config.ts","playwright.learner-notifications.config.ts","tests/e2e/learner-notifications.spec.ts","scripts/learner-notification-browser-qa.mjs"];
function walk(directory){return fs.readdirSync(path.join(root,directory),{withFileTypes:true}).flatMap(entry=>{const file=path.posix.join(directory,entry.name);if(entry.name.startsWith(".env"))return [];return entry.isDirectory()?walk(file):entry.isFile()?[file]:[];});}
function snapshot(){const files=[...buildFiles,...["src","public","prisma"].flatMap(walk)].sort();const hashes=Object.fromEntries(files.map(file=>[file,createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex")]));return {revision:`sha256:${createHash("sha256").update(JSON.stringify(hashes)).digest("hex")}`,files:hashes};}
const source=snapshot();
const receipt={schemaVersion:"learner-notification-browser/v1",source,status:"NOT_STARTED",browser:null,cleanup:null,safety:{loopbackOnly:true,syntheticOnly:true,actualProviderDelivery:false,alreadyVerifiedSyntheticFixture:true,externalOperations:false,trace:false,screenshot:false,rawLogsSaved:false}};
const migration=await runMigration({afterMigrate:async({databaseUrl,environment,tempRoot})=>{
 // Generate only after the disposable runner has verified its loopback database.
 // The isolated browser must use this revision's schema, not a previous client.
 const generation=spawnSync(process.execPath,[path.join(root,"node_modules/prisma/build/index.js"),"generate","--config","prisma.playwright.config.ts"],{cwd:root,windowsHide:true,stdio:"ignore",env:{...environment,DATABASE_URL:databaseUrl,DIRECT_URL:databaseUrl}});
 if(generation.status!==0)throw new Error("notification-browser-client-generation-failed");
 const executable=chromium.executablePath();if(!fs.existsSync(executable))throw new Error("notification-browser-executable-missing");
 const mirror=path.join(tempRoot,"notification-browser-app");fs.mkdirSync(mirror,{recursive:true});
 for(const directory of ["src","public","prisma"])fs.cpSync(path.join(root,directory),path.join(mirror,directory),{recursive:true,filter:candidate=>!path.basename(candidate).startsWith(".env")});
 for(const file of buildFiles.filter(file=>!file.includes("/") && !file.startsWith("playwright.")))fs.copyFileSync(path.join(root,file),path.join(mirror,file));
 fs.mkdirSync(path.join(mirror,"scripts"));fs.copyFileSync(path.join(root,"scripts/local-database-safety.ts"),path.join(mirror,"scripts/local-database-safety.ts"));
 fs.symlinkSync(path.join(root,"node_modules"),path.join(mirror,"node_modules"),process.platform==="win32"?"junction":"dir");
 const reportFile=path.join(tempRoot,"notification-browser.json");
 const child=spawnSync(process.execPath,[path.join(root,"node_modules/@playwright/test/cli.js"),"test","--config","playwright.learner-notifications.config.ts","--fail-on-flaky-tests"],{cwd:root,windowsHide:true,encoding:"utf8",maxBuffer:8*1024*1024,
  env:{...environment,DATABASE_URL:databaseUrl,DIRECT_URL:databaseUrl,LEARNER_NOTIFICATIONS_BROWSER_MIRROR:mirror,LEARNER_NOTIFICATIONS_BROWSER_REPORT:reportFile,PLAYWRIGHT_EXECUTABLE_PATH:executable,E2E_PORT:"31035",E2E_BASE_URL:"http://127.0.0.1:31035",NEXT_PUBLIC_APP_URL:"http://127.0.0.1:31035",E2E_TEST_MODE:"true",LEARNER_NOTIFICATIONS_EXECUTOR_ENABLED:"false"}});
 if(!fs.existsSync(reportFile))throw new Error("notification-browser-receipt-missing");
 const result=JSON.parse(fs.readFileSync(reportFile,"utf8"));receipt.browser={expected:result.stats.expected,unexpected:result.stats.unexpected,skipped:result.stats.skipped,flaky:result.stats.flaky};
 // The privacy reporter suppresses stdout; JSON retains test output in memory.
 // Extract only this closed diagnostic grammar, never raw browser output.
 const workerLines=[];
 function collectWorkerLines(suites){for(const suite of suites??[]){for(const spec of suite.specs??[])for(const test of spec.tests??[])for(const result of test.results??[])for(const item of result.stdout??[])if(typeof item.text==="string")workerLines.push(...item.text.split(/\r?\n/u));collectWorkerLines(suite.suites);}}
 collectWorkerLines(result.suites);
 receipt.workerDiagnostics=workerLines.filter(line=>/^::notice::portal-worker attempted=(true|false) accepted=(true|false) error=(none|TypeError|SecurityError|InvalidStateError|AbortError|other)$/u.test(line)).slice(0,2);
 if(child.status!==0)receipt.failureAnnotations=`${child.stdout??""}
${child.stderr??""}`.split(/\r?\n/u).filter(line=>/^::error file=tests\/e2e\/learner-notifications\.spec\.ts,line=\d+::playwright /u.test(line)).slice(0,10);
 if(child.status!==0 || receipt.browser.expected!==7 || receipt.browser.unexpected!==0 || receipt.browser.skipped!==0 || receipt.browser.flaky!==0)throw new Error("notification-browser-gate-failed");
 if(snapshot().revision!==source.revision)throw new Error("notification-browser-source-changed");
}});
receipt.status=migration.status;receipt.migrationCount=migration.migrationNames?.length;receipt.cleanup=migration.cleanup;
const directory=path.join(root,".ai-team/reports");fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,`learner-notification-browser-${randomUUID()}.json`),JSON.stringify(receipt,null,2)+"\n");fs.writeFileSync(path.join(directory,"learner-notification-browser-latest.json"),JSON.stringify(receipt,null,2)+"\n");
process.stdout.write(JSON.stringify({status:receipt.status,sourceRevision:source.revision,migrationCount:receipt.migrationCount,browser:receipt.browser,cleanup:receipt.cleanup,failureAnnotations:receipt.failureAnnotations})+"\n");if(receipt.status!=="PASS")process.exitCode=1;
