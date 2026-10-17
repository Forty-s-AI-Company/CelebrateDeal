const {PrismaClient}=require('@prisma/client');
const {chromium}=require('@playwright/test');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const db=new PrismaClient({datasourceUrl:'postgresql://postgres@127.0.0.1:64505/celebratedeal_ci?schema=public'});
const report={status:'IN_PROGRESS',checks:[],restored:false};const base='http://127.0.0.1:31024';
(async()=>{let browser,member,pref,project,landing;
try {
 member=await db.vendorMember.findFirstOrThrow({where:{user:{email:'demo@celebratedeal.local'},status:'active'},select:{vendorId:true,userId:true}});
 const key={userId_vendorId:{userId:member.userId,vendorId:member.vendorId}};
 pref=await db.userOnboardingPreference.findUnique({where:key,select:{selectedProjectId:true}});
 const slug=`audit-dual-${Date.now()}`;
 project=await db.salesProject.create({data:{vendorId:member.vendorId,name:'合成雙層發布測試',slug,mode:'live_course',primaryFlow:'live'}});
 landing=await db.landingPage.create({data:{vendorId:member.vendorId,projectId:project.id,name:'合成公開頁',slug,draftContent:{schemaVersion:1,data:{root:{},content:[]}}}});
 await db.userOnboardingPreference.update({where:key,data:{selectedProjectId:project.id}});
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000}});
 report.stage='login';await page.goto(`${base}/login`);await page.getByRole('button',{name:'登入',exact:true}).click();await page.waitForURL('**/dashboard');
 report.stage='merchant-diagnosis';await page.goto(`${base}/landing-pages/${landing.id}`);
 const status=page.getByRole('status',{name:'公開網址狀態'});await status.getByText('專案尚未發布，公開網址目前無法開啟',{exact:true}).waitFor();
 assert.equal(await status.getByRole('link').count(),5);
 report.stage='publish';await page.getByRole('button',{name:'發布已儲存草稿',exact:true}).click();
 await page.getByText(/Funnel 版本 v1 已儲存為發布版本。專案尚未發布/).waitFor();
 const publicResponse=await page.request.get(`${base}/lp/${slug}`);report.publicStatus=publicResponse.status();report.http404Matches=publicResponse.status()===404;const publicView=await browser.newPage();await publicView.goto(`${base}/lp/${slug}`);await publicView.getByRole('heading',{name:'404',exact:true}).waitFor();report.notFoundUi=true;await publicView.close();
 const saved=await db.landingPage.findUniqueOrThrow({where:{id:landing.id},select:{status:true,revision:true}});assert.equal(saved.status,'published');
 assert.equal((await db.salesProject.findUniqueOrThrow({where:{id:project.id},select:{status:true}})).status,'draft');
 report.checks.push({funnelPublished:true,projectStillDraft:true,publicStatus:publicResponse.status(),merchantReason:true,missingItemLinks:4});
 // Only a synthetic fixture changes state here; no product publication gate is bypassed in application code.
 await db.salesProject.update({where:{id:project.id},data:{status:'published',publishedAt:new Date()}});
 report.stage='published-fixture';await page.reload();await status.getByText('專案與 Funnel 均已發布，公開頁目前可開啟。',{exact:true}).waitFor();
 assert.equal((await page.request.get(`${base}/lp/${slug}`)).status(),200);report.checks.push({syntheticPublishedProject:true,publicStatus:200});report.status=report.http404Matches?'PASS':'FAIL';if(!report.http404Matches)process.exitCode=1;
}catch(e){report.status='FAIL';report.errorType=e.name;process.exitCode=1;}
finally{try{if(member&&project){await db.userOnboardingPreference.updateMany({where:{userId:member.userId,vendorId:member.vendorId},data:{selectedProjectId:pref?.selectedProjectId??null}});if(landing){await db.landingPage.update({where:{id:landing.id},data:{publishedVersionId:null}});await db.landingPage.delete({where:{id:landing.id}});}await db.salesProject.delete({where:{id:project.id}});report.restored=true;}}catch{report.status='FAIL';report.cleanupFailed=true;process.exitCode=1;}if(browser)await browser.close();await db.$disconnect();fs.writeFileSync(path.join(__dirname,'browser-result.json'),JSON.stringify(report,null,2));}
})();
