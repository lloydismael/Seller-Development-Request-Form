/* Real modules with isolated in-memory CAS storage: no local/live mutations. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function harness() {
  const env = { ADMIN_USERNAME:"test-admin", ADMIN_PASSWORD:"test-only-password-not-for-deployment", SESSION_SECRET:"test-only-signing-secret-not-for-deployment" };
  let reads = 0, writes = 0, version = 0;
  const collection = () => {
    const records = new Map(), clone = o => JSON.parse(JSON.stringify(o));
    return {
      records,
      async list() { reads++; return [...records.values()].filter(x => !x.value.recordType).map(x => clone(x.value)); },
      async listRelated(id, type = "csat-attendee") { return [...records.values()].filter(x => x.value.csatSession === id && x.value.recordType === type).map(x => clone(x.value)); },
      async transact(operations) {
        for (const o of operations) {
          const current = records.get(o.value.id);
          if (o.version === null ? current : !current || current.version !== o.version) throw Object.assign(new Error("CAS conflict"), { statusCode:409 });
        }
        for (const o of operations) { writes++; records.set(o.value.id, { value:clone(o.value), version:String(++version) }); }
      },
      async get(id) { reads++; return records.has(id) ? clone(records.get(id).value) : null; },
      async getWithVersion(id) { reads++; return records.has(id) ? clone(records.get(id)) : null; },
      async put(value) { writes++; records.set(value.id, { value:clone(value), version:String(++version) }); return value; },
      async remove(id) { writes++; records.delete(id); },
      async insert(value) { return this.compareAndSwap(value.id, value, null); },
      async compareAndSwap(id, value, expected) {
        if (id !== value.id) throw new TypeError("ID mismatch");
        const current = records.get(id);
        if ((expected === null && current) || (expected !== null && (!current || current.version !== expected))) throw Object.assign(new Error("CAS conflict"), { statusCode:409 });
        return this.put(value);
      }
    };
  };
  const store = { kind:"test", async checkConnection() {}, bookings:collection(), blocks:collection(), settings:collection(), activity:collection(), accounts:collection() };
  const handlers = new Map(), cache = new Map();
  function load(file) {
    file = require.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports:{} }; cache.set(file, mod);
    const localRequire = name => {
      if (name === "@azure/functions") return { app:{ http:(name, definition) => handlers.set(name, definition.handler) } };
      if (name.startsWith(".")) {
        const resolved = require.resolve(path.resolve(path.dirname(file), name));
        if (resolved === require.resolve("../src/store")) return store;
        return load(resolved);
      }
      return require(name);
    };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { module:mod, exports:mod.exports, require:localRequire, __dirname:path.dirname(file), process:{ env }, Buffer, URL, Date, console:{ warn() {} }, setTimeout:callback => callback() }, { filename:file });
    return mod.exports;
  }
  const auth = load(path.resolve(__dirname, "../src/auth.js")), forms = load(path.resolve(__dirname, "../src/forms.js"));
  load(path.resolve(__dirname, "../src/functions/api.js"));
  const request = (method, body, token, extra = {}) => ({ method, url:"https://example.com/api", headers:new Headers({ "x-admin-request":"1", origin:"https://example.com", ...(token ? { cookie:`sdrf_admin=${token}` } : {}), ...extra }), params:{ id:"test" }, query:new URLSearchParams("date=2026-12-01"), json:async () => body });
  async function login() {
    const result = await handlers.get("authLogin")(request("POST", { username:env.ADMIN_USERNAME, password:env.ADMIN_PASSWORD }));
    if (result.status !== 200) throw new Error("Test login failed");
    return result.cookies[0].value;
  }
  return { handlers, request, login, store, auth, forms, load, env, reads:() => reads, writes:() => writes };
}
module.exports = { harness };