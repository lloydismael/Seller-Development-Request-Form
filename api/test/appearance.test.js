const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../../app/appearance.js"), "utf8");
function setup(initial = "{}", unavailable = false, cache = null, wait = false, mode = null) {
  let stored = initial;
  const storage = { "booking-published-palette-v1":cache };
  const events = {}, values = {}, timers = new Map();
  const root = { dataset:{ waitForAppearance:String(wait) }, style:{ setProperty:(key, value) => { values[key] = value; } } };
  const context = { document:{ documentElement:root, getElementById:() => null, addEventListener:() => {} }, window:{
    addEventListener:(name, fn) => { events[name] = fn; }, matchMedia:() => ({ matches:false, addEventListener:() => {} })
  }, setTimeout:(fn, delay) => { timers.set(1, { fn, delay }); return 1; }, clearTimeout:id => timers.delete(id), localStorage:{
    getItem:key => { if (unavailable) throw Error("Blocked"); return key === "booking-accessibility" ? stored : key === "booking-color-mode" ? mode : storage[key] || null; },
    setItem:(key, value) => { if (unavailable) throw Error("Blocked"); if (key === "booking-accessibility") stored = value; else storage[key] = value; }
  } };
  vm.runInNewContext(source, context);
  if (mode) vm.runInNewContext(fs.readFileSync(require.resolve("../../app/theme.js"), "utf8"), context);
  return { api:context.window.BookingAppearance, root, values, events, storage, timers, replace:value => { stored = value; }, stored:() => stored };
}
test("appearance applies all materials without changing accessibility preferences", () => {
  const s = setup('{"reduceTransparency":true}');
  for (const [enabled, blur, expected] of [[true, 4, "liquid"], [true, 16, "frosted"], [false, 12, "solid"]]) {
    s.api.apply({ glassEnabled:enabled, glassTransparency:20, glassBlur:blur });
    assert.equal(s.root.dataset.glassStyle, expected);
    assert.equal(s.root.dataset.glass, enabled ? "enabled" : "disabled");
    assert.equal(s.values["--glass-alpha"], "0.8");
    assert.equal(s.values["--glass-blur"], `${blur}px`);
    assert.equal(s.root.dataset.reduceTransparency, "true");
  }
});
test("page background resolves auto by material and falls back safely for unknown values", () => {
  const s = setup();
  for (const [theme, expected] of [
    [{ glassEnabled:true, glassBlur:4, glassTransparency:20 }, "shapes"],
    [{ glassEnabled:false, glassBlur:12, glassTransparency:20 }, "soft"],
    [{ glassEnabled:false, glassBlur:12, glassTransparency:20, glassBackdrop:"aurora" }, "aurora"],
    [{ glassEnabled:true, glassBlur:16, glassTransparency:20, glassBackdrop:"plain" }, "plain"],
    [{ glassEnabled:true, glassBlur:16, glassTransparency:20, glassBackdrop:"x;color:red" }, "shapes"]
  ]) {
    s.api.apply(theme);
    assert.equal(s.root.dataset.backdrop, expected);
  }
  s.api.previewColors({ glassEnabled:false, glassBlur:12, glassTransparency:20, glassBackdrop:"grid" });
  assert.equal(s.root.dataset.backdrop, "grid");
  s.api.clearColorPreview();
  assert.equal(s.root.dataset.backdrop, "shapes");
});
test("custom page background is sanitized before reaching CSS and dims images", () => {
  const s = setup();
  const base = { glassEnabled:false, glassBlur:12, glassTransparency:20, glassBackdrop:"custom" };
  s.api.apply({ ...base, glassCustomA:"#112233", glassCustomB:"#445566", glassCustomAngle:200, glassCustomPattern:"grid", glassCustomImage:"https://cdn.example.com/bg.jpg", glassCustomDim:80 });
  assert.equal(s.root.dataset.backdrop, "custom");
  assert.equal(s.values["--bd-a"], "#112233");
  assert.equal(s.values["--bd-angle"], "200deg");
  assert.equal(s.values["--bd-image"], 'url("https://cdn.example.com/bg.jpg")');
  assert.match(s.values["--bd-scrim"], /var\(--ui-bg\) 80%/);
  assert.deepEqual([s.values["--bd-grid-o"], s.values["--bd-dots-o"], s.values["--bd-lines-o"]], ["1", "0", "0"]);
  s.api.apply({ ...base, glassCustomA:"red;background:url(x)", glassCustomB:null, glassCustomAngle:9999, glassCustomPattern:"x", glassCustomImage:'https://e.test/a")};x{', glassCustomDim:5 });
  assert.equal(s.values["--bd-a"], "#0f766e");
  assert.equal(s.values["--bd-b"], "#94a3b8");
  assert.equal(s.values["--bd-angle"], "135deg");
  assert.equal(s.values["--bd-image"], "none");
  assert.equal(s.values["--bd-scrim"], "transparent");
  assert.deepEqual([s.values["--bd-grid-o"], s.values["--bd-dots-o"], s.values["--bd-lines-o"]], ["0", "0", "0"]);
  s.api.apply({ ...base, glassBackdrop:"executive" });
  assert.equal(s.root.dataset.backdrop, "executive");
});
test("shared layout applies on both modes, ignores draft mutations and resets legacy defaults", () => {
  const s = setup();
  for (const width of ["narrow", "standard", "wide"]) for (const density of ["compact", "comfortable"]) for (const cardStyle of ["outlined", "elevated", "flat"]) {
    const theme = { width, density, cardStyle };
    s.api.apply(theme);
    theme.width = "changed";
    for (const mode of ["light", "dark"]) {
      s.root.dataset.colorMode = mode; s.api.refreshColors();
      assert.equal(s.root.dataset.width, width);
      assert.equal(s.root.dataset.density, density);
      assert.equal(s.root.dataset.cardStyle, cardStyle);
    }
  }
  s.api.apply({});
  assert.equal(s.root.dataset.width, "standard");
  assert.equal(s.root.dataset.density, "comfortable");
  assert.equal(s.root.dataset.cardStyle, "outlined");
});
test("published palettes refresh with mode changes and do not follow unsaved edits", () => {
  const s = setup();
  const theme = { primary:"#1d4ed8", background:"#eff6ff", darkPrimary:"#c4b5fd", darkBackground:"#1c142b" };
  s.api.apply(theme);
  assert.equal(s.values["--ui-bg"], theme.background);
  assert.equal(s.values["--primary"], "var(--ui-primary)");
  theme.darkBackground = "#ffffff";
  s.root.dataset.colorMode = "dark"; s.api.refreshColors();
  assert.equal(s.values["--ui-bg"], "#1c142b");
  s.root.dataset.colorMode = "light"; s.api.refreshColors();
  assert.equal(s.values["--ui-bg"], "#eff6ff");
  assert.equal(s.api.palette({}, "dark")["--ui-surface"], "#1e293b");
  assert.equal(s.api.palette({}, "light")["--ui-text"], "#0f172a");
});
test("admin color previews follow both modes and restore the latest published palette", () => {
  const s = setup();
  const live = { primary:"#0f766e", background:"#f8fafc", darkPrimary:"#5eead4", darkBackground:"#0f172a", width:"wide" };
  const draft = { primary:"#1d4ed8", background:"#eff6ff", darkPrimary:"#c4b5fd", darkBackground:"#1c142b", width:"narrow" };
  s.api.apply(live);
  s.api.previewColors(draft);
  draft.darkBackground = "#ffffff";
  for (const mode of ["dark", "light", "dark", "light"]) {
    s.root.dataset.colorMode = mode; s.api.refreshColors();
    assert.equal(s.values["--ui-bg"], mode === "dark" ? "#1c142b" : "#eff6ff");
    assert.equal(s.values["--ui-primary"], s.api.palette({ ...draft, darkBackground:"#1c142b" }, mode)["--ui-primary"]);
    assert.equal(s.root.dataset.width, "wide");
  }
  s.api.clearColorPreview();
  assert.equal(s.values["--ui-bg"], live.background);
  s.root.dataset.colorMode = "dark"; s.api.refreshColors();
  assert.equal(s.values["--ui-bg"], live.darkBackground);
  s.api.previewColors(draft);
  s.api.apply({ ...live, darkBackground:"#27151d" });
  assert.equal(s.values["--ui-bg"], "#27151d");
});
const luminance = color => color.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
test("custom palettes retain readable text, muted text, accents and button labels", () => {
  const s = setup();
  for (const background of ["#000000", "#ffffff", "#777777", "#ff0000", "#00ff00", "#0000ff", "#eff6ff", "#1c142b"]) {
    for (const primary of [background, "#ffffff", "#000000", "#aabbcc"]) for (const mode of ["light", "dark"]) {
      const p = s.api.palette({ background, primary, darkBackground:background, darkPrimary:primary }, mode);
      for (const surface of ["--ui-bg", "--ui-surface", "--ui-raised"]) {
        assert.ok(contrast(p["--ui-text"], p[surface]) >= 4.5, `${background}: text on ${surface}`);
        assert.ok(contrast(p["--ui-muted"], p[surface]) >= 4.5, `${background}: muted on ${surface}`);
        assert.ok(contrast(p["--ui-primary"], p[surface]) >= 4.5, `${background}: accent on ${surface}`);
      }
      assert.ok(contrast(p["--ui-primary-ink"], p["--ui-primary"]) >= 4.5);
      for (const backdrop of [0, 255]) {
        const alpha = Number(p["--ui-glass-min-alpha"]);
        const composed = "#" + p["--ui-glass-rgb"].split(" ").map(c => Math.round(Number(c) * alpha + backdrop * (1 - alpha)).toString(16).padStart(2, "0")).join("");
        for (const key of ["--ui-text", "--ui-muted", "--ui-primary"]) assert.ok(contrast(p[key], composed) >= 4.5, `${background}: ${key} on glass`);
      }
    }
  }
});

