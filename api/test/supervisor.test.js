const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./api-harness");
const plain = value => JSON.parse(JSON.stringify(value));
const password = "Supervisor-test-password";
const fields = ["createdAt", "disabled", "facilitatorLabel", "id", "profile", "provider", "role", "updatedAt", "user"];
async function setup() {
  const h = harness(), admin = await h.login();
  const call = (name, method, input, token = admin, id = "booking-1", extra = {}) => {
    const req = h.request(method, input, token, extra); req.params.id = id;
    return h.handlers.get(name)(req);
  };
  const created = await call("supervisorAccounts", "POST", { username:"supervisor", password,
    profile:{ displayName:" Supervisor Name ", email:" supervisor@example.com ", phone:" +12345 " } });
  assert.equal(created.status, 201); assert.notEqual(created.jsonBody.auditRecorded, false);
  const login = async (user = "supervisor", pass = password) => {
    const result = await call("authLogin", "POST", { username:user, password:pass }, null);
    assert.equal(result.status, 200); return result.cookies[0].value;
  };
  const supervisor = await login();
  const facilitator = await call("facilitatorAccounts", "POST", { username:"trainer", password:"Trainer-test-password", facilitatorLabel:"Assigned" });
  assert.equal(facilitator.status, 201);
  const trainer = await login("trainer", "Trainer-test-password");
  return { h, call, admin, supervisor, trainer, account:created.jsonBody, facilitator:facilitator.jsonBody, login };
}

test("supervisor account contract is safe, admin-only and has no facilitator mapping", async () => {
  const { h, call, supervisor, trainer, account, facilitator } = await setup();
  assert.equal(account.role, "supervisor"); assert.equal(account.facilitatorLabel, "");
  assert.deepEqual(Object.keys(account).sort(), fields);
  assert.deepEqual(plain(account.profile), { displayName:"Supervisor Name", email:"supervisor@example.com", phone:"+12345" });
  const saved = await h.store.accounts.get(account.id);
  assert.equal(saved.facilitatorLabel, undefined); assert.equal(saved.credential.algorithm, "scrypt-v1");
  assert.equal(saved.credential.salt.length, 32); assert.equal(saved.credential.hash.length, 128);
  assert.equal(JSON.stringify(saved).includes(password), false);
  const directory = await h.store.accounts.get("facilitator-directory");
  assert.equal(directory.users.supervisor, account.id);
  assert.deepEqual(plain(directory.labels), { Assigned:facilitator.id });
  const list = await call("supervisorAccounts", "GET");
  assert.deepEqual(Array.from(list.jsonBody, x => x.id), [account.id]);
  assert.deepEqual(Array.from((await call("facilitatorAccounts", "GET")).jsonBody, x => x.id), [facilitator.id]);
  assert.doesNotMatch(JSON.stringify(list.jsonBody), /credential|attempts|salt|hash/);
  assert.equal((await call("health", "GET")).jsonBody.capabilities.includes("supervisor-accounts"), true);
  for (const token of [null, supervisor, trainer]) {
    const writes = h.writes();
    for (const [name, method] of [["supervisorAccounts", "GET"], ["supervisorAccounts", "POST"], ["supervisorAccount", "PUT"]])
      assert.equal((await call(name, method, {}, token, account.id)).status, 401);
    assert.equal(h.writes(), writes);
  }
  const accounts = h.load(require.resolve("../src/accounts"));
  const who = await h.auth.getIdentity(h.request("GET", null, supervisor));
  await assert.rejects(accounts.manageSupervisors(who, {}), { statusCode:403 });
  assert.equal(await h.auth.isAdmin(h.request("GET", null, supervisor)), false);
  assert.equal(await h.auth.isManagement(h.request("GET", null, supervisor)), true);
  assert.equal(await h.auth.adminUser(h.request("GET", null, supervisor)), null);
  for (const roles of [["supervisor"], ["facilitator"], ["anonymous", "supervisor"]]) {
    const principal = Buffer.from(JSON.stringify({ userRoles:roles, userId:"external", userDetails:"external", identityProvider:"aad" })).toString("base64");
    assert.equal(await h.auth.getIdentity(h.request("GET", null, null, { "x-ms-client-principal":principal })), null);
  }
});

