const store = require("./store");
const { findConflicts, conflictMessage, isActive } = require("./rules");
const GUARD = "schedule-reservation-version";

// A shared ETag in the bookings partition makes conflict checks and writes atomic
// across API instances, including approvals of different pending requests.
async function save(next, version, force = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const guard = await store.bookings.getWithVersion(GUARD);
    if (!force && isActive(next.status)) {
      const [bookings, blocks] = await Promise.all([store.bookings.list(), store.blocks.list()]);
      const conflicts = findConflicts(bookings, blocks, next, next.id);
      if (conflicts.length) throw Object.assign(new Error(conflictMessage(conflicts)), { statusCode:409, code:"SLOT_CONFLICT", publicMessage:conflictMessage(conflicts) });
    }
    try {
      await store.bookings.transact([
        { value:{ id:GUARD, recordType:"schedule-guard", revision:require("crypto").randomUUID() }, version:guard?.version ?? null },
        { value:next, version }
      ]);
      return next;
    } catch (e) {
      if (e.statusCode !== 409) throw e;
      const current = await store.bookings.getWithVersion(next.id);
      if (!current || current.version !== version || attempt === 3) throw e;
    }
  }
}
module.exports = { save };
