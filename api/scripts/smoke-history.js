const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

async function smokeHistory(base, request = fetch) {
  const origin = new URL(base).origin;
  assert.equal(new URL(origin).protocol, "https:", "Production smoke checks require HTTPS");
  const get = (route, headers = {}) => request(origin + route, {
    headers: { Origin: origin, ...headers }, signal: AbortSignal.timeout(15000), redirect: "error"
  });
  const first = await get("/api/my-requests");
  assert.equal(first.status, 200, "History route must be deployed to the linked backend");
  assert.match(first.headers.get("cache-control") || "", /no-store/i);
  const cookie = first.headers.get("set-cookie");
  assert.ok(cookie, "History must establish a browser cookie");
  const attributes = cookie.split(";").slice(1).map(value => value.trim().toLowerCase());
  for (const attribute of ["httponly", "secure", "samesite=strict", "path=/api", "max-age=31536000"]) {
    assert.ok(attributes.includes(attribute), `Missing cookie attribute: ${attribute}`);
  }
  const initial = await first.json();
  assert.deepEqual(initial, { items: [], nextCursor: null, recognized: false });
  const headers = { Cookie: cookie.split(";")[0] };
  const returning = await get("/api/my-requests", headers);
  assert.equal(returning.status, 200);
  assert.deepEqual(await returning.json(), { items: [], nextCursor: null, recognized: true });
  const detail = await get("/api/my-requests/" + randomUUID(), headers);
  assert.equal(detail.status, 404, "Unknown requests must stay private");
  const health = await get("/api/health");
  assert.equal(health.status, 200);
  const status = await health.json();
  assert.equal(status.ok, true);
  assert.equal(status.storage, "table");
}

if (require.main === module) {
  smokeHistory(process.argv[2]).then(() => {
    console.log("History smoke passed: new and returning browser, cookie flags, unknown detail, table health. No bookings created.");
  }).catch(() => {
    console.error("History smoke failed. Check linked API deployment and cookie configuration; no saved requests were changed.");
    process.exitCode = 1;
  });
}
module.exports = { smokeHistory };
