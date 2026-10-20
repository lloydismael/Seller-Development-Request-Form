const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { harness } = require("./api-harness");
const defaults = require("../../app/form-config");
const anonymous = require("../src/anonymous");

function tableStore() {
  const rows = new Map(), queries = [];
  let version = 0;
  class TableClient {
    async createTable() {}
    async upsertEntity(entity) { rows.set(entity.rowKey, { ...entity, etag:String(++version) }); }
    async createEntity(entity) { if (rows.has(entity.rowKey)) throw { statusCode:409 }; await this.upsertEntity(entity); }
    async updateEntity(entity, mode, options) {
      if (rows.get(entity.rowKey)?.etag !== options.etag) throw { statusCode:412 };
      await this.upsertEntity(entity);
    }
    async submitTransaction(operations) {
      for (const [action, entity, , options] of operations) {
        if (action === "create" ? rows.has(entity.rowKey) : rows.get(entity.rowKey)?.etag !== options.etag) throw { statusCode:412 };
      }
      for (const [, entity] of operations) await this.upsertEntity(entity);
    }
    async getEntity(pk, id) { if (!rows.has(id)) throw { statusCode:404 }; return rows.get(id); }
    async deleteEntity(pk, id) { rows.delete(id); }
    listEntities({ queryOptions }) {
      queries.push(queryOptions.filter);
      const owner = /ownerHash eq '([a-f0-9]{64})'/.exec(queryOptions.filter)?.[1];
      const date = /createdAt lt '([^']+)'/.exec(queryOptions.filter)?.[1];
      const id = /RowKey lt '([^']+)'/.exec(queryOptions.filter)?.[1];
      return { async *[Symbol.asyncIterator]() {
        for (const e of rows.values()) if ((!owner || e.ownerHash === owner) && (!date || e.createdAt < date || (e.createdAt === date && e.rowKey < id))) yield e;
      } };
    }
  }
  const module = { exports:{} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/store"), "utf8"), {
    module, __dirname:path.resolve(__dirname, "..", "src"), process:{ env:{ STORAGE_TABLE_ENDPOINT:"https://example.table.core.windows.net" } }, URL,
    require:name => name === "./shared-production" ? { enabled:false } : name === "@azure/data-tables" ? { TableClient } : name === "@azure/identity" ? { DefaultAzureCredential:class {} } : require(name)
  });
  return { store:module.exports, rows, queries };
}
function setup() {
  const a = harness(), storage = tableStore();
  a.store.bookings = storage.store.bookings;
  const request = (method = "GET", body, cookie, query = "") => {
    const req = a.request(method, body, null, cookie ? { cookie } : {});
    req.query = new URLSearchParams(query);
    return req;
  };
  const list = (cookie, query) => a.handlers.get("myRequests")(request("GET", null, cookie, query));
  const get = (id, cookie) => { const req = request("GET", null, cookie); req.params.id = id; return a.handlers.get("myRequest")(req); };
  const submit = async cookie => a.handlers.get("bookings")(request("POST", {
    formVersion:(await a.forms.published()).version,
    answerValues:{ name:"Requestor", requesterEmail:"requestor@example.com", division:"LG Division", sd_lg:defaults.questions.sd_lg.choices[0], category:defaults.questions.category.choices[0].label,
      t_tech:"Meta Andromeda", date:"2099-12-01", facilitator:defaults.questions.facilitator.choices[0], time:defaults.questions.time.choices[0],
      venue:defaults.questions.venue.choices[0], participants:25, recommendations:"Test" }
  }, cookie));
  return { ...a, adminRequest:a.request, rows:storage.rows, queries:storage.queries, request, list, get, submit };
}
const cookieHeader = result => `${result.cookies[0].name}=${result.cookies[0].value}`;
const assertPrivate = body => {
  for (const field of ["ownerHash", "adminNotes", "updatedBy", "answerValues", "answers"]) assert.equal(Object.hasOwn(body, field), false, field);
};

