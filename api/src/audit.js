/* Operational history, not a transactional or tamper-proof compliance ledger.
 * Mutations commit first; append failure must be surfaced in their response. */
const { randomUUID } = require("crypto");
const store = require("./store");
const ACTIONS = ["booking.create", "booking.update", "booking.delete", "block.create", "block.delete", "profile.update", "password.change", "form.draft", "form.publish", "facilitator.create", "facilitator.update", "training.complete", "training.accept", "training.decline", "attendee.create", "invitation.issue", "invitation.revoke", "sharing.rotate", "sharing.revoke", "sharing.reactivate"];
const safe = v => String(v || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 256);
async function record(action, actor, target, summary) {
  if (!ACTIONS.includes(action)) throw new TypeError("Unknown audit action.");
  const item = { id:randomUUID(), action, actor:safe(actor || "anonymous"), target:safe(target), timestamp:new Date().toISOString(), summary:safe(summary), ...(require("./shared-production").enabled ? { source:"local-shared" } : {}) };
  await store.activity.compareAndSwap(item.id, item, null);
}
async function list(query) {
  const pageText = query.get("page") || "1", action = query.get("action") || "", from = query.get("from") || "";
  if (!/^[1-9]\d{0,5}$/.test(pageText) || (action && !ACTIONS.includes(action)) || (from && (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/.test(from) || !Number.isFinite(Date.parse(from)) || new Date(from).toISOString().slice(0, 10) !== from.slice(0, 10))))
    throw Object.assign(new Error("Invalid activity page/action/from filter."), { statusCode:400 });
  const page = +pageText, pageSize = 25;
  const items = (await store.activity.list()).filter(x => (!action || x.action === action) && (!from || x.timestamp >= new Date(from).toISOString()))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
  // Project the public shape; never expose unrelated storage properties.
  return { items:items.slice((page - 1) * pageSize, page * pageSize).map(x => ({ id:x.id, action:x.action, actor:x.actor, target:x.target, timestamp:x.timestamp, summary:x.summary })), page, hasMore:items.length > page * pageSize };
}
module.exports = { append:record, list, ACTIONS };