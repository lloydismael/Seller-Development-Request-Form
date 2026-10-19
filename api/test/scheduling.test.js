const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./api-harness');
const rules = require('../src/rules');
const booking = { id:'one', status:'Pending', facilitator:'Arwee', trainingDate:'2099-10-24', time:'1:00 PM - 3:00 PM', topic:'Meta Andromeda' };
test('only approved and completed bookings reserve overlapping time; active request semantics remain unchanged', () => {
  for (const status of ['Pending','Approved','Completed','Rejected','Cancelled']) {
    const reserved = ['Approved','Completed'].includes(status);
    assert.equal(rules.reservesSlot(status),reserved);
    assert.equal(rules.findConflicts([{...booking,status}],[],{...booking,id:'two'},'two').length,reserved ? 1 : 0);
  }
  assert.equal(rules.isActive('Pending'),true);
  assert.equal(rules.findConflicts([{...booking,status:'Approved'}],[],{...booking,time:'3:00 PM - 5:00 PM'}).length,0);
  assert.equal(rules.findConflicts([],[{facilitator:'Arwee',startDate:'2099-10-24'}],booking).length,1);
});
test('public API availability excludes pending/rejected/cancelled and retains blocked dates', async () => {
  const h = harness();
  for (const [index,status] of ['Pending','Approved','Completed','Rejected','Cancelled'].entries()) await h.store.bookings.put({...booking,id:String(index),status});
  await h.store.blocks.put({id:'leave',facilitator:'Other',startDate:booking.trainingDate});
  const req = h.request('GET'); req.query.set('date',booking.trainingDate);
  const result = await h.handlers.get('availability')(req);
  assert.equal(result.jsonBody.busy.length,2);
  assert.deepEqual(Array.from(result.jsonBody.blocked),['Other']);
});
test('concurrent approvals of distinct pending requests have exactly one winner', async () => {
  const h = harness(), scheduling = h.load(require.resolve('../src/scheduling'));
  await h.store.bookings.put(booking); await h.store.bookings.put({...booking,id:'two'});
  const one = await h.store.bookings.getWithVersion('one'), two = await h.store.bookings.getWithVersion('two');
  const result = await Promise.allSettled([scheduling.save({...one.value,status:'Approved'},one.version),scheduling.save({...two.value,status:'Approved'},two.version)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(result.find(r=>r.status==='rejected').reason.code,'SLOT_CONFLICT');
  assert.equal((await h.store.bookings.list()).filter(b=>b.status==='Approved').length,1);
  assert.equal((await h.store.bookings.list()).filter(b=>b.status==='Pending').length,1);
});
test('administrator approval and training acceptance share the same concurrency guard', async () => {
  const h = harness(), token = await h.login();
  await h.store.bookings.put(booking); await h.store.bookings.put({...booking,id:'two'});
  const req = h.request('PUT',{status:'Approved'},token); req.params.id = 'one';
  const csat = h.load(require.resolve('../src/csat'));
  const who = await h.auth.getIdentity(h.request('GET',null,token));
  const results = await Promise.allSettled([h.handlers.get('bookingItem')(req).then(result => { if(result.status !== 200) throw Object.assign(new Error(result.jsonBody.error),{code:result.jsonBody.code}); return result; }),csat.decide('two',who,'accept')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'SLOT_CONFLICT');
});
test('cancelling releases reservations and explicit admin force remains available', async () => {
  const h = harness(), scheduling = h.load(require.resolve('../src/scheduling'));
  await h.store.bookings.put({...booking,status:'Approved'}); await h.store.bookings.put({...booking,id:'two'});
  let one = await h.store.bookings.getWithVersion('one'), two = await h.store.bookings.getWithVersion('two');
  await scheduling.save({...one.value,status:'Cancelled'},one.version);
  await scheduling.save({...two.value,status:'Approved'},two.version);
  one = await h.store.bookings.getWithVersion('one');
  await assert.rejects(scheduling.save({...one.value,status:'Approved'},one.version),e=>e.code==='SLOT_CONFLICT');
  await scheduling.save({...one.value,status:'Approved'},one.version,true);
  assert.equal((await h.store.bookings.list()).filter(b=>b.status==='Approved').length,2);
});