test("account routes enforce role boundaries, validation and one transactional username namespace", async () => {
  const { h, call, supervisor, account, facilitator } = await setup();
  const base = { username:"second-supervisor", password:"Second-test-password" };
  for (const patch of [{ role:"admin" }, { role:"supervisor" }, { facilitatorLabel:"Assigned" }, { credentialVersion:10 },
    { password:"short" }, { password:"x".repeat(129) }, { disabled:"true" }, { profile:null }, { profile:[] },
    { profile:{ email:"bad" } }, { profile:{ displayName:" " } }, { username:"__proto__" }, { username:"constructor" },
    { username:"test-admin" }, { username:"trainer" }, { username:"supervisor" }]) {
    const writes = h.writes();
    assert.equal((await call("supervisorAccounts", "POST", { ...base, ...patch })).status, 400);
    assert.equal(h.writes(), writes);
  }
  for (const token of [undefined, supervisor]) {
    for (const input of [{ role:"supervisor" }, { role:"admin" }, { credentialVersion:99 }]) {
      const writes = h.writes();
      assert.equal((await call("facilitatorAccount", "PUT", input, token, facilitator.id)).status, 400);
      assert.equal((await call("facilitatorAccounts", "POST", { username:"escalated", password, facilitatorLabel:"New", ...input }, token)).status, 400);
      assert.equal(h.writes(), writes);
    }
    assert.equal((await call("facilitatorAccount", "PUT", {}, token, account.id)).status, 404);
    assert.equal((await call("facilitatorAccount", "PUT", {}, token, "local-admin")).status, 404);
    assert.equal((await call("facilitatorAccounts", "POST", { username:"supervisor", password, facilitatorLabel:"New" }, token)).status, 400);
  }
  for (const id of [facilitator.id, "local-admin", "missing"])
    assert.equal((await call("supervisorAccount", "PUT", {}, undefined, id)).status, 404);
  for (const input of [{ role:"admin" }, { facilitatorLabel:"Assigned" }, { profile:{ role:"admin" } }])
    assert.equal((await call("supervisorAccount", "PUT", input, undefined, account.id)).status, 400);
  assert.equal((await call("supervisorAccounts", "POST", base)).status, 201);
  const results = await Promise.all([
    call("supervisorAccounts", "POST", { username:"racing-user", password }),
    call("facilitatorAccounts", "POST", { username:"racing-user", password, facilitatorLabel:"Race" })
  ]);
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.ok(results.every(r => [201, 400, 409].includes(r.status)));
  assert.equal((await h.store.accounts.list()).filter(a => a.username === "racing-user").length, 1);
});

