const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function runtime(file) {
  const env = { ADMIN_USERNAME:"storage-admin", ADMIN_PASSWORD:"Storage-admin-password", SESSION_SECRET:"Storage-session-secret-with-enough-characters", STORAGE_TEST_FILE:file };
  const cache = new Map();
  function load(name) {
    const filename = require.resolve(`../src/${name}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports:{} }; cache.set(filename, mod);
    const localRequire = dependency => dependency.startsWith("./") ? load(dependency.slice(2)) : require(dependency);
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), { module:mod, exports:mod.exports, require:localRequire,
      __dirname:path.dirname(filename), process:{ env }, Buffer, URL, Date, setTimeout, console:{ warn() {} } }, { filename });
    return mod.exports;
  }
  return { accounts:load("accounts"), store:load("store"), auth:load("auth") };
}

test("supervisor credentials, directory and revocation persist across backend restarts", async () => {
  const file = path.join(__dirname, `supervisor-storage-${crypto.randomUUID()}.json`);
  try {
    const first = runtime(file), admin = await first.accounts.bootstrap();
    const created = await first.accounts.manageSupervisors(admin, { username:"persistent-supervisor", password:"Persistent-supervisor-password" });
    const second = runtime(file);
    const who = await second.accounts.authenticateIdentity("persistent-supervisor", "Persistent-supervisor-password");
    assert.equal(who.id, created.id); assert.equal(who.role, "supervisor");
    const token = second.auth.issueToken(who.user, who.credentialVersion);
    const req = { headers:new Headers({ cookie:`sdrf_admin=${token}` }) };
    assert.equal((await second.auth.getIdentity(req)).role, "supervisor");
    const directory = await second.store.accounts.get("facilitator-directory");
    assert.deepEqual(JSON.parse(JSON.stringify(directory.labels)), {});
    await first.accounts.manageSupervisors(admin, { password:"Persistent-reset-password", disabled:true }, created.id);
    const third = runtime(file);
    assert.equal(await third.auth.getIdentity(req), null);
    assert.equal(await third.accounts.authenticateIdentity(who.user, "Persistent-reset-password"), null);
    await third.accounts.manageSupervisors(admin, { disabled:false }, created.id);
    const fourth = runtime(file);
    assert.equal(await fourth.accounts.authenticateIdentity(who.user, "Persistent-supervisor-password"), null);
    assert.equal((await fourth.accounts.authenticateIdentity(who.user, "Persistent-reset-password")).role, "supervisor");
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /Persistent-supervisor-password|Persistent-reset-password/);
  } finally { fs.rmSync(file, { force:true }); }
});
