const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const { validateSnapshot,migrate } = require("../scripts/migrate-storage");
const source = fs.readFileSync(require.resolve("../src/store"),"utf8");

function mockStore(env = {}) {
  const calls = [], rows = new Map();
  class TableClient {
    constructor(endpoint,name,credential) { calls.push({endpoint,name,credential}); this.name = name; }
    static fromConnectionString(conn,name) { calls.push({conn}); return new TableClient("connection",name,"key"); }
    async createTable() {}
    listEntities() { const entities = [...rows.values()].filter(e => e.table === this.name); return { async *[Symbol.asyncIterator]() { yield* entities; }, byPage() { return { async next() { return {value:entities,done:false}; } }; } }; }
    async getEntity(pk,id) { if (!rows.has(`${this.name}:${id}`)) throw {statusCode:404}; return rows.get(`${this.name}:${id}`); }
    async createEntity(e) { if (rows.has(`${this.name}:${e.rowKey}`)) throw {statusCode:409}; rows.set(`${this.name}:${e.rowKey}`,{...e,table:this.name}); }
  }
  const context = { module:{exports:{}},process:{env},__dirname:'api/src',URL,console:{warn(){}},require(name) {
    if (name === "@azure/data-tables") return {TableClient};
    if (name === "@azure/identity") return {DefaultAzureCredential:class DefaultAzureCredential {},ManagedIdentityCredential:class ManagedIdentityCredential {}};
    return require(name);
  } };
  vm.runInNewContext(source,context);
  return {store:context.module.exports,calls};
}
test("endpoint credentials take precedence over legacy key configuration",async () => {
  const {store,calls} = mockStore({STORAGE_TABLE_ENDPOINT:"https://example.table.core.windows.net/",STORAGE_CONNECTION_STRING:"unused"});
  await store.checkConnection(); assert.equal(store.kind,"table"); assert.equal(calls.length,2); assert.equal(calls[0].credential.constructor.name,"DefaultAzureCredential");
});
test("Azure host uses only managed identity",async () => {
  const {store,calls} = mockStore({STORAGE_TABLE_ENDPOINT:"https://example.table.core.windows.net/",WEBSITE_SITE_NAME:"test"});
  await store.checkConnection(); assert.equal(calls[0].credential.constructor.name,"ManagedIdentityCredential");
});
test("cloud file fallback and insecure endpoints are rejected",() => {
  assert.throws(() => mockStore({WEBSITE_SITE_NAME:"test"}),/Cloud storage/);
  assert.throws(() => mockStore({STORAGE_TABLE_ENDPOINT:"http://example.com"}),/HTTPS/);
});
const booking = {id:"test-1",createdAt:"2026-10-13T00:00:00Z",requestor:"Test",division:"Test",category:"Test",facilitator:"Test",trainingDate:"2026-12-01",time:"9:00 AM - 12:00 PM",venue:"Test",status:"Pending",answers:{name:"Test"}};
function memoryStore() {
  const data = {bookings:[],blocks:[]};
  return Object.fromEntries(Object.keys(data).map(name => [name,{async list(){return data[name];},async get(id){return data[name].find(r=>r.id===id)||null;},async insert(rec){if(data[name].some(r=>r.id===rec.id))throw {statusCode:409};data[name].push(structuredClone(rec));}}]));
}
test("dry-run does not write; apply and repeated apply preserve IDs and fields",async () => {
  const store = memoryStore(), snapshot = {bookings:[booking],blocks:[]};
  const dry = await migrate(snapshot,store); assert.equal(dry.pending.bookings,1); assert.equal((await store.bookings.list()).length,0);
  await migrate(snapshot,store,{apply:true}); assert.deepEqual(await store.bookings.get(booking.id),booking);
  assert.equal((await migrate(snapshot,store,{apply:true})).skipped.bookings,1);
  await assert.rejects(migrate({bookings:[{...booking,venue:"different"}],blocks:[]},store),/refusing overwrite/);
});
test("migration rejects duplicates, invalid dates, oversized and conflicting records",async () => {
  assert.throws(()=>validateSnapshot({bookings:[booking,booking],blocks:[]}),/duplicate/);
  assert.throws(()=>validateSnapshot({bookings:[{...booking,trainingDate:"2026-02-30"}],blocks:[]}),/invalid/);
  assert.throws(()=>validateSnapshot({bookings:[{...booking,notes:"x".repeat(40000)}],blocks:[]}),/size/);
  await assert.rejects(migrate({bookings:[booking,{...booking,id:"test-2"}],blocks:[]},memoryStore()),/conflicts/);
});
const frontend = fs.readFileSync(require.resolve("../../app/data.js"),"utf8");
test("partial migration can resume without overwriting preserved records",async () => {
  const store = memoryStore(), snapshot = {bookings:[booking,{...booking,id:"second",trainingDate:"2026-12-02"}],blocks:[]};
  const insert = store.bookings.insert;
  let failed = false;
  store.bookings.insert = async rec => {
    if (rec.id === "second" && !failed) { failed = true; throw new Error("Simulated interruption"); }
    return insert(rec);
  };
  await assert.rejects(migrate(snapshot,store,{apply:true}),err => err.migrationProgress.inserted.bookings === 1);
  const resumed = await migrate(snapshot,store,{apply:true});
  assert.equal(resumed.skipped.bookings,1); assert.equal(resumed.inserted.bookings,1);
  assert.deepEqual(await store.bookings.get(booking.id),booking);
});
function browser(hostname,search,fetch) {
  const local = new Map(),context = {window:{},location:{hostname,search},URLSearchParams,AbortSignal,fetch,localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)},sessionStorage:{getItem:()=>null},crypto:{randomUUID:()=>"test"}};
  vm.runInNewContext(frontend,context); return {store:context.window.BookingStore,local};
}
test("cloud API failure never writes locally and detection can retry",async () => {
  let healthy = false;
  const {store,local} = browser("example.com","?storage=local",async()=>({ok:healthy,headers:{get:()=>"application/json"},json:async()=>({ok:true,storage:"table"})}));
  await assert.rejects(store.create(booking),/unavailable/); assert.equal(local.size,0);
  healthy=true; assert.equal(await store.mode(),"api");
});
test("local UI mode is explicit; deployed file backend is rejected",async () => {
  const local = browser("localhost","?storage=local",async()=>{throw new Error("no API");});
  assert.equal(await local.store.mode(),"local"); await local.store.create(booking); assert.equal(local.local.size,1);
  const cloud = browser("example.com","",async()=>({ok:true,headers:{get:()=>"application/json"},json:async()=>({ok:true,storage:"file"})}));
  await assert.rejects(cloud.store.mode(),/unavailable/);
});