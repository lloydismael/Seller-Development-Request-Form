const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../../app/data.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
function browser(search = "", hostname = "example.com", reply = () => ({ ok:true })) {
  const calls = [], local = new Map(), session = new Map([["sdrf_admin", "untrusted-old-session"]]);
  const context = { window:{}, location:{ hostname, search }, URLSearchParams, AbortSignal,
    localStorage:{ getItem:k => local.get(k) || null, setItem:(k, v) => local.set(k, v) },
    sessionStorage:{ getItem:k => session.get(k), setItem:(k, v) => session.set(k, v), removeItem:k => session.delete(k) },
    fetch:async (url, options) => {
      calls.push({ url, options });
      const result = url === "/api/health" ? { status:200, data:{ ok:true, storage:"table" } } : reply(url, options);
      return { ok:result.status >= 200 && result.status < 300, status:result.status,
        headers:{ get:name => name === "content-type" ? (result.contentType || "application/json") : result.headers?.[name] || null },
        json:async () => result.data };
    } };
  for (const file of ["form-config", "form-schema"]) vm.runInNewContext(fs.readFileSync(require.resolve(`../../app/${file}`), "utf8"), context);
  vm.runInNewContext(source, context);
  return { store:context.window.BookingStore, calls, local, session };
}
const config = require("../../app/form-config");
const profile = { displayName:"Test", email:"test@example.com", phone:"+1 555 0100" };
const password = { currentPassword:" old test password ", newPassword:" new test password ", confirmPassword:" new test password " };
const cases = [
  ["create", [{ formVersion:"v1", answerValues:{ participants:25 } }], "POST", "/api/bookings", { formVersion:"v1", answerValues:{ participants:25 } }],
  ["list", [], "GET", "/api/bookings"],
  ["update", ["id /?", { status:"Approved" }], "PUT", "/api/bookings/id%20%2F%3F", { status:"Approved" }],
  ["remove", ["id /?"], "DELETE", "/api/bookings/id%20%2F%3F"],
  ["availability", ["2026-12-01 &"], "GET", "/api/availability?date=2026-12-01%20%26"],
  ["listBlocks", [], "GET", "/api/blocks"],
  ["addBlock", [{ facilitator:"Test", startDate:"2026-12-01" }], "POST", "/api/blocks", { facilitator:"Test", startDate:"2026-12-01" }],
  ["removeBlock", ["id /?"], "DELETE", "/api/blocks/id%20%2F%3F"],
  ["login", ["test-admin", " test password "], "POST", "/api/auth/login", { username:"test-admin", password:" test password " }],
  ["me", [], "GET", "/api/auth/me"],
  ["logout", [], "POST", "/api/auth/logout", {}],
  ["profile", [], "GET", "/api/auth/profile"],
  ["updateProfile", [profile], "PUT", "/api/auth/profile", profile],
  ["changePassword", [password], "POST", "/api/auth/password", password],
  ["changePassword", Object.values(password), "POST", "/api/auth/password", password],
  ["formConfig", [], "GET", "/api/form-config"],
  ["formDraft", [], "GET", "/api/manage/form-draft"],
  ["saveFormDraft", [config, "draft-revision"], "PUT", "/api/manage/form-draft", { config, revision:"draft-revision" }],
  ["publishForm", ["draft-revision"], "POST", "/api/manage/form-publish", { revision:"draft-revision" }],
  ["activity", [{ page:2, action:"form.publish", from:"2026-10-14", empty:"", absent:undefined, nil:null }], "GET", "/api/manage/activity?page=2&action=form.publish&from=2026-10-14"],
  ["activity", [], "GET", "/api/manage/activity?"]
];
for (const [name, args, method, url, body] of cases) test(`persistent transport ${name}: ${method} ${url}`, async () => {
  const result = { marker:"server-response" }, b = browser("", "example.com", () => ({ status:200, data:result }));
  assert.deepEqual(plain(await b.store[name](...args)), result);
  assert.equal(b.calls.length,2);
  const call = b.calls[1]; assert.equal(call.url,url);
  assert.deepEqual(plain(call.options), { method, credentials:"same-origin", mode:"same-origin", cache:"no-store",
    headers:{ Accept:"application/json", ...(method === "GET" ? {} : { "X-Admin-Request":"1", "Content-Type":"application/json" }) },
    ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
  assert.equal(b.local.size,0); assert.equal(b.session.get("sdrf_admin"),"untrusted-old-session");
  await b.store.mode(); assert.equal(b.calls.length,2, "Healthy mode detection is cached");
});

test("admin adapter keeps positional draft/publish arguments for the current transport", async () => {
  const b = browser("", "example.com", () => ({ status:200, data:{} }));
  assert.equal(b.store.saveFormDraft.length,2); assert.equal(b.store.publishForm.length,1);
  // Pin the actual UI branches as well as the request bodies they choose.
  const ui = fs.readFileSync(require.resolve("../../app/admin/settings.js"), "utf8");
  assert.ok(ui.includes("ctx.S.saveFormDraft.length >= 2 ? ctx.S.saveFormDraft(normalized, draft.revision) : ctx.S.saveFormDraft({ config:normalized, revision:draft.revision })"));
  assert.ok(ui.includes("ctx.S.publishForm(ctx.S.saveFormDraft.length >= 2 ? draft.revision : { revision:draft.revision })"));
  const draft = { revision:"saved-revision" }, S = b.store;
  await (S.saveFormDraft.length >= 2 ? S.saveFormDraft(config, draft.revision) : S.saveFormDraft({ config, revision:draft.revision }));
  await S.publishForm(S.saveFormDraft.length >= 2 ? draft.revision : { revision:draft.revision });
  assert.deepEqual(JSON.parse(b.calls[1].options.body), { config, revision:draft.revision });
  assert.deepEqual(JSON.parse(b.calls[2].options.body), { revision:draft.revision });
});

test("demo identity is memory-only, ignores stale sessions, and clears on logout/reload", async () => {
  const b = browser("?storage=local", "localhost");
  assert.equal((await b.store.me()).user,null);
  await assert.rejects(b.store.login("admin", "wrong"), e => e.status === 401);
  assert.equal((await b.store.login("admin", "Admin@123")).provider,"demo");
  assert.equal((await b.store.me()).user,"admin");
  assert.equal((await browser("?storage=local", "localhost").store.me()).user,null);
  await b.store.logout(); assert.equal((await b.store.me()).user,null);
  assert.equal(b.local.size,0); assert.equal(b.session.get("sdrf_admin"),"untrusted-old-session");
  assert.equal(b.calls.length,0);
  for (const name of ["profile", "updateProfile", "changePassword", "formDraft", "saveFormDraft", "publishForm", "activity"])
    await assert.rejects(b.store[name](), e => e.status === 503 && e.code === "DEMO_UNAVAILABLE");
  assert.equal(b.local.size,0); assert.equal(b.calls.length,0);
});

test("draft preview blocks every mutation before fetching or writing", async () => {
  for (const hostname of ["localhost", "example.com"]) {
    const b = browser("?storage=local&preview=draft", hostname);
    for (const [name, args, method] of cases.filter(c => c[2] !== "GET"))
      await assert.rejects(b.store[name](...args), e => e.status === 403 && e.code === "PREVIEW_READ_ONLY", method);
    assert.throws(() => b.store.replaceLocal([], []), e => e.code === "PREVIEW_READ_ONLY");
    assert.equal(b.calls.length,0); assert.equal(b.local.size,0);
  }
});

test("transport preserves expiry/conflict/throttle metadata and committed audit warnings", async () => {
  for (const [status, data, code] of [[409, { error:"Record or form changed. Refresh." }, "FORM_EXPIRED"],
    [409, { error:"This form is outdated", code:"FORM_EXPIRED" }, "FORM_EXPIRED"],
    [409, { error:"Record changed. Reload.", code:"RECORD_CONFLICT" }, "RECORD_CONFLICT"],
    [409, { error:"Facilitator already booked", code:"SLOT_CONFLICT" }, "SLOT_CONFLICT"],
    [409, { error:"Facilitator already booked" }, "SLOT_CONFLICT"],
    [409, { error:"Conflict", code:"EXPLICIT_SERVER_CODE" }, "EXPLICIT_SERVER_CODE"],
    [401, {}, undefined], [429, { error:"Too many attempts" }, undefined]]) {
    const b = browser("", "example.com", () => ({ status, data, headers:{ "retry-after":"60" } }));
    await assert.rejects(b.store.saveFormDraft(config,"r1"), e => e.status === status && e.code === code && e.retryAfter === "60" && JSON.stringify(e.response) === JSON.stringify(data));
    assert.equal(b.local.size,0);
  }
  const b = browser("", "example.com", () => ({ status:200, data:{ saved:true }, headers:{ "x-audit-recorded":"false" } }));
  const result = await b.store.updateProfile(profile);
  assert.equal(result.saved,true); assert.equal(result.auditRecorded,false); assert.match(result.warning,/Do not retry/);
  assert.equal(b.calls.length,2, "Audit warning must not retry a committed mutation");
  const empty = browser("", "example.com", () => ({ status:204, data:null, contentType:"text/plain" }));
  assert.equal(await empty.store.remove("test"),null);
});

test("iframe preview policy permits self only and cannot be weakened by route overrides", () => {
  const config = JSON.parse(fs.readFileSync(require.resolve("../../app/staticwebapp.config.json"), "utf8"));
  assert.equal(config.globalHeaders["X-Frame-Options"], "SAMEORIGIN");
  const policy = config.globalHeaders["Content-Security-Policy"];
  const ancestors = policy.split(";").map(x => x.trim()).filter(x => /^frame-ancestors(?:\s|$)/i.test(x));
  assert.deepEqual(ancestors, ["frame-ancestors 'self'"]);
  for (const route of config.routes || []) {
    for (const key of Object.keys(route.headers || {}))
      assert.ok(!["x-frame-options", "content-security-policy"].includes(key.toLowerCase()), "Route must not override self-only framing");
  }
});