const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const schema = require("../../app/form-schema");
const defaults = require("../../app/form-config");
const { harness } = require("./api-harness");
const clone = value => JSON.parse(JSON.stringify(value));
const config = () => schema.validate(defaults);
const values = () => ({ name:"Test Requestor", requesterEmail:"requestor@example.com", division:"LG Division", sd_lg:defaults.questions.sd_lg.choices[0], category:defaults.questions.category.choices[0].label,
  t_tech:"Meta Andromeda", date:"2026-12-01", facilitator:defaults.questions.facilitator.choices[0], time:defaults.questions.time.choices[0],
  venue:defaults.questions.venue.choices[0], participants:25, recommendations:"Test recommendations" });

test("canonical defaults/schema expose matching browser and CommonJS exports", () => {
  const browser = { window:{} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../app/form-config"), "utf8"), browser);
  vm.runInNewContext(fs.readFileSync(require.resolve("../../app/form-schema"), "utf8"), browser);
  assert.deepEqual(clone(browser.window.FORM_CONFIG), clone(defaults));
  assert.deepEqual(clone(browser.window.FormSchema.validate(browser.window.FORM_CONFIG)), config());
  assert.equal(config().questions.participants.type, "number"); assert.equal(config().questions.recommendations.type, "textarea");
});

test("glass settings normalize legacy themes without mutation and reject invalid values", () => {
  const legacy = clone(defaults), before = clone(legacy);
  const normalized = schema.validate(legacy);
  assert.deepEqual(legacy, before);
  for (const [key, value] of Object.entries(schema.GLASS_DEFAULTS)) assert.equal(normalized.theme[key], value);
  assert.ok(Object.isFrozen(schema.GLASS_DEFAULTS));
  delete legacy.theme;
  assert.equal(schema.validate(legacy).theme.glassEnabled, false);
  for (const transparency of [0, 20, 40]) for (const blur of [0, 12, 20]) {
    const c = config(); Object.assign(c.theme, { glassEnabled:true, glassTransparency:transparency, glassBlur:blur });
    assert.deepEqual(schema.validate(c).theme, c.theme);
  }
  for (const [key, invalid] of [
    ["glassEnabled", [0, 1, "true", null, undefined]],
    ["glassTransparency", [-1, 41, "20", null, undefined, NaN, Infinity]],
    ["glassBlur", [-1, 21, "12", null, undefined, NaN, Infinity]],
    ["glassUnknown", [true]]
  ]) for (const value of invalid) {
    const c = config(); c.theme[key] = value;
    assert.throws(() => schema.validate(c), { statusCode:400 }, `${key}: ${value}`);
  }
  const browser = { window:{} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../app/form-schema"), "utf8"), browser);
  const c = config(); Object.assign(c.theme, { glassEnabled:true, glassTransparency:40, glassBlur:20 });
  assert.deepEqual(clone(browser.window.FormSchema.validate(c)), schema.validate(c));
});

test("independent dark colors validate without changing legacy themes or allowing arbitrary CSS", () => {
  const c = config();
  assert.equal(c.theme.darkPrimary, undefined);
  Object.assign(c.theme, { darkPrimary:"#aAbBcC", darkBackground:"#102030" });
  assert.deepEqual(schema.validate(c).theme, c.theme);
  const packaged = require("../src/form-assets/form-schema");
  assert.deepEqual(packaged.validate(c), schema.validate(c));
  for (const key of ["darkPrimary", "darkBackground"]) for (const value of [null, 42, "#fff", "red", "url(bad)", "#abcdef00"]) {
    const bad = clone(c); bad.theme[key] = value;
    assert.throws(() => schema.validate(bad), { statusCode:400 });
  }
});

test("schema rejects unsafe keys, bounds, HTML/CSS, cycles, unreachable nodes and skipped essentials", () => {
  const changes = [
    c => { c.questions.name.next = "missing"; }, c => { c.questions.time.next = "name"; },
    c => { c.questions.division.next = "division"; }, // dormant edge must also be acyclic
    c => { c.questions.category.choices[0].goto = "facilitator"; }, c => { c.questions.name.required = false; },
    c => { c.questions.date.field = "topic"; }, c => { c.questions.facilitator.type = "text"; },
    c => { c.questions.time.allowOther = true; }, c => { c.questions.time.choices = ["13:99 PM - 1:00 PM"]; },
    c => { c.questions.time.choices = ["3:00 PM - 1:00 PM"]; }, c => { c.questions.name.title = "<script>"; },
    c => { c.questions.name.title = "constructor"; }, c => { c.theme.primary = "url(javascript:bad)"; },
    c => { c.theme.width = "100vw"; }, c => { c.questions.time.choices.push(c.questions.time.choices[0]); },
    c => { c.questions.name.field = "director"; }, c => { c.questions.recommendations.field = "requestor"; },
    c => { c.questions.project.choices[0] = { label:"A", goto:"date" }; },
    c => { c.questions.extra = { title:"Extra", type:"text" }; c.order.push("extra"); },
    c => { c.order = ["name"]; }, c => { c.questions.project.max = 4; },
    c => { c.sections = [{ id:"s", title:"A" }, { id:"s", title:"B" }]; },
    c => { c.questions.name.section = "unknown"; }, c => { c.questions.name.help = "x".repeat(1001); }
  ];
  for (const change of changes) { const c = config(); change(c); assert.throws(() => schema.validate(c), { statusCode:400 }); }
  const unsafe = config(); unsafe.questions = JSON.parse('{"__proto__":{}}');
  assert.throws(() => schema.validate(unsafe), { statusCode:400 });
  assert.throws(() => schema.size({ value:"x".repeat(15360) }), { statusCode:400 });
});

test("all default exclusive director/topic branches retain essential mappings", () => {
  const c = config();
  for (const division of c.questions.division.choices) for (const category of c.questions.category.choices) {
    const v = values(); delete v.sd_lg; delete v.t_tech;
    v.division = division.label; v[division.goto] = c.questions[division.goto].choices[0]; v.category = category.label;
    const question = c.questions[category.goto]; v[category.goto] = question.type === "multi" ? [question.choices[0]] : question.choices[0];
    const rec = schema.submission(c, v);
    assert.ok(schema.REQUIRED.every(f => !!rec[f])); assert.ok(rec.answerSnapshot.some(x => x.id === category.goto));
  }
});

test("typed submissions follow active path and preserve stable IDs, labels and multi values", () => {
  const c = config(), v = values(), rec = schema.submission(c, v);
  assert.equal(rec.requestor, v.name); assert.equal(rec.participants, "25"); assert.equal(rec.answerValues.participants, 25);
  assert.equal(rec.answers[c.questions.name.title], v.name); assert.equal(rec.answerSnapshot[0].id, "name");
  for (const change of [v => { v.sd_oj = "Inactive"; }, v => { v.unknown = "Injected"; }, v => { delete v.date; },
    v => { v.date = "2026-02-30"; }, v => { v.participants = "25"; }, v => { v.participants = -1; },
    v => { v.time = "Made up"; }, v => { v.name = {}; }, v => { v.name = " "; }, v => { v.recommendations = "x".repeat(2001); }
  ]) { const bad = values(); change(bad); assert.throws(() => schema.submission(c, bad), { statusCode:400 }); }
  const multi = values(); delete multi.t_tech; multi.category = c.questions.category.choices[4].label;
  multi.project = ["Allegra Garden Place", "Prisma Residences"];
  assert.equal(schema.submission(c, multi).topic, "Allegra Garden Place; Prisma Residences");
  multi.project.push("Allegra Garden Place"); assert.throws(() => schema.submission(c, multi));
  const other = values(); other.venue = "Other training room"; assert.equal(schema.submission(c, other).venue, "Other training room");
});

test("custom types/sections/order/theme normalize independently of explicit routing", () => {
  const c = config(); c.sections = [{ id:"details", title:"Details", description:"Safe plain text" }];
  c.questions.recommendations.next = "email";
  c.questions.email = { title:"Email", type:"email", required:true, next:"score", section:"details", help:"Help", placeholder:"you@example.com" };
  c.questions.score = { title:"Score", type:"number", min:0, max:10, next:"note" };
  c.questions.note = { title:"Note", type:"textarea", next:"extraDate" }; c.questions.extraDate = { title:"Extra date", type:"date" };
  c.order.push("email", "score", "note", "extraDate"); c.order.reverse();
  c.theme = { primary:"#123456", background:"#FFFFFF", density:"compact", width:"wide", cardStyle:"flat" };
  const normalized = schema.validate(c), v = { ...values(), email:"test@example.com", score:0, note:"Note", extraDate:"2028-02-29" };
  assert.equal(schema.submission(normalized, v).answerValues.score, 0);
  v.email = "invalid"; assert.throws(() => schema.submission(normalized, v));
});

test("create-only seed races, CAS draft conflicts, atomic publish and immutable snapshots", async () => {
  const a = harness(), seeded = await Promise.all([a.forms.published(), a.forms.published()]);
  assert.equal(seeded[0].version, seeded[1].version);
  const initial = await a.forms.draft(), changed = clone(initial.config); changed.title = "Changed form";
  Object.assign(changed.theme, { glassEnabled:true, glassTransparency:30, glassBlur:16 });
  const saves = await Promise.allSettled([a.forms.saveDraft({ config:changed, revision:initial.revision }), a.forms.saveDraft({ config:changed, revision:initial.revision })]);
  assert.equal(saves.filter(x => x.status === "fulfilled").length, 1); assert.equal(saves.find(x => x.status === "rejected").reason.statusCode, 409);
  assert.equal((await a.forms.published()).config.title, defaults.title);
  await assert.rejects(a.forms.publish({ revision:initial.revision }), { statusCode:409 });
  const saved = await a.forms.draft(), published = await a.forms.publish({ revision:saved.revision });
  assert.deepEqual(saved.config.theme, changed.theme);
  assert.deepEqual(published.config.theme, changed.theme);
  assert.deepEqual((await a.forms.published()).config.theme, changed.theme);
  assert.equal((await a.store.settings.get("form-version-" + seeded[0].version)).config.theme.glassEnabled, false);
  assert.equal(published.config.title, "Changed form"); assert.notEqual(published.version, seeded[0].version);
  assert.equal((await a.store.settings.get("form-version-" + seeded[0].version)).config.title, defaults.title);
  await assert.rejects(a.forms.booking({ formVersion:seeded[0].version, answerValues:values() }), { statusCode:409 });
  const now = await a.forms.booking({ formVersion:published.version, answerValues:values(), requestor:"Forged", answers:{ forged:"Wrong" } });
  assert.equal(now.requestor, values().name); assert.equal(now.formVersion, published.version);
  await assert.rejects(a.forms.booking({ requestor:"Legacy" }), { statusCode:409 });
});

test("snapshot/CAS failures cannot publish and persisted corruption fails closed", async () => {
  const a = harness(), before = await a.forms.published(), d = await a.forms.draft(), original = a.store.settings.compareAndSwap.bind(a.store.settings);
  a.store.settings.compareAndSwap = async (id, value, version) => { if (id.startsWith("form-version-")) throw new Error("Snapshot unavailable"); return original(id, value, version); };
  await assert.rejects(a.forms.publish({ revision:d.revision })); assert.equal((await a.forms.published()).version, before.version);
  a.store.settings.compareAndSwap = async (id, value, version) => { if (id === "form-state") throw Object.assign(new Error("State raced"), { statusCode:409 }); return original(id, value, version); };
  await assert.rejects(a.forms.publish({ revision:d.revision }), { statusCode:409 }); assert.equal((await a.forms.published()).version, before.version);
  a.store.settings.records.get("form-state").value.published.config.title = "<bad>";
  await assert.rejects(a.forms.published(), { statusCode:503 });
});

test("combined state cap rejects oversized drafts without replacing live/draft state", async () => {
  const a = harness(), before = await a.forms.published(), d = await a.forms.draft(), c = clone(d.config);
  for (const q of Object.values(c.questions)) q.help = "x".repeat(220);
  // The configuration alone fits, but co-located draft/live state does not.
  const validated = schema.validate(c); assert.ok(JSON.stringify(validated).length * 2 <= schema.MAX_BYTES);
  await assert.rejects(a.forms.saveDraft({ config:c, revision:d.revision }), { statusCode:400 });
  assert.equal((await a.forms.draft()).revision, d.revision); assert.equal((await a.forms.published()).version, before.version);
});

test("concurrent publishers have one winner and never overwrite immutable snapshots", async () => {
  const a = harness(), d = await a.forms.draft();
  const attempts = await Promise.allSettled([a.forms.publish({ revision:d.revision }), a.forms.publish({ revision:d.revision })]);
  assert.equal(attempts.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(attempts.find(x => x.status === "rejected").reason.statusCode, 409);
  const live = await a.forms.published();
  assert.equal(live.version, attempts.find(x => x.status === "fulfilled").value.version);
  const snapshot = await a.store.settings.get("form-version-" + live.version);
  await assert.rejects(a.store.settings.compareAndSwap(snapshot.id, { ...snapshot, config:{} }, null), { statusCode:409 });
});

test("every active route orders date before facilitator before time, regardless of display order", () => {
  for (const sequence of [["facilitator", "date", "time"], ["date", "time", "facilitator"], ["time", "facilitator", "date"]]) {
    const c = config();
    for (const option of c.questions.category.choices) c.questions[option.goto].next = sequence[0];
    sequence.forEach((key, index) => { c.questions[key].next = sequence[index + 1] || "venue"; });
    assert.throws(() => schema.validate(c), /trainingDate before facilitator before time/);
  }
  const branch = config();
  // One invalid branch amongst otherwise valid routes must also be rejected.
  branch.questions.t_tech.next = "alternateFacilitator";
  branch.questions.alternateFacilitator = { ...branch.questions.facilitator, next:"date" };
  branch.order.push("alternateFacilitator");
  assert.throws(() => schema.validate(branch), { statusCode:400 });
  const c = config(); c.order.reverse();
  assert.doesNotThrow(() => schema.validate(c));
});

test("malformed scheduling/schema text types are safe validation failures", () => {
  for (const value of [null, undefined, false, 7, [], {}, ["1:00 PM - 2:00 PM"]]) {
    assert.equal(schema.validTime(value), false);
    assert.equal(schema.validDate(value), false);
  }
  for (const key of ["name", "date", "facilitator", "time", "venue", "recommendations"]) {
    for (const value of [false, 7, [], {}, ["text"]]) {
      const v = values(); v[key] = value;
      assert.throws(() => schema.submission(config(), v), { statusCode:400 });
    }
  }
  for (const key of ["title", "help", "placeholder"]) {
    for (const value of [null, false, 7, [], {}]) {
      const c = config(); c.questions.name[key] = value;
      assert.throws(() => schema.validate(c), { statusCode:400 });
    }
  }
});

test("custom number/multi bounds, optional blanks and date validation match submission types", () => {
  const c = config(); c.questions.recommendations.next = "score";
  c.questions.score = { title:"Score", type:"number", min:0, max:10, next:"tags" };
  c.questions.tags = { title:"Tags", type:"multi", choices:["A", "B", "C"], min:2, max:2, next:"extraDate" };
  c.questions.extraDate = { title:"Extra date", type:"date", next:"email" };
  c.questions.email = { title:"Email", type:"email", next:"note" };
  c.questions.note = { title:"Optional note", type:"textarea" };
  c.order.push("score", "tags", "extraDate", "email", "note");
  const normalized = schema.validate(c);
  const good = { ...values(), score:0, tags:["A", "B"], extraDate:"2000-02-29", email:"a@example.com", note:"" };
  assert.equal(schema.submission(normalized, good).answerValues.score, 0);
  assert.equal(schema.submission(normalized, { ...values(), score:10 }).answerValues.score, 10);
  for (const [key, value] of [["score", -1], ["score", 11], ["score", "5"], ["score", []], ["tags", ["A"]],
    ["tags", ["A", "B", "C"]], ["tags", ["A", "A"]], ["tags", {}], ["extraDate", "2001-02-29"],
    ["extraDate", []], ["email", "invalid"], ["note", {}]]) {
    assert.throws(() => schema.submission(normalized, { ...good, [key]:value }), { statusCode:400 });
  }
  const blank = schema.submission(normalized, { ...values(), score:"", tags:[], extraDate:null, email:"", note:null });
  for (const key of ["score", "tags", "extraDate", "email", "note"]) assert.equal(blank.answerValues[key], undefined);
});