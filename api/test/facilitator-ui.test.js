const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../app/admin/facilitators.js'), 'utf8');
function harness(identity = { role:'admin' }) {
  const nodes = new Map(), listeners = new Map(), calls = [];
  function node() {
    return { innerHTML:'', textContent:'', hidden:false, disabled:false, isConnected:true, dataset:{}, value:'',
      setAttribute() {}, focus() {}, querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
      querySelectorAll:() => [], addEventListener() {}, append() {}, close() {}, remove() { this.isConnected = false; }, showModal() {}, reportValidity:() => true };
  }
  const view = node();
  const S = { facilitators:async () => { calls.push('list'); return [{ id:'one', user:'trainer', facilitatorLabel:'Alice', disabled:false }]; }, activity:async () => ({items:[],hasMore:false}) };
  const context = { window:{ addEventListener:(name, fn) => listeners.set(name, fn), removeEventListener:name => listeners.delete(name) }, crypto:require('node:crypto').webcrypto, Uint8Array, Date, confirm:() => false, document:{ createElement:() => node() }, FormData:class { get() { return ''; } }, setTimeout };
  vm.runInNewContext(source, context);
  return { ui:context.window.FacilitatorUI, view, nodes, calls, listeners, render:() => context.window.FacilitatorUI.render(view,{S,identity,labels:['Alice','Bob']}) };
}
test('directory tools filter usernames, labels, status and reserve disabled assignments', () => {
  const { tools } = harness().ui;
  const accounts = [{id:'a',user:'AliceLogin',facilitatorLabel:'Alice',disabled:false},{id:'b',user:'BobLogin',facilitatorLabel:'Bob',disabled:true}];
  assert.deepEqual(Array.from(tools.filtered(accounts,' alice ','active')), [accounts[0]]);
  assert.deepEqual(Array.from(tools.filtered(accounts,'bob','disabled')), [accounts[1]]);
  assert.equal(tools.filtered(accounts,'bob','active').length,0);
  assert.deepEqual(Array.from(tools.available(['Alice','Bob','Carol','Carol'],accounts)),['Carol']);
  assert.deepEqual(Array.from(tools.available(['Alice','Bob','Carol'],accounts,'b')),['Bob','Carol']);
});
test('generated passwords meet policy, use secure randomness and vary', () => {
  const { tools } = harness().ui;
  const results = new Set(Array.from({length:50}, () => tools.password()));
  assert.equal(results.size,50);
  for (const value of results) assert.match(value,/^[A-Za-z2-9!@#$%+\-]{20}$/);
  assert.match(source,/crypto\.getRandomValues/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|Math\.random/);
});
test('CSV uses explicit public columns and neutralizes spreadsheet formulas', () => {
  const { tools } = harness().ui;
  const result = tools.csv([{user:'=formula',facilitatorLabel:' \t+formula',disabled:true,credential:'private-hash',password:'private-password',profile:{email:'private-email'},createdAt:'2026-01-01',updatedAt:'2026-02-01'},{user:'with"quote',facilitatorLabel:'with,comma'}]);
  assert.match(result,/"'=formula"/);
  assert.match(result,/"' \t\+formula"/);
  assert.match(result,/"with""quote","with,comma"/);
  assert.doesNotMatch(result,/private-|credential|password|email/);
});
test('workspace loads summaries, directory and filters with accessible drawer controls', async () => {
  const h = harness(); await h.render();
  assert.deepEqual(h.calls,['list']);
  assert.match(h.view.innerHTML,/Account directory/);
  assert.match(h.view.innerHTML,/Without accounts/);
  assert.match(h.nodes.get('#accountRows').innerHTML,/trainer/);
  h.nodes.get('#accountSearch').oninput({target:{value:'missing'}});
  assert.equal(h.nodes.get('#accountRows').innerHTML,'');
  assert.equal(h.nodes.get('#exportAccounts').disabled,true);
  assert.match(h.nodes.get('#accountEmpty').textContent,/No accounts match/);
  h.nodes.get('#createAccount').onclick({currentTarget:h.nodes.get('#createAccount')});
  h.nodes.get('#accountForm').oninput();
  assert.equal(h.ui.canLeave(),false);
  h.ui.deactivate();
  assert.equal(h.ui.canLeave(),true);
  assert.equal(h.listeners.has('beforeunload'),false);
  assert.match(source,/aria-labelledby/);
  assert.match(source,/drawer\.showModal\(\)/);
});
test('facilitators cannot load the administrator directory', async () => {
  const h = harness({role:'facilitator'}); await h.render();
  assert.deepEqual(h.calls,[]);
  assert.match(h.view.innerHTML,/Administrator access required/);
  h.ui.deactivate();
});
test('account module is loaded before training and admin navigation guards drafts', () => {
  const html = fs.readFileSync(require.resolve('../../app/admin/index.html'),'utf8');
  const admin = fs.readFileSync(require.resolve('../../app/admin/admin.js'),'utf8');
  assert.ok(html.indexOf('/admin/facilitators.js') < html.indexOf('/admin/csat.js'));
  assert.match(admin,/window\.FacilitatorUI\?\.canLeave\(\) === false/);
  assert.match(source,/busy \|\| !form\.reportValidity/);
  assert.match(source,/result\.auditRecorded === false/);
});
