const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const admin = fs.readFileSync(require.resolve('../../app/admin/admin.js'), 'utf8');
const csat = fs.readFileSync(require.resolve('../../app/admin/csat.js'), 'utf8');
function link(role, search, bookings = [{ id:'booking-one' }]) {
  const calls = [], context = { URLSearchParams, location:{ search }, identity:{ role }, bookings, st:{ tab:'dashboard' },
    toast:message => calls.push(['toast', message]), render:() => calls.push(['render']), openBooking:id => calls.push(['open', id]) };
  vm.runInNewContext(admin.slice(admin.indexOf('  async function openLinkedRequest()'), admin.indexOf('  async function initialize()')), context);
  return { context, calls, run:() => context.openLinkedRequest() };
}
test('admin and supervisor request links open exact authorized booking after initialization', async () => {
  for (const role of ['admin','supervisor']) {
    const h = link(role, '?request=booking-one'); await h.run();
    assert.equal(h.context.st.tab, 'bookings');
    assert.deepEqual(h.calls, [['render'], ['open','booking-one']]);
  }
  assert.match(admin, /await reload\(\);\s+await openLinkedRequest\(\);/);
});
test('invalid, duplicate and unavailable links cannot open a booking', async () => {
  for (const search of ['?request=unknown','?request=%3Cscript%3E','?request=booking-one&request=other']) {
    const h = link('admin', search); await h.run(); assert.equal(h.calls.some(call => call[0] === 'open'), false);
    assert.equal(h.calls[0][0], 'toast');
  }
});
test('facilitator links use scoped training view instead of management booking APIs', async () => {
  const h = link('facilitator', '?request=booking-one', []); await h.run();
  assert.equal(h.context.st.tab, 'csat'); assert.deepEqual(h.calls, [['render']]);
});
async function training(search, sessions) {
  const view = { isConnected:true, innerHTML:'', querySelectorAll:() => [], querySelector:() => null };
  const context = { URLSearchParams, location:{ search }, window:{}, document:{ createElement:() => ({}) } };
  vm.runInNewContext(csat, context);
  await context.window.CsatUI.render('csat', view, { S:{ trainingSessions:async () => sessions }, identity:{ role:'facilitator' }, labels:[] });
  return view.innerHTML;
}
test('facilitator notification link shows its matching assigned request only', async () => {
  const html = await training('?request=booking-one', [{ id:'booking-one', topic:'Linked training', status:'Approved' }, { id:'other', topic:'Other training', status:'Approved' }]);
  assert.match(html, /Linked training/); assert.doesNotMatch(html, /Other training/);
  assert.match(html, /Showing the request opened from your notification/);
});
test('unavailable facilitator links show safe guidance and do not fetch unscoped request details', async () => {
  const html = await training('?request=other', [{ id:'booking-one', topic:'Assigned training', status:'Approved' }]);
  assert.match(html, /unavailable or you do not have access/);
});
