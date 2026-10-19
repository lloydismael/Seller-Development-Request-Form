const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const directories = [];
test.after(() => { for (const dir of directories) fs.rmSync(dir, { recursive:true, force:true }); });
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
    async createEntity(e) { if (rows.has(`${this.name}:${e.rowKey}`)) throw {statusCode:409}; rows.set(`${this.name}:${e.rowKey}`,{...e,table:this.name,etag:`etag-${++this.sequence}`}); }
    sequence = 0;
    async updateEntity(e, mode, options) {
      calls.push({ mode, etag:options.etag });
      const old = rows.get(`${this.name}:${e.rowKey}`);
      if (!old) throw { statusCode:404 };
      if (old.etag !== options.etag) throw { statusCode:412 };
      rows.set(`${this.name}:${e.rowKey}`, { ...e, table:this.name, etag:`etag-${++this.sequence}` });
    }
    async submitTransaction(operations) {
      for (const [operation, e, mode, options] of operations) {
        const old = rows.get(`${this.name}:${e.rowKey}`);
        if (operation === "create" ? !!old : !old || old.etag !== options.etag) throw { statusCode:operation === "create" ? 409 : 412 };
        if (operation === "update") assert.equal(mode, "Replace");
      }
      for (const [, e] of operations) rows.set(`${this.name}:${e.rowKey}`, { ...e, table:this.name, etag:`etag-${++this.sequence}` });
    }
    async upsertEntity(e) { rows.set(`${this.name}:${e.rowKey}`, { ...e, table:this.name, etag:`etag-${++this.sequence}` }); }
    async deleteEntity(pk, id) { rows.delete(`${this.name}:${id}`); }
  }
  const context = { module:{exports:{}},process:{env},__dirname:'api/src',URL,setTimeout,console:{warn(){}},require(name) {
    if (name === "@azure/data-tables") return {TableClient};
    if (name === "@azure/identity") return {DefaultAzureCredential:class DefaultAzureCredential {},ManagedIdentityCredential:class ManagedIdentityCredential {}};
    if (name === "./shared-production") return { enabled:false };
    return require(name);
  } };
  vm.runInNewContext(source,context);
  return {store:context.module.exports,calls};
}
for (const backend of ["file", "table"]) test(`${backend} transactions atomically coordinate session and attendee writes`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "csat-storage-")); directories.push(dir);
  const { store } = mockStore(backend === "file" ? { STORAGE_TEST_FILE:path.join(dir, "db.json") } : { STORAGE_TABLE_ENDPOINT:"https://example.table.core.windows.net" });
  await store.bookings.insert({ id:"session", status:"Approved" });
  const row = await store.bookings.getWithVersion("session");
  await store.bookings.transact([{ value:{ ...row.value, status:"Completed" }, version:row.version }, { value:{ id:"attendee", recordType:"csat-attendee", csatSession:"session" }, version:null }]);
  assert.equal((await store.bookings.get("session")).status, "Completed");
  assert.equal((await store.bookings.list()).length, 1);
  await assert.rejects(store.bookings.transact([{ value:{ id:"session", status:"Cancelled" }, version:row.version }, { value:{ id:"second", recordType:"csat-attendee", csatSession:"session" }, version:null }]), e => e.statusCode === 409);
  assert.equal(await store.bookings.get("second"), null);
  assert.equal((await store.bookings.get("session")).status, "Completed");
});

test("endpoint credentials take precedence over legacy key configuration",async () => {
  const {store,calls} = mockStore({STORAGE_TABLE_ENDPOINT:"https://example.table.core.windows.net/",STORAGE_CONNECTION_STRING:"unused"});
  await store.checkConnection(); assert.equal(store.kind,"table"); assert.equal(calls.length,5); assert.equal(calls[0].credential.constructor.name,"DefaultAzureCredential");
});
test("Azure host uses only managed identity",async () => {
  const {store,calls} = mockStore({STORAGE_TABLE_ENDPOINT:"https://example.table.core.windows.net/",WEBSITE_SITE_NAME:"test"});
  await store.checkConnection(); assert.equal(calls[0].credential.constructor.name,"ManagedIdentityCredential");
});
test("cloud file fallback and insecure endpoints are rejected",() => {
  assert.throws(() => mockStore({WEBSITE_SITE_NAME:"test"}),/Cloud storage/);
  assert.throws(() => mockStore({STORAGE_TABLE_ENDPOINT:"http://example.com"}),/HTTPS/);
  assert.throws(() => mockStore({NODE_ENV:"production",STORAGE_TEST_FILE:"test.json"}),/forbidden/);
});