test("first visit establishes identity; return visits renew the one-year cookie", async () => {
  const a = setup(), first = await a.list();
  assert.equal(first.status, 200); assert.equal(first.jsonBody.recognized, false); assert.equal(first.jsonBody.nextCursor, null);
  const c = first.cookies[0];
  assert.equal(Buffer.from(c.value, "base64url").length, 32); assert.equal(c.httpOnly, true); assert.equal(c.sameSite, "Strict");
  assert.equal(c.path, "/api"); assert.equal(c.maxAge, 31536000); assert.equal(c.secure, true); assert.equal(first.headers["Cache-Control"], "no-store");
  const second = await a.list(cookieHeader(first));
  assert.equal(second.jsonBody.recognized, true); assert.equal(second.cookies[0].value, c.value); assert.equal(second.cookies[0].maxAge, 31536000);
  a.env.NODE_ENV = "production";
  const req = a.request(); req.url = "http://localhost/api"; req.headers.set("origin", "http://localhost");
  assert.equal((await a.handlers.get("myRequests")(req)).cookies[0].secure, true);
  delete a.env.NODE_ENV;
  assert.equal((await a.handlers.get("myRequests")(req)).cookies[0].secure, false);
});

test("owned history is isolated, read-only, and excludes internals after admin changes", async () => {
  const a = setup(), first = await a.list(), cookie = cookieHeader(first), other = cookieHeader(await a.list());
  const created = await a.submit(cookie);
  assert.equal(created.status, 201); assert.equal(created.jsonBody.historyAvailable, true); assert.equal(created.jsonBody.ownerHash, undefined);
  const saved = await a.store.bookings.get(created.jsonBody.id);
  assert.match(saved.ownerHash, /^[a-f0-9]{64}$/); assert.notEqual(saved.ownerHash, first.cookies[0].value);
  assert.equal(JSON.stringify(saved).includes(first.cookies[0].value), false);
  const token = await a.login(), update = a.adminRequest("PUT", { status:"Approved", adminNotes:"Private note", ownerHash:"forged" }, token);
  update.params.id = saved.id;
  const changed = await a.handlers.get("bookingItem")(update);
  assert.equal(changed.status, 200); assert.equal(changed.jsonBody.ownerHash, undefined);
  assert.equal((await a.store.bookings.get(saved.id)).ownerHash, saved.ownerHash);
  const own = await a.list(cookie), detail = await a.get(saved.id, cookie);
  assert.equal(own.jsonBody.items.length, 1); assert.equal(own.jsonBody.items[0].status, "Approved"); assertPrivate(own.jsonBody.items[0]);
  assert.equal(detail.status, 200); assert.equal(detail.jsonBody.status, "Approved"); assertPrivate(detail.jsonBody);
  assert.deepEqual(JSON.parse(JSON.stringify(detail.jsonBody.answerSnapshot)), JSON.parse(JSON.stringify(saved.answerSnapshot)));
  assert.equal(JSON.stringify(detail.jsonBody).includes("Private note"), false);
  assert.equal((await a.list(other)).jsonBody.items.length, 0);
  for (const c of [other, undefined, "sdrf_browser=broken", `${cookie}; ${cookie}`]) assert.equal((await a.get(saved.id, c)).status, 404);
  assert.equal((await a.get("unknown", cookie)).status, 404);
  const adminList = await a.handlers.get("bookings")(a.adminRequest("GET", null, token));
  assert.equal(adminList.jsonBody[0].ownerHash, undefined);
  assert.ok(a.queries.some(q => q.includes(`ownerHash eq '${saved.ownerHash}'`)));
  await a.store.bookings.put({ id:"legacy", createdAt:saved.createdAt });
  assert.equal((await a.get("legacy", cookie)).status, 404);
});

