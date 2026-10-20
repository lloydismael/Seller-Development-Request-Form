const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const contract = require('../../app/api-contract');
const source = fs.readFileSync(require.resolve('../../app/data.js'), 'utf8');
function browser(capabilities = [...contract.required, 'supervisor-accounts'], search = '') {
  const calls = [];
  const context = {window:{BookingApiContract:contract},location:{hostname:'localhost',search},URLSearchParams,AbortSignal,
    fetch:async (url, options) => {
      calls.push({url, options});
      return {ok:true,status:200,headers:{get:() => 'application/json'},json:async () => url === '/api/health' ? {ok:true,protocol:1,capabilities} : {id:'saved'}};
    }};
  vm.runInNewContext(source, context);
  return {store:context.window.BookingStore,calls};
}
test('Supervisor account transport uses dedicated encoded routes and authenticated requests', async () => {
  const b = browser();
  await b.store.supervisors();
  await b.store.saveSupervisor({username:'manager',password:'test-only-password',profile:{displayName:'Manager'}});
  await b.store.saveSupervisor({disabled:true}, 'id /?');
  assert.deepEqual(b.calls.slice(1).map(call => [call.options.method, call.url]), [
    ['GET','/api/manage/supervisors'], ['POST','/api/manage/supervisors'], ['PUT','/api/manage/supervisors/id%20%2F%3F']
  ]);
  for (const call of b.calls.slice(1)) assert.equal(call.options.credentials, 'same-origin');
  assert.equal(b.calls[2].options.headers['X-Admin-Request'], '1');
  assert.deepEqual(JSON.parse(b.calls[3].options.body), {disabled:true});
});
test('Supervisor routes fail closed on older backends without breaking existing features', async () => {
  const b = browser(contract.required);
  await assert.rejects(b.store.supervisors(), error => error.code === 'BACKEND_UPDATE_REQUIRED');
  assert.equal(b.calls.length, 1);
  await b.store.facilitators();
  assert.equal(b.calls[1].url, '/api/manage/facilitators');
});
test('Supervisor accounts remain unavailable in browser-only demo mode', async () => {
  const b = browser(undefined, '?storage=local');
  await assert.rejects(b.store.supervisors(), error => error.code === 'DEMO_UNAVAILABLE');
  await assert.rejects(b.store.saveSupervisor({}), error => error.code === 'DEMO_UNAVAILABLE');
  assert.equal(b.calls.length, 0);
});