for (const backend of ["file", "table"]) test(`${backend} collections preserve CRUD and conditional create/update contracts`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booking-storage-")); directories.push(dir);
  const env = backend === "file" ? { STORAGE_TEST_FILE:path.join(dir,"isolated.json") }
    : { STORAGE_TABLE_ENDPOINT:"https://example.table.core.windows.net/" };
  const { store, calls } = mockStore(env);
  for (const name of ["bookings", "blocks", "accounts", "settings", "activity"]) {
    const c = store[name], rec = { id:"test-record", value:"initial" };
    assert.equal(await c.getWithVersion(rec.id), null);
    await c.compareAndSwap(rec.id, rec, null);
    await assert.rejects(c.compareAndSwap(rec.id, { ...rec, value:"overwrite" }, null), e => e.statusCode === 409);
    const original = await c.getWithVersion(rec.id);
    assert.deepEqual(JSON.parse(JSON.stringify(original.value)), rec);
    const changed = { ...rec, value:"changed" };
    await c.compareAndSwap(rec.id, changed, original.version);
    const latest = await c.getWithVersion(rec.id);
    assert.notEqual(latest.version, original.version);
    await assert.rejects(c.compareAndSwap(rec.id, rec, original.version), e => e.statusCode === 409);
    await assert.rejects(c.compareAndSwap(rec.id, rec, "*"), /explicit/);
    await assert.rejects(c.compareAndSwap(rec.id, { ...rec, id:"other" }, latest.version), /match/);
    await c.put(rec);
    assert.equal((await c.list()).length, 1);
    await c.remove(rec.id);
    await assert.rejects(c.compareAndSwap(rec.id, changed, latest.version), e => e.statusCode === 409);
    assert.equal(await c.get(rec.id), null);
    if (backend === "table") assert.ok(calls.some(call => call.mode === "Replace" && call.etag === original.version));
  }
});

test("independent file modules serialize concurrent CAS and preserve legacy booking records", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booking-storage-")); directories.push(dir);
  const file = path.join(dir,"isolated.json"), env = { STORAGE_TEST_FILE:file };
  fs.writeFileSync(file, JSON.stringify({ bookings:[{ id:"legacy", value:"preserved" }], blocks:[] }));
  const a = mockStore(env).store, b = mockStore(env).store;
  const old = await a.bookings.getWithVersion("legacy");
  assert.equal(old.version, "legacy");
  const results = await Promise.allSettled([a.bookings.compareAndSwap("legacy", { ...old.value, value:"one" }, old.version),
    b.bookings.compareAndSwap("legacy", { ...old.value, value:"two" }, old.version)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.statusCode, 409);
  const bootstraps = await Promise.allSettled([a.accounts.insert({ id:"test", value:"one" }), b.accounts.insert({ id:"test", value:"two" })]);
  assert.equal(bootstraps.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await b.accounts.list()).length, 1);
  fs.writeFileSync(file, "corrupt");
  await assert.rejects(a.accounts.get("test"));
  await assert.rejects(a.accounts.insert({ id:"test" }));
  assert.equal(fs.readFileSync(file,"utf8"), "corrupt");
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
  vm.runInNewContext(fs.readFileSync(require.resolve("../../app/form-config"), "utf8"), context);
  vm.runInNewContext(fs.readFileSync(require.resolve("../../app/form-schema"), "utf8"), context);
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
  assert.equal(await local.store.mode(),"local");
  const live = await local.store.formConfig(), q = live.config.questions;
  const input = { formVersion:live.version, answerValues:{ name:"Test", division:q.division.choices[0].label,
    sd_lg:q.sd_lg.choices[0], category:q.category.choices[0].label, t_tech:q.t_tech.choices[0],
    date:"2026-12-01", facilitator:q.facilitator.choices[0], time:q.time.choices[0], venue:q.venue.choices[0],
    participants:25, recommendations:"Test recommendations" } };
  await assert.rejects(local.store.create(booking), e => e.code === "FORM_EXPIRED");
  await assert.rejects(local.store.create({ ...input, answerValues:{ ...input.answerValues, participants:"25" } }), e => e.statusCode === 400);
  assert.equal(local.local.size,0, "Invalid typed submissions must not write browser data");
  const saved = await local.store.create(input);
  assert.equal(saved.requestor,"Test"); assert.equal(saved.answerValues.participants,25);
  assert.equal(saved.formVersion,live.version); assert.equal(saved.status,"Pending");
  assert.equal(saved.answerSnapshot[0].id,"name"); assert.equal(local.local.size,2);
  assert.equal(saved.historyOwner,local.local.get("sdrf_history_owner_v1"));
  assert.deepEqual(JSON.parse(local.local.get("sdrf_bookings_v2")), [JSON.parse(JSON.stringify(saved))]);
  await assert.rejects(local.store.create(input), e => e.code === "SLOT_CONFLICT");
  assert.equal(JSON.parse(local.local.get("sdrf_bookings_v2")).length,1);
  const cloud = browser("example.com","",async()=>({ok:true,headers:{get:()=>"application/json"},json:async()=>({ok:true,storage:"file"})}));
  await assert.rejects(cloud.store.mode(),/unavailable/);
});