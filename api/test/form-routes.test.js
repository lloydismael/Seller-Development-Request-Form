const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./api-harness");
const defaults = require("../../app/form-config");
const values = () => ({ name:"Requestor", division:"LG Division", sd_lg:defaults.questions.sd_lg.choices[0], category:defaults.questions.category.choices[0].label,
  t_tech:"Meta Andromeda", date:"2026-12-01", facilitator:defaults.questions.facilitator.choices[0], time:defaults.questions.time.choices[0],
  venue:defaults.questions.venue.choices[0], participants:25, recommendations:"Test" });

test("public/draft/publish routes enforce versions, validation and auditing", async () => {
  const a = harness(), token = await a.login();
  const live = await a.handlers.get("formConfig")(a.request("GET")); assert.equal(live.status, 200); assert.ok(live.jsonBody.version);
  const initial = await a.handlers.get("formDraft")(a.request("GET", null, token));
  const config = JSON.parse(JSON.stringify(initial.jsonBody.config)); config.title = "New title";
  const saved = await a.handlers.get("formDraft")(a.request("PUT", { config, revision:initial.jsonBody.revision }, token));
  assert.equal(saved.status, 200); assert.notEqual(saved.jsonBody.revision, initial.jsonBody.revision);
  assert.equal((await a.handlers.get("formDraft")(a.request("PUT", { config, revision:initial.jsonBody.revision }, token))).status, 409);
  assert.equal((await a.handlers.get("formConfig")(a.request("GET"))).jsonBody.config.title, defaults.title);
  assert.equal((await a.handlers.get("formPublish")(a.request("POST", { revision:initial.jsonBody.revision }, token))).status, 409);
  const published = await a.handlers.get("formPublish")(a.request("POST", { revision:saved.jsonBody.revision }, token));
  assert.equal(published.status, 200); assert.equal(published.jsonBody.config.title, "New title");
  assert.equal((await a.handlers.get("formPublish")(a.request("POST", { revision:saved.jsonBody.revision }, token))).status, 409);
  const events = await a.store.activity.list();
  assert.equal(events.filter(x => x.action === "form.draft").length, 1); assert.equal(events.filter(x => x.action === "form.publish").length, 1);
});

test("bookings reject old clients, derive typed records and retain immutable answer history", async () => {
  const a = harness(), token = await a.login(), live = await a.forms.published();
  const old = await a.handlers.get("bookings")(a.request("POST", { requestor:"Old request" }));
  assert.equal(old.status, 409); assert.match(old.jsonBody.error, /formVersion.*answerValues/);
  assert.equal(old.jsonBody.code, "FORM_EXPIRED");
  const b = { formVersion:live.version, answerValues:values(), requestor:"Forged", status:"Approved", answers:{ injected:"Bad" } };
  const created = await a.handlers.get("bookings")(a.request("POST", b));
  assert.equal(created.status, 201); assert.equal(created.jsonBody.requestor, "Requestor"); assert.equal(created.jsonBody.status, "Pending");
  assert.equal(created.jsonBody.answerValues.participants, 25); assert.equal(created.jsonBody.answers.injected, undefined);
  const duplicate = await a.handlers.get("bookings")(a.request("POST", b));
  assert.equal(duplicate.status, 201); assert.equal(duplicate.jsonBody.status, "Pending");
  const update = a.request("PUT", { status:"Approved", adminNotes:"Private notes" }, token); update.params.id = created.jsonBody.id;
  assert.equal((await a.handlers.get("bookingItem")(update)).status, 200);
  const reserved = await a.handlers.get("bookings")(a.request("POST", b));
  assert.equal(reserved.status, 409); assert.equal(reserved.jsonBody.code, "SLOT_CONFLICT");
  const competing = a.request("PUT", { status:"Approved" }, token); competing.params.id = duplicate.jsonBody.id;
  assert.equal((await a.handlers.get("bookingItem")(competing)).jsonBody.code, "SLOT_CONFLICT");
  const draft = await a.forms.draft(); draft.config.questions.name.title = "Renamed requestor";
  const saved = await a.forms.saveDraft({ config:draft.config, revision:draft.revision }); await a.forms.publish({ revision:saved.revision });
  const stored = await a.store.bookings.get(created.jsonBody.id); assert.equal(stored.answerSnapshot[0].title, defaults.questions.name.title);
  const deleted = a.request("DELETE", {}, token); deleted.params.id = stored.id;
  assert.equal((await a.handlers.get("bookingItem")(deleted)).status, 200);
  const events = await a.store.activity.list();
  for (const action of ["booking.create", "booking.update", "booking.delete"]) assert.ok(events.some(x => x.action === action));
  assert.equal(JSON.stringify(events).includes("Private notes"), false);
});

