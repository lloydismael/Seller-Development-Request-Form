const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./api-harness");
const config = require("../../app/csat-config");
const schema = require("../../app/csat-schema");
const answer = (division = "division-4") => ({ name:"Attendee", division, ...(config.branches[division] ? { director:config.branches[division].choices[0].id } : {}), program:5, learning:4, venue:3, food:2, speaker:1, favorite:"Practice", comments:"More practice" });
async function setup() {
  const h = harness(), admin = await h.login();
  const call = (name, method, body, token = admin, params = {}) => { const req = h.request(method, body, token); req.params = { id:"training-1", ...params }; return h.handlers.get(name)(req); };
  await h.store.bookings.put({ id:"training-1", topic:"Phone Videography", status:"Approved", facilitator:"Arwee P. Cancino", trainingDate:"2026-12-01", time:"9:00 AM - 12:00 PM", venue:"Room" });
  const created = await call("facilitatorAccounts", "POST", { username:"trainer", password:"Facilitator-test-123", facilitatorLabel:"Arwee P. Cancino" });
  assert.equal(created.status, 201); assert.notEqual(created.jsonBody.auditRecorded, false);
  const login = await call("authLogin", "POST", { username:"trainer", password:"Facilitator-test-123" }, null);
  assert.equal(login.status, 200); assert.equal(login.jsonBody.role, "facilitator");
  return { h, call, admin, facilitator:login.cookies[0].value, account:created.jsonBody };
}
test("source fidelity and all division routes validate", () => {
  assert.equal(config.divisions.length, 6);
  assert.equal(config.branches["division-4"], undefined);
  const duplicates = config.branches["division-2"].choices.filter(c => c.label === "Wally Cruz");
  assert.equal(duplicates.length, 2); assert.notEqual(duplicates[0].id, duplicates[1].id);
  for (const d of config.divisions) assert.equal(schema.validate(answer(d.id)).version, config.version);
  for (const key of ["name", "comments", "favorite"]) assert.throws(() => schema.validate({ ...answer(), [key]:" " }));
  for (const value of [0,6,1.5,"5",null]) assert.throws(() => schema.validate({ ...answer(), program:value }));
  assert.throws(() => schema.validate({ ...answer(), director:"lg-1" }));
  assert.throws(() => schema.validate({ ...answer("division-1"), director:"oj-1" }));
});
test("facilitator authentication never grants administrator APIs", async () => {
  const { call, facilitator, h } = await setup();
  for (const [name, method] of [["bookings","GET"],["bookingItem","PUT"],["blocks","GET"],["formDraft","GET"],["activity","GET"],["facilitatorAccounts","GET"]]) assert.notEqual((await call(name, method, {}, facilitator)).status, 200, name);
  assert.equal((await call("authProfile", "GET", null, facilitator)).status, 200);
  await h.store.bookings.put({ id:"unassigned", facilitator:"Someone else", topic:"Phone Videography", status:"Approved" });
  const list = await call("trainingSessions", "GET", null, facilitator);
  assert.deepEqual(Array.from(list.jsonBody, x => x.id), ["training-1"]);
  assert.equal((await call("trainingSession", "GET", null, facilitator, { id:"unassigned" })).status, 404);
});
test("completion, invitations, one response and scoped results", async () => {
  const { call, facilitator, h } = await setup();
  const attendee = await call("trainingAttendees", "POST", { name:"Registered" }, facilitator);
  assert.equal(attendee.status, 201);
  const params = { attendeeId:attendee.jsonBody.id };
  assert.equal((await call("trainingInvitation", "POST", { action:"issue" }, facilitator, params)).status, 400);
  assert.equal((await call("trainingComplete", "POST", {}, facilitator)).status, 200);
  assert.equal((await call("trainingComplete", "POST", {}, facilitator)).status, 200);
  const issued = await call("trainingInvitation", "POST", { action:"issue" }, facilitator, params);
  const token = issued.jsonBody.link.split("#")[1];
  assert.equal((await call("csatSurvey", "POST", { token }, null)).jsonBody.state, "open");
  assert.equal((await call("csatSubmit", "POST", { token, answers:answer() }, null)).status, 200);
  assert.equal((await call("csatSubmit", "POST", { token, answers:answer() }, null)).jsonBody.alreadySubmitted, true);
  assert.equal((await call("trainingInvitation", "POST", { action:"issue" }, facilitator, params)).status, 400);
  const detail = await call("trainingSession", "GET", null, facilitator);
  assert.equal(detail.jsonBody.responses.length, 1); assert.equal(detail.jsonBody.averages[0].average, 5);
  assert.doesNotMatch(JSON.stringify(detail.jsonBody), /tokenHash|credential|ownerHash/);
  assert.equal((await h.store.bookings.list()).length, 1);
});
test("revocation, reissue, closed sessions and duplicate concurrent responses", async () => {
  const { call, facilitator, h } = await setup();
  await call("trainingComplete", "POST", {}, facilitator);
  const a = await call("trainingAttendees", "POST", { name:"Registered" }, facilitator), params = { attendeeId:a.jsonBody.id };
  const first = await call("trainingInvitation", "POST", { action:"issue" }, facilitator, params);
  const second = await call("trainingInvitation", "POST", { action:"issue" }, facilitator, params);
  assert.equal((await call("csatSurvey", "POST", { token:first.jsonBody.link.split("#")[1] }, null)).status, 404);
  const token = second.jsonBody.link.split("#")[1];
  const booking = await h.store.bookings.get("training-1");
  await h.store.bookings.put({ ...booking, status:"Cancelled" });
  assert.equal((await call("csatSubmit", "POST", { token, answers:answer() }, null)).status, 400);
  await h.store.bookings.put(booking);
  const replies = await Promise.all([call("csatSubmit", "POST", { token, answers:answer() }, null), call("csatSubmit", "POST", { token, answers:answer() }, null)]);
  assert.ok(replies.some(r => r.status === 200));
  assert.ok(replies.every(r => [200,409].includes(r.status)));
  assert.equal((await call("trainingSession", "GET", null, facilitator)).jsonBody.responses.length, 1);
});
test("disabled/reset accounts invalidate sessions and mapping prevents duplicate accounts", async () => {
  const { call, facilitator, account } = await setup();
  assert.equal((await call("facilitatorAccounts", "POST", { username:"other", password:"Other-test-password", facilitatorLabel:account.facilitatorLabel })).status, 400);
  assert.equal((await call("facilitatorAccount", "PUT", { disabled:true }, undefined, { id:account.id })).status, 200);
  assert.equal((await call("trainingSessions", "GET", null, facilitator)).status, 401);
  assert.equal((await call("authLogin", "POST", { username:"trainer", password:"Facilitator-test-123" }, null)).status, 401);
  await call("facilitatorAccount", "PUT", { disabled:false, password:"Replacement-test-123" }, undefined, { id:account.id });
  assert.equal((await call("authLogin", "POST", { username:"trainer", password:"Replacement-test-123" }, null)).status, 200);
});
test("invitation revocation and facilitator reassignment are effective immediately", async () => {
  const { call, facilitator, account } = await setup();
  await call("trainingComplete", "POST", {}, facilitator);
  const a = await call("trainingAttendees", "POST", { name:"Registered" }, facilitator), params = { attendeeId:a.jsonBody.id };
  const issued = await call("trainingInvitation", "POST", { action:"issue" }, facilitator, params);
  await call("trainingInvitation", "POST", { action:"revoke" }, facilitator, params);
  assert.equal((await call("csatSubmit", "POST", { token:issued.jsonBody.link.split("#")[1], answers:answer() }, null)).status, 404);
  await call("facilitatorAccount", "PUT", { facilitatorLabel:"Cladine I. Francia" }, undefined, { id:account.id });
  assert.equal((await call("trainingSession", "GET", null, facilitator)).status, 401);
  const login = await call("authLogin", "POST", { username:"trainer", password:"Facilitator-test-123" }, null);
  assert.equal((await call("trainingSession", "GET", null, login.cookies[0].value)).status, 404);
});

