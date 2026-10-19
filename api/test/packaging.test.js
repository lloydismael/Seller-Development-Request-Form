const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const files = ["form-config.js", "form-schema.js", "csat-config.js", "csat-schema.js"];
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booking-package-"));
  t.after(() => fs.rmSync(dir, { recursive:true, force:true }));
  fs.mkdirSync(path.join(dir,"app")); fs.mkdirSync(path.join(dir,"api/scripts"), { recursive:true });
  files.forEach(name => fs.copyFileSync(path.join(root,"app",name), path.join(dir,"app",name)));
  fs.copyFileSync(path.join(root,"api/scripts/build-form-assets.js"), path.join(dir,"api/scripts/build-form-assets.js"));
  return dir;
}
function node(args, cwd) {
  // Explicit environment prevents loading real account/storage settings.
  return spawnSync(process.execPath, args, { cwd, encoding:"utf8", env:{ NODE_ENV:"test" } });
}
test("build copies canonical bytes, refreshes generated assets, and fails without source", t => {
  const dir = fixture(t), script = path.join(dir,"api/scripts/build-form-assets.js");
  const manifest = require("../package.json");
  assert.match(manifest.scripts.build, /scripts\/build-form-assets/);
  for (const hook of ["preinstall", "install", "postinstall", "prepare", "prestart"]) assert.equal(manifest.scripts[hook],undefined);
  assert.equal(node([script],dir).status,0);
  for (const name of files) assert.deepEqual(fs.readFileSync(path.join(dir,"api/src/form-assets",name)),fs.readFileSync(path.join(root,"app",name)));
  const changed = fs.readFileSync(path.join(dir,"app/form-config.js"),"utf8") + "\n// isolated build refresh\n";
  fs.writeFileSync(path.join(dir,"app/form-config.js"),changed);
  const build = manifest.scripts.build.slice(9, -1);
  const built = node(["-e",build],path.join(dir,"api"));
  assert.equal(built.status,0,built.stderr);
  assert.equal(fs.readFileSync(path.join(dir,"api/src/form-assets/form-config.js"),"utf8"),changed);
  fs.rmSync(path.join(dir,"app/form-schema.js"));
  assert.notEqual(node([script],dir).status,0);
  assert.equal(fs.readFileSync(path.join(dir,"api/src/form-assets/form-config.js"),"utf8"),changed);
});

test("repository loader prefers canonical assets and never masks their errors with generated defaults", t => {
  const dir = fixture(t); assert.equal(node(["api/scripts/build-form-assets.js"],dir).status,0);
  fs.copyFileSync(path.join(root,"api/src/form-assets-loader.js"),path.join(dir,"api/src/form-assets-loader.js"));
  fs.writeFileSync(path.join(dir,"api/src/form-assets/form-config.js"),"throw new Error('stale copy must not load');");
  const probe = "const assert=require('node:assert/strict'); const a=require('./api/src/form-assets-loader'); assert.equal(a.defaults,require('./app/form-config')); assert.equal(a.schema,require('./app/form-schema'));";
  assert.equal(node(["-e",probe],dir).status,0);
  fs.rmSync(path.join(dir,"app/form-schema.js"));
  assert.notEqual(node(["-e",probe],dir).status,0);
});

test("API-only package loads real forms and registers/invokes routes without outside app assets", t => {
  const dir = fixture(t); assert.equal(node(["api/scripts/build-form-assets.js"],dir).status,0);
  const pkg = path.join(dir,"isolated-package"); fs.mkdirSync(pkg);
  fs.cpSync(path.join(root,"api/src"),path.join(pkg,"src"),{ recursive:true });
  fs.cpSync(path.join(dir,"api/src/form-assets"),path.join(pkg,"src/form-assets"),{ recursive:true });
  for (const name of ["host.json", "package.json"]) fs.copyFileSync(path.join(root,"api",name),path.join(pkg,name));
  fs.rmSync(path.join(dir,"app"),{ recursive:true }); fs.rmSync(path.join(dir,"api"),{ recursive:true });
  const probe = `
    const assert = require('node:assert/strict'), Module = require('node:module'), path = require('node:path');
    const rows = new Map(), handlers = new Map(), loaded = [], original = Module._load;
    const settings = {
      async getWithVersion(id) { return rows.get(id) || null; },
      async compareAndSwap(id, value, version) {
        assert.equal(version,null); assert.equal(rows.has(id),false);
        rows.set(id,{ value, version:'isolated' });
      }
    };
    Module._load = function(name, parent, main) {
      if (name === '@azure/functions') return { app:{ http:(name, definition) => handlers.set(name,definition.handler) } };
      if (name === './store' || name === '../store') return { settings };
      if (path.isAbsolute(name)) {
        assert.ok(name.startsWith(process.cwd() + path.sep), 'outside-package dependency: ' + name);
        loaded.push(name);
      }
      return original.apply(this,arguments);
    };
    (async () => {
      const forms = require('./src/forms');
      require('./src/functions/api');
      const assets = require('./src/form-assets-loader');
      const config = assets.schema.validate(assets.defaults);
      Object.assign(config.theme, { glassEnabled:true, glassTransparency:35, glassBlur:18 });
      assets.schema.validate(config);
      rows.set('form-state', { value:{ id:'form-state', draft:{ config, revision:'draft-glass' },
        published:{ config, version:'published-glass' } }, version:'stored-glass' });
      const live = await forms.published();
      assert.equal(live.config.theme.glassEnabled,true);
      assert.equal((await forms.draft()).config.theme.glassBlur,18); assert.ok(live.version); assert.equal(live.config.questions.participants.type,'number');
      assert.equal((await forms.draft()).version,live.version);
      assert.ok(handlers.has('authProfile')); assert.ok(handlers.has('formPublish')); assert.ok(handlers.has('activity'));
      const result = await handlers.get('formConfig')({ method:'GET' });
      assert.equal(result.status,200); assert.deepEqual(result.jsonBody,live);
      for (const name of ['form-config.js','form-schema.js']) assert.ok(loaded.includes(path.join(process.cwd(),'src/form-assets',name)));
    })().catch(e => { console.error(e); process.exitCode=1; });
  `;
  const build = require("../package.json").scripts.build.slice(9, -1);
  const built = node(["-e", build], pkg); assert.equal(built.status, 0, built.stderr);
  const result = node(["-e",probe],pkg); assert.equal(result.status,0,result.stderr);
  fs.rmSync(path.join(pkg,"src/form-assets"),{ recursive:true });
  assert.notEqual(node(["-e", build],pkg).status,0,"Remote build must reject missing prebuilt assets");
  assert.notEqual(node(["-e",probe],pkg).status,0,"Unbuilt API-only package must fail rather than fabricate defaults");
});