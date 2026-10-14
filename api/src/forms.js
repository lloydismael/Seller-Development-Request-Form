const { randomUUID } = require("crypto");
const store = require("./store");
const { schema, defaults } = require("./form-assets-loader");
const STATE_ID = "form-state";
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode, expose:true });
const conflict = () => fail("The form changed. Reload the latest form/draft and retry.", 409);
async function state() {
  let current = await store.settings.getWithVersion(STATE_ID);
  if (!current) {
    const config = schema.validate(defaults), revision = randomUUID();
    const initial = schema.size({ id:STATE_ID, draft:{ config, revision }, published:{ config, version:revision } });
    // Create snapshot first. Orphan snapshots from a failed CAS are never served.
    await snapshot(revision, config);
    try { await store.settings.compareAndSwap(STATE_ID, initial, null); }
    catch (e) { if (e.statusCode !== 409) throw e; }
    current = await store.settings.getWithVersion(STATE_ID);
  }
  if (!current || !current.value.draft || !current.value.published) throw fail("Form configuration is unavailable.", 503);
  // Persisted corruption fails closed; do not silently fall back to source defaults.
  try { schema.size(current.value); schema.validate(current.value.draft.config); schema.validate(current.value.published.config); }
  catch { throw fail("Stored form configuration is invalid.", 503); }
  return current;
}
async function snapshot(version, config) {
  await store.settings.compareAndSwap("form-version-" + version, schema.size({ id:"form-version-" + version, config, version }), null);
}
async function published() { return (await state()).value.published; }
async function draft() {
  const current = await state();
  return { ...current.value.draft, version:current.value.published.version };
}
async function saveDraft(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["config", "revision"].includes(k))) throw fail("Supply {config, revision}.", 400);
  const config = schema.validate(input.config), current = await state();
  if (input.revision !== current.value.draft.revision) throw conflict();
  const next = schema.size({ ...current.value, draft:{ config, revision:randomUUID() } });
  await store.settings.compareAndSwap(STATE_ID, next, current.version);
  return { ...next.draft, version:next.published.version };
}
async function publish(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => k !== "revision") || typeof input.revision !== "string") throw fail("Supply {revision}.", 400);
  const current = await state();
  if (input.revision !== current.value.draft.revision) throw conflict();
  const config = schema.validate(current.value.draft.config), version = randomUUID();
  const next = schema.size({ ...current.value, draft:{ config, revision:version }, published:{ config, version } });
  await snapshot(version, config);
  await store.settings.compareAndSwap(STATE_ID, next, current.version);
  return next.published;
}
async function booking(input) {
  if (!input || typeof input.formVersion !== "string" || !input.answerValues) throw fail("This form is outdated. Refresh to load the published form and submit formVersion with answerValues.", 409);
  const live = await published();
  if (input.formVersion !== live.version) throw conflict();
  return { ...schema.submission(live.config, input.answerValues), formVersion:live.version };
}
module.exports = { published, draft, saveDraft, publish, booking };