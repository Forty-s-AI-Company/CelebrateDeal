const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
 const result = {status:'IN_PROGRESS'};
 try {
  const response = await fetch('http://127.0.0.1:31026/', {redirect:'manual'});
  const body = await response.text();
  result.httpStatus = response.status;
  result.expectedDestination = response.headers.get('location') === '/login?from=home';
  result.skeletonAbsent = !body.includes('正在載入頁面');
  assert.equal(response.status,307); assert.equal(result.expectedDestination,true); assert.equal(result.skeletonAbsent,true);
  result.status='PASS';
 } catch(error) {result.status='FAIL';result.errorType=error.name;process.exitCode=1;}
 fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));
})();
