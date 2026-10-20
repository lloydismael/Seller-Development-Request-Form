const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./api-harness");
const defaults = require("../../app/form-config");
const plain = value => JSON.parse(JSON.stringify(value));
const auditFor = h => h.load(require.resolve("../src/audit"));
const detailsFor = who => ({ kind:"authenticated", name:who.profile.displayName, username:who.user, role:who.role, accountId:who.id });
async function event(h, action) { return (await h.store.activity.list()).findLast(x => x.action === action); }

// Every test uses VM-loaded modules and in-memory collections; no live/local data writes.
test("append keeps legacy actors and sanitizes only allowlisted actor details", async () => {
  const h = harness(), audit = auditFor(h);
  await audit.append("booking.update", "legacy-user", "target", "Saved", {
    kind:"authenticated", name:"  Display\u0000\nName  ", username:"u".repeat(300), role:"admin", accountId:"account-id",
    ip:"192.0.2.1", cookie:"private-cookie", token:"private-token", email:"private-email", nested:{ secret:"private-secret" }
  });
  const saved = await event(h, "booking.update");
  assert.equal(saved.actor, "legacy-user");
  assert.deepEqual(plain(saved.actorDetails), { kind:"authenticated", name:"DisplayName", username:"u".repeat(256), role:"admin", accountId:"account-id" });
  assert.equal(saved.source, "server");
  assert.doesNotMatch(JSON.stringify(saved), /192\.0\.2\.1|private-/);
  for (const details of [undefined, null, [], "authenticated", { kind:"forged", name:"Imposter" }]) {
    await audit.append("booking.delete", "old-admin", "target", "Deleted", details);
    assert.deepEqual(plain((await event(h, "booking.delete")).actorDetails), { kind:"unknown" });
  }
  await audit.append("booking.create", "anonymous", "target", "Submitted", { kind:"self-reported", name:42, username:{ secret:true } });
  assert.deepEqual(plain((await event(h, "booking.create")).actorDetails), { kind:"self-reported" });
  await assert.rejects(audit.append("invalid", "actor", "target", "summary"), /Unknown audit action/);
});

test("booking create snapshots validated requestor as self-reported even with an admin session", async () => {
  const h = harness(), token = await h.login();
  const input = { formVersion:(await h.forms.published()).version, requestor:"Forged requestor", actorDetails:{ kind:"authenticated", name:"Forged actor" },
    answerValues:{ name:"  Real Requestor  ", division:"LG Division", sd_lg:defaults.questions.sd_lg.choices[0], category:defaults.questions.category.choices[0].label,
      t_tech:"Meta Andromeda", date:"2099-12-01", facilitator:defaults.questions.facilitator.choices[0], time:defaults.questions.time.choices[0],
      venue:defaults.questions.venue.choices[0], participants:25, recommendations:"Test" } };
  const result = await h.handlers.get("bookings")(h.request("POST", input, token, { "x-forwarded-for":"192.0.2.1" }));
  assert.equal(result.status, 201);
  const saved = await event(h, "booking.create");
  assert.equal(saved.actor, "anonymous");
  assert.deepEqual(plain(saved.actorDetails), { kind:"self-reported", name:result.jsonBody.requestor });
  assert.equal(saved.actorDetails.name, "Real Requestor");
  const req = h.request("PUT", { status:"Approved" }, token); req.params.id = result.jsonBody.id;
  assert.equal((await h.handlers.get("bookingItem")(req)).status, 200);
  const who = await h.auth.getIdentity(req);
  assert.deepEqual(plain((await event(h, "booking.update")).actorDetails), detailsFor(who));
  req.method = "DELETE";
  assert.equal((await h.handlers.get("bookingItem")(req)).status, 200);
  h.store.bookings.get = h.store.bookings.list = async () => { throw new Error("Never reconstruct actors from bookings"); };
  const listed = await auditFor(h).list(new URLSearchParams("actor=real%20requestor&actorType=self-reported"));
  assert.equal(listed.items.length, 1);
  assert.deepEqual(plain(listed.items[0].actorDetails), plain(saved.actorDetails));
  assert.doesNotMatch(JSON.stringify(await h.store.activity.list()), /Forged|192\.0\.2\.1|sdrf_admin|sdrf_browser/);
});

