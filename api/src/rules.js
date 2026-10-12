// Scheduling rules – keep in sync with app/data.js
function toMin(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return NaN;
  let h = (+m[1]) % 12; if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + (+m[2]);
}
const slotRange = s => { const p = String(s || "").split(/\s*-\s*/); return [toMin(p[0]), toMin(p[1])]; };
const overlaps = (a, b) => { const [a1, a2] = slotRange(a), [b1, b2] = slotRange(b); return a1 < b2 && b1 < a2; };
const isActive = s => !["Rejected", "Cancelled"].includes(s);
const inBlock = (x, date) => date >= x.startDate && date <= (x.endDate || x.startDate);

function findConflicts(bookings, blocks, b, ignoreId) {
  const out = [];
  if (!b.trainingDate || !b.facilitator || (b.status && !isActive(b.status))) return out;
  blocks.filter(x => x.facilitator === b.facilitator && inBlock(x, b.trainingDate)).forEach(x => out.push({ type: "block", item: x }));
  bookings.filter(x => x.id !== ignoreId && isActive(x.status) && x.facilitator === b.facilitator &&
    x.trainingDate === b.trainingDate && b.time && x.time && overlaps(x.time, b.time))
    .forEach(x => out.push({ type: "booking", item: x }));
  return out;
}
const conflictMessage = c => c.map(x => x.type === "block"
  ? `${x.item.facilitator} is unavailable on this date (${x.item.reason || "blocked"}).`
  : `${x.item.facilitator} is already booked ${x.item.time} on ${x.item.trainingDate}.`).join("\n");

module.exports = { slotRange, overlaps, isActive, inBlock, findConflicts, conflictMessage };
