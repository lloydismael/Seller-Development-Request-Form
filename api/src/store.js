/*
 * Storage:
 *  - STORAGE_CONNECTION_STRING set  -> Azure Table Storage (production; "UseDevelopmentStorage=true" for Azurite)
 *  - not set                        -> JSON file at api/.data/db.json (local development only)
 */
const fs = require("fs/promises");
const path = require("path");
const CONN = process.env.STORAGE_CONNECTION_STRING;
const FILE = path.join(__dirname, "..", ".data", "db.json");
const TABLES = { bookings: "SdrfBookings", blocks: "SdrfBlocks" };
const PK = "sdrf";

const kind = CONN ? "table" : "file";
if (!CONN) console.warn("[store] STORAGE_CONNECTION_STRING not set – using local JSON file (development only).");

// ---- file backend ----
let lock = Promise.resolve();
async function readDb() { try { return JSON.parse(await fs.readFile(FILE, "utf8")); } catch { return { bookings: [], blocks: [] }; } }
async function writeDb(db) { await fs.mkdir(path.dirname(FILE), { recursive: true }); await fs.writeFile(FILE, JSON.stringify(db, null, 2)); }
function withDb(fn) { const run = lock.then(async () => { const db = await readDb(); const r = await fn(db); await writeDb(db); return r; }); lock = run.catch(() => {}); return run; }

// ---- table backend ----
const clients = {};
async function table(name) {
  if (!clients[name]) {
    const { TableClient } = require("@azure/data-tables");
    const c = TableClient.fromConnectionString(CONN, TABLES[name], { allowInsecureConnection: /UseDevelopmentStorage|127\.0\.0\.1|localhost/.test(CONN) });
    await c.createTable().catch(e => { if (e.statusCode !== 409) throw e; });
    clients[name] = c;
  }
  return clients[name];
}

function collection(name) {
  return {
    async list() {
      if (!CONN) return (await readDb())[name] || [];
      const c = await table(name), out = [];
      for await (const e of c.listEntities({ queryOptions: { filter: `PartitionKey eq '${PK}'` } })) out.push(JSON.parse(e.data));
      return out;
    },
    async get(id) {
      if (!CONN) return ((await readDb())[name] || []).find(x => x.id === id) || null;
      try { const e = await (await table(name)).getEntity(PK, id); return JSON.parse(e.data); }
      catch (e) { if (e.statusCode === 404) return null; throw e; }
    },
    async put(obj) {
      if (!CONN) return withDb(db => { db[name] = (db[name] || []).filter(x => x.id !== obj.id); db[name].push(obj); return obj; });
      await (await table(name)).upsertEntity({ partitionKey: PK, rowKey: obj.id, data: JSON.stringify(obj) }, "Replace");
      return obj;
    },
    async remove(id) {
      if (!CONN) return withDb(db => { db[name] = (db[name] || []).filter(x => x.id !== id); });
      await (await table(name)).deleteEntity(PK, id).catch(e => { if (e.statusCode !== 404) throw e; });
    }
  };
}

module.exports = { kind, bookings: collection("bookings"), blocks: collection("blocks") };
