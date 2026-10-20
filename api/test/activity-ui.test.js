const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../app/admin/settings.js'),'utf8');
function harness() {
  const nodes = new Map(), calls=[];
  function node(){return {hidden:true,attrs:{},textContent:'',setAttribute(k,v){this.attrs[k]=v;}};}
  const get=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};
  const button=node();button.dataset={eventDetails:'0'};
  const link=node();link.dataset={activityBooking:'booking-a'};
  const view={innerHTML:'',querySelector:get,querySelectorAll:selector=>selector==='[data-event-details]'?[button]:[link]};
  const context={activityQuery:{page:1,actor:'',actorType:'',action:'',from:'',to:''},actions:['booking.create'],esc:value=>String(value||'').replace(/</g,'&lt;'),option:(value,label)=>`<option value="${value}">${label}</option>`,render:(...args)=>calls.push(args)};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function activity(view, ctx, result)'),source.indexOf('  window.SettingsUI')),context);
  const result={page:1,hasMore:false,items:[{id:'event',actor:'anonymous',actorDetails:{kind:'self-reported',name:'<Test Requestor>'},action:'booking.create',target:'booking-a',summary:'Booking submitted',timestamp:'2026-10-20T00:00:00.000Z'},{id:'old',actor:'admin',action:'booking.update',target:'old',timestamp:'2026-10-20T00:00:00.000Z',summary:'Updated'}]};
  const ctx={onViewBooking:id=>calls.push(id)};context.activity(view,ctx,result);
  return {context,nodes,button,link,view,calls};
}
test('activity shows self-reported names, friendly actions, legacy confidence and no fabricated source',()=>{
  const h=harness();assert.match(h.view.innerHTML,/&lt;Test Requestor>/);assert.match(h.view.innerHTML,/Self-reported/);assert.match(h.view.innerHTML,/Booking submitted/);assert.match(h.view.innerHTML,/Legacy event/);assert.match(h.view.innerHTML,/Source unavailable/);assert.match(h.view.innerHTML,/name="actorType"/);assert.match(h.view.innerHTML,/name="to"/);
});
test('details toggles accessibly and booking links use the host callback',()=>{
  const h=harness();h.button.onclick();assert.equal(h.nodes.get('#eventDetails0').hidden,false);assert.equal(h.button.attrs['aria-expanded'],'true');h.button.onclick();assert.equal(h.nodes.get('#eventDetails0').hidden,true);h.link.onclick();assert.equal(h.calls[0],'booking-a');
});
test('filters validate date order and reset page; clear filters resets all values',()=>{
  const h=harness();const elements=Object.fromEntries(['action','actor','actorType','from','to'].map(k=>[k,{value:''}]));elements.from.value='2026-10-21';elements.to.value='2026-10-20';const event={preventDefault(){},currentTarget:{elements}};
  h.nodes.get('#activityFilters').onsubmit(event);assert.equal(h.calls.length,0);assert.match(h.nodes.get('#activityFilterError').textContent,/From date/);
  elements.to.value='2026-10-22';elements.actor.value=' Test ';h.nodes.get('#activityFilters').onsubmit(event);assert.equal(h.context.activityQuery.actor,'Test');assert.equal(h.context.activityQuery.page,1);
  h.nodes.get('#activityClear').onclick();assert.equal(h.context.activityQuery.actor,'');assert.equal(h.context.activityQuery.to,'');
});
