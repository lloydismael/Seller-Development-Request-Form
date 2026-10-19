const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const os = require("node:os");
const directories = [];
test.after(() => { for (const dir of directories) fs.rmSync(dir, { recursive:true, force:true }); });

const source = fs.readFileSync(require.resolve("../src/auth"), "utf8");
const settings = {
  ADMIN_USERNAME: "test-admin",
  ADMIN_PASSWORD: "test-only-password-not-for-deployment",
  SESSION_SECRET: "test-only-signing-secret-not-for-deployment"
};
function auth(env = {}, now = Date.now(), file) {
  if (!file) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booking-auth-")); directories.push(dir); file = path.join(dir, "test.json"); }
  const production = env.NODE_ENV === "production" || env.WEBSITE_SITE_NAME;
  const environment = { ...settings, STORAGE_TEST_FILE:file, ...env };
  // Production guard tests only load auth; they must never touch real storage.
  const modules = {};
  function load(name) {
    if (modules[name]) return modules[name];
    const context = { module:{exports:{}}, process:{env:environment}, __dirname:path.dirname(require.resolve(`../src/${name}`)),
      require: dependency => dependency.startsWith("./") ? load(dependency.slice(2)) : require(dependency),
      Buffer, URL, Date:class extends Date { static now() { return now; } }, setTimeout, console:{warn(){}} };
    if (production && name === "accounts") return {};
    vm.runInNewContext(name === "auth" ? source : fs.readFileSync(require.resolve(`../src/${name}`), "utf8"), context);
    modules[name] = context.module.exports; return modules[name];
  }
  const result = load("auth");
  return Object.assign(result, { testStore:production ? null : load("store"), testFile:file });
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

test("credentials require exact username and password", async () => {
  const a = auth();
  assert.equal(await a.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD), true);
  assert.equal(await a.checkCredentials("wrong", settings.ADMIN_PASSWORD), false);
  assert.equal(await a.checkCredentials(settings.ADMIN_USERNAME, "wrong"), false);
  assert.equal(await a.checkCredentials(null, null), false);
});

test("signed cookies authenticate only until expiry and secret rotation", async () => {
  const now = 1700000000000, a = auth({}, now);
  await a.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD);
  const token = a.issueToken(settings.ADMIN_USERNAME, 1);
  assert.throws(() => a.issueToken(settings.ADMIN_USERNAME), /persisted credential version/);
  assert.equal(await a.adminUser(cookieRequest(token)), settings.ADMIN_USERNAME);
  assert.equal(await auth({}, now + a.TTL * 1000, a.testFile).isAdmin(cookieRequest(token)), false);
  assert.equal(await auth({ SESSION_SECRET: "another-test-only-secret-with-sufficient-length" }, now, a.testFile).isAdmin(cookieRequest(token)), false);
  for (const value of ["", "broken", "payload.signature", `${token}x`, `${token}.extra`])
    assert.equal(await a.isAdmin(cookieRequest(value)), false, "Invalid cookie accepted");
});

test("malformed signed payloads fail closed rather than throwing", async () => {
  const a = auth();
  for (const data of [null, {}, { u: settings.ADMIN_USERNAME, exp: "invalid" }, { u:settings.ADMIN_USERNAME, exp:Math.floor(Date.now()/1000)+1000 }]) {
    const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
    const signature = crypto.createHmac("sha256", settings.SESSION_SECRET).update(payload).digest("base64url");
    assert.equal(await a.isAdmin(cookieRequest(`${payload}.${signature}`)), false);
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

test("malformed optional SWA principals cannot break admin authorization", async () => {
  const a = auth();
  for (const principal of [null, {}, { userRoles: {} }, { userRoles: "admin", userDetails: "unexpected" }, { userRoles: ["anonymous"] }]) {
    const encoded = Buffer.from(JSON.stringify(principal)).toString("base64");
    assert.equal(await a.isAdmin(request({ "x-ms-client-principal": encoded })), false);
  }
});

test("bootstrap is create-only, hashed, and environment changes never replace credentials", async () => {
  const a = auth(), b = auth({ ADMIN_PASSWORD:"different-test-password" }, Date.now(), a.testFile);
  const results = await Promise.all([a.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD),
    b.checkCredentials(settings.ADMIN_USERNAME, "different-test-password")]);
  assert.equal(results.filter(Boolean).length, 1);
  const rows = await a.testStore.accounts.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].credential.algorithm, "scrypt-v1");
  assert.equal(rows[0].credential.salt.length, 32);
  assert.equal(rows[0].credential.hash.length, 128);
  const persisted = fs.readFileSync(a.testFile, "utf8");
  assert.equal(persisted.includes(settings.ADMIN_PASSWORD), false);
  assert.equal(persisted.includes("different-test-password"), false);
  const winner = results[0] ? settings.ADMIN_PASSWORD : "different-test-password";
  const restarted = auth({ ADMIN_PASSWORD:"stale-env-test-password", ADMIN_USERNAME:"changed-env" }, Date.now(), a.testFile);
  assert.equal(await restarted.checkCredentials(settings.ADMIN_USERNAME, winner), true);
  assert.equal(await restarted.checkCredentials("changed-env", "stale-env-test-password"), false);
});

test("profile ownership and password change revoke sessions without leaking credential state", async () => {
  const a = auth();
  await a.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD);
  const req = cookieRequest(a.issueToken(settings.ADMIN_USERNAME, 1));
  await assert.rejects(a.updateProfile(request(), { displayName:"Other" }), e => e.statusCode === 401);
  for (const patch of [{ id:"other" }, { username:"other" }, { credentialVersion:99 }, { email:"invalid" }, { phone:"bad" }, { displayName:"" }])
    await assert.rejects(a.updateProfile(req, patch), e => e.statusCode === 400);
  const profile = await a.updateProfile(req, { displayName:"Test Name", email:"test@example.com", phone:"+1 555 0100" });
  assert.equal(profile.id, "local-admin");
  assert.equal(profile.user, settings.ADMIN_USERNAME);
  assert.equal(profile.profile.displayName, "Test Name");
  assert.deepEqual(Object.keys(profile).sort(), ["credentialVersion", "disabled", "facilitatorLabel", "id", "profile", "provider", "role", "user"]);
  const password = "  test-new-password  ";
  for (const input of [
    { currentPassword:settings.ADMIN_PASSWORD, newPassword:"short", confirmPassword:"short" },
    { currentPassword:settings.ADMIN_PASSWORD, newPassword:"x".repeat(129), confirmPassword:"x".repeat(129) },
    { currentPassword:settings.ADMIN_PASSWORD, newPassword:password, confirmPassword:password.trim() },
    { currentPassword:settings.ADMIN_PASSWORD, newPassword:settings.ADMIN_PASSWORD, confirmPassword:settings.ADMIN_PASSWORD },
    { currentPassword:"wrong", newPassword:password, confirmPassword:password }
  ]) await assert.rejects(a.changePassword(req, input), e => e.statusCode === 400);
  const changed = await a.changePassword(req, { currentPassword:settings.ADMIN_PASSWORD, newPassword:password, confirmPassword:password });
  assert.equal(changed.credentialVersion, 2);
  assert.equal(JSON.stringify(changed).includes("credential\""), false);
  assert.equal(await a.isAdmin(req), false);
  assert.equal(await a.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD), false);
  assert.equal(await a.checkCredentials(settings.ADMIN_USERNAME, password.trim()), false);
  assert.equal(await a.checkCredentials(settings.ADMIN_USERNAME, password), true);
  const fresh = cookieRequest(a.issueToken(settings.ADMIN_USERNAME, changed.credentialVersion));
  assert.equal(await a.isAdmin(fresh), true);
  assert.equal((await auth({}, Date.now(), a.testFile).getProfile(fresh)).profile.email, "test@example.com");
});

test("persisted login limits are bounded per account and unknown users do not deny bootstrap", async () => {
  const now = Date.now(), a = auth({}, now);
  for (let i = 0; i < 20; i++) assert.equal(await a.checkCredentials(`unknown-${i}`, "test-password"), false);
  assert.equal(await a.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD), true);
  for (let i = 0; i < 5; i++) assert.equal(await a.checkCredentials(settings.ADMIN_USERNAME, "wrong"), false);
  const restarted = auth({}, now, a.testFile);
  assert.equal(await restarted.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD), false);
  const account = await a.testStore.accounts.get("local-admin");
  assert.equal(account.attempts.login.count, 5);
  assert.equal((await a.testStore.accounts.list()).length, 1);
  assert.equal(await auth({}, now + 15*60*1000, a.testFile).checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD), true);
});

test("SWA identities keep provider ownership, profile persistence, and external password management", async () => {
  const a = auth();
  const principal = { identityProvider:"aad", userId:"test-id", userDetails:"test@example.com", userRoles:["admin"] };
  const req = request({ "x-ms-client-principal":Buffer.from(JSON.stringify(principal)).toString("base64") });
  assert.equal(await a.adminUser(req), principal.userDetails);
  const who = await a.getIdentity(req);
  assert.equal(who.provider, "swa:aad");
  await a.updateProfile(req, { displayName:"Provider Name" });
  assert.equal((await auth({}, Date.now(), a.testFile).getProfile(req)).profile.displayName, "Provider Name");
  await assert.rejects(a.changePassword(req, {}), /identity provider/);
  const anonymous = request({ "x-ms-client-principal":Buffer.from(JSON.stringify({ ...principal, userRoles:["anonymous"] })).toString("base64") });
  assert.equal(await a.isAdmin(anonymous), false);
});

test("corrupt persisted storage never falls back to bootstrap", async () => {
  const a = auth();
  fs.writeFileSync(a.testFile, "invalid-json");
  await assert.rejects(a.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD));
  assert.equal(fs.readFileSync(a.testFile, "utf8"), "invalid-json");
});

test("login returns a safe version snapshot and concurrent password changes have one winner", async () => {
  const a = auth();
  const who = await a.authenticateIdentity(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD);
  assert.equal(who.credentialVersion, 1);
  assert.equal(who.provider, "local");
  assert.equal("credential" in who, false);
  assert.equal(await a.authenticateIdentity("unknown", settings.ADMIN_PASSWORD), null);
  const req = cookieRequest(a.issueToken(who.user, who.credentialVersion));
  const b = auth({}, Date.now(), a.testFile);
  const changes = await Promise.allSettled([a.changePassword(req, {
    currentPassword:settings.ADMIN_PASSWORD, newPassword:"first-test-new-password", confirmPassword:"first-test-new-password"
  }), b.changePassword(req, {
    currentPassword:settings.ADMIN_PASSWORD, newPassword:"second-test-new-password", confirmPassword:"second-test-new-password"
  })]);
  assert.equal(changes.filter(r => r.status === "fulfilled").length, 1);
  assert.ok([401, 409].includes(changes.find(r => r.status === "rejected").reason.statusCode));
  assert.equal((await a.testStore.accounts.get("local-admin")).credentialVersion, 2);
  assert.equal(await a.isAdmin(cookieRequest(a.issueToken(who.user, who.credentialVersion))), false);
});

test("password verification attempts persist and expire separately from login attempts", async () => {
  const now = Date.now(), a = auth({}, now);
  await a.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD);
  const req = cookieRequest(a.issueToken(settings.ADMIN_USERNAME, 1));
  const input = { currentPassword:"wrong", newPassword:"new-test-password", confirmPassword:"new-test-password" };
  for (let i = 0; i < 5; i++) await assert.rejects(a.changePassword(req, input), e => e.statusCode === 400);
  const b = auth({}, now, a.testFile);
  await assert.rejects(b.changePassword(req, { ...input, currentPassword:settings.ADMIN_PASSWORD }), e => e.statusCode === 429);
  assert.equal(await b.checkCredentials(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD), true);
  const attempts = (await a.testStore.accounts.get("local-admin")).attempts;
  assert.equal(attempts.password.count, 5);
  assert.equal(Object.keys(attempts).length, 2);
  const later = auth({}, now + 15*60*1000, a.testFile);
  const changed = await later.changePassword(req, { ...input, currentPassword:settings.ADMIN_PASSWORD });
  assert.equal(changed.credentialVersion, 2);
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
  assert.equal(b.removed(), false, "API logout must not manipulate browser session storage");
  for (const call of calls.filter(c => c.url !== "/api/health")) assert.equal(call.options.credentials, "same-origin");
});