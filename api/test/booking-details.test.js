const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../app/admin/admin.js'), 'utf8');
function detail(status = 'Pending', role = 'admin') {
  let html = '', closed = false, saves = 0;
  const booking = { id:'request-one', topic:'Test training', requestor:'Test Requestor', division:'Sales', status, trainingDate:'2099-01-01', time:'9:00 AM - 12:00 PM', facilitator:'Trainer', participants:25, venue:'Office', adminNotes:'', answerSnapshot:[{id:'internal-id',title:'Notes',value:'Plain <text>'}] };
  const nodes = {};
  for (const [id, value] of Object.entries({ eStatus:status,eDate:booking.trainingDate,eFac:'Trainer',eTime:booking.time,eVenue:'Office',eNotes:'' })) nodes['#'+id] = {value,focus(){}};
  for (const id of ['eSave','eCancel','eDelete','eConflict','eEditor','eFeedback']) nodes['#'+id] = {disabled:false,focus(){}};
  nodes['#modal'] = {hidden:false};
  const buttons = [];
  nodes['#modalBody'] = {querySelectorAll:() => buttons};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const context = { bookings:[booking], identity:{role}, VENUES:['Office'],FACS:['Trainer'],TIMES:[booking.time],STATUSES:['Pending','Approved','Completed','Rejected','Cancelled'],
    esc,title:b=>b.topic,historical:(list,value)=>list,opts:()=>'',fmtDate:date=>date,conflictsFor:()=>[],conflictDetails:()=>'',S:{isActive:()=>true},
    $:id=>nodes[id],confirm:()=>true,saveBooking:async(id,patch)=>{saves++;context.lastPatch=patch;return true;},closeModal:()=>{closed=true;nodes['#modal'].hidden=true;},
    openModal(markup){html=markup;for(const match of markup.matchAll(/data-booking-status="([^"]+)"[^>]*>([^<]+)</g))buttons.push({dataset:{bookingStatus:match[1]},textContent:match[2],disabled:false});} };
  vm.runInNewContext(source.slice(source.indexOf('  function openBooking(id)'),source.indexOf('  // ---------- modal ----------')), context);
  context.openBooking(booking.id);
  return {nodes,buttons,context,html,get closed(){return closed;},get saves(){return saves;}};
}
test('details emphasize schedule and status while secondary content is collapsed', () => {
  const h = detail();
  assert.match(h.html,/booking-summary/);assert.match(h.html,/Participants/);
  assert.match(h.html,/<details class="booking-disclosure" id="eEditor"><summary>Edit schedule and notes/);
  assert.match(h.html,/<details class="booking-disclosure"><summary>Request details/);
  assert.doesNotMatch(h.html,/answer-id|Form version:|internal-id/);
  assert.match(h.html,/Plain &lt;text&gt;/);assert.equal(h.nodes['#eSave'].disabled,true);
});
test('quick status choices reflect the current status and preserve role restriction on deletion', () => {
  assert.deepEqual(detail('Pending').buttons.map(b=>b.dataset.bookingStatus),['Approved','Rejected']);
  assert.deepEqual(detail('Approved').buttons.map(b=>b.dataset.bookingStatus),['Completed','Cancelled']);
  assert.deepEqual(detail('Rejected').buttons.map(b=>b.dataset.bookingStatus),['Pending']);
  assert.doesNotMatch(detail('Pending','supervisor').html,/id="eDelete"/);
});
test('quick actions save status only through the existing conflict-aware update path', async () => {
  const h = detail();await h.buttons[0].onclick();
  assert.equal(h.saves,1);assert.equal(h.context.lastPatch.status,'Approved');
  assert.deepEqual(Object.keys(h.context.lastPatch),['status']);assert.equal(h.closed,true);
});
test('unsaved schedule edits block quick status changes instead of discarding edits', async () => {
  const h = detail();h.nodes['#eDate'].value='2099-01-02';await h.buttons[0].onclick();
  assert.equal(h.saves,0);assert.equal(h.nodes['#eEditor'].open,true);
  assert.match(h.nodes['#eFeedback'].textContent,/Save or undo/);
});
