const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rules = require('../src/rules');
const source = fs.readFileSync(require.resolve('../../app/admin/conflicts.js'),'utf8');
const context = {window:{BookingStore:rules}};
vm.runInNewContext(source,context);
const C = context.window.AdminConflicts;
const a = {id:'a',facilitator:'Arwee',trainingDate:'2026-10-24',time:'1:00 PM - 3:00 PM',status:'Pending'};
test('admin warnings include pending overlaps without changing reservations', () => {
  const b = {...a,id:'b'};
  assert.equal(C.find([a,b],[],a)[0].type,'competing');
  assert.equal(C.find([a,b],[],b)[0].type,'competing');
  assert.equal(rules.findConflicts([a,b],[],a,a.id).length,0);
  for(const status of ['Approved','Completed']) {
    const confirmed = {...b,status};
    assert.equal(C.find([a,confirmed],[],a)[0].type,'reserved');
    assert.equal(C.find([{...a,status},confirmed],[],{...a,status})[0].type,'confirmed');
  }
});
test('partial overlaps warn; adjacent times, other dates/facilitators and closed requests do not', () => {
  assert.equal(C.find([a,{...a,id:'b',time:'2:00 PM - 4:00 PM'}],[],a).length,1);
  for(const patch of [{time:'3:00 PM - 5:00 PM'},{trainingDate:'2026-10-25'},{facilitator:'Other'},{status:'Rejected'},{status:'Cancelled'}]) assert.equal(C.find([a,{...a,id:'b',...patch}],[],a).length,0);
  assert.equal(C.find([a],[],{...a,status:'Rejected'}).length,0);
  assert.equal(C.find([a],[],a).length,0);
});
test('connected conflict groups count each booking once and preserve blocked-date warnings', () => {
  const bookings = [a,{...a,id:'b',time:'2:00 PM - 4:00 PM'},{...a,id:'c',time:'3:00 PM - 5:00 PM'},{...a,id:'d',time:'6:00 PM - 7:00 PM'}];
  const groups = C.groups(bookings,[]);
  assert.equal(groups.length,1); assert.equal(groups[0].items.length,3);
  const blocks=[{id:'block',facilitator:'Arwee',startDate:'2026-10-24',reason:'Leave'}];
  assert.equal(C.find(bookings,blocks,a).filter(c=>c.type==='block').length,1);
  const affected = C.groups(bookings,blocks).flatMap(g=>Array.from(g.items));
  assert.equal(affected.length,4); assert.equal(new Set(affected.map(b=>b.id)).size,4);
});
test('dashboard, table, details and approval use separate admin warnings', () => {
  const admin = fs.readFileSync(require.resolve('../../app/admin/admin.js'),'utf8');
  const html = fs.readFileSync(require.resolve('../../app/admin/index.html'),'utf8');
  assert.ok(html.indexOf('/admin/conflicts.js')<html.indexOf('/admin/admin.js'));
  assert.match(admin,/const hasConflict = b => conflictsFor\(b\)/);
  assert.match(admin,/Conflicts only/);
  assert.match(admin,/!st.fConflict \|\| hasConflict\(b\)/);
  assert.match(admin,/data-conflict-open/);
  assert.match(admin,/overlapping pending request\(s\) exist/);
});