test("supervisor security updates and self-service use credential versions and safe auditing", async () => {
  const { h, call, supervisor, account, login } = await setup();
  const before = await h.store.accounts.get(account.id);
  const registry = await h.store.accounts.getWithVersion("facilitator-directory");
  assert.equal((await call("supervisorAccount", "PUT", { profile:{ email:"new@example.com" } }, undefined, account.id)).status, 200);
  assert.equal((await call("authProfile", "PUT", { displayName:"Self Name" }, supervisor)).status, 200);
  assert.equal((await call("authMe", "GET", null, supervisor)).jsonBody.role, "supervisor");
  const contact = await h.store.accounts.get(account.id);
  assert.equal(contact.credentialVersion, before.credentialVersion);
  assert.deepEqual(contact.credential, before.credential); assert.deepEqual(contact.attempts, before.attempts);
  assert.deepEqual(await h.store.accounts.getWithVersion("facilitator-directory"), registry);
  const changed = await call("authPassword", "POST", { currentPassword:password, newPassword:"Changed-supervisor-password", confirmPassword:"Changed-supervisor-password" }, supervisor);
  assert.equal(changed.status, 200); assert.equal(changed.cookies[0].maxAge, 0);
  assert.equal((await call("bookings", "GET", null, supervisor)).status, 401);
  let token = await login("supervisor", "Changed-supervisor-password");
  for (const patch of [{ password:"Reset-supervisor-password" }, { disabled:true }, { disabled:false }]) {
    assert.equal((await call("supervisorAccount", "PUT", patch, undefined, account.id)).status, 200);
    assert.equal((await call("trainingSessions", "GET", null, token)).status, 401);
    if (patch.disabled) assert.equal((await call("authLogin", "POST", { username:"supervisor", password:"Reset-supervisor-password" }, null)).status, 401);
    else token = await login("supervisor", "Reset-supervisor-password");
  }
  const events = await h.store.activity.list();
  assert.ok(events.some(e => e.action === "supervisor.update" && e.summary.includes("password reset")));
  assert.doesNotMatch(JSON.stringify(events), /Supervisor-test-password|Changed-supervisor-password|Reset-supervisor-password|supervisor@example|new@example|12345/);
  const saved = await h.store.accounts.get(account.id);
  h.store.accounts.compareAndSwap = async () => { throw Object.assign(new Error("secret-conflict"), { statusCode:409 }); };
  assert.equal((await call("supervisorAccount", "PUT", { profile:{ email:"conflict@example.com" } }, undefined, account.id)).status, 409);
  assert.deepEqual(await h.store.accounts.get(account.id), saved);
});

test("supervisors view all bookings and manage schedules, conflicts and blocks but not admin-only APIs", async () => {
  const { h, call, supervisor, trainer } = await setup();
  const booking = { id:"booking-1", status:"Pending", topic:"Other training", facilitator:"Unassigned",
    trainingDate:"2026-12-01", time:"9:00 AM - 12:00 PM", ownerHash:"private-owner", adminNotes:"" };
  await h.store.bookings.put(booking);
  await h.store.bookings.put({ ...booking, id:"booking-2", status:"Approved" });
  const all = await call("bookings", "GET", null, supervisor);
  assert.equal(all.status, 200); assert.equal(all.jsonBody.length, 2); assert.doesNotMatch(JSON.stringify(all.jsonBody), /ownerHash|private-owner/);
  assert.equal((await call("trainingSessions", "GET", null, supervisor)).jsonBody.length, 2);
  assert.equal((await call("bookingItem", "PUT", { status:"Approved" }, supervisor)).jsonBody.code, "SLOT_CONFLICT");
  const forced = await call("bookingItem", "PUT", { status:"Approved", force:true, venue:"Updated", adminNotes:"Reviewed" }, supervisor);
  assert.equal(forced.status, 200); assert.equal(forced.jsonBody.updatedBy, "supervisor");
  assert.equal((await call("bookingItem", "PUT", { status:"Completed", force:true }, supervisor)).status, 200);
  assert.equal((await call("bookingItem", "PUT", { status:"Rejected" }, supervisor, "booking-2")).status, 200);
  const block = await call("blocks", "POST", { facilitator:"Unassigned", startDate:"2026-12-02", reason:"Unavailable" }, supervisor);
  assert.equal(block.status, 201); assert.equal(block.jsonBody.createdBy, "supervisor");
  assert.equal((await call("blocks", "GET", null, supervisor)).jsonBody.length, 1);
  assert.equal((await call("blockItem", "DELETE", null, supervisor, block.jsonBody.id)).status, 200);
  assert.equal((await h.store.blocks.list()).length, 0);
  for (const [name, method] of [["bookingItem", "DELETE"], ["formDraft", "GET"], ["formDraft", "PUT"], ["formPublish", "POST"], ["activity", "GET"]]) {
    const writes = h.writes();
    assert.equal((await call(name, method, {}, supervisor)).status, 401); assert.equal(h.writes(), writes);
  }
  assert.equal((await call("bookingItem", "DELETE", null)).status, 200);
  for (const [name, method] of [["bookings", "GET"], ["bookingItem", "PUT"], ["blocks", "POST"], ["blockItem", "DELETE"], ["facilitatorAccounts", "GET"]])
    assert.equal((await call(name, method, {}, trainer)).status, 401);
  const events = await h.store.activity.list();
  assert.ok(events.some(e => e.action === "booking.update" && e.actorDetails.role === "supervisor" && e.actorDetails.accountId));
});

