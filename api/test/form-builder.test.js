const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const schema = require("../../app/form-schema");
const defaults = require("../../app/form-config");
const source = fs.readFileSync(require.resolve("../../app/admin/settings.js"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));

function builderState() {
  const cfg = schema.validate(defaults);
  cfg.questions.custom1 = { title:"First question", type:"text", required:false, next:"custom2" };
  cfg.questions.custom2 = { title:"Second question", type:"text", required:false, next:cfg.start };
  cfg.order.unshift("custom1", "custom2"); cfg.start = "custom1";
  const originalTitle = cfg.questions[cfg.start].title;
  const buttons = Object.fromEntries(["moveUp", "moveDown", "addQuestion", "duplicateQuestion", "removeQuestion", "saveDraft", "previewDraft", "publishForm", "builderStatus", "draftValidation", "previewPanel", "choiceLines"].map(id => [`#${id}`, {}]));
  const span = {}, picked = { dataset:{ question:cfg.start }, querySelector:() => span };
  const context = { schema, clone, cfg, q:cfg.questions[cfg.start], selected:cfg.start, essential:true, choicePending:false, profileDirty:false, previewOpen:true,
    label:value => typeof value === "string" ? value : value.label,
    find:selector => buttons[selector], dirty:() => context.profileDirty || context.q.title !== originalTitle,
    view:{ querySelectorAll:() => [picked] } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("  function linear("), source.indexOf("  function builder(")), context);
  vm.runInContext(source.slice(source.indexOf("    function status()", source.indexOf("  function builder(")), source.indexOf("    // Multiline choices")), context);
  vm.runInContext(source.slice(source.indexOf("    function changed()"), source.indexOf('    if (find("#choiceLines"))')), context);
  return { context, buttons, span };
}

test("question edits update sidebar without replacing the editor and keep draft actions gated", () => {
  const { context, buttons, span } = builderState();
  context.q.title = "Updated label";
  context.changed();
  assert.equal(span.textContent, "1. Updated label");
  assert.equal(context.previewOpen, false);
  assert.equal(buttons["#saveDraft"].disabled, false);
  assert.equal(buttons["#previewDraft"].disabled, true);
  assert.equal(buttons["#publishForm"].disabled, true);
  assert.equal(buttons["#removeQuestion"].disabled, true);
  context.q.title = "";
  context.changed();
  assert.equal(buttons["#saveDraft"].disabled, true);
  assert.equal(buttons["#draftValidation"].hidden, false);
});

test("move controls validate cloned routes, protect branches and do not mutate the draft", () => {
  const { context, buttons } = builderState();
  const before = JSON.stringify(context.cfg);
  context.refreshStructureActions();
  assert.equal(JSON.stringify(context.cfg), before);
  assert.equal(buttons["#moveUp"].disabled, true);
  assert.equal(buttons["#moveDown"].disabled, false);
  const moved = context.moveCandidate(1);
  assert.equal(moved.order[1], context.selected);
  assert.doesNotThrow(() => schema.validate(moved));
  context.q.choices = [{ label:"Branch", goto:context.cfg.order[2] }];
  context.refreshStructureActions();
  for (const id of ["moveDown", "addQuestion", "duplicateQuestion"]) assert.equal(buttons[`#${id}`].disabled, true);
  assert.equal(buttons["#moveDown"].title, "Routing prevents this move");
});

test("pending choice edits disable draft and structural actions with actionable hints", () => {
  const { context, buttons } = builderState();
  context.q.choices = ["One", "Two"];
  buttons["#choiceLines"].value = "One\nThree";
  context.pendingChoices();
  assert.equal(context.profileDirty, true);
  for (const id of ["saveDraft", "previewDraft", "publishForm", "moveDown", "addQuestion", "duplicateQuestion"]) {
    assert.equal(buttons[`#${id}`].disabled, true);
    assert.equal(buttons[`#${id}`].title, "Apply choices first");
  }
  buttons["#choiceLines"].value = "One\nTwo";
  context.pendingChoices();
  assert.equal(context.profileDirty, false);
  assert.equal(buttons["#addQuestion"].disabled, false);
});

test("builder renders numbered labels, concise hints and persistent native disclosures", () => {
  const cfg = schema.validate(defaults), selected = cfg.order.find(id => cfg.questions[id].type === "choice");
  const context = { schema, cfg, selected, q:cfg.questions[selected], essential:true, fixedType:false, previewOpen:false,
    draft:{ revision:2, version:1 }, esc:value => String(value ?? ""), label:value => typeof value === "string" ? value : value.label,
    option:() => "", select:() => "", protectedQuestion:() => true, destinationOptions:() => "", typeNames:{ choice:"Single choice" },
    openPanels:new Set(["routing", "settings"]), view:{} };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("  function linear("), source.indexOf("  function builder(")), context);
  const start = source.indexOf('    view.innerHTML = `<div class="settings-heading builder-heading"');
  const end = source.indexOf("    const find =", start);
  vm.runInContext(source.slice(start, end), context);
  const html = context.view.innerHTML;
  assert.match(html, /1\. /);
  assert.match(html, /Single choice/);
  assert.doesNotMatch(html, /Question inspector|<h2>Form builder/);
  assert.match(html, /data-builder-panel="routing" open/);
  assert.match(html, /data-builder-panel="settings" open/);
  assert.match(html, /data-builder-panel="sections" >/);
  assert.match(html, /id="draftValidation" role="alert"/);
  assert.match(html, /Save a draft, preview it, then publish/);
  assert.match(html, /id="builderSteps" data-state="saved"/);
  assert.match(html, /id="livePreview"/);
  assert.match(html, /id="flowMap"/);
  assert.match(html, /name="answerType" data-prop="type" value="choice" checked/);
});

test("live preview and flow map describe the selected question visually", () => {
  const cfg = schema.validate(defaults);
  const context = { schema, cfg, clone, esc:value => String(value ?? ""), label:value => typeof value === "string" ? value : value.label };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("  function linear("), source.indexOf("  function builder(")), context);
  const choice = { title:"Pick one", type:"choice", required:true, help:"Choose wisely", choices:["A", "B", "C", "D", "E", "F", "G"], allowOther:true };
  const html = context.previewHtml(choice);
  assert.match(html, /Pick one<span class="qp-req"/);
  assert.match(html, /Choose wisely/);
  assert.match(html, /Other…/);
  assert.match(html, /\+ 2 more options/);
  assert.match(context.previewHtml({ title:"T", type:"multi", choices:["A"], min:1, max:2 }), /at least 1 and at most 2/);
  const id = cfg.start, flow = context.flowHtml(cfg, id);
  assert.match(flow, /Form starts here/);
  assert.match(flow, /flow-node current/);
  assert.match(flow, new RegExp(cfg.questions[cfg.questions[id].next].title.slice(0, 8)));
});
