/* Private, create-only import. Defaults to dry-run; never deletes the source. */
const fs = require("node:fs/promises");
const { isDeepStrictEqual } = require("node:util");
const { findConflicts, slotRange } = require("../src/rules");

const STATUSES = new Set(["Pending","Approved","Completed","Rejected","Cancelled"]);
const validDate = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
};
function validateSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.bookings) || !Array.isArray(snapshot.blocks)) throw new Error("Snapshot must contain bookings and blocks arrays.");
  for (const name of ["bookings","blocks"]) {
    const seen = new Set();
    snapshot[name].forEach((rec,index) => {
      const where = `${name}[${index}]`;
      if (!rec || typeof rec !== "object" || typeof rec.id !== "string" || !rec.id || /[\/#?\u0000-\u001f\u007f-\u009f]/.test(rec.id) || Buffer.byteLength(rec.id,"utf16le") > 1024)
        throw new Error(`${where}: invalid Table Storage record ID.`);
      if (seen.has(rec.id)) throw new Error(`${where}: duplicate ID in source.`);
      seen.add(rec.id);
      // Table string properties have a 64 KiB UTF-16 limit; leave room for safety.
      if (Buffer.byteLength(JSON.stringify(rec),"utf16le") > 60000) throw new Error(`${where}: record exceeds migration size limit.`);
      if (!rec.createdAt || !Number.isFinite(Date.parse(rec.createdAt))) throw new Error(`${where}: missing or invalid createdAt.`);
      if (name === "bookings") {
        for (const field of ["requestor","division","category","facilitator","time","venue"])
          if (typeof rec[field] !== "string" || !rec[field].trim()) throw new Error(`${where}: missing ${field}.`);
        const range = slotRange(rec.time);
        if (!validDate(rec.trainingDate) || !STATUSES.has(rec.status) || !range.every(Number.isFinite) || range[0] >= range[1]) throw new Error(`${where}: invalid booking date, status, or time.`);
        if (!rec.answers || typeof rec.answers !== "object" || Array.isArray(rec.answers)) throw new Error(`${where}: answers must be an object.`);
      } else if (!rec.facilitator || !validDate(rec.startDate) || (rec.endDate && (!validDate(rec.endDate) || rec.endDate < rec.startDate))) {
        throw new Error(`${where}: invalid facilitator or blocked date range.`);
      }
    });
  }
  return snapshot;
}

async function migrate(snapshot,store,{ apply = false } = {}) {
  validateSnapshot(snapshot);
  const existing = { bookings:await store.bookings.list(), blocks:await store.blocks.list() };
  const pending = { bookings:[], blocks:[] }, skipped = { bookings:0, blocks:0 };
  for (const name of ["bookings","blocks"]) {
    const byId = new Map(existing[name].map(rec => [rec.id,rec]));
    for (const rec of snapshot[name]) {
      if (!byId.has(rec.id)) pending[name].push(rec);
      else if (isDeepStrictEqual(byId.get(rec.id),rec)) skipped[name]++;
      else throw new Error(`Destination ${name} ID differs from source; refusing overwrite.`);
    }
  }
  const combined = { bookings:[...existing.bookings,...pending.bookings], blocks:[...existing.blocks,...pending.blocks] };
  // Also check existing bookings against imported blocks, not just imported bookings.
  const conflicts = combined.bookings.filter(rec => findConflicts(combined.bookings,combined.blocks,rec,rec.id).length > 0).length;
  if (conflicts) throw new Error(`${conflicts} booking(s) have scheduling conflicts. Resolve these before migration.`);
  const result = { mode:apply ? "apply" : "dry-run", source:{ bookings:snapshot.bookings.length, blocks:snapshot.blocks.length }, pending:{ bookings:pending.bookings.length, blocks:pending.blocks.length }, skipped, inserted:{ bookings:0, blocks:0 } };
  if (!apply) return result;
  try {
    for (const name of ["blocks","bookings"]) for (const rec of pending[name]) {
      try { await store[name].insert(rec); }
      catch (err) {
        if (err.statusCode !== 409 || !isDeepStrictEqual(await store[name].get(rec.id),rec)) throw err;
      }
      if (!isDeepStrictEqual(await store[name].get(rec.id),rec)) throw new Error("Imported record verification failed.");
      result.inserted[name]++;
    }
    // Compare complete records, including records skipped on an earlier attempt.
    for (const name of ["blocks","bookings"]) for (const rec of snapshot[name])
      if (!isDeepStrictEqual(await store[name].get(rec.id),rec)) throw new Error("Final preservation verification failed.");
  } catch (err) { err.migrationProgress = result; throw err; }
  return result;
}

async function main() {
  const args = process.argv.slice(2), file = args.find(arg => !arg.startsWith("--"));
  if (!file || args.some(arg => arg.startsWith("--") && arg !== "--apply")) throw new Error("Usage: node scripts/migrate-storage.js <private-snapshot.json> [--apply]");
  if (!process.env.STORAGE_TABLE_ENDPOINT) throw new Error("Set STORAGE_TABLE_ENDPOINT before migration; browser/file destinations are not allowed.");
  const snapshot = validateSnapshot(JSON.parse(await fs.readFile(file,"utf8")));
  const store = require("../src/store");
  console.log(JSON.stringify(await migrate(snapshot,store,{ apply:args.includes("--apply") }),null,2));
}
if (require.main === module) main().catch(err => {
  if (err.migrationProgress) console.error(JSON.stringify(err.migrationProgress));
  // SDK details may include request metadata; do not print arbitrary response bodies.
  console.error(err.statusCode ? `Migration stopped: storage request failed (${err.statusCode}). Originals are unchanged; rerun dry-run before retrying.` : err.message);
  process.exitCode = 1;
});
module.exports = { validateSnapshot,migrate };