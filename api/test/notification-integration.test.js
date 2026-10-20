const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./api-harness");
const defaults = require("../../app/form-config");
const rows = h => [...h.store.bookings.records.values()].map(row => row.value).filter(row => row.recordType === "email-notification" && row.state !== "skipped");
const values = () => ({ name:"Requestor", requesterEmail:"requestor@example.com", division:"LG Division", sd_lg:defaults.questions.sd_lg.choices[0], category:defaults.questions.category.choices[0].label,
  t_tech:defaults.questions.t_tech.choices[0], date:"2099-12-01", facilitator:defaults.questions.facilitator.choices[0], time:defaults.questions.time.choices[0], venue:defaults.questions.venue.choices[0], participants:25, recommendations:"Test" });
async function setup() {
  const h = harness();
  h.env.EMAIL_NOTIFICATIONS_ENABLED = "true";
  const token = await h.login();
  const account = (await h.store.accounts.list()).find(a => a.role === "admin");
  await h.store.accounts.put({ ...account, profile:{ ...account.profile, email:"admin@example.com" } });
  return { h, token };
}
test("new requests commit notifications atomically and never expose internal rows", async () => {
  const { h, token } = await setup();
  const result = await h.handlers.get("bookings")(h.request("POST", { formVersion:(await h.forms.published()).version, answerValues:values() }));
  assert.equal(result.status, 201);
  assert.equal(rows(h).length, 1);
  assert.equal((await h.store.bookings.list()).length, 1);
  const listing = await h.handlers.get("bookings")(h.request("GET", null, token));
  assert.equal(listing.jsonBody.length, 1);
  assert.equal(listing.jsonBody[0].recordType, undefined);
});
test("outbox persistence failure cannot commit a booking or a notification", async () => {
  const { h } = await setup();
  await h.forms.published();
  h.store.bookings.transact = async () => { throw new Error("Test transaction failure"); };
  const result = await h.handlers.get("bookings")(h.request("POST", { formVersion:(await h.forms.published()).version, answerValues:values() }));
  assert.equal(result.status, 500);
  assert.equal((await h.store.bookings.list()).length, 0);
  assert.equal(rows(h).length, 0);
});
test("approval commits requester mail once; ordinary edits do not retrigger it", async () => {
  const { h, token } = await setup();
  const result = await h.handlers.get("bookings")(h.request("POST", { formVersion:(await h.forms.published()).version, answerValues:values() }));
  const request = patch => ({ ...h.request("PUT", patch, token), params:{ id:result.jsonBody.id } });
  const approved = await h.handlers.get("bookingItem")(request({ status:"Approved" }));
  assert.equal(approved.status, 200);
  assert.equal(rows(h).length, 2);
  assert.equal((await h.handlers.get("bookingItem")(request({ adminNotes:"Updated note" }))).status, 200);
  assert.equal(rows(h).length, 2);
});