test("profile and password preserve pre-mutation actor snapshots for admins and facilitators", async () => {
  for (const facilitator of [false, true]) {
    const h = harness(), admin = await h.login();
    let token = admin, password = h.env.ADMIN_PASSWORD;
    if (facilitator) {
      password = "Facilitator-test-password";
      const created = await h.handlers.get("facilitatorAccounts")(h.request("POST", { username:"trainer", password, facilitatorLabel:"Trainer" }, admin));
      assert.equal(created.status, 201);
      token = (await h.handlers.get("authLogin")(h.request("POST", { username:"trainer", password }))).cookies[0].value;
    }
    const req = h.request("PUT", { displayName:"Updated Actor", email:"private@example.com", phone:"12345" }, token);
    const before = await h.auth.getIdentity(req);
    assert.equal((await h.handlers.get("authProfile")(req)).status, 200);
    const profileEvent = await event(h, "profile.update");
    assert.equal(profileEvent.actor, before.user);
    assert.deepEqual(plain(profileEvent.actorDetails), detailsFor(before));
    const updated = await h.auth.getIdentity(req);
    req.method = "POST"; req.json = async () => ({ currentPassword:password, newPassword:"Replacement-test-password", confirmPassword:"Replacement-test-password" });
    assert.equal((await h.handlers.get("authPassword")(req)).status, 200);
    assert.equal(await h.auth.getIdentity(req), null);
    const passwordEvent = await event(h, "password.change");
    assert.equal(passwordEvent.actor, before.user);
    assert.deepEqual(plain(passwordEvent.actorDetails), detailsFor(updated));
    assert.doesNotMatch(JSON.stringify(await h.store.activity.list()), /private@example|12345|Replacement-test-password|credentialVersion|cookie|token/);
  }
});

test("facilitator mutations attribute the acting admin, not the target account", async () => {
  const h = harness(), token = await h.login(), req = h.request("POST", { username:"trainer", password:"Trainer-test-password", facilitatorLabel:"Target assignment", profile:{ displayName:"Target name", email:"target@example.com" } }, token);
  const who = await h.auth.getIdentity(req);
  const created = await h.handlers.get("facilitatorAccounts")(req);
  assert.equal(created.status, 201);
  req.method = "PUT"; req.params.id = created.jsonBody.id;
  req.json = async () => ({ password:"Reset-target-password", disabled:true, profile:{ displayName:"Changed target" } });
  assert.equal((await h.handlers.get("facilitatorAccount")(req)).status, 200);
  for (const action of ["facilitator.create", "facilitator.update"]) {
    const saved = await event(h, action);
    assert.equal(saved.actor, who.user);
    assert.equal(saved.target, created.jsonBody.id);
    assert.deepEqual(plain(saved.actorDetails), detailsFor(who));
  }
  assert.doesNotMatch(JSON.stringify(await h.store.activity.list()), /Target name|Changed target|target@example|Reset-target-password/);
});

test("actor, actorType and inclusive to filters combine before pagination; legacy remains unknown", async () => {
  const h = harness(), audit = auditFor(h);
  for (let i = 0; i < 60; i++) await h.store.activity.put({ id:`event-${String(i).padStart(2, "0")}`, action:"booking.update", actor:"legacy-user", target:i % 2 ? "wanted" : "other", timestamp:`2099-12-01T23:59:${String(i).padStart(2, "0")}.999Z`, summary:"Updated",
    actorDetails:{ kind:"authenticated", name:"Display Name", username:"trainer", accountId:"account-123", role:"facilitator", token:"secret" }, source:"server", ip:"192.0.2.1" });
  await h.store.activity.put({ id:"legacy", action:"booking.update", actor:"legacy-admin", target:"wanted", timestamp:"2099-12-01T00:00:00.000Z", summary:"Legacy", source:"192.0.2.1", cookie:"secret" });
  await h.store.activity.put({ id:"later", action:"booking.update", actor:"legacy-user", target:"wanted", timestamp:"2099-12-02T00:00:00.000Z", actorDetails:{ kind:"authenticated", name:"Display Name" } });
  const query = "actor=DISPLAY%20NAME&actorType=authenticated&action=booking.update&target=wanted&from=2099-12-01&to=2099-12-01";
  const first = await audit.list(new URLSearchParams(query)), second = await audit.list(new URLSearchParams(query + "&page=2"));
  assert.equal(first.items.length, 25); assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 5); assert.equal(second.hasMore, false);
  assert.equal(first.items[0].timestamp, "2099-12-01T23:59:59.999Z");
  for (const actor of ["TRAINER", "account-123", "legacy-user"]) assert.equal((await audit.list(new URLSearchParams(query.replace("DISPLAY%20NAME", actor)))).items.length, 25);
  const exact = await audit.list(new URLSearchParams(query.replace("to=2099-12-01", "to=2099-12-01T23:59:01.999Z")));
  assert.equal(exact.items.length, 1);
  const legacy = await audit.list(new URLSearchParams("actor=legacy-admin&actorType=unknown"));
  assert.equal(legacy.items.length, 1);
  assert.deepEqual(plain(legacy.items[0].actorDetails), { kind:"unknown" });
  assert.equal(legacy.items[0].source, "unknown");
  for (const item of [...first.items, ...legacy.items]) {
    assert.equal(item.sourceUnavailable, true);
    assert.deepEqual(Object.keys(item).sort(), ["action", "actor", "actorDetails", "id", "source", "sourceUnavailable", "summary", "target", "timestamp"]);
  }
  assert.doesNotMatch(JSON.stringify(first), /secret|192\.0\.2\.1|cookie|token/);
});

test("invalid attribution filters reject before activity reads", async () => {
  const h = harness(), audit = auditFor(h);
  h.store.activity.list = async () => { throw new Error("Invalid filters must not read storage"); };
  for (const query of ["actor=", "actor=%20", "actor=" + "x".repeat(257), "actor=%00", "actor=%0A", "actor=%7F", "actor=a&actor=b", "actorType=admin", "actorType=", "actorType=unknown&actorType=authenticated", "to=", "to=2099-02-29", "to=2099-12-01T24:00:00.000Z", "to=2099-12-01&to=2099-12-02", "from=2099-12-02&to=2099-12-01"]) {
    await assert.rejects(audit.list(new URLSearchParams(query)), error => error.statusCode === 400, query);
  }
});

test("source is an explicit safe backend category including local-shared", async () => {
  const h = harness();
  h.load(require.resolve("../src/shared-production")).enabled = true;
  await auditFor(h).append("block.delete", "admin", "block", "Deleted");
  assert.equal((await event(h, "block.delete")).source, "local-shared");
  const result = await auditFor(h).list(new URLSearchParams());
  assert.equal(result.items[0].source, "local-shared");
  assert.equal(result.items[0].sourceUnavailable, true);
});

test("audit failures still report saved mutations without exposing credentials", async () => {
  const h = harness(), token = await h.login();
  h.store.activity.compareAndSwap = async () => { throw new Error("private-token"); };
  const result = await h.handlers.get("authPassword")(h.request("POST", { currentPassword:h.env.ADMIN_PASSWORD, newPassword:"Replacement-test-password", confirmPassword:"Replacement-test-password" }, token));
  assert.equal(result.status, 200); assert.equal(result.jsonBody.auditRecorded, false);
  assert.equal(result.cookies[0].maxAge, 0);
  assert.equal(await h.auth.getIdentity(h.request("GET", null, token)), null);
  assert.doesNotMatch(JSON.stringify(result), /private-token|Replacement-test-password/);
});