test("supervisors manage facilitator accounts including resets without gaining supervisor administration", async () => {
  const { h, call, supervisor, trainer, facilitator, login } = await setup();
  assert.equal((await call("facilitatorAccounts", "GET", null, supervisor)).status, 200);
  const created = await call("facilitatorAccounts", "POST", { username:"managed-trainer", password, facilitatorLabel:"Managed" }, supervisor);
  assert.equal(created.status, 201); assert.equal(created.jsonBody.role, "facilitator");
  assert.equal((await call("facilitatorAccount", "PUT", { profile:{ displayName:"Managed contact" } }, supervisor, facilitator.id)).status, 200);
  assert.equal((await call("authMe", "GET", null, trainer)).jsonBody.role, "facilitator");
  assert.equal((await call("facilitatorAccount", "PUT", { password:"Reset-trainer-password", facilitatorLabel:"Reassigned" }, supervisor, facilitator.id)).status, 200);
  assert.equal((await call("authMe", "GET", null, trainer)).jsonBody.user, null);
  const reset = await login("trainer", "Reset-trainer-password");
  assert.equal((await call("facilitatorAccount", "PUT", { disabled:true }, supervisor, facilitator.id)).status, 200);
  assert.equal((await call("trainingSessions", "GET", null, reset)).status, 401);
  assert.equal((await call("facilitatorAccount", "PUT", { disabled:false }, supervisor, facilitator.id)).status, 200);
  await login("trainer", "Reset-trainer-password");
  assert.ok((await h.store.activity.list()).some(e => e.action === "facilitator.update" && e.actorDetails.role === "supervisor"));
});

test("supervisors manage unassigned training decisions, feedback, sharing and legacy activation", async () => {
  const { h, call, supervisor } = await setup();
  await h.store.bookings.put({ id:"booking-1", topic:"Phone Videography", status:"Pending", facilitator:"Unassigned",
    trainingDate:"2026-12-01", time:"9:00 AM - 12:00 PM", venue:"Room" });
  assert.equal((await call("trainingDecision", "POST", { action:"accept" }, supervisor)).status, 200);
  assert.equal((await call("trainingComplete", "POST", {}, supervisor)).status, 200);
  const attendee = await call("trainingAttendees", "POST", { name:"Registered" }, supervisor);
  assert.equal(attendee.status, 201);
  const invitation = h.request("POST", { action:"issue" }, supervisor);
  invitation.params = { id:"booking-1", attendeeId:attendee.jsonBody.id };
  const issued = await h.handlers.get("trainingInvitation")(invitation); assert.equal(issued.status, 200);
  const token = issued.jsonBody.link.split("#")[1];
  const answers = { name:"Registered", division:"division-4", program:5, learning:4, venue:3, food:2, speaker:1, favorite:"Practice", comments:"More practice" };
  assert.equal((await call("csatSubmit", "POST", { token, answers }, null)).status, 200);
  const detail = await call("trainingSession", "GET", null, supervisor);
  assert.equal(detail.status, 200); assert.equal(detail.jsonBody.responses.length, 1); assert.equal(detail.jsonBody.averages[0].average, 5);
  assert.doesNotMatch(JSON.stringify(detail.jsonBody), /tokenHash|credential|ownerHash/);
  assert.equal((await call("trainingSharing", "GET", null, supervisor)).jsonBody.state, "open");
  for (const action of ["rotate", "revoke", "reactivate"]) assert.equal((await call("trainingSharing", "POST", { action }, supervisor)).status, 200);
  await h.store.bookings.put({ id:"legacy", topic:"Phone Videography", status:"Completed", facilitator:"Unassigned" });
  assert.equal((await call("trainingComplete", "POST", { activateLegacy:true }, supervisor, "legacy")).status, 200);
  await h.store.bookings.put({ id:"declined", topic:"Other", status:"Pending", facilitator:"Unassigned" });
  assert.equal((await call("trainingDecision", "POST", { action:"decline" }, supervisor, "declined")).jsonBody.status, "Rejected");
});

