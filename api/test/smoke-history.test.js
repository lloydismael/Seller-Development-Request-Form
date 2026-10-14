const test = require("node:test");
const assert = require("node:assert/strict");
const { smokeHistory } = require("../scripts/smoke-history");

function mockRequest({ missingRoute = false, insecureCookie = false } = {}) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Origin, "https://example.test");
    assert.equal(options.redirect, "error");
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: true, storage: "table" }));
    if (!url.endsWith("/api/my-requests")) return new Response("", { status: 404 });
    if (missingRoute) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ items: [], nextCursor: null, recognized: Boolean(options.headers.Cookie) }), {
      headers: { "cache-control": "no-store", "set-cookie": `sdrf_browser=test-token; max-age=31536000; path=/api; ${insecureCookie ? "" : "secure; "}samesite=strict; httponly` }
    });
  };
  return { request, calls };
}

test("history smoke accepts proxy-normalized cookie flags without modifying bookings", async () => {
  const { request, calls } = mockRequest();
  await smokeHistory("https://example.test/", request);
  assert.equal(calls.length, 4);
  assert.equal(calls[1].options.headers.Cookie, "sdrf_browser=test-token");
  assert.ok(calls.every(call => call.options.method === undefined));
});

test("history smoke detects missing deployments and insecure cookies", async () => {
  await assert.rejects(smokeHistory("https://example.test", mockRequest({ missingRoute: true }).request), /History route must be deployed/);
  await assert.rejects(smokeHistory("https://example.test", mockRequest({ insecureCookie: true }).request), /Missing cookie attribute: secure/);
});

test("history smoke refuses HTTP before making a request", async () => {
  const { request, calls } = mockRequest();
  await assert.rejects(smokeHistory("http://example.test", request), /require HTTPS/);
  assert.equal(calls.length, 0);
});