test("cookie is persisted only on successful create, including saved audit failures", async () => {
  const a = setup();
  const invalid = await a.handlers.get("bookings")(a.request("POST", null));
  assert.equal(invalid.status, 400); assert.equal(invalid.cookies, undefined);
  const created = await a.submit(); assert.equal(created.status, 201); assert.equal(created.jsonBody.historyAvailable, false); assert.ok(created.cookies);
  const blocked = await a.list(); assert.equal(blocked.jsonBody.recognized, false); assert.equal(blocked.jsonBody.items.length, 0);
  assert.equal((await a.list(cookieHeader(created))).jsonBody.items[0].id, created.jsonBody.id);
  const reserved = await a.store.bookings.get(created.jsonBody.id);
  await a.store.bookings.put({ ...reserved, status:"Approved" });
  const conflict = await a.submit(); assert.equal(conflict.status, 409); assert.equal(conflict.cookies, undefined);
  await a.store.bookings.remove(created.jsonBody.id);
  a.store.bookings.transact = async () => { throw new Error("private credential"); };
  const failure = await a.submit(); assert.equal(failure.status, 500); assert.equal(failure.cookies, undefined); assert.equal(JSON.stringify(failure).includes("credential"), false);
  const b = setup(); b.store.activity.compareAndSwap = async () => { throw new Error("private"); };
  const auditFailure = await b.submit(); assert.equal(auditFailure.status, 201); assert.equal(auditFailure.jsonBody.auditRecorded, false); assert.ok(auditFailure.cookies);
});

test("cross-origin submissions and history fail before reads or cookie issuance", async () => {
  const a = setup();
  for (const headers of [{ origin:"https://evil.example" }, { "sec-fetch-site":"cross-site" }, { "sec-fetch-site":"same-site" }, { origin:"null" }]) {
    for (const [name, method] of [["myRequests", "GET"], ["myRequest", "GET"], ["bookings", "POST"]]) {
      const req = a.request(method, {}); for (const [k, v] of Object.entries(headers)) req.headers.set(k, v);
      const result = await a.handlers.get(name)(req);
      assert.equal(result.status, 403); assert.equal(result.cookies, undefined); assert.equal(result.headers["Cache-Control"], "no-store");
    }
  }
  assert.equal(a.reads(), 0); assert.equal(a.queries.length, 0);
  const missing = a.request(); missing.headers.delete("origin");
  assert.equal((await a.handlers.get("myRequests")(missing)).status, 200);
  a.env.ADMIN_ALLOWED_ORIGINS = "https://approved.example";
  assert.equal((await a.list()).status, 403);
  const allowed = a.request(); allowed.headers.set("origin", "https://approved.example");
  assert.equal((await a.handlers.get("myRequests")(allowed)).status, 200);
});

test("bounded keyset pagination is deterministic and queries owners rather than listing bookings", async () => {
  const a = setup(), first = await a.list(), cookie = cookieHeader(first), ownerHash = anonymous.identity(a.request("GET", null, cookie)).ownerHash;
  for (const id of ["a", "c", "b", "d"]) await a.store.bookings.put({ id, ownerHash, createdAt:id === "d" ? "2026-10-15T00:00:00.000Z" : "2026-10-14T00:00:00.000Z", status:"Pending" });
  await a.store.bookings.put({ id:"stranger", ownerHash:"a".repeat(64), createdAt:"2026-10-16T00:00:00.000Z" });
  a.store.bookings.list = () => { throw new Error("Must not list all bookings"); };
  const one = await a.list(cookie, "limit=2"); assert.deepEqual(Array.from(one.jsonBody.items, i => i.id), ["d", "c"]); assert.ok(one.jsonBody.nextCursor);
  const two = await a.list(cookie, `limit=2&cursor=${one.jsonBody.nextCursor}`); assert.deepEqual(Array.from(two.jsonBody.items, i => i.id), ["b", "a"]); assert.equal(two.jsonBody.nextCursor, null);
  assert.ok(a.queries.every(q => q.includes("PartitionKey eq 'sdrf' and ownerHash eq")));
  assert.ok(a.queries[1].includes("RowKey lt 'c'"));
  for (const query of ["limit=0", "limit=51", "limit=-1", "limit=2.5", "limit=01", "limit=1&limit=2", "cursor=", "cursor=%%%", "cursor=" + "a".repeat(513), "cursor=" + Buffer.from("{}").toString("base64url"),
    "cursor=" + anonymous.cursor({ createdAt:"2026-02-30T00:00:00.000Z", id:"a" }), "cursor=" + anonymous.cursor({ createdAt:"2026-10-14T00:00:00.000Z", id:"bad'id" })]) {
    const invalid = await a.list(cookie, query); assert.equal(invalid.status, 400, query); assert.equal(invalid.cookies, undefined);
  }
});

test("warmed-up parallel submissions share ownership without minting competing identities", async () => {
  const a = setup(), first = await a.list(), cookie = cookieHeader(first);
  // Distinct scheduling checks are outside this capability contract.
  a.store.bookings.list = async () => [];
  const results = await Promise.all([a.submit(cookie), a.submit(cookie)]);
  for (const result of results) {
    assert.equal(result.status, 201); assert.equal(cookieHeader(result), cookie);
    assert.equal((await a.get(result.jsonBody.id, cookie)).status, 200);
  }
  assert.equal((await a.list(cookie)).jsonBody.items.length, 2);
});

test("all table booking write paths maintain queryable owner properties and preserve legacy records", async () => {
  const { store, rows } = tableStore(), rec = { id:"record", ownerHash:"b".repeat(64), createdAt:"2026-10-14T00:00:00.000Z" };
  await store.bookings.insert(rec); assert.equal(rows.get(rec.id).ownerHash, rec.ownerHash);
  const initial = await store.bookings.getWithVersion(rec.id);
  await store.bookings.compareAndSwap(rec.id, { ...rec, status:"Approved" }, initial.version);
  assert.equal(rows.get(rec.id).ownerHash, rec.ownerHash); assert.equal(rows.get(rec.id).createdAt, rec.createdAt);
  await store.bookings.put({ ...rec, status:"Completed" }); assert.equal(rows.get(rec.id).ownerHash, rec.ownerHash);
  await store.bookings.put({ id:"legacy", createdAt:rec.createdAt }); assert.equal(rows.get("legacy").ownerHash, undefined);
  assert.equal((await store.bookings.listOwned(rec.ownerHash, { limit:25, after:null })).items.length, 1);
  await assert.rejects(store.bookings.listOwned("' or true", { limit:25, after:null }), /Invalid owner/);
});

test("local file owner queries retain records and deterministic pagination", async () => {
  const directory = path.join(__dirname, `.history-${require("node:crypto").randomUUID()}`);
  fs.mkdirSync(directory);
  try {
    const module = { exports:{} }, ownerHash = "c".repeat(64);
    vm.runInNewContext(fs.readFileSync(require.resolve("../src/store"), "utf8"), { module, require:name => name === "./shared-production" ? { enabled:false } : require(name), __dirname:path.resolve(__dirname, "..", "src"),
      process:{ env:{ STORAGE_TEST_FILE:path.join(directory, "db.json") } }, URL, setTimeout, console:{ warn() {} } });
    const store = module.exports;
    for (const id of ["a", "c", "b"]) await store.bookings.insert({ id, ownerHash, createdAt:"2026-10-14T00:00:00.000Z" });
    await store.bookings.put({ id:"legacy" });
    const first = await store.bookings.listOwned(ownerHash, { limit:2, after:null });
    assert.deepEqual(Array.from(first.items, i => i.id), ["c", "b"]); assert.equal(first.hasMore, true);
    const second = await store.bookings.listOwned(ownerHash, { limit:2, after:first.items[1] });
    assert.deepEqual(Array.from(second.items, i => i.id), ["a"]); assert.equal(second.hasMore, false);
    assert.equal((await store.bookings.list()).length, 4);
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});
