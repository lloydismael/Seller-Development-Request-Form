const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {harness}=require('./api-harness');
const source=fs.readFileSync(require.resolve('../src/shared-production'),'utf8');
const env={LOCAL_DATA_MODE:'shared-production',SHARED_PRODUCTION_ACK:'LIVE_DATA_WRITES',STORAGE_TABLE_ENDPOINT:'https://sellerdevelopment.table.core.windows.net/',AZURE_TENANT_ID:'3250f76b-9ac9-409f-a84f-f4867a615ef3',CSAT_SIGNING_KEY:'c'.repeat(48),SESSION_SECRET:'s'.repeat(48),CSAT_PUBLIC_ORIGIN:'https://sellerdevelopmentrf.clouditechsolution.com'};
test('shared mode rejects fallback, default secrets and wrong endpoint',()=>{
 const load=e=>vm.runInNewContext(source,{module:{exports:{}},process:{env:e}});
 assert.doesNotThrow(()=>load(env));
 for(const patch of [{STORAGE_TABLE_ENDPOINT:''},{STORAGE_TEST_FILE:'db.json'},{SHARED_PRODUCTION_ACK:''},{SESSION_SECRET:'short'},{CSAT_SIGNING_KEY:'s'.repeat(48)}])assert.throws(()=>load({...env,...patch}));
});
test('v2 links work with independent sessions while production legacy links remain valid',async()=>{
 const h=harness(), admin=await h.login();
 await h.store.bookings.put({id:'signing-test',topic:'Phone Videography',facilitator:'Trainer',status:'Completed',csatActivatedAt:'now'});
 const file=require.resolve('../src/csat');const old=h.load(file);const who=await h.auth.getIdentity(h.request('GET',null,admin));
 const legacy=(await old.sharing('signing-test',who)).link.split('#')[1];
 h.env.CSAT_SIGNING_KEY='shared-key-not-a-session-secret-12345678901234567890';
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,process:{env:h.env},Buffer,setTimeout,require:name=>name==='./store'?h.store:name==='./accounts'?{assigned:async()=>true}:name==='./shared-production'?{enabled:false}:name==='./form-assets-loader'?require('../src/form-assets-loader'):require(name)});
 const csat=module.exports, token=(await csat.sharing('signing-test',{role:'admin'})).link.split('#')[1];
 assert.ok(token.startsWith('s2.'));
 assert.equal((await csat.survey(legacy)).state,'open');
 assert.equal((await csat.survey(token)).state,'open');
});
