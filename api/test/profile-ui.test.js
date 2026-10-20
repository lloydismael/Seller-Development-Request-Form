const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../app/admin/settings.js'),'utf8');
function profile(role = 'facilitator', provider = 'local') {
  const fields = Object.fromEntries(['displayName','email','phone'].map(key=>[key,{value:key==='displayName'?'Trainer':'',disabled:false}]));
  const pf = {elements:fields, reportValidity:()=>true};
  const nodes = new Map();
  const get = selector => { if(!nodes.has(selector)) nodes.set(selector,{disabled:false,textContent:'',hidden:true,setAttribute(){}});return nodes.get(selector); };
  const view = {innerHTML:'',querySelector:selector=>selector==='#profileForm'?pf:selector==='#passwordForm'?null:get(selector),querySelectorAll:()=>[]};
  const calls=[];
  const context = {profileDirty:false,esc:s=>s||'',operation:async(view,work)=>work(),warning(){},error(){},ctx:{S:{updateProfile:async fields=>{calls.push(fields);return {profile:fields};}},onProfile(){},toast(){}},account:{user:'trainer',role,provider,facilitatorLabel:role==='facilitator'?'Arwee':'',profile:{displayName:'Trainer',email:'',phone:''}},view};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function profile(view, ctx, account)'),source.indexOf('  function adoptDraft')),context);
  context.profile(view,context.ctx,context.account);
  return {context,view,pf,nodes,calls};
}
test('profile has one page heading, role/assignment, clear sign-in and contact-only email guidance',()=>{
  const h=profile();
  assert.doesNotMatch(h.view.innerHTML,/<h2>My profile/);
  assert.match(h.view.innerHTML,/<h3>Contact details/);
  assert.match(h.view.innerHTML,/<h3>Security/);
  assert.match(h.view.innerHTML,/Facilitator/);
  assert.match(h.view.innerHTML,/Assignment/);
  assert.match(h.view.innerHTML,/Username and password/);
  assert.match(h.view.innerHTML,/not sign-in or password recovery/);
  assert.match(profile('admin','swa').view.innerHTML,/External identity provider/);
});
test('save/cancel enable only for changed contacts and cancel restores values',()=>{
  const h=profile();h.pf.oninput();assert.equal(h.nodes.get('#saveProfile').disabled,true);
  h.pf.elements.email.value='trainer@example.com';h.pf.oninput();assert.equal(h.nodes.get('#saveProfile').disabled,false);
  assert.equal(h.context.profileDirty,true);
  h.nodes.get('#cancelProfile').onclick();assert.equal(h.pf.elements.email.value,'');assert.equal(h.context.profileDirty,false);
  assert.equal(h.nodes.get('#saveProfile').disabled,true);
});
test('unchanged submits do not write; successful save updates baseline and invalid phone reports inline',async()=>{
  const h=profile();h.pf.onsubmit({preventDefault(){}});assert.equal(h.calls.length,0);
  h.pf.elements.email.value='trainer@example.com';h.pf.oninput();h.pf.onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.length,1);assert.equal(h.nodes.get('#saveProfile').disabled,true);
  assert.equal(h.nodes.get('#profileFeedback').textContent,'Contact details saved.');
  h.pf.elements.phone.value='bad';h.pf.onsubmit({preventDefault(){}});assert.match(h.nodes.get('#profileFeedback').textContent,/valid email\/phone/);
});
test('facilitator contacts are separate from assignment/security saves and email participates in search',()=>{
  const source = fs.readFileSync(require.resolve('../../app/admin/facilitators.js'),'utf8');
  assert.match(source,/contact \? \{ profile \}/);
  assert.match(source,/Save contact details/);
  assert.match(source,/Email is for contact only/);
  assert.match(source,/a\.profile\?\.email/);
  assert.match(source,/if \(!contact && !creating && !changingStatus && !confirm/);
});
