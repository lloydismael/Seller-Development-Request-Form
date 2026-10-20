const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./api-harness");

async function setup() {
  const h = harness(), admin = await h.login();
  const call = (name, method, input, token = admin, id) => {
    const req = h.request(method, input, token);
    if (id) req.params.id = id;
    return h.handlers.get(name)(req);
  };
  const created = await call("facilitatorAccounts", "POST", { username:"trainer", password:"Initial-test-password", facilitatorLabel:"Private assignment" });
  assert.equal(created.status, 201);
  const login = async password => {
    const result = await call("authLogin", "POST", { username:"trainer", password }, null);
    assert.equal(result.status, 200);
    return result.cookies[0].value;
  };
  return { h, call, admin, account:created.jsonBody, login };
}
const publicKeys = ["createdAt", "disabled", "facilitatorLabel", "id", "profile", "provider", "role", "updatedAt", "user"];
const plain = value => JSON.parse(JSON.stringify(value));

const invalidProfiles = [null, [], "contact", { unknown:"private" }, { displayName:" " },
  { displayName:"x".repeat(101) }, { email:"bad-email" }, { email:"x".repeat(255) },
  { email:42 }, { phone:"letters" }, { phone:"1".repeat(33) }, { phone:"123\n456" }];

test("admin create validates and projects contact profiles without changing generic identity", async () => {
  const { h, call } = await setup();
  const input = { username:"contact-trainer", password:"Contact-test-password", facilitatorLabel:"Contact assignment" };
  for (const profile of invalidProfiles) {
    const writes = h.writes();
    const result = await call("facilitatorAccounts", "POST", { ...input, profile });
    assert.equal(result.status, 400);
    assert.equal(h.writes(), writes);
  }
  const created = await call("facilitatorAccounts", "POST", { ...input,
    profile:{ displayName:" Contact Person ", email:" person@example.com ", phone:" +1 (234) 567-890 " } });
  assert.equal(created.status, 201);
  assert.deepEqual(plain(created.jsonBody.profile), { displayName:"Contact Person", email:"person@example.com", phone:"+1 (234) 567-890" });
  assert.deepEqual(Object.keys(created.jsonBody).sort(), publicKeys);
  const empty = await call("facilitatorAccounts", "POST", { ...input, username:"empty-trainer", facilitatorLabel:"Empty assignment", profile:{ email:"", phone:" " } });
  assert.equal(empty.status, 201);
  assert.deepEqual(plain(empty.jsonBody.profile), { displayName:"Empty assignment", email:"", phone:"" });
  assert.doesNotMatch(JSON.stringify(await h.store.activity.list()), /Contact Person|person@example|234/);
});

test("admin contact-only updates use account CAS, preserve sessions and do not expose contacts in audit", async () => {
  const { h, call, account, login } = await setup();
  const token = await login("Initial-test-password");
  const before = await h.store.accounts.get(account.id);
  const directory = await h.store.accounts.getWithVersion("facilitator-directory");
  let swaps = 0;
  const cas = h.store.accounts.compareAndSwap;
  h.store.accounts.compareAndSwap = async function(id, value, version) { swaps++; assert.equal(id, account.id); return cas.call(this, id, value, version); };
  h.store.accounts.transact = async () => { throw new Error("Contact updates must not transact"); };
  for (const profile of [{ displayName:"Private name", email:"private@example.com", phone:"+123456" }, { email:"", phone:" " }, {}]) {
    const result = await call("facilitatorAccount", "PUT", { profile }, undefined, account.id);
    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.jsonBody).sort(), publicKeys);
    const saved = await h.store.accounts.get(account.id);
    assert.equal(saved.credentialVersion, before.credentialVersion);
    assert.deepEqual(saved.credential, before.credential);
    assert.deepEqual(saved.attempts, before.attempts);
    assert.deepEqual(await h.store.accounts.getWithVersion("facilitator-directory"), directory);
    const identity = await h.auth.getIdentity(h.request("GET", null, token));
    assert.equal(identity.id, account.id);
    assert.deepEqual(plain(identity.profile), plain(result.jsonBody.profile));
    assert.deepEqual(Object.keys(identity).sort(), ["credentialVersion", "disabled", "facilitatorLabel", "id", "profile", "provider", "role", "user"]);
    assert.deepEqual(Object.keys((await call("authMe", "GET", null, token)).jsonBody).sort(), ["facilitatorLabel", "id", "profile", "provider", "role", "user"]);
    assert.equal((await h.store.activity.list()).at(-1).summary, "Facilitator account updated; profile updated");
  }
  assert.equal(swaps, 3);
  const saved = await h.store.accounts.get(account.id);
  assert.deepEqual(saved.profile, { displayName:"Private name", email:"", phone:"" });
  assert.doesNotMatch(JSON.stringify(await h.store.activity.list()), /Private name|private@example|123456|sessions invalidated/);
  for (const profile of invalidProfiles) {
    const writes = h.writes();
    assert.equal((await call("facilitatorAccount", "PUT", { profile }, undefined, account.id)).status, 400);
    assert.equal(h.writes(), writes);
  }
  h.store.accounts.compareAndSwap = async () => { throw Object.assign(new Error("CAS conflict"), { statusCode:409 }); };
  assert.equal((await call("facilitatorAccount", "PUT", { profile:{ email:"new@example.com" } }, undefined, account.id)).status, 409);
  assert.deepEqual(await h.store.accounts.get(account.id), saved);
});

test("self-service admin and facilitator profiles retain sessions; facilitator cannot manage contacts", async () => {
  const { h, call, admin, account, login } = await setup();
  const facilitator = await login("Initial-test-password");
  for (const token of [admin, facilitator]) {
    const identity = await h.auth.getIdentity(h.request("GET", null, token));
    const before = await h.store.accounts.get(identity.id);
    for (const profile of invalidProfiles) {
      const writes = h.writes();
      assert.equal((await call("authProfile", "PUT", profile, token)).status, 400);
      assert.equal(h.writes(), writes);
    }
    for (const profile of [{ displayName:"Self contact", email:"self@example.com", phone:"12345" }, { email:"", phone:"" }]) {
      const result = await call("authProfile", "PUT", profile, token);
      assert.equal(result.status, 200);
      const current = await h.auth.getIdentity(h.request("GET", null, token));
      assert.equal(current.credentialVersion, identity.credentialVersion);
      assert.deepEqual(Object.keys(current).sort(), Object.keys(identity).sort());
      assert.deepEqual(plain(current.profile), plain(result.jsonBody.profile));
      const saved = await h.store.accounts.get(identity.id);
      assert.deepEqual(saved.credential, before.credential);
      assert.deepEqual(saved.attempts, before.attempts);
    }
  }
  const writes = h.writes();
  assert.equal((await call("facilitatorAccount", "PUT", { profile:{ email:"other@example.com" } }, facilitator, account.id)).status, 401);
  assert.equal((await call("facilitatorAccounts", "POST", { profile:{ email:"other@example.com" } }, facilitator)).status, 401);
  const accounts = h.load(require.resolve("../src/accounts"));
  const who = await h.auth.getIdentity(h.request("GET", null, facilitator));
  await assert.rejects(accounts.manageFacilitators(who, { profile:{ phone:"123" } }, account.id), { statusCode:403 });
  assert.equal(h.writes(), writes);
  const events = await h.store.activity.list();
  assert.doesNotMatch(JSON.stringify(events), /self@example|12345|other@example/);
  assert.doesNotMatch(JSON.stringify(events.map(event => event.summary)), /Self contact|self@example|12345|other@example/);
  assert.ok(events.some(event => event.actorDetails?.name === "Self contact"));
});

test("contact updates combined with security saves still invalidate sessions", async () => {
  const { h, call, account, login } = await setup();
  let password = "Initial-test-password";
  for (const patch of [{ facilitatorLabel:"Changed assignment" }, { disabled:false }, { password:"Changed-test-password" }]) {
    const token = await login(password);
    const before = await h.store.accounts.get(account.id);
    const result = await call("facilitatorAccount", "PUT", { ...patch, profile:{ email:"combined@example.com" } }, undefined, account.id);
    assert.equal(result.status, 200);
    assert.equal((await h.store.accounts.get(account.id)).credentialVersion, before.credentialVersion + 1);
    assert.equal(await h.auth.getIdentity(h.request("GET", null, token)), null);
    assert.equal(result.jsonBody.profile.email, "combined@example.com");
    assert.match((await h.store.activity.list()).at(-1).summary, /; profile updated; sessions invalidated$/);
    if (patch.password) password = patch.password;
  }
  assert.doesNotMatch(JSON.stringify(await h.store.activity.list()), /combined@example|Changed assignment|Changed-test-password/);
});

test("management metadata is safely projected without extending authentication identity", async () => {
  const { h, call, account, login } = await setup();
  assert.deepEqual(Object.keys(account).sort(), publicKeys);
  const saved = await h.store.accounts.get(account.id);
  assert.equal(account.createdAt, saved.createdAt);
  assert.equal(account.updatedAt, saved.updatedAt);
  assert.match(account.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  const token = await login("Initial-test-password");
  const identity = await h.auth.getIdentity(h.request("GET", null, token));
  assert.deepEqual(Object.keys(identity).sort(), ["credentialVersion", "disabled", "facilitatorLabel", "id", "profile", "provider", "role", "user"]);
  const me = await call("authMe", "GET", null, token);
  assert.equal(Object.hasOwn(me.jsonBody, "createdAt"), false);
  assert.equal(Object.hasOwn(me.jsonBody, "updatedAt"), false);
  await h.store.accounts.put({ ...saved, createdAt:"2020-01-02T03:04:05.000Z", updatedAt:"2020-01-02T03:04:05.000Z", internalSecret:"storage-secret" });
  const changed = await call("facilitatorAccount", "PUT", { disabled:false }, undefined, account.id);
  assert.equal(changed.status, 200);
  assert.equal(changed.jsonBody.createdAt, "2020-01-02T03:04:05.000Z");
  assert.notEqual(changed.jsonBody.updatedAt, "2020-01-02T03:04:05.000Z");
  assert.deepEqual(Object.keys(changed.jsonBody).sort(), publicKeys);
  const list = await call("facilitatorAccounts", "GET");
  assert.deepEqual(plain(list.jsonBody), [plain(changed.jsonBody)]);
  assert.doesNotMatch(JSON.stringify(list.jsonBody), /credential|attempts|storage-secret|Initial-test-password/);
  for (const malformed of [undefined, "storage-secret", { secret:"storage-secret" }, "2026-02-30T00:00:00.000Z"]) {
    await h.store.accounts.put({ ...saved, createdAt:malformed, updatedAt:malformed });
    const legacy = await call("facilitatorAccounts", "GET");
    assert.equal(legacy.jsonBody[0].createdAt, null);
    assert.equal(legacy.jsonBody[0].updatedAt, null);
  }
});

test("target filter is validated and combined before pagination, with only public audit fields", async () => {
  const { h, admin, account } = await setup();
  const activity = async query => {
    const req = h.request("GET", null, admin); req.query = new URLSearchParams(query);
    return h.handlers.get("activity")(req);
  };
  for (let i = 0; i < 60; i++) await h.store.activity.put({ id:`event-${String(i).padStart(3, "0")}`, action:"facilitator.update", actor:"admin", target:i % 2 ? account.id : "fac-unrelated", timestamp:`2099-01-01T00:00:${String(i).padStart(2, "0")}.000Z`, summary:i % 2 ? "password reset" : "Unrelated private information", internalSecret:"storage-secret" });
  await h.store.activity.put({ id:"old", action:"facilitator.update", actor:"admin", target:account.id, timestamp:"2000-01-01T00:00:00.000Z", summary:"Old" });
  await h.store.activity.put({ id:"other-action", action:"profile.update", actor:"admin", target:account.id, timestamp:"2099-01-01T00:01:00.000Z", summary:"Other action" });
  const query = `target=${account.id}&action=facilitator.update&from=2099-01-01`;
  const first = await activity(query), second = await activity(query + "&page=2");
  assert.equal(first.status, 200); assert.equal(first.jsonBody.page, 1);
  assert.equal(first.jsonBody.items.length, 25); assert.equal(first.jsonBody.hasMore, true);
  assert.equal(second.jsonBody.items.length, 5); assert.equal(second.jsonBody.hasMore, false);
  const all = [...first.jsonBody.items, ...second.jsonBody.items];
  assert.equal(new Set(all.map(x => x.id)).size, 30);
  assert.deepEqual(all.map(x => x.id), Array.from({ length:30 }, (_, i) => `event-${String(59 - i * 2).padStart(3, "0")}`));
  for (const item of all) {
    assert.equal(item.target, account.id);
    assert.deepEqual(Object.keys(item).sort(), ["action", "actor", "actorDetails", "id", "source", "sourceUnavailable", "summary", "target", "timestamp"]);
  }
  assert.doesNotMatch(JSON.stringify(all), /Unrelated|storage-secret|Other action/);
  const missing = await activity("target=fac-missing");
  assert.equal(missing.status, 200); assert.equal(missing.jsonBody.items.length, 0); assert.equal(missing.jsonBody.hasMore, false);
  let activityReads = 0;
  const listActivity = h.store.activity.list;
  h.store.activity.list = async () => { activityReads++; return listActivity(); };
  for (const target of ["", "../secret", "with spaces", "bad'filter", "bad\nvalue", "x".repeat(129)]) {
    assert.equal((await activity(`target=${encodeURIComponent(target)}`)).status, 400);
    assert.equal(activityReads, 0);
  }
  assert.equal((await activity(`target=${account.id}&target=fac-unrelated`)).status, 400);
});

test("update summaries describe field presence, stay nonsecret and preserve revocation and assignment uniqueness", async () => {
  const { h, call, account, login } = await setup();
  let password = "Initial-test-password", token = await login(password);
  const patches = [
    [{ password:"Replacement-test-password" }, "password reset"],
    [{ disabled:true }, "account disabled"],
    [{ disabled:false }, "account enabled"],
    [{ facilitatorLabel:"New private assignment" }, "assignment updated"],
    [{ password:"Combined-test-password", disabled:false, facilitatorLabel:"Final private assignment" }, "password reset; account enabled; assignment updated"],
    [{}, ""]
  ];
  for (const [patch, changes] of patches) {
    const result = await call("facilitatorAccount", "PUT", patch, undefined, account.id);
    assert.equal(result.status, 200);
    const events = (await h.store.activity.list()).filter(x => x.action === "facilitator.update");
    assert.equal(events.at(-1).summary, "Facilitator account updated" + (changes ? "; " + changes : "") + "; sessions invalidated");
    assert.equal(events.at(-1).target, account.id);
    assert.equal(await h.auth.getIdentity(h.request("GET", null, token)), null);
    if (patch.password) password = patch.password;
    if (!patch.disabled) token = await login(password);
  }
  assert.doesNotMatch(JSON.stringify(await h.store.activity.list()), /Initial-test-password|Replacement-test-password|Combined-test-password|private assignment|email|phone|credential/);
  const writes = h.writes();
  assert.equal((await call("facilitatorAccounts", "POST", { username:"trainer", password:"Another-test-password", facilitatorLabel:"Other" })).status, 400);
  assert.equal((await call("facilitatorAccounts", "POST", { username:"other", password:"Another-test-password", facilitatorLabel:"Final private assignment" })).status, 400);
  assert.equal((await call("facilitatorAccount", "PUT", { profile:{ email:"invalid-email" } }, undefined, account.id)).status, 400);
  assert.equal((await call("facilitatorAccount", "PUT", {}, undefined, "local-admin")).status, 404);
  assert.equal(h.writes(), writes);
  for (const denied of [null, token]) {
    const reads = h.reads(), writes = h.writes();
    for (const [name, method] of [["facilitatorAccounts", "GET"], ["facilitatorAccounts", "POST"], ["facilitatorAccount", "PUT"], ["activity", "GET"]]) assert.equal((await call(name, method, {}, denied, account.id)).status, 401);
    assert.equal(h.writes(), writes);
    if (!denied) assert.equal(h.reads(), reads);
  }
});
