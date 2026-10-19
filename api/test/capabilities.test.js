const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const contract = require('../../app/api-contract');
const capabilities = require('../src/capabilities');
const { check } = require('../scripts/check-production-compatibility');
const { harness } = require('./api-harness');
test('contract rejects legacy/malformed contracts and supports published features', () => {
  assert.equal(contract.compatible({ok:true,storage:'table'}),false);
  assert.equal(contract.compatible({...capabilities,ok:true}),true);
  for(const value of [null,{}, {...capabilities,ok:false}, {...capabilities,ok:true,capabilities:[]}, {...capabilities,ok:true,protocol:'1'}]) assert.equal(contract.compatible(value),false);
});
test('health publishes non-sensitive compatibility contract',async()=>{
  const h=harness(), result=await h.handlers.get('health')();
  assert.equal(result.status,200); assert.equal(contract.compatible(result.jsonBody),true);
  assert.doesNotMatch(JSON.stringify(result.jsonBody),/secret|endpoint|credential/i);
});
test('production gate fails closed and remains production-only',async()=>{
  const response=value=>async()=>({ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>value});
  await assert.rejects(check(response({ok:true,storage:'table'})),/incompatible/);
  assert.equal(await check(response({...capabilities,ok:true,storage:'table'})),true);
  const workflow=fs.readFileSync(require.resolve('../../.github/workflows/azure-static-web-apps-yellow-mushroom-07fa45d00.yml'),'utf8');
  assert.match(workflow,/Verify independent production API compatibility\s+if: github.event_name == 'push'/);
  assert.match(workflow,/api_location: ""/);
});
