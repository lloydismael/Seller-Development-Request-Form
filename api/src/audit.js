/* Operational history, not a transactional or tamper-proof compliance ledger.
 * Mutations commit first; append failure must be surfaced in their response. */
const { randomUUID } = require("crypto");
const store = require("./store");
const ACTIONS = ["booking.create", "booking.update", "booking.delete", "block.create", "block.delete", "profile.update", "password.change", "form.draft", "form.publish", "facilitator.create", "facilitator.update", "training.complete", "training.accept", "training.decline", "attendee.create", "invitation.issue", "invitation.revoke", "sharing.rotate", "sharing.revoke", "sharing.reactivate"];
const safe = v => String(v || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 256);
const ACTOR_TYPES = ["self-reported", "authenticated", "unknown"];
function actorDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !ACTOR_TYPES.includes(value.kind)) return { kind:"unknown" };
  const result = { kind:value.kind };
  for (const key of ["name", "username", "role", "accountId"])
    if (typeof value[key] === "string") result[key] = safe(value[key]).trim();
  return result;
}
async function record(action, actor, target, summary, details) {
  if (!ACTIONS.includes(action)) throw new TypeError("Unknown audit action.");
  const item = { id:randomUUID(), action, actor:safe(actor || "anonymous"), actorDetails:actorDetails(details), target:safe(target), timestamp:new Date().toISOString(), summary:safe(summary), source:require("./shared-production").enabled ? "local-shared" : "server" };
  await store.activity.compareAndSwap(item.id, item, null);
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const canonical = new Date(value).toISOString();
  return value.length === 10 ? canonical.slice(0, 10) === value : canonical === value;
}
async function list(query) {
  const pageText = query.get("page") || "1", action = query.get("action") || "", from = query.get("from") || "", to = query.get("to") || "", target = query.get("target") || "", actor = query.get("actor") || "", actorType = query.get("actorType") || "";
  const until = to.length === 10 ? to + "T23:59:59.999Z" : to;
  if (!/^[1-9]\d{0,5}$/.test(pageText) || (action && !ACTIONS.includes(action)) || (query.has("target") && !/^[A-Za-z0-9_-]{1,128}$/.test(target)) ||
      ["page", "action", "from", "to", "target", "actor", "actorType"].some(key => query.getAll(key).length > 1) ||
      (from && !validDate(from)) || (query.has("to") && !validDate(to)) || (from && to && new Date(from).toISOString() > until) ||
      (query.has("actor") && (!actor.trim() || actor.length > 256 || /[\u0000-\u001f\u007f]/.test(actor))) ||
      (query.has("actorType") && !ACTOR_TYPES.includes(actorType)))
    throw Object.assign(new Error("Invalid activity page/action/from/to/target/actor/actorType filter."), { statusCode:400 });
  const page = +pageText, pageSize = 25, search = actor.trim().toLowerCase();
  // Only stored snapshots are used: legacy actors are unknown, never reconstructed.
  const items = (await store.activity.list()).map(x => ({ id:x.id, action:x.action, actor:safe(x.actor), actorDetails:actorDetails(x.actorDetails), target:x.target, timestamp:x.timestamp, summary:x.summary,
    source:["local-shared", "server"].includes(x.source) ? x.source : "unknown", sourceUnavailable:true }))
    .filter(x => (!target || x.target === target) && (!action || x.action === action) && (!from || x.timestamp >= new Date(from).toISOString()) && (!until || x.timestamp <= until) &&
      (!actorType || x.actorDetails.kind === actorType) && (!search || [x.actor, x.actorDetails.name, x.actorDetails.username, x.actorDetails.accountId].some(value => typeof value === "string" && value.toLowerCase().includes(search))))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
  // Source describes the recording backend, not a client location; IP geolocation is unavailable.
  return { items:items.slice((page - 1) * pageSize, page * pageSize), page, hasMore:items.length > page * pageSize };
}
module.exports = { append:record, list, ACTIONS };