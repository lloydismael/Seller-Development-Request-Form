const test = require("node:test");
const assert = require("node:assert/strict");
const { harness } = require("./api-harness");
const schema = require("../../app/form-schema");
const defaults = require("../../app/form-config");
const plain = value => JSON.parse(JSON.stringify(value));
function legacy() {
  const config = schema.validate(defaults);
  delete config.questions.requesterEmail;
  config.questions.name.next = "division";
  config.order = config.order.filter(id => id !== "requesterEmail");
  config.questions.name.title = "Custom requestor";
  return schema.validate(config);
}
test("legacy live/draft forms migrate once without rewriting old snapshots", async () => {
  const h = harness(), config = legacy(), draft = plain(config);
  draft.title = "Unsaved custom draft";
  await h.store.settings.put({ id:"form-version-old", config, version:"old" });
  await h.store.settings.put({ id:"form-state", draft:{ config:draft, revision:"draft-old" }, published:{ config, version:"old" } });
  const results = await Promise.all([h.forms.published(), h.forms.published()]);
  assert.equal(results[0].version, results[1].version);
  assert.notEqual(results[0].version, "old");
  assert.equal(results[0].config.questions.name.title, "Custom requestor");
  assert.equal(results[0].config.questions.name.next, "requesterEmail");
  assert.equal(results[0].config.questions.requesterEmail.next, "division");
  assert.equal((await h.forms.draft()).config.title, "Unsaved custom draft");
  assert.equal((await h.store.settings.get("form-version-old")).config.questions.requesterEmail, undefined);
  assert.equal((await h.forms.published()).version, results[0].version);
});
test("migration preserves an existing unrelated email question and its route", async () => {
  const h = harness(), config = legacy();
  config.questions.recommendations.next = "requesterEmail";
  config.questions.requesterEmail = { title:"Other contact", type:"email" };
  config.order.push("requesterEmail");
  await h.store.settings.put({ id:"form-state", draft:{ config, revision:"draft-old" }, published:{ config, version:"old" } });
  const live = await h.forms.published();
  assert.equal(live.config.questions.name.next, "requesterEmail_new");
  assert.equal(live.config.questions.requesterEmail.title, "Other contact");
  assert.equal(live.config.questions.recommendations.next, "requesterEmail");
  assert.equal(live.config.questions.requesterEmail_new.field, "requesterEmail");
});
test("Your Email is a required typed mapping and cannot be removed from drafts", async () => {
  const h = harness(), draft = await h.forms.draft();
  assert.equal(draft.config.questions.requesterEmail.type, "email");
  const config = plain(draft.config);
  config.questions.requesterEmail.type = "text";
  assert.throws(() => schema.validate(config), /required email/);
  config.questions.requesterEmail.type = "email";
  config.questions.requesterEmail.required = false;
  assert.throws(() => schema.validate(config), /required email/);
  await assert.rejects(h.forms.saveDraft({ config:legacy(), revision:draft.revision }), /cannot be removed/);
});
test("email mapping validates format and maximum length in submissions", () => {
  const config = schema.validate(defaults);
  const values = { name:"Requestor", requesterEmail:"  person@example.com  ", division:"LG Division", sd_lg:config.questions.sd_lg.choices[0], category:config.questions.category.choices[0].label,
    t_tech:config.questions.t_tech.choices[0], date:"2099-12-01", facilitator:config.questions.facilitator.choices[0], time:config.questions.time.choices[0], venue:config.questions.venue.choices[0], participants:25, recommendations:"Test" };
  assert.equal(schema.submission(config, values).requesterEmail, "person@example.com");
  for (const email of [undefined, "", "bad", "a@example.com\r\nBcc:other@example.com", "a".repeat(243) + "@example.com"]) {
    assert.throws(() => schema.submission(config, { ...values, requesterEmail:email }), { statusCode:400 });
  }
});
