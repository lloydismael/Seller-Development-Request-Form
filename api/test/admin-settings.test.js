const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const schema = require("../../app/form-schema");
const defaults = require("../../app/form-config");
const source = fs.readFileSync(require.resolve("../../app/admin/settings.js"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(positional = false, mode = "api") {
  const calls = [], preferences = {}, previews = [], config = schema.validate(defaults);
  let nodes = {}, html = "";
  const view = {
    set innerHTML(value) {
      Object.values(nodes).forEach(node => { node.isConnected = false; });
      html = value;
      const colors = ["light", "dark"].flatMap(mode => [`${mode}Preset`, `${mode}PalettePreview`, ...["primary", "background"].flatMap(kind => [`${mode}${kind}`, `${mode}${kind}Value`])]);
      nodes = Object.fromEntries([...colors, "appearancedensity", "appearancewidth", "appearancecardStyle", "appearanceStatus", "saveAppearance", "publishAppearance", "previewAppearance", "reloadAppearance", "appearancePreviewPanel", "iframe", ".material-preview", "liquid", "frosted", "solid", "reduceMotion", "reduceTransparency", "bookings"].map(id => [id, { disabled:false, isConnected:true, checked:false, value:id, style:{ setProperty() {} }, dataset:{ preference:id, settingsNav:id }, scrollIntoView() {} }]));
      for (const key of ["density", "width", "cardStyle"]) nodes[`appearance${key}`].dataset.appearanceStyle = key;
      for (const mode of ["light", "dark"]) {
        nodes[`${mode}Preset`].dataset.palettePreset = mode;
        for (const kind of ["primary", "background"]) Object.assign(nodes[`${mode}${kind}`].dataset, { colorMode:mode, colorKind:kind });
      }
    },
    get innerHTML() { return html; },
    querySelector(selector) { return nodes[selector.replace(/^#/, "")]; },
    querySelectorAll(selector) {
      const ids = selector === '[name="material"]' ? ["liquid", "frosted", "solid"] : selector === "[data-preference]" ? ["reduceMotion", "reduceTransparency"] : selector === "[data-settings-nav]" ? ["bookings"] : Object.keys(nodes);
      if (selector === "[data-appearance-style]") return [nodes.appearancedensity, nodes.appearancewidth, nodes.appearancecardStyle];
      if (selector === "[data-palette-preset]") return [nodes.lightPreset, nodes.darkPreset];
      if (selector === "[data-color-kind]") return [nodes.lightprimary, nodes.lightbackground, nodes.darkprimary, nodes.darkbackground];
      return ids.map(id => nodes[id]);
    },
    setAttribute() {}, removeAttribute() {}
  };
  const result = () => ({ config:clone(config), revision:3, version:2 });
  const save = async payload => { calls.push(["save", payload]); Object.assign(config, clone(payload.config)); return result(); };
  const ctx = { mode, config, S:{ formDraft:async () => result(),
    saveFormDraft:positional ? async function(cfg, revision) { return save({ config:cfg, revision }); } : save,
    publishForm:async revision => { calls.push(["publish", revision]); return { config:clone(config), version:4 }; }
  }, toast() {}, navigate:tab => calls.push(["navigate", tab]), onPublished:result => calls.push(["live", result.version]) };
  const window = { FormSchema:schema, addEventListener() {}, BookingAppearance:{ previewColors:theme => previews.push(clone(theme)), clearColorPreview:() => previews.push(null), palette:() => ({}), preferences:() => preferences, setPreference:(key, value) => { preferences[key] = value; } } };
  vm.runInNewContext(source, { window, confirm:() => true, alert() {}, document:{} });
  return { window, view, ctx, calls, preferences, previews, node:id => nodes[id] };
}
test("local Settings exposes accessibility and the current roster without draft operations", async () => {
  const s = setup(false, "local");
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  assert.match(s.view.innerHTML, /Shared appearance requires the authenticated API/);
  assert.doesNotMatch(s.view.innerHTML, /id="saveAppearance"/);
  const roster = Object.values(s.ctx.config.questions).find(q => q.field === "facilitator");
  assert.match(s.view.innerHTML, new RegExp(`${roster.choices.length} facilitators`));
  s.node("reduceMotion").checked = true; s.node("reduceMotion").onchange();
  assert.equal(s.preferences.reduceMotion, true);
  s.node("bookings").onclick();
  assert.deepEqual(s.calls, [["navigate", "bookings"]]);
});
test("Settings saves shared layout choices without changing the live application before publishing", async () => {
  const s = setup();
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  const original = clone(s.ctx.config.theme);
  s.node("previewAppearance").onclick();
  for (const [key, value] of [["density", "compact"], ["width", "wide"], ["cardStyle", "elevated"]]) {
    const control = s.node(`appearance${key}`);
    control.value = value; control.onchange();
    assert.equal(s.node(".material-preview").dataset[key], value);
  }
  assert.equal(s.node("appearancePreviewPanel").hidden, true);
  assert.equal(s.node("publishAppearance").disabled, true);
  assert.deepEqual(s.ctx.config.theme, original);
  assert.equal(s.calls.length, 0);
  s.node("saveAppearance").onclick(); await flush();
  assert.deepEqual(s.calls[0][1].config.theme, { ...original, density:"compact", width:"wide", cardStyle:"elevated" });
  assert.equal(s.node("publishAppearance").disabled, false);
  assert.equal(s.calls.some(call => call[0] === "live"), false);
  s.node("publishAppearance").onclick(); await flush();
  assert.deepEqual(s.calls[2], ["live", 4]);
});
test("local Settings disables shared layout controls and rejects synthetic changes", async () => {
  const s = setup(false, "local");
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  assert.match(s.view.innerHTML, /<fieldset class="layout-editor" disabled>/);
  const original = clone(s.ctx.config.theme);
  s.node("appearancedensity").value = "compact"; s.node("appearancedensity").onchange();
  assert.deepEqual(s.ctx.config.theme, original);
});
test("Settings previews independent palettes locally and keeps visitor colors draft-only until publish", async () => {
  const s = setup();
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  assert.match(s.view.innerHTML, /Light mode/);
  assert.match(s.view.innerHTML, /Dark mode/);
  s.node("lightPreset").value = "ocean"; s.node("lightPreset").onchange();
  s.node("darkPreset").value = "violet"; s.node("darkPreset").onchange();
  s.node("darkprimary").value = "#aabbcc"; s.node("darkprimary").oninput();
  assert.equal(s.node("darkPreset").value, "custom");
  assert.equal(s.node("darkprimaryValue").textContent, "#aabbcc");
  assert.equal(s.previews.at(-1).background, "#eff6ff");
  assert.equal(s.previews.at(-1).darkBackground, "#1c142b");
  assert.equal(s.previews.at(-1).darkPrimary, "#aabbcc");
  assert.equal(s.ctx.config.theme.background, schema.validate(defaults).theme.background);
  assert.equal(s.node("publishAppearance").disabled, true);
  assert.equal(s.calls.length, 0);
  s.node("saveAppearance").onclick(); await flush();
  const theme = s.calls[0][1].config.theme;
  assert.equal(theme.primary, "#1d4ed8");
  assert.equal(theme.background, "#eff6ff");
  assert.equal(theme.darkPrimary, "#aabbcc");
  assert.equal(theme.darkBackground, "#1c142b");
  assert.equal(theme.glassEnabled, false);
  assert.equal(s.calls.some(call => call[0] === "live"), false);
  s.node("publishAppearance").onclick(); await flush();
  assert.deepEqual(s.calls[2], ["live", 4]);
});
test("saved draft colors preview only in Settings and survive departure without publishing", async () => {
  const s = setup();
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  assert.match(s.view.innerHTML, /Unpublished colors preview only in Settings/);
  s.node("darkPreset").value = "rose"; s.node("darkPreset").onchange();
  s.node("saveAppearance").onclick(); await flush();
  assert.equal(s.previews.at(-1).darkBackground, "#27151d");
  s.window.SettingsUI.deactivate();
  assert.equal(s.previews.at(-1), null);
  for (const tab of ["builder", "profile", "activity"]) {
    await s.window.SettingsUI.render("settings", s.view, s.ctx);
    assert.equal(s.previews.at(-1).darkBackground, "#27151d");
    await s.window.SettingsUI.render(tab, s.view, { ...s.ctx, mode:"local" });
    assert.equal(s.previews.at(-1), null);
  }
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  assert.equal(s.previews.at(-1).darkBackground, "#27151d");
  s.node("reloadAppearance").onclick(); await flush();
  assert.equal(s.previews.at(-1).darkBackground, "#27151d");
  assert.equal(s.calls.some(call => call[0] === "live"), false);
});
test("discarding unsaved colors restores saved draft colors before navigation", async () => {
  const s = setup();
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  const savedTheme = clone(s.previews.at(-1));
  s.node("darkPreset").value = "rose"; s.node("darkPreset").onchange();
  assert.equal(s.previews.at(-1).darkBackground, "#27151d");
  assert.equal(s.window.SettingsUI.canLeave(), true);
  assert.deepEqual(s.previews.at(-1), savedTheme);
  s.window.SettingsUI.deactivate();
  assert.equal(s.previews.at(-1), null);
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  assert.deepEqual(s.previews.at(-1), savedTheme);
  assert.equal(s.calls.length, 0);
});
test("leaving Settings restores the same published tokens as booking in either mode", async () => {
  const s = setup(), values = {};
  const root = { dataset:{}, style:{ setProperty:(key, value) => { values[key] = value; } } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../app/appearance.js"), "utf8"), {
    window:s.window, document:{ documentElement:root }, localStorage:{ getItem:() => null }
  });
  const live = clone(s.ctx.config.theme);
  s.ctx.onPublished = result => s.window.BookingAppearance.apply(result.config.theme);
  s.window.BookingAppearance.apply(live);
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  s.node("lightPreset").value = "ocean"; s.node("lightPreset").onchange();
  s.node("darkPreset").value = "rose"; s.node("darkPreset").onchange();
  s.node("saveAppearance").onclick(); await flush();
  for (const mode of ["light", "dark"]) {
    await s.window.SettingsUI.render("settings", s.view, s.ctx);
    root.dataset.colorMode = mode; s.window.BookingAppearance.refreshColors();
    assert.equal(values["--ui-bg"], mode === "dark" ? "#27151d" : "#eff6ff");
    await s.window.SettingsUI.render("builder", s.view, { ...s.ctx, mode:"local" });
    assert.equal(root.dataset.colorMode, mode);
    const published = s.window.BookingAppearance.palette(live, mode);
    for (const [key, value] of Object.entries(published)) assert.equal(values[key], value);
  }
  await s.window.SettingsUI.render("settings", s.view, s.ctx);
  s.node("publishAppearance").onclick(); await flush();
  const published = clone(s.ctx.config.theme);
  assert.equal(s.calls.at(-1)[0], "publish");
  s.window.SettingsUI.deactivate();
  assert.equal(values["--ui-bg"], published.darkBackground);
});
for (const positional of [false, true]) {
  test(`Settings saves presets before publishing with ${positional ? "positional" : "object"} transport`, async () => {
    const s = setup(positional);
    await s.window.SettingsUI.render("settings", s.view, s.ctx);
    assert.equal(s.node("saveAppearance").disabled, true);
    s.node("liquid").checked = true; s.node("liquid").onchange();
    assert.equal(s.node("publishAppearance").disabled, true);
    s.node("publishAppearance").onclick();
    assert.equal(s.calls.length, 0);
    s.node("saveAppearance").onclick(); await flush();
    assert.deepEqual(s.calls[0][1].config.theme, { ...schema.validate(defaults).theme, glassEnabled:true, glassTransparency:40, glassBlur:4 });
    assert.equal(s.calls[0][1].revision, 3);
    assert.equal(s.node("publishAppearance").disabled, false);
    assert.equal(s.calls.some(call => call[0] === "live"), false);
    s.node("previewAppearance").onclick();
    assert.equal(s.node("iframe").src, "/?preview=draft");
    s.node("publishAppearance").onclick(); await flush();
    assert.deepEqual(JSON.parse(JSON.stringify(s.calls[1])), ["publish", positional ? 3 : { revision:3 }]);
    assert.deepEqual(s.calls[2], ["live", 4]);
  });
}

