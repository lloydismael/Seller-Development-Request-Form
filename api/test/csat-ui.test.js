const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const config = require('../../app/csat-config');
const schema = require('../../app/csat-schema');
const read = name => fs.readFileSync(path.join(__dirname, '../../app', name), 'utf8');
async function viewer(state = 'open', mode = 'individual') {
  const forms = [], calls = [], nodes = {}, timers = new Map(); let timerId = 0;
  const node = selector => nodes[selector] ||= { textContent:'', hidden:false, focus() {}, onclick:null, value:0, children:[], append(child) { this.children.push(child); } };
  const view = { innerHTML:'', querySelector(selector) { if (selector !== 'form') return node(selector); const form = { querySelector:selector => node(selector), querySelectorAll:() => [], events:{}, addEventListener(name, callback) { this.events[name] = callback; }, values:[] }; forms.push(form); return form; }, focus() {}, prepend() {} };
  const history = [];
  class FormData { constructor(form) { this.values = form.values; } get(id) { return this.values.find(x => x[0] === id)?.[1] ?? null; } *[Symbol.iterator]() { yield* this.values; } }
  const context = { crypto:require('node:crypto'), setTimeout:callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout:id => timers.delete(id), window:{ CsatConfig:config, CsatSchema:schema, addEventListener() {} }, document:{ querySelector:() => view, createElement:tag => ({tag,textContent:'',onclick:null}) }, location:{hash:'#private-invitation',pathname:'/csat/'}, history:{replaceState:(...args)=>history.push(args)}, FormData, AbortSignal,
    fetch:async (url, options) => { calls.push({url,options}); return {ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>({state,mode,session:{trainingDate:'2026-12-01',facilitator:'Test'}})} } };
  await vm.runInNewContext(read('csat/survey.js'),context);
  return { view, forms, calls, history, nodes, timers };
}
test('survey resolves fragment token in POST body and removes it from browser history', async () => {
  const s = await viewer();
  assert.equal(s.history[0][2], '/csat/');
  const resolve = s.calls.find(c => c.url === '/api/csat/resolve');
  assert.equal(resolve.options.method, 'POST');
  assert.equal(JSON.parse(resolve.options.body).token, 'private-invitation');
  assert.match(s.view.innerHTML, /BASIC INFORMATION/);
  assert.match(read('csat/index.html'), /name="referrer" content="no-referrer"/);
});
test('OMF skips director and LG retains source branch before evaluation', async () => {
  for (const [division, destination] of [['division-4','POST-EVALUATION SURVEY'],['division-1','LG DIVISION']]) {
    const s = await viewer(); s.forms[0].values = [['name','Attendee']];
    await s.forms[0].onsubmit({preventDefault(){}});
    assert.match(s.view.innerHTML, /DIVISION/);
    s.forms[1].values = [['division',division]];
    await s.forms[1].onsubmit({preventDefault(){}});
    assert.match(s.view.innerHTML, new RegExp(destination));
    if (division === 'division-1') { s.forms[2].values = [['director','lg-1']]; await s.forms[2].onsubmit({preventDefault(){}}); assert.match(s.view.innerHTML,/POST-EVALUATION SURVEY/); }
    assert.match(s.view.innerHTML,/required/);
    assert.doesNotMatch(s.view.innerHTML,/textarea/);
    assert.match(s.view.innerHTML,/rating-tiles/);
  }
});
test('rating auto-advance cancels on Back and only final feedback can submit', async () => {
  const s = await viewer();
  const next = async values => { const form = s.forms.at(-1); form.values = values; await form.onsubmit({preventDefault(){}}); };
  await next([['name','Attendee']]); await next([['division','division-4']]);
  const form = s.forms.at(-1); form.values = [['program','5']];
  form.events.click({detail:1,target:{closest:()=>({})}});
  assert.equal(s.timers.size,1);
  s.nodes['#back'].onclick(); assert.equal(s.timers.size,0);
  await next([['division','division-4']]);
  for (const id of ['program','learning','venue','food','speaker']) {
    assert.doesNotMatch(s.view.innerHTML,/Submit feedback/);
    await next([[id,'5']]);
  }
  assert.match(s.view.innerHTML,/What is your most favorite part/);
  await next([['favorite','Practice']]); assert.match(s.view.innerHTML,/Submit feedback/);
  assert.equal(s.calls.filter(c=>c.url==='/api/csat/submit').length,0);
  await next([['comments','More practice']]);
  assert.equal(s.calls.filter(c=>c.url==='/api/csat/submit').length,1);
  assert.match(s.view.innerHTML,/feedback has been saved/);
});

test('shared success starts a blank form with a new attempt ID', async () => {
  const s = await viewer('open','shared');
  const next = async values => { const form=s.forms.at(-1); form.values=values; await form.onsubmit({preventDefault(){}}); };
  for(const values of [[['name','Attendee']],[['division','division-4']],...['program','learning','venue','food','speaker'].map(id=>[[id,'5']]),[['favorite','Practice']],[['comments','Examples']]]) await next(values);
  const submitted=JSON.parse(s.calls.find(c=>c.url==='/api/csat/submit').options.body);
  assert.ok(submitted.attemptId);
  const button=s.nodes['.terminal'].children[0]; assert.equal(button.textContent,'Submit another response');
  await button.onclick();
  assert.match(s.view.innerHTML,/FULL NAME/); assert.doesNotMatch(s.view.innerHTML,/value="Attendee"/);
  const resolve=JSON.parse(s.calls.filter(c=>c.url==='/api/csat/resolve').at(-1).options.body);
  assert.notEqual(resolve.attemptId,submitted.attemptId);
});

test('empty text stays invalid and published appearance request carries no token', async () => {
  const s = await viewer(); s.forms[0].values = [['name',' ']];
  await s.forms[0].onsubmit({preventDefault(){}});
  assert.equal(s.forms.length,1); assert.equal(s.nodes['#slideError'].hidden,false);
  assert.equal(s.calls.find(c=>c.url==='/api/form-config').options.body,undefined);
});

test('closed and answered invitations cannot render submission forms', async () => {
  for (const state of ['closed','answered']) { const s = await viewer(state); assert.equal(s.forms.length,0); assert.doesNotMatch(s.view.innerHTML,/<form>/); }
});
test('CSAT routes and management scripts are included in static deployment', () => {
  const routes = JSON.parse(read('staticwebapp.config.json'));
  assert.ok(routes.navigationFallback.exclude.includes('/csat/*'));
  assert.match(read('admin/index.html'), /src="\/admin\/csat.js"/);
  assert.match(read('admin/csat.js'), /textContent = e.message/);
});
