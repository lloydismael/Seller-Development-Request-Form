const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { harness } = require('./api-harness');
const answers = {name:'Attendee',division:'division-4',program:5,learning:4,venue:3,food:2,speaker:1,favorite:'Practice',comments:'More examples'};
async function setup() {
  const h = harness(), admin = await h.login();
  await h.store.bookings.put({id:'session-1',topic:'Phone Videography',status:'Approved',facilitator:'Trainer',ownerHash:'owner'});
  const call = (name,method,body,token=admin,params={}) => { const req=h.request(method,body,token); req.params={id:'session-1',...params}; return h.handlers.get(name)(req); };
  const share = await call('trainingSharing','GET');
  assert.equal(share.status,200);
  return { h,call,token:share.jsonBody.link.split('#')[1] };
}
test('sharing is stable, completion-gated and hidden from generic booking projections',async()=>{
  const {h,call,token}=await setup();
  assert.equal((await call('trainingSharing','GET')).jsonBody.link.split('#')[1],token);
  assert.equal((await call('csatSurvey','POST',{token},null)).jsonBody.state,'closed');
  assert.equal((await call('csatSubmit','POST',{token,attemptId:crypto.randomUUID(),answers},null)).status,400);
  const list=await call('bookings','GET'); assert.doesNotMatch(JSON.stringify(list.jsonBody),/csatSharing|nonce/);
  assert.equal((await call('trainingSharing','GET',null,null)).status,401);
  const csat=h.load(require.resolve('../src/csat'));
  assert.equal(await csat.ownedSharing(await h.store.bookings.get('session-1')),null);
  await call('trainingComplete','POST',{});
  assert.ok((await csat.ownedSharing(await h.store.bookings.get('session-1'))).link);
});
test('shared responses allow multiple attempts but retries are idempotent',async()=>{
  const {call,token,h}=await setup(); await call('trainingComplete','POST',{});
  const attemptId=crypto.randomUUID();
  const result=await call('csatSubmit','POST',{token,attemptId,answers},null); assert.equal(result.status,200);
  assert.equal((await call('csatSubmit','POST',{token,attemptId,answers},null)).jsonBody.alreadySubmitted,true);
  assert.equal((await call('csatSurvey','POST',{token,attemptId},null)).jsonBody.state,'answered');
  assert.equal((await call('csatSubmit','POST',{token,attemptId:crypto.randomUUID(),answers},null)).status,200);
  const detail=await call('trainingSession','GET'); assert.equal(detail.jsonBody.responses.length,2); assert.equal(detail.jsonBody.averages[0].average,5);
  assert.equal((await h.store.bookings.list()).length,1);
  assert.doesNotMatch(JSON.stringify(detail.jsonBody),/nonce|csatSharing|rate/);
});
test('revoke/rotate invalidates shared access but preserves legacy invitations and saved results',async()=>{
  const {call,token}=await setup(); await call('trainingComplete','POST',{});
  const attendee=await call('trainingAttendees','POST',{name:'Legacy'});
  const invitation=await call('trainingInvitation','POST',{action:'issue'},undefined,{attendeeId:attendee.jsonBody.id});
  const legacy=invitation.jsonBody.link.split('#')[1];
  await call('csatSubmit','POST',{token,attemptId:crypto.randomUUID(),answers},null);
  await call('csatSubmit','POST',{token:legacy,answers},null);
  assert.equal((await call('trainingSession','GET')).jsonBody.responses.length,2);
  await call('trainingSharing','POST',{action:'revoke'});
  assert.equal((await call('csatSurvey','POST',{token},null)).status,404);
  assert.equal((await call('csatSurvey','POST',{token:legacy},null)).jsonBody.state,'answered');
  const fresh=await call('trainingSharing','POST',{action:'reactivate'});
  assert.notEqual(fresh.jsonBody.link.split('#')[1],token);
  assert.equal((await call('trainingSession','GET')).jsonBody.responses.length,2);
});
test('requester sees sharing only for owned open detail and revocation removes it',async()=>{
  const {call,h}=await setup();
  const browser=crypto.randomBytes(32).toString('base64url');
  const row=await h.store.bookings.get('session-1');
  await h.store.bookings.put({...row,ownerHash:crypto.createHash('sha256').update(browser).digest('hex')});
  const detail=async token=>{const req=h.request('GET',null,null,{cookie:`sdrf_browser=${token}`});req.params={id:'session-1'};return h.handlers.get('myRequest')(req);};
  assert.equal((await detail(browser)).jsonBody.csatShare,undefined);
  await call('trainingComplete','POST',{});
  assert.ok((await detail(browser)).jsonBody.csatShare.link);
  assert.equal((await detail(crypto.randomBytes(32).toString('base64url'))).status,404);
  await call('trainingSharing','POST',{action:'revoke'});
  assert.equal((await detail(browser)).jsonBody.csatShare,undefined);
});

test('sharing rotation and submission throttling preserve responses',async()=>{
  const {call,h,token}=await setup(); await call('trainingComplete','POST',{});
  const rotated=await call('trainingSharing','POST',{action:'rotate'});
  assert.equal((await call('csatSurvey','POST',{token},null)).status,404);
  const fresh=rotated.jsonBody.link.split('#')[1];
  const row=await h.store.bookings.get('session-1');
  await h.store.bookings.put({...row,csatSharing:{...row.csatSharing,rate:{startedAt:Date.now(),count:300}}});
  assert.equal((await call('csatSubmit','POST',{token:fresh,attemptId:crypto.randomUUID(),answers},null)).status,429);
  assert.equal((await call('trainingSession','GET')).jsonBody.responses.length,0);
});

test('concurrent shared submissions reconcile and token tampering fails closed',async()=>{
  const {call,token}=await setup(); await call('trainingComplete','POST',{});
  const attemptId=crypto.randomUUID();
  const results=await Promise.all([call('csatSubmit','POST',{token,attemptId,answers},null),call('csatSubmit','POST',{token,attemptId,answers},null)]);
  assert.ok(results.every(r=>r.status===200)); assert.equal((await call('trainingSession','GET')).jsonBody.responses.length,1);
  assert.equal((await call('csatSurvey','POST',{token:token.slice(0,-1)+'!'},null)).status,404);
});