test("supervisor login throttling is bounded per account and rejects stale credential snapshots", async () => {
  const { h, call, account } = await setup();
  for (let i = 0; i < 5; i++) assert.equal((await call("authLogin", "POST", { username:"supervisor", password:"wrong" }, null)).status, 401);
  assert.equal((await call("authLogin", "POST", { username:"supervisor", password }, null)).status, 401);
  const locked = await h.store.accounts.get(account.id);
  assert.equal(locked.attempts.login.count, 5);
  assert.equal((await call("authLogin", "POST", { username:"unknown-user", password }, null)).status, 401);
  assert.deepEqual(await h.store.accounts.get(account.id), locked);
  assert.equal((await call("supervisorAccount", "PUT", { password:"Unlocked-supervisor-password" }, undefined, account.id)).status, 200);
  assert.equal((await call("authLogin", "POST", { username:"supervisor", password:"Unlocked-supervisor-password" }, null)).status, 401);
  const reset = await h.store.accounts.get(account.id);
  await h.store.accounts.put({ ...reset, attempts:{ ...reset.attempts, login:{ startedAt:Date.now() - 16 * 60 * 1000, count:5 } } });
  assert.equal((await call("authLogin", "POST", { username:"supervisor", password:"Unlocked-supervisor-password" }, null)).status, 200);
  const cas = h.store.accounts.compareAndSwap;
  h.store.accounts.compareAndSwap = async function(id, value, version) {
    const result = await cas.call(this, id, value, version);
    if (id === account.id && value.attempts?.login?.count === 1) {
      await h.store.accounts.put({ ...value, disabled:true, credentialVersion:value.credentialVersion + 1 });
    }
    return result;
  };
  assert.equal((await call("authLogin", "POST", { username:"supervisor", password:"Unlocked-supervisor-password" }, null)).status, 401);
});

test("new account and supervisor writes fail closed for CSRF, malformed input and storage failures", async () => {
  const { h, call, supervisor, account } = await setup();
  for (const [name, method, token, id] of [["supervisorAccounts", "POST", undefined], ["supervisorAccount", "PUT", undefined, account.id],
    ["facilitatorAccounts", "POST", supervisor], ["bookingItem", "PUT", supervisor], ["blocks", "POST", supervisor], ["trainingSharing", "POST", supervisor]]) {
    for (const extra of [{ "x-admin-request":"" }, { origin:"https://evil.example" }, { "sec-fetch-site":"cross-site" }]) {
      const writes = h.writes(); assert.equal((await call(name, method, {}, token, id, extra)).status, 403); assert.equal(h.writes(), writes);
    }
  }
  for (const input of [null, [], "invalid"])
    assert.equal((await call("supervisorAccounts", "POST", input)).status, 400);
  const anonymous = harness();
  for (const [name, method] of [["supervisorAccounts", "GET"], ["supervisorAccounts", "POST"], ["supervisorAccount", "PUT"]])
    assert.equal((await anonymous.handlers.get(name)(anonymous.request(method, {}))).status, 401);
  assert.equal(anonymous.reads(), 0); assert.equal(anonymous.writes(), 0);
  h.store.activity.compareAndSwap = async () => { throw new Error("private-audit-secret"); };
  const warning = await call("supervisorAccounts", "POST", { username:"audit-warning", password });
  assert.equal(warning.status, 201); assert.equal(warning.jsonBody.auditRecorded, false);
  assert.equal((await h.store.accounts.get(warning.jsonBody.id)).role, "supervisor");
  assert.doesNotMatch(JSON.stringify(warning), /private-audit-secret/);
  h.store.accounts.transact = async () => { throw new Error("private-storage-secret"); };
  const failed = await call("supervisorAccounts", "POST", { username:"storage-failure", password });
  assert.equal(failed.status, 500); assert.doesNotMatch(JSON.stringify(failed), /private-storage-secret/);
  assert.equal((await h.store.accounts.list()).some(a => a.username === "storage-failure"), false);
});
