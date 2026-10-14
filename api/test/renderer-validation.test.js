const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const schema = require("../../app/form-schema");
const defaults = require("../../app/form-config");
const source = fs.readFileSync(require.resolve("../../app/app.js"), "utf8");

// Exercise actual renderer/validation functions, not a reimplementation. DOM
// boundary is deliberately minimal: these tests never fetch or save bookings.
function renderer(config) {
  const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
  const context = {
    CFG:config, Q:config.questions, schema, answers:{}, otherText:{}, avail:null, requestorComplete:false,
    availabilityState:"idle", availabilityReady:() => false,
    scheduling:id => ["facilitator", "time"].includes(id),
    localToday:() => "2026-10-14", validDate:s => schema.validDate(s) && s >= "2026-10-14",
    document:{ createElement:() => ({ dataset:{} }) }, ICON:{ check:"" },
    // Custom date rendering must not invoke the training-only quick date picker.
    quickDates:() => { throw new Error("Custom date invoked scheduling picker"); },
    S:{ overlaps:() => false },
    gridClass:() => "tiles", tileInner:(id, label) => context.esc(label)
  };
  vm.runInNewContext(`
    const choiceObj = c => typeof c === "string" ? { label:c } : c;
    const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
    ${slice("  const isAnswered =", "  const cancelAuto =")}
    ${slice("  function visiblePath()", "  // Estimate remaining branches")}
    ${slice("  function renderQuestion(", "  function render()")}
    ${slice("  function invalidReason(", "  function showError(")}
    globalThis.renderQuestion = renderQuestion;
    globalThis.invalidReason = invalidReason;
    globalThis.visiblePath = visiblePath;
    globalThis.esc = esc;
  `, context);
  return context;
}

test("renderer applies and clears glass through validated theme tokens", () => {
  const properties = {}, root = { dataset:{}, style:{ setProperty:(key, value) => { properties[key] = value; } } };
  const context = { document:{ documentElement:root } };
  vm.runInNewContext(source.slice(source.indexOf("  function applyTheme("), source.indexOf("  async function loadForm(")), context);
  const theme = schema.validate(defaults).theme;
  context.applyTheme(theme);
  assert.equal(root.dataset.glass, "disabled");
  assert.equal(properties["--glass-alpha"], "0.8");
  assert.equal(properties["--glass-blur"], "12px");
  Object.assign(theme, { glassEnabled:true, glassTransparency:40, glassBlur:20 });
  context.applyTheme(theme);
  assert.equal(root.dataset.glass, "enabled");
  assert.equal(properties["--glass-alpha"], "0.6");
  assert.equal(properties["--glass-blur"], "20px");
  theme.glassEnabled = false; context.applyTheme(theme);
  assert.equal(root.dataset.glass, "disabled");
});

function config() {
  const c = schema.validate(defaults);
  c.questions.recommendations.next = "score";
  c.questions.score = { title:"Score", type:"number", min:0, max:10, next:"extraDate" };
  c.questions.extraDate = { title:"Reference date", type:"date", next:"tags" };
  c.questions.tags = { title:"Tags", type:"multi", choices:["A", "B", "C"], min:2, max:2, next:"email" };
  c.questions.email = { title:"Email", type:"email", next:"note" };
  c.questions.note = { title:"Note", type:"textarea", placeholder:'Plain "text" & details' };
  c.order.push("score", "extraDate", "tags", "email", "note");
  return schema.validate(c);
}

test("submit appears only when the current route is valid and availability is ready", () => {
  const states = { name:"Required", division:"Required", facilitator:"Checking availability" };
  const context = {
    visiblePath:() => Object.keys(states), routeLengths:() => [3],
    isAnswered:id => !states[id], invalidReason:id => states[id],
    container:{ querySelectorAll:() => [] },
    document:{ getElementById:id => id === "progressFill" ? { style:{}, parentElement:{ setAttribute() {} } } : {} },
    Q:{ name:{ field:"requestor", required:true }, division:{}, facilitator:{} }, requestorComplete:true,
    submit:{}, submitting:false, loaded:true, preview:false, stale:false
  };
  vm.runInNewContext(source.slice(source.indexOf("  function updateProgress()"), source.indexOf("  function tileInner(")), context);
  context.updateProgress(); assert.equal(context.submit.hidden, true);
  states.name = ""; states.division = "";
  context.updateProgress(); assert.equal(context.submit.hidden, true);
  states.facilitator = "";
  context.updateProgress(); assert.equal(context.submit.hidden, false); assert.equal(context.submit.disabled, false);
  context.preview = true;
  context.updateProgress(); assert.equal(context.submit.hidden, false); assert.equal(context.submit.disabled, true);
  context.preview = false; context.submitting = true;
  context.updateProgress(); assert.equal(context.submit.hidden, false); assert.equal(context.submit.disabled, true);
  context.submitting = false; states.name = "Required";
  context.updateProgress(); assert.equal(context.submit.hidden, true);
  states.name = ""; context.stale = true;
  context.updateProgress(); assert.equal(context.submit.hidden, true);
});

test("typing a valid first name never exposes submit before completing the name", () => {
  const r = renderer(config());
  r.answers.name = "Test Requestor";
  Object.assign(r, {
    routeLengths:() => [8], container:{ querySelectorAll:() => [] },
    document:{ getElementById:id => id === "progressFill" ? { style:{}, parentElement:{ setAttribute() {} } } : {} },
    submit:{}, submitting:false, loaded:true, preview:false, stale:false
  });
  vm.runInNewContext(source.slice(source.indexOf("  function updateProgress()"), source.indexOf("  function tileInner(")), r);
  r.updateProgress();
  assert.deepEqual(Array.from(r.visiblePath()), ["name"]);
  assert.equal(r.submit.hidden, true); assert.equal(r.submit.disabled, true);
  r.requestorComplete = true;
  r.updateProgress();
  assert.deepEqual(Array.from(r.visiblePath()), ["name", "division"]);
  assert.equal(r.submit.hidden, true); assert.equal(r.submit.disabled, true);
});

test("actual renderer emits configured numeric bounds, optional controls and escaped arbitrary strings", () => {
  const r = renderer(config());
  const number = r.renderQuestion("score", 1).innerHTML;
  assert.match(number, /type="number"/); assert.match(number, /min="0" max="10" step="any"/);
  assert.doesNotMatch(number, /aria-required="true"/);
  assert.match(r.renderQuestion("participants", 1).innerHTML, /step="1"/);
  const date = r.renderQuestion("extraDate", 2).innerHTML;
  assert.match(date, /type="date"/); assert.doesNotMatch(date, /date-tiles|\bmin=/);
  const note = r.renderQuestion("note", 3).innerHTML;
  assert.match(note, /maxlength="2000"/);
  assert.match(note, /Plain &quot;text&quot; &amp; details/);
  const tags = r.renderQuestion("tags", 4).innerHTML;
  assert.match(tags, /Select at least 2/); assert.match(tags, /Select up to 2/);
});

test("actual renderer validation accepts optional blanks/zero/historical custom dates and rejects bad bounds/types", () => {
  const r = renderer(config());
  for (const id of ["score", "extraDate", "tags", "email", "note"]) assert.equal(r.invalidReason(id), "");
  for (const [id, value] of [["score", 0], ["score", 10], ["extraDate", "2000-02-29"], ["tags", ["A", "B"]], ["email", "a@example.com"]]) {
    r.answers[id] = value; assert.equal(r.invalidReason(id), "");
  }
  for (const [id, value] of [["score", -1], ["score", 11], ["score", "5"], ["score", {}],
    ["tags", ["A"]], ["tags", ["A", "B", "C"]], ["tags", ["A", "A"]], ["tags", {}],
    ["extraDate", "2001-02-29"], ["extraDate", {}], ["email", "bad"], ["note", {}]]) {
    r.answers[id] = value; assert.notEqual(r.invalidReason(id), "", `${id}: ${JSON.stringify(value)}`);
  }
  r.answers.date = "2026-10-13"; assert.match(r.invalidReason("date"), /today or a future/);
  r.answers.date = "2026-10-14"; assert.equal(r.invalidReason("date"), "");
});

test("requestor name gates Sales Division until valid and hides it again when cleared", () => {
  const r = renderer(config());
  for (const value of [undefined, "", "   ", "<invalid>", "A".repeat(201)]) {
    r.answers.name = value;
    assert.deepEqual(Array.from(r.visiblePath()), ["name"]);
  }
  r.answers.name = "Test Requestor";
  assert.deepEqual(Array.from(r.visiblePath()), ["name"]);
  r.requestorComplete = true;
  assert.deepEqual(Array.from(r.visiblePath()), ["name", "division"]);
  r.answers.name = "";
  assert.deepEqual(Array.from(r.visiblePath()), ["name"]);
});

test("name completion waits for Enter or blur and advances only once when valid", () => {
  const handlers = {}, card = { dataset:{ id:"name" } }, calls = [];
  const context = {
    Q:{ name:{ field:"requestor", required:true } }, submitting:false, requestorComplete:false,
    invalidReason:() => "", render:() => calls.push("render"), goNext:id => calls.push(id),
    showError:() => calls.push("error"),
    container:{ addEventListener:(type, handler) => { handlers[type] = handler; } }
  };
  vm.runInNewContext(source.slice(source.indexOf("  function completeRequestor("), source.indexOf('  container.addEventListener("change"')), context);
  const target = { closest:() => card, matches:() => true };
  handlers.keydown({ key:"Enter", isComposing:true, target });
  assert.equal(context.requestorComplete, false);
  let prevented = false;
  handlers.keydown({ key:"Enter", target, preventDefault:() => { prevented = true; } });
  assert.ok(prevented); assert.equal(context.requestorComplete, true);
  assert.deepEqual(calls, ["render", "name"]);
  handlers.focusout({ type:"focusout", target });
  assert.equal(calls.length, 2);
  context.requestorComplete = false;
  handlers.focusout({ type:"focusout", target });
  assert.equal(context.requestorComplete, true);
  context.requestorComplete = false; context.invalidReason = () => "Required";
  handlers.focusout({ type:"focusout", target });
  assert.equal(context.requestorComplete, false);
  context.submitting = true; context.invalidReason = () => "";
  handlers.focusout({ type:"focusout", target });
  assert.equal(context.requestorComplete, false);
});

test("advancing from the completed name centers and focuses the second question", () => {
  const calls = [], target = {
    scrollIntoView:options => calls.push(options.block),
    querySelector:() => ({ focus:options => calls.push(options.preventScroll) })
  };
  let advance;
  const context = {
    cancelAuto() {}, setTimeout:fn => { advance = fn; }, submitting:false, form:{ hidden:false },
    invalidReason:() => "", visiblePath:() => ["name", "division"], isAnswered:id => id === "name",
    reducedMotion:{ matches:true }, container:{ querySelector:selector => {
      assert.equal(selector, '[data-id="division"]'); return target;
    } }
  };
  vm.runInNewContext(source.slice(source.indexOf("  function goNext("), source.indexOf("  function invalidReason(")), context);
  context.goNext("name"); advance();
  assert.deepEqual(calls, ["center", true]);
});

test("active question glow follows focus and exposes the current step", () => {
  const cards = ["name", "division"].map(id => ({
    dataset:{ id }, classes:new Set(), attributes:{},
    classList:{ toggle(name, active) { if (active) this.owner.classes.add(name); else this.owner.classes.delete(name); } },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  }));
  cards.forEach(card => { card.classList.owner = card; });
  let focus;
  const context = { activeQuestionId:undefined, container:{
    querySelectorAll:() => cards,
    addEventListener:(type, handler) => { assert.equal(type, "focusin"); focus = handler; }
  } };
  vm.runInNewContext(source.slice(source.indexOf("  function highlightQuestion("), source.indexOf("  function goNext(")), context);
  context.highlightQuestion("name");
  assert.ok(cards[0].classes.has("is-active"));
  assert.equal(cards[0].attributes["aria-current"], "step");
  focus({ target:{ closest:() => cards[1] } });
  assert.ok(!cards[0].classes.has("is-active"));
  assert.equal(cards[0].attributes["aria-current"], undefined);
  assert.ok(cards[1].classes.has("is-active"));
  assert.equal(cards[1].attributes["aria-current"], "step");
});

test("optional requestor does not block configured routing", () => {
  const c = config(); c.questions.name.required = false;
  assert.deepEqual(Array.from(renderer(c).visiblePath()), ["name", "division"]);
});

test("actual renderer follows scheduling graph rather than editable presentation order", () => {
  const c = config(); c.order.reverse(); const r = renderer(schema.validate(c));
  r.answers.name = "Test Requestor"; r.requestorComplete = true;
  r.answers.division = "LG Division"; r.answers.category = c.questions.category.choices[0].label;
  const path = Array.from(r.visiblePath());
  assert.ok(path.indexOf("date") < path.indexOf("facilitator"));
  assert.ok(path.indexOf("facilitator") < path.indexOf("time"));
  assert.ok(path.includes("extraDate"));
});