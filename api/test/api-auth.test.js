const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const authSource = fs.readFileSync(require.resolve("../src/auth"), "utf8");
const apiSource = fs.readFileSync(require.resolve("../src/functions/api"), "utf8");

function api() {
  const env = { WEBSITE_SITE_NAME: "test", ADMIN_USERNAME: "test-admin",
    ADMIN_PASSWORD: "test-only-password-not-for-deployment",
    SESSION_SECRET: "test-only-signing-secret-not-for-deployment" };
  const context = { module: { exports: {} }, process: { env }, require, Buffer, URL, Date,
    console: { warn() {} } };
  vm.runInNewContext(authSource, context);
  const auth = context.module.exports, handlers = new Map();
  let reads = 0, writes = 0;
  const collection = {
    async list() { reads++; return []; }, async get() { reads++; return null; },
    async put() { writes++; }, async remove() { writes++; }
  };
  vm.runInNewContext(apiSource, {
    setTimeout: callback => { callback(); }, require(name) {
      if (name === "@azure/functions") return { app: { http: (name, definition) => handlers.set(name, definition.handler) } };
      if (name === "../auth") return auth;
      if (name === "../store") return { kind: "table", bookings: collection, blocks: collection, async checkConnection() {} };
      if (name === "../rules") return require("../src/rules");
      return require(name);
    }
  });
  const request = (method, body, token) => ({ method, url: "https://example.com/api",
    headers: new Headers(token ? { cookie: `sdrf_admin=${token}` } : {}),
    params: { id: "test" }, query: new URLSearchParams("date=2026-12-01"), json: async () => body });
  return { handlers, request, env, reads: () => reads, writes: () => writes };
}

test("login, me, protected reads and logout preserve signed-cookie contracts", async () => {
  const a = api();
  const anonymous = await a.handlers.get("authMe")(a.request("GET"));
  assert.equal(anonymous.jsonBody.user, null);
  const wrong = await a.handlers.get("authLogin")(a.request("POST", { username: "test-admin", password: "wrong" }));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.cookies, undefined);
  const login = await a.handlers.get("authLogin")(a.request("POST", { username: a.env.ADMIN_USERNAME, password: a.env.ADMIN_PASSWORD }));
  assert.equal(login.status, 200);
  const cookie = login.cookies[0];
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httpOnly, true);
  const me = await a.handlers.get("authMe")(a.request("GET", null, cookie.value));
  assert.equal(me.jsonBody.user, a.env.ADMIN_USERNAME);
  assert.equal((await a.handlers.get("bookings")(a.request("GET", null, cookie.value))).status, 200);
  assert.equal((await a.handlers.get("blocks")(a.request("GET", null, cookie.value))).status, 200);
  const logout = await a.handlers.get("authLogout")(a.request("POST", null, cookie.value));
  assert.equal(logout.status, 200);
  assert.equal(logout.cookies[0].value, "");
  assert.equal(logout.cookies[0].maxAge, 0);
  assert.equal((await a.handlers.get("bookings")(a.request("GET"))).status, 401);
  for (const result of [anonymous, wrong, login, me, logout])
    assert.equal(result.headers["Cache-Control"], "no-store");
});

test("all private operations reject anonymous callers before storage access", async () => {
  const a = api();
  for (const [name, method] of [["bookings", "GET"], ["bookingItem", "PUT"], ["bookingItem", "DELETE"],
    ["blocks", "GET"], ["blocks", "POST"], ["blockItem", "DELETE"]]) {
    assert.equal((await a.handlers.get(name)(a.request(method, {}))).status, 401);
  }
  assert.equal(a.reads(), 0);
  assert.equal(a.writes(), 0);
  assert.equal((await a.handlers.get("health")()).status, 200);
  assert.equal((await a.handlers.get("availability")(a.request("GET"))).status, 200);
});