test("blocks audit writes; protected activity supports action/from/page filters", async () => {
  const a = harness(), token = await a.login();
  const block = await a.handlers.get("blocks")(a.request("POST", { facilitator:"Test", startDate:"2026-12-01", reason:"Sensitive reason" }, token));
  assert.equal(block.status, 201); assert.equal(block.jsonBody.createdBy, a.env.ADMIN_USERNAME);
  const remove = a.request("DELETE", null, token); remove.params.id = block.jsonBody.id;
  assert.equal((await a.handlers.get("blockItem")(remove)).status, 200);
  const audit = a.load(require.resolve("../src/audit"));
  for (let i = 0; i < 26; i++) await audit.append("form.draft", "Test", "target", "Draft saved");
  const req = a.request("GET", null, token); req.query = new URLSearchParams("action=form.draft&page=1&from=2020-01-01");
  const first = await a.handlers.get("activity")(req);
  assert.equal(first.status, 200); assert.equal(first.jsonBody.items.length, 25); assert.equal(first.jsonBody.hasMore, true);
  req.query.set("page", "2"); const second = await a.handlers.get("activity")(req);
  assert.equal(second.jsonBody.items.length, 1); assert.equal(second.jsonBody.hasMore, false);
  for (const query of ["page=0", "page=-1", "action=secret", "from=2026-02-30", "from=bad"]) {
    req.query = new URLSearchParams(query); assert.equal((await a.handlers.get("activity")(req)).status, 400);
  }
  const events = await a.store.activity.list();
  for (const action of ["block.create", "block.delete"]) assert.ok(events.some(x => x.action === action));
  assert.equal(JSON.stringify(events).includes("Sensitive reason"), false);
});

test("audit failure reports saved mutation without deceptive rollback/retry or secret errors", async () => {
  const a = harness(), token = await a.login(); a.store.activity.compareAndSwap = async () => { throw new Error("Sensitive storage credential"); };
  const profile = await a.handlers.get("authProfile")(a.request("PUT", { displayName:"Saved name" }, token));
  assert.equal(profile.status, 200); assert.equal(profile.jsonBody.auditRecorded, false); assert.match(profile.jsonBody.warning, /Mutation saved.*Do not retry/);
  assert.equal(profile.headers["X-Audit-Recorded"], "false");
  assert.equal((await a.handlers.get("authProfile")(a.request("GET", null, token))).jsonBody.profile.displayName, "Saved name");
  assert.equal(JSON.stringify(profile).includes("Sensitive storage"), false);
  const live = await a.forms.published(), booking = await a.handlers.get("bookings")(a.request("POST", { formVersion:live.version, answerValues:values() }));
  assert.equal(booking.status, 201); assert.equal(booking.jsonBody.auditRecorded, false); assert.equal((await a.store.bookings.list()).length, 1);
});

test("invalid/oversized JSON and storage errors have safe responses", async () => {
  const a = harness(), token = await a.login(), req = a.request("PUT", {}, token); req.json = async () => { throw new SyntaxError("bad"); };
  assert.equal((await a.handlers.get("formDraft")(req)).status, 400);
  assert.equal((await a.handlers.get("formDraft")(a.request("PUT", { config:"x".repeat(15360), revision:"x" }, token))).status, 400);
  a.store.bookings.list = async () => { throw new Error("Sensitive storage credential"); };
  const result = await a.handlers.get("bookings")(a.request("GET", null, token)); assert.equal(result.status, 500); assert.equal(JSON.stringify(result).includes("Sensitive"), false);
});

test("password audit failure still clears cookie after committed credential rotation", async () => {
  const a = harness(), token = await a.login();
  a.store.activity.compareAndSwap = async () => { throw new Error("Private failure"); };
  const result = await a.handlers.get("authPassword")(a.request("POST", { currentPassword:a.env.ADMIN_PASSWORD,
    newPassword:"replacement-test-password-123", confirmPassword:"replacement-test-password-123" }, token));
  assert.equal(result.status, 200); assert.equal(result.jsonBody.ok, true); assert.equal(result.jsonBody.auditRecorded, false);
  assert.equal(result.cookies[0].maxAge, 0); assert.equal(result.cookies[0].value, "");
  assert.equal((await a.handlers.get("bookings")(a.request("GET", null, token))).status, 401);
});

test("new bookings reject past UTC dates but admin edits retain historical dates", async () => {
  const a = harness(), token = await a.login(), live = await a.forms.published();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const past = await a.handlers.get("bookings")(a.request("POST", { formVersion:live.version, answerValues:{ ...values(), date:yesterday } }));
  assert.equal(past.status, 400); assert.match(past.jsonBody.error, /future training date \(UTC\)/);
  assert.equal((await a.store.bookings.list()).length, 0);
  const created = await a.handlers.get("bookings")(a.request("POST", { formVersion:live.version, answerValues:{ ...values(), date:today } }));
  assert.equal(created.status, 201);
  const update = a.request("PUT", { trainingDate:yesterday }, token); update.params.id = created.jsonBody.id;
  const edited = await a.handlers.get("bookingItem")(update);
  assert.equal(edited.status, 200); assert.equal(edited.jsonBody.trainingDate, yesterday);
});

test("API distinguishes expired forms, record races and slot conflicts without exception disclosure", async () => {
  const a = harness(), token = await a.login(), live = await a.forms.published(), draft = await a.forms.draft();
  const expired = await a.handlers.get("bookings")(a.request("POST", { formVersion:"stale", answerValues:values() }));
  assert.equal(expired.status, 409); assert.equal(expired.jsonBody.code, "FORM_EXPIRED");
  for (const [name, input, method] of [["formDraft", { config:draft.config, revision:"stale" }, "PUT"], ["formPublish", { revision:"stale" }, "POST"]]) {
    const result = await a.handlers.get(name)(a.request(method, input, token));
    assert.equal(result.status, 409); assert.equal(result.jsonBody.code, "RECORD_CONFLICT");
    assert.doesNotMatch(result.jsonBody.error, /formVersion/);
  }
  a.store.accounts.compareAndSwap = async () => { throw Object.assign(new Error("secret database version"), { statusCode:409 }); };
  const race = await a.handlers.get("authProfile")(a.request("PUT", { displayName:"Safe" }, token));
  assert.equal(race.status, 409); assert.equal(race.jsonBody.code, "RECORD_CONFLICT");
  assert.equal(JSON.stringify(race).includes("secret"), false);
  await a.store.blocks.put({ id:"test-block", facilitator:values().facilitator, startDate:values().date, endDate:values().date });
  const slot = await a.handlers.get("bookings")(a.request("POST", { formVersion:live.version, answerValues:values() }));
  assert.equal(slot.status, 409); assert.equal(slot.jsonBody.code, "SLOT_CONFLICT");
});

test("malformed schedule text and force flags fail before persistence or conflict bypass", async () => {
  const a = harness(), token = await a.login(), live = await a.forms.published();
  const created = await a.handlers.get("bookings")(a.request("POST", { formVersion:live.version, answerValues:values() }));
  assert.equal(created.status, 201);
  for (const [key, value] of [["facilitator", {}], ["time", []], ["venue", 42], ["trainingDate", {}], ["adminNotes", []], ["force", "false"]]) {
    const req = a.request("PUT", { [key]:value }, token); req.params.id = created.jsonBody.id;
    assert.equal((await a.handlers.get("bookingItem")(req)).status, 400);
  }
  const block = await a.handlers.get("blocks")(a.request("POST", { facilitator:{}, startDate:values().date }, token));
  assert.equal(block.status, 400); assert.equal((await a.store.blocks.list()).length, 0);
  assert.equal((await a.store.bookings.get(created.jsonBody.id)).facilitator, values().facilitator);
});