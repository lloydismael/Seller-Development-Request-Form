const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const schema = require("../../app/form-schema");
const defaults = require("../../app/form-config");
const source = fs.readFileSync(require.resolve("../../app/admin/settings.js"), "utf8");

test("actual glass controls use typed values, synchronize disabled state and preserve choice safeguards", () => {
  const cfg = schema.validate(defaults), reset = {};
  const controls = [
    { dataset:{ theme:"glassEnabled" }, type:"checkbox", checked:false },
    { dataset:{ theme:"glassTransparency" }, type:"number", value:20, valueAsNumber:20, disabled:true },
    { dataset:{ theme:"glassBlur" }, type:"number", value:12, valueAsNumber:12, disabled:true },
    { dataset:{ theme:"primary" }, type:"color", value:cfg.theme.primary }
  ];
  let changes = 0, pending = 0, valid = true;
  const context = { cfg, schema, choicePending:true, find:() => reset,
    changed:() => { changes++; try { schema.validate(cfg); valid = true; } catch { valid = false; } },
    pendingChoices:() => { pending++; },
    view:{ querySelectorAll:selector => selector === "[data-theme]" ? controls : selector.includes("^=") ? controls.slice(0, 3) : controls.slice(1, 3) }
  };
  vm.runInNewContext(source.slice(source.indexOf("    const syncGlass ="), source.indexOf('    view.querySelectorAll("[data-section-title]')), context);
  controls[0].checked = true; controls[0].oninput();
  assert.equal(cfg.theme.glassEnabled, true);
  assert.ok(controls.slice(1, 3).every(input => !input.disabled));
  controls[1].valueAsNumber = 30; controls[1].oninput();
  assert.equal(cfg.theme.glassTransparency, 30);
  controls[2].valueAsNumber = NaN; controls[2].oninput();
  assert.equal(valid, false);
  assert.equal(pending, changes);
  const primary = cfg.theme.primary;
  reset.onclick();
  for (const [key, value] of Object.entries(schema.GLASS_DEFAULTS)) assert.equal(cfg.theme[key], value);
  assert.equal(cfg.theme.primary, primary);
  assert.equal(controls[0].checked, false);
  assert.equal(controls[1].value, 20);
  assert.equal(controls[2].value, 12);
  assert.ok(controls.slice(1, 3).every(input => input.disabled));
  assert.equal(valid, true);
  assert.equal(pending, changes);
});

test("glass appearance controls have native bounds and explicit fallback/reset help", () => {
  assert.match(source, /type="checkbox" data-theme="glassEnabled"/);
  const start = source.indexOf('${[["glassTransparency"') + 2;
  const end = source.indexOf('.join("")}', start) + '.join("")'.length;
  const markup = vm.runInNewContext(source.slice(start, end), { cfg:schema.validate(defaults), schema, esc:String });
  assert.match(markup, /type="number" data-theme="glassTransparency"[^>]*min="0" max="40"/);
  assert.match(markup, /type="number" data-theme="glassBlur"[^>]*min="0" max="20"/);
  assert.equal((markup.match(/aria-describedby="glassHelp" disabled/g) || []).length, 2);
  assert.match(source, /Readability limits effective transparency to 20% in light mode and 10% in dark mode/);
  assert.match(source, /Reset and disable glass/);
});
