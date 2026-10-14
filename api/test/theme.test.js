const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../../app/theme.js"), "utf8");

function setup({ saved = null, dark = false, reduced = false, blocked = false } = {}) {
  const root = { dataset:{}, classList:{ add:() => {}, remove:() => {} } };
  const attrs = {}, events = {}, storage = { value:saved }, timers = [];
  let ready, systemChange, storageChange;
  const button = { setAttribute:(key, value) => { attrs[key] = value; }, addEventListener:(type, handler) => { events[type] = handler; } };
  vm.runInNewContext(source, {
    document:{ documentElement:root, getElementById:() => button, addEventListener:(type, handler) => { ready = handler; } },
    window:{ addEventListener:(type, handler) => { storageChange = handler; }, matchMedia:query => query.includes("color-scheme") ? { matches:dark, addEventListener:(type, handler) => { systemChange = handler; } } : { matches:reduced } },
    localStorage:{ getItem:() => { if (blocked) throw new Error("Storage blocked"); return storage.value; }, setItem:(key, value) => { if (blocked) throw new Error("Storage blocked"); storage.value = value; } },
    setTimeout:handler => { timers.push(handler); return timers.length; }, clearTimeout:() => {}
  });
  ready();
  return { root, attrs, events, storage, timers, systemChange, storageChange };
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

test("blocked storage does not prevent theme switching", () => {
  const ui = setup({ blocked:true });
  ui.events.click();
  assert.equal(ui.root.dataset.colorMode, "dark");
  assert.equal(ui.attrs["aria-checked"], "true");
});