test("preferences persist, ignore unknown fields, and synchronize across tabs", () => {
  const s = setup();
  s.api.setPreference("reduceMotion", true);
  assert.equal(JSON.parse(s.stored()).reduceMotion, true);
  s.api.setPreference("unknown", true);
  assert.equal(JSON.parse(s.stored()).unknown, undefined);
  s.replace('{"reduceTransparency":true}'); s.events.storage({ key:"unrelated" });
  assert.equal(s.root.dataset.reduceMotion, "true");
  s.events.storage({ key:"booking-accessibility" });
  assert.equal(s.root.dataset.reduceMotion, "false");
  assert.equal(s.root.dataset.reduceTransparency, "true");
  s.replace(null); s.events.storage({ key:null });
  assert.equal(s.root.dataset.reduceTransparency, "false");
});
test("malformed or blocked storage still allows browser-local accessibility controls", () => {
  for (const initial of ["bad json", "null", "[]", "42"]) {
    const s = setup(initial);
    s.api.setPreference("reduceMotion", true);
    assert.equal(s.root.dataset.reduceMotion, "true");
    assert.equal(JSON.parse(s.stored()).reduceMotion, true);
  }
  const s = setup("{}", true);
  assert.doesNotThrow(() => s.api.setPreference("reduceMotion", true));
  assert.equal(s.api.preferences().reduceMotion, true);
});

