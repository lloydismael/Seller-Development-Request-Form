const test = require("node:test");
const assert = require("node:assert/strict");
const { harness:api } = require("./api-harness");

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
    ["blocks", "GET"], ["blocks", "POST"], ["blockItem", "DELETE"], ["authProfile", "GET"], ["authProfile", "PUT"],
    ["authPassword", "POST"], ["formDraft", "GET"], ["formDraft", "PUT"], ["formPublish", "POST"], ["activity", "GET"]]) {
    assert.equal((await a.handlers.get(name)(a.request(method, {}))).status, 401);
  }
  assert.equal(a.reads(), 0);
  assert.equal(a.writes(), 0);
  assert.equal((await a.handlers.get("health")()).status, 200);
  assert.equal((await a.handlers.get("availability")(a.request("GET"))).status, 200);
});

test("CSRF header and exact origin checks protect every write and support linked SWA", async () => {
  const a = api(), token = await a.login();
  for (const [name, method] of [["authLogin", "POST"], ["authLogout", "POST"], ["bookingItem", "PUT"], ["bookingItem", "DELETE"], ["blocks", "POST"], ["blockItem", "DELETE"], ["authProfile", "PUT"], ["authPassword", "POST"], ["formDraft", "PUT"], ["formPublish", "POST"]]) {
    assert.equal((await a.handlers.get(name)(a.request(method, {}, token, { "x-admin-request":"" }))).status, 403, name);
    assert.equal((await a.handlers.get(name)(a.request(method, {}, token, { origin:"https://evil.example" }))).status, 403, name);
  }
  for (const extra of [
    { origin:"https://site.example.evil", "x-forwarded-host":"site.example" },
    { origin:"https://site.example", "x-forwarded-host":"site.example,evil.example" },
    { origin:"https://site.example", "x-forwarded-host":"evil.example,site.example" },
    { origin:"https://site.example:444", "x-forwarded-host":"site.example" }, { origin:"null" },
    { "sec-fetch-site":"cross-site" }, { origin:"https://site.example", "x-forwarded-host":"site.example", "x-forwarded-proto":"https,http" }
  ]) assert.equal((await a.handlers.get("authLogout")(a.request("POST", {}, token, extra))).status, 403);
  const linked = a.request("POST", {}, token, { origin:"https://site.example", "x-forwarded-host":"site.example", "x-forwarded-proto":"https", host:"internal.azurewebsites.net" });
  linked.url = "https://internal.azurewebsites.net/api/auth/logout";
  assert.equal((await a.handlers.get("authLogout")(linked)).status, 200);
  const noOrigin = a.request("POST", {}, token); noOrigin.headers.delete("origin");
  assert.equal((await a.handlers.get("authLogout")(noOrigin)).status, 200);
});

test("profile/password use safe identity, record audit and invalidate old sessions", async () => {
  const a = api(), token = await a.login();
  const profile = await a.handlers.get("authProfile")(a.request("PUT", { displayName:"Test Display", email:"test@example.com", phone:"+1 555" }, token));
  assert.equal(profile.status, 200); assert.equal(profile.jsonBody.profile.displayName, "Test Display");
  assert.equal(profile.jsonBody.credentialVersion, undefined); assert.equal(profile.jsonBody.credential, undefined);
  assert.equal((await a.handlers.get("authProfile")(a.request("GET", null, token))).jsonBody.profile.email, "test@example.com");
  const password = await a.handlers.get("authPassword")(a.request("POST", { currentPassword:a.env.ADMIN_PASSWORD, newPassword:"replacement-test-password-123", confirmPassword:"replacement-test-password-123" }, token));
  assert.equal(password.status, 200); assert.equal(password.jsonBody.ok, true); assert.equal(password.cookies[0].maxAge, 0);
  assert.equal((await a.handlers.get("bookings")(a.request("GET", null, token))).status, 401);
  const activity = await a.store.activity.list();
  for (const action of ["profile.update", "password.change"]) assert.ok(activity.some(x => x.action === action && x.actor === a.env.ADMIN_USERNAME));
  assert.equal(JSON.stringify(activity).includes("replacement-test-password"), false);
  assert.equal(JSON.stringify(activity).includes("test@example.com"), false);
});

test("login issues credential snapshot; handler errors never leak backend details", async () => {
  const a = api(); a.store.accounts.get = async () => { throw new Error("secret-storage-connection-password"); };
  const result = await a.handlers.get("authLogin")(a.request("POST", { username:a.env.ADMIN_USERNAME, password:a.env.ADMIN_PASSWORD }));
  assert.equal(result.status, 500); assert.equal(JSON.stringify(result).includes("secret-storage"), false);
  const b = api(), token = await b.login(), payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url"));
  assert.equal(payload.v, 1); assert.equal(payload.u, b.env.ADMIN_USERNAME);
});

test("known account validation errors are actionable but input and backend secrets remain private", async () => {
  const a = api(), token = await a.login();
  for (const [name, method, input, expected] of [
    ["authPassword", "POST", { currentPassword:"incorrect-test-secret", newPassword:"new-test-password-123", confirmPassword:"new-test-password-123" }, /Current password is incorrect/],
    ["authPassword", "POST", { currentPassword:a.env.ADMIN_PASSWORD, newPassword:"short-secret", confirmPassword:"mismatch-secret" }, /12–128 characters/],
    ["authProfile", "PUT", { email:"invalid-secret-email" }, /Invalid profile field/],
    ["authProfile", "PUT", { role:"secret-admin" }, /Only displayName, email and phone/]
  ]) {
    const result = await a.handlers.get(name)(a.request(method, input, token));
    assert.equal(result.status, 400); assert.match(result.jsonBody.error, expected);
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.equal(JSON.stringify(result).includes(a.env.ADMIN_PASSWORD), false);
  }
  a.store.accounts.compareAndSwap = async () => { throw Object.assign(new Error("private-secret-storage"), { statusCode:400 }); };
  const hidden = await a.handlers.get("authProfile")(a.request("PUT", { displayName:"Safe" }, token));
  assert.equal(hidden.status, 400); assert.equal(JSON.stringify(hidden).includes("private-secret"), false);
});