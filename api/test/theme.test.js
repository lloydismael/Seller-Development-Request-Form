const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../../app/theme.js"), "utf8");

function setup({ saved = null, dark = false, reduced = false, blocked = false, appearance = false } = {}) {
  const values = {};
  const root = { dataset:{}, style:{ setProperty:(key, value) => { values[key] = value; } }, classList:{ add:() => {}, remove:() => {} } };
  const attrs = {}, events = {}, storage = { value:saved }, timers = [], palettes = [];
  let ready, systemChange, storageChange;
  const button = { setAttribute:(key, value) => { attrs[key] = value; }, addEventListener:(type, handler) => { events[type] = handler; } };
  const context = {
    document:{ documentElement:root, getElementById:() => button, addEventListener:(type, handler) => { ready = handler; } },
    window:{ BookingAppearance:{ refreshColors:() => palettes.push(root.dataset.colorMode) }, addEventListener:(type, handler) => { storageChange = handler; }, matchMedia:query => query.includes("color-scheme") ? { matches:dark, addEventListener:(type, handler) => { systemChange = handler; } } : { matches:reduced } },
    localStorage:{ getItem:() => { if (blocked) throw new Error("Storage blocked"); return storage.value; }, setItem:(key, value) => { if (blocked) throw new Error("Storage blocked"); storage.value = value; } },
    setTimeout:handler => { timers.push(handler); return timers.length; }, clearTimeout:() => {}
  };
  if (appearance) vm.runInNewContext(fs.readFileSync(require.resolve("../../app/appearance.js"), "utf8"), context);
  vm.runInNewContext(source, context);
  ready();
  return { root, attrs, events, storage, timers, systemChange, storageChange, palettes, values, api:context.window.BookingAppearance };
}

test("theme follows system until an explicit toggle is saved", () => {
  const ui = setup({ dark:true });
  assert.equal(ui.root.dataset.colorMode, "dark");
  assert.equal(ui.attrs["aria-checked"], "true");
  ui.systemChange({ matches:false });
  assert.equal(ui.root.dataset.colorMode, "light");
  ui.events.click();
  assert.equal(ui.root.dataset.colorMode, "dark");
  assert.equal(ui.storage.value, "dark");
  ui.systemChange({ matches:false });
  assert.equal(ui.root.dataset.colorMode, "dark");
  ui.events.click();
  assert.equal(ui.attrs["aria-checked"], "false");
  assert.equal(ui.storage.value, "light");
});

test("saved preference wins and reduced motion skips transition timers", () => {
  const ui = setup({ saved:"light", dark:true, reduced:true });
  assert.equal(ui.root.dataset.colorMode, "light");
  ui.events.click();
  assert.equal(ui.root.dataset.colorMode, "dark");
  assert.equal(ui.timers.length, 0);
});

test("theme synchronizes other pages and falls back to system after preference removal", () => {
  const ui = setup({ saved:"light", dark:true });
  ui.storageChange({ key:"unrelated", newValue:"dark" });
  assert.equal(ui.root.dataset.colorMode, "light");
  ui.storageChange({ key:"booking-color-mode", newValue:"dark" });
  assert.equal(ui.attrs["aria-checked"], "true");
  ui.storageChange({ key:"booking-color-mode", newValue:null });
  assert.equal(ui.root.dataset.colorMode, "dark");
  ui.systemChange({ matches:false });
  assert.equal(ui.root.dataset.colorMode, "light");
  ui.storageChange({ key:null, newValue:null });
  assert.equal(ui.root.dataset.colorMode, "dark");
});

test("palette refresh follows bootstrap, system, toggle and cross-tab mode changes", () => {
  const ui = setup();
  ui.systemChange({ matches:true });
  ui.events.click();
  ui.storageChange({ key:"booking-color-mode", newValue:"dark" });
  assert.deepEqual(ui.palettes, ["light", "light", "dark", "light", "dark"]);
});

test("actual mode switch follows independent published and admin-preview presets", () => {
  for (const saved of ["light", "dark"]) {
    const ui = setup({ saved, appearance:true });
    const live = { primary:"#0f766e", background:"#f8fafc", darkPrimary:"#5eead4", darkBackground:"#0f172a" };
    ui.api.apply(live);
    assert.equal(ui.values["--ui-bg"], saved === "dark" ? live.darkBackground : live.background);
    const draft = { primary:"#1d4ed8", background:"#eff6ff", darkPrimary:"#fda4af", darkBackground:"#27151d" };
    ui.api.previewColors(draft);
    for (let i = 0; i < 4; i++) {
      ui.events.click();
      const mode = ui.root.dataset.colorMode;
      const expected = ui.api.palette(draft, mode);
      assert.equal(ui.values["--ui-bg"], expected["--ui-bg"]);
      assert.equal(ui.values["--ui-primary"], expected["--ui-primary"]);
    }
    ui.api.clearColorPreview();
    assert.equal(ui.values["--ui-bg"], saved === "dark" ? live.darkBackground : live.background);
  }
});
test("blocked storage does not prevent theme switching", () => {
  const ui = setup({ blocked:true });
  ui.events.click();
  assert.equal(ui.root.dataset.colorMode, "dark");
  assert.equal(ui.attrs["aria-checked"], "true");
});