const paletteKey = "booking-published-palette-v1";
const ocean = { primary:"#0369a1", background:"#f0f9ff", darkPrimary:"#7dd3fc", darkBackground:"#082f49" };

test("published palette survives navigation and real light/dark startup without draft contamination", () => {
  const first = setup();
  first.api.apply({ ...ocean, glassMode:"frosted" });
  const cached = first.storage[paletteKey];
  assert.deepEqual(JSON.parse(cached), { version:1, colors:ocean });
  first.api.previewColors({ ...ocean, background:"#ffffff" });
  first.api.apply({ ...ocean, darkBackground:"#111111" }, { published:false });
  assert.equal(first.storage[paletteKey], cached);
  for (const mode of ["light", "dark"]) {
    const next = setup("{}", false, cached, true, mode);
    assert.equal(next.values["--ui-bg"], mode === "dark" ? ocean.darkBackground : ocean.background);
    assert.equal(next.values["--ui-primary"], next.api.palette(ocean, mode)["--ui-primary"]);
    assert.equal(next.root.dataset.appearanceLoading, "true");
    const fresh = { ...ocean, background:"#fff7ed", darkBackground:"#431407" };
    next.api.apply(fresh);
    next.api.reveal();
    assert.equal(next.root.dataset.appearanceLoading, "false");
    assert.equal(next.timers.size, 0);
    assert.equal(next.values["--ui-bg"], mode === "dark" ? fresh.darkBackground : fresh.background);
    assert.deepEqual(JSON.parse(next.storage[paletteKey]).colors, fresh);
  }
});

test("palette cache rejects malformed values and tolerates blocked storage", () => {
  const invalid = ["bad json", "null", "[]", JSON.stringify({ version:2, colors:ocean }),
    JSON.stringify({ version:1, colors:{ unexpected:"#000000" } }),
    JSON.stringify({ version:1, colors:{ background:["#000000"] } }),
    JSON.stringify({ version:1, colors:{ background:"invalid" } })];
  for (const cache of invalid) {
    const s = setup("{}", false, cache);
    assert.equal(s.values["--ui-bg"], undefined);
  }
  assert.doesNotThrow(() => setup("{}", true, JSON.stringify({ version:1, colors:ocean }), true, "dark"));
  const defaults = setup("{}", false, JSON.stringify({ version:1, colors:{} }));
  assert.equal(defaults.values["--ui-bg"], defaults.api.palette({}, "light")["--ui-bg"]);
});

test("initial reveal releases on errors or bounded timeout and late colors still apply", () => {
  const failed = setup("{}", false, null, true);
  failed.api.reveal();
  failed.api.reveal();
  assert.equal(failed.root.dataset.appearanceLoading, "false");
  assert.equal(failed.timers.size, 0);
  const slow = setup("{}", true, null, true);
  const timer = slow.timers.get(1);
  assert.equal(timer.delay, 1500);
  timer.fn();
  assert.equal(slow.root.dataset.appearanceLoading, "false");
  slow.api.apply(ocean);
  assert.equal(slow.values["--ui-bg"], ocean.background);
  const ordinary = setup();
  assert.equal(ordinary.timers.size, 0);
});

test("both entry points start appearance and mode exactly once before styles", () => {
  for (const path of ["../../app/index.html", "../../app/admin/index.html"]) {
    const html = fs.readFileSync(require.resolve(path), "utf8");
    assert.equal((html.match(/src="\/appearance.js"/g) || []).length, 1);
    assert.equal((html.match(/src="\/theme.js"/g) || []).length, 1);
    assert.ok(html.indexOf('src="/appearance.js"') < html.indexOf('src="/theme.js"'));
    assert.ok(html.indexOf('src="/theme.js"') < html.indexOf('rel="stylesheet"'));
    assert.match(html, /data-wait-for-appearance="true"/);
    assert.match(html, /html\[data-appearance-loading="true"\]/);
  }
});