test("assigned facilitators accept or decline Pending bookings only", async () => {
  const { call, facilitator, h } = await setup();
  const booking = await h.store.bookings.get('training-1');
  await h.store.bookings.put({ ...booking, status:'Pending' });
  const accepted = await call('trainingDecision','POST',{action:'accept'},facilitator);
  assert.equal(accepted.status,200); assert.equal(accepted.jsonBody.status,'Approved'); assert.notEqual(accepted.jsonBody.auditRecorded,false);
  assert.equal((await call('trainingDecision','POST',{action:'decline'},facilitator)).status,409);
  await h.store.bookings.put({ ...booking, status:'Pending' });
  assert.equal((await call('trainingDecision','POST',{action:'decline'},null)).status,401);
  await h.store.bookings.put({ ...booking, id:'other', facilitator:'Someone else', status:'Pending' });
  assert.equal((await call('trainingDecision','POST',{action:'accept'},facilitator,{id:'other'})).status,404);
  const declined = await call('trainingDecision','POST',{action:'decline'},facilitator);
  assert.equal(declined.status,200); assert.equal(declined.jsonBody.status,'Rejected');
  assert.equal((await h.store.bookings.get('training-1')).decidedBy.startsWith('fac-'),true);
});

test("pending and legacy completed sessions require explicit permitted transitions", async () => {
  const { call, facilitator, h } = await setup();
  const b = await h.store.bookings.get("training-1");
  await h.store.bookings.put({ ...b, status:"Pending" });
  assert.equal((await call("trainingComplete", "POST", {}, facilitator)).status, 400);
  await h.store.bookings.put({ ...b, status:"Completed" });
  assert.equal((await call("trainingComplete", "POST", {}, facilitator)).status, 400);
  assert.equal((await call("trainingComplete", "POST", { activateLegacy:true }, facilitator)).status, 400);
  assert.equal((await call("trainingComplete", "POST", { activateLegacy:true })).status, 200);
});
