const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../src/auth"), "utf8");
const settings = {
  ADMIN_USERNAME: "test-admin",
  ADMIN_PASSWORD: "test-only-password-not-for-deployment",
  SESSION_SECRET: "test-only-signing-secret-not-for-deployment"
};
function auth(env = {}, now = Date.now()) {
  const context = { module: { exports: {} }, process: { env: { ...settings, ...env } },
    require, Buffer, URL, Date: { now: () => now }, console: { warn() {} } };
  vm.runInNewContext(source, context);
  return context.module.exports;
}
const request = (headers = {}, url = "https://example.com/api/auth/me") => ({ headers: new Headers(headers), url });
const cookieRequest = token => request({ cookie: `other=value; sdrf_admin=${token}` });

test("production requires private password and strong signing secret", () => {
  for (const host of [{ WEBSITE_SITE_NAME: "test" }, { NODE_ENV: "production" }]) {
    assert.doesNotThrow(() => auth(host));
    for (const invalid of [
      { ADMIN_PASSWORD: "" }, { ADMIN_PASSWORD: "Admin@123" },
      { SESSION_SECRET: "" }, { SESSION_SECRET: "short" },
      { SESSION_SECRET: "sdrf-dev-secret-change-me" }
    ]) assert.throws(() => auth({ ...host, ...invalid }), /Production ADMIN_PASSWORD/);
  }
});

test("credentials require exact username and password", () => {
  const a = auth();
  assert.equal(a.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD), true);
  assert.equal(a.checkCredentials("wrong", settings.ADMIN_PASSWORD), false);
  assert.equal(a.checkCredentials(settings.ADMIN_USERNAME, "wrong"), false);
  assert.equal(a.checkCredentials(null, null), false);
});

test("signed cookies authenticate only until expiry and secret rotation", () => {
  const now = 1700000000000, a = auth({}, now), token = a.issueToken(settings.ADMIN_USERNAME);
  assert.equal(a.adminUser(cookieRequest(token)), settings.ADMIN_USERNAME);
  assert.equal(auth({}, now + a.TTL * 1000).isAdmin(cookieRequest(token)), false);
  assert.equal(auth({ SESSION_SECRET: "another-test-only-secret-with-sufficient-length" }, now).isAdmin(cookieRequest(token)), false);
  for (const value of ["", "broken", "payload.signature", `${token}x`, `${token}.extra`])
    assert.equal(a.isAdmin(cookieRequest(value)), false, `Invalid cookie accepted: ${value}`);
});

test("malformed signed payloads fail closed rather than throwing", () => {
  const a = auth();
  for (const data of [null, {}, { u: settings.ADMIN_USERNAME, exp: "invalid" }]) {
    const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
    const signature = crypto.createHmac("sha256", settings.SESSION_SECRET).update(payload).digest("base64url");
    assert.equal(a.isAdmin(cookieRequest(`${payload}.${signature}`)), false);
  }
});

test("session cookies use secure browser flags through the HTTPS proxy", () => {
  const a = auth();
  for (const req of [request(), request({ "x-forwarded-proto": "https, http" }, "http://backend/api")]) {
    const c = a.sessionCookie(req, "test", a.TTL);
    assert.equal(c.secure, true);
    assert.equal(c.httpOnly, true);
    assert.equal(c.sameSite, "Strict");
    assert.equal(c.path, "/");
  }
  assert.equal(a.sessionCookie(request({}, "http://localhost/api"), "test", a.TTL).secure, false);
  assert.equal(a.sessionCookie(request(), "", 0).maxAge, 0);
});

test("malformed optional SWA principals cannot break admin authorization", () => {
  const a = auth();
  for (const principal of [null, {}, { userRoles: {} }, { userRoles: "admin", userDetails: "unexpected" }, { userRoles: ["anonymous"] }]) {
    const encoded = Buffer.from(JSON.stringify(principal)).toString("base64");
    assert.equal(a.isAdmin(request({ "x-ms-client-principal": encoded })), false);
  }
});

const frontend = fs.readFileSync(require.resolve("../../app/data.js"), "utf8");
function browser(fetch) {
  let removed = false;
  const context = { window: {}, location: { hostname: "example.com", search: "" },
    URLSearchParams, AbortSignal, fetch, sessionStorage: { removeItem() { removed = true; } } };
  vm.runInNewContext(frontend, context);
  return { store: context.window.BookingStore, removed: () => removed };
}
const response = (status, data) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: () => "application/json" }, json: async () => data });

test("admin session transport failures are not reported as logged out", async () => {
  const b = browser(async url => url === "/api/health"
    ? response(200, { ok: true, storage: "table" }) : response(503, { error: "Session API unavailable" }));
  await assert.rejects(b.store.me(), /Session API unavailable/);
  await assert.rejects(b.store.logout(), /Session API unavailable/);
  assert.equal(b.removed(), false);
});

test("login, session and logout use same-origin credentials", async () => {
  const calls = [];
  const b = browser(async (url, options) => {
    calls.push({ url, options });
    return response(200, url === "/api/health" ? { ok: true, storage: "table" } : { user: "test-admin" });
  });
  assert.equal((await b.store.login("test-admin", "test-only")).user, "test-admin");
  assert.equal((await b.store.me()).user, "test-admin");
  await b.store.logout();
  assert.equal(b.removed(), true);
  for (const call of calls.filter(c => c.url !== "/api/health")) assert.equal(call.options.credentials, "same-origin");
});