const assert=require('node:assert/strict');
const {parseFunnelOperations,defaultFunnelOperations}=require(process.cwd()+'/src/lib/funnel-operations.ts');
const {parseFunnelStepPages}=require(process.cwd()+'/src/lib/funnel-step-pages.ts');
const {parsePageDocument}=require(process.cwd()+'/src/lib/funnel-page-document.ts');
const {parseLandingPageContent}=require(process.cwd()+'/src/lib/landing-page-content.ts');
for(const expiresAt of [null,undefined,'not-a-date']) { const value=defaultFunnelOperations();value.deadline.enabled=true;value.deadline.expiresAt=expiresAt;assert.equal(parseFunnelOperations(value),null); }
assert.equal(parseFunnelStepPages({pages:{}}),null);
assert.equal(parsePageDocument({pages:{}}),null);
assert.equal(parseLandingPageContent({pages:{}}),null);
