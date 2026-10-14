const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../../app/admin/admin.js"), "utf8");
const bootstrap = source.slice(source.indexOf("  let user, identity;"), source.indexOf('  $("#app").hidden = false;'));
const initialize = source.slice(source.indexOf("  async function initialize()"), source.lastIndexOf("})();"));

function setup({ configFailure = false, modeFailure = false, authFailure = false, signedIn = false, pendingConfig } = {}) {
  const events = [], nodes = {}, colors = {};
  const root = { dataset:{ waitForAppearance:"true" }, style:{ setProperty:(key, value) => { colors[key] = value; } } };
  let timer, calls = 0;
  const config = { theme:{ background:"#eff6ff", primary:"#1d4ed8", darkBackground:"#082f49", darkPrimary:"#38bdf8" } };
  const context = {
    window:{ addEventListener:() => {} }, document:{ documentElement:root },
    localStorage:{ getItem:() => null, setItem:() => {} },
    setTimeout:fn => { timer = fn; return 1; }, clearTimeout:() => { timer = null; },
    location:{ hostname:"example.test", port:"", reload:() => {} },
    $:id => nodes[id] ||= { hidden:true }, esc:value => value,
    mode:null, sourceConfig:null,
    applyConfig:value => { context.sourceConfig = value; context.window.BookingAppearance.apply(value.theme); events.push("config"); },
    showLogin:async () => {
      events.push("login");
      assert.equal(root.dataset.appearanceLoading, "false");
      return { user:"admin" };
    },
    reload:async () => { events.push("reload"); },
    S:{
      mode:async () => { if (modeFailure) throw new Error("Transport unavailable"); return "api"; },
      formConfig:async () => {
        calls++;
        if (pendingConfig) await pendingConfig;
        if (configFailure && calls === 1) throw new Error("Config unavailable");
        return { config };
      },
      me:async () => { events.push("identity"); if (authFailure) throw new Error("Identity unavailable"); return { user:signedIn ? "admin" : null }; }
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../../app/appearance.js"), "utf8"), context);
  const originalReveal = context.window.BookingAppearance.reveal;
  context.window.BookingAppearance.reveal = () => { events.push("reveal"); originalReveal(); };
  return { context, events, nodes, root, colors, calls:() => calls, timeout:() => timer(),
    bootstrap:() => vm.runInNewContext(`(async () => { ${bootstrap} })()`, context),
    initialize:() => vm.runInNewContext(`(async () => { ${initialize} })()`, context) };
}

test("admin published colors apply before reveal and sign-in without duplicate configuration loads", async () => {
  for (const signedIn of [false, true]) {
    const s = setup({ signedIn });
    await s.bootstrap();
    assert.deepEqual(s.events.slice(0, 3), ["config", "reveal", "identity"]);
    assert.equal(s.colors["--ui-bg"], "#eff6ff");
    assert.equal(s.root.dataset.appearanceLoading, "false");
    await s.initialize();
    assert.equal(s.calls(), 1);
    assert.equal(s.events.at(-1), "reload");
  }
});

test("failed pre-login configuration reveals sign-in and retries after authentication", async () => {
  const s = setup({ configFailure:true });
  await s.bootstrap();
  assert.ok(s.events.includes("login"));
  assert.equal(s.root.dataset.appearanceLoading, "false");
  await s.initialize();
  assert.equal(s.calls(), 2);
  assert.equal(s.colors["--ui-bg"], "#eff6ff");
});

test("admin transport and identity failures reveal connection retry UI", async () => {
  for (const options of [{ modeFailure:true }, { authFailure:true }]) {
    const s = setup(options);
    await s.bootstrap();
    assert.equal(s.root.dataset.appearanceLoading, "false");
    assert.equal(s.nodes["#gate"].hidden, false);
    assert.equal(s.nodes["#loginErr"].hidden, false);
    assert.equal(s.nodes["#loginBtn"].textContent, "Retry connection");
  }
});

test("slow admin configuration has a bounded reveal and still applies authoritative colors", async () => {
  let resolve;
  const s = setup({ pendingConfig:new Promise(done => { resolve = done; }) });
  const loading = s.bootstrap();
  await Promise.resolve();
  assert.equal(s.root.dataset.appearanceLoading, "true");
  s.timeout();
  assert.equal(s.root.dataset.appearanceLoading, "false");
  resolve();
  await loading;
  assert.equal(s.colors["--ui-bg"], "#eff6ff");
  assert.ok(s.events.includes("login"));
});
