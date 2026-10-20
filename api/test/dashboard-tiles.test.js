const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../app/admin/admin.js'), 'utf8');
function dashboard() {
  const nodes = new Map();
  function node(dataset = {}) {
    const classes = new Set();
    return { dataset, innerHTML:'', textContent:'', hidden:false, attrs:{}, focused:false,
      setAttribute(k,v) { this.attrs[k]=v; }, focus() { this.focused=true; },
      classList:{add:k=>classes.add(k),toggle(k,v){if(v)classes.add(k);else classes.delete(k);},contains:k=>classes.has(k)},
      querySelector:selector=>get(selector),querySelectorAll:()=>[] };
  }
  function get(selector) { if(!nodes.has(selector)) nodes.set(selector,node()); return nodes.get(selector); }
  const tiles = ['total','pending','upcoming','month','conflicts'].map(key=>node({dashboardTile:key}));
  const view = node();
  view.querySelectorAll=()=>tiles;
  view.querySelector=selector=>selector.startsWith('[data-dashboard-tile=') ? tiles.find(t=>selector.includes(`"${t.dataset.dashboardTile}"`)) : get(selector);
  const bookings=[{id:'a',status:'Pending',trainingDate:'2026-10-24',conflict:true},{id:'b',status:'Approved',trainingDate:'2026-10-24',conflict:true},{id:'c',status:'Cancelled',trainingDate:'2026-09-01'}];
  const context={st:{dashboardSelection:''},bookings,blocks:[],today:'2026-10-20',active:b=>!['Rejected','Cancelled'].includes(b.status),hasConflict:b=>b.conflict,byDate:(a,b)=>a.trainingDate.localeCompare(b.trainingDate),conflictsFor:()=>[{type:'reserved'}],window:{AdminConflicts:{groups:()=>[{date:'2026-10-24',facilitator:'Test',items:bookings.slice(0,2)}]}},title:b=>b.id,FACS:[],CATS:[],ymd:()=> '2026-11-03',addDays:d=>d,esc:s=>s,fmtDate:s=>s,rowHtml:b=>`<div data-open="${b.id}">${b.id}</div>`,empty:s=>s,bars:()=>'',color:()=>'',accessibleActions(){}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function dashboard(v) {'),source.indexOf('  // ---------- Calendar ----------')),context);
  return {context,view,tiles,nodes,render:()=>context.dashboard(view)};
}
test('every tile renders accessible buttons and its matching booking count',()=>{
  const h=dashboard();h.render();
  assert.match(h.view.innerHTML,/type="button" class="stat dashboard-tile/);
  assert.match(h.view.innerHTML,/aria-pressed="false" aria-controls="dashboardResults"/);
  for(const [key,count] of [['total',3],['pending',1],['upcoming',2],['month',2],['conflicts',2]]) {
    h.tiles.find(t=>t.dataset.dashboardTile===key).onclick();
    assert.equal(h.context.st.dashboardSelection,key);
    assert.match(h.nodes.get('#dashboardResults').innerHTML,new RegExp(`${count} booking`));
    assert.equal(h.tiles.filter(t=>t.attrs['aria-pressed']==='true').length,1);
  }
});
test('selection toggles, clears with focus restoration, and survives refreshed data',()=>{
  const h=dashboard();h.render();const tile=h.tiles[4];tile.onclick();
  assert.match(h.nodes.get('#dashboardResults').innerHTML,/conflict-group/);
  assert.match(h.nodes.get('#dashboardSelectionStatus').textContent,/2 matching bookings/);
  h.context.bookings[1].conflict=false;h.render();
  assert.equal(h.context.st.dashboardSelection,'conflicts');
  assert.match(h.nodes.get('#dashboardResults').innerHTML,/1 booking/);
  tile.onclick();assert.equal(h.nodes.get('#dashboardResults').hidden,true);
  tile.onclick();h.nodes.get('#clearDashboardSelection').onclick();
  assert.equal(tile.focused,true);assert.equal(h.context.st.dashboardSelection,'');
});
test('empty selection renders guidance and preserves overview',()=>{
  const h=dashboard();h.context.bookings=[];h.render();h.tiles[1].onclick();
  assert.match(h.nodes.get('#dashboardResults').innerHTML,/No bookings in this category/);
  assert.match(h.view.innerHTML,/Pending approval/);
});
