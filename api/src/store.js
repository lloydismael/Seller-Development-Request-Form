/*
 * Storage:
 *  - STORAGE_TABLE_ENDPOINT set     -> Azure Table Storage using Azure Identity
 *  - STORAGE_CONNECTION_STRING set  -> Table Storage / Azurite compatibility
 *  - neither set                    -> local JSON only, never on a cloud host
 */
const fs = require("fs/promises");
const path = require("path");
const CONN = process.env.STORAGE_CONNECTION_STRING;
const ENDPOINT = process.env.STORAGE_TABLE_ENDPOINT;
const FILE = path.join(__dirname, "..", ".data", "db.json");
const TABLES = { bookings: "SdrfBookings", blocks: "SdrfBlocks" };
const PK = "sdrf";

const kind = ENDPOINT || CONN ? "table" : "file";
if (ENDPOINT) {
  const url = new URL(ENDPOINT);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("STORAGE_TABLE_ENDPOINT must be an HTTPS endpoint without credentials or query parameters.");
}
if (kind === "file" && (process.env.WEBSITE_SITE_NAME || process.env.NODE_ENV === "production"))
  throw new Error("Cloud storage is not configured. Set STORAGE_TABLE_ENDPOINT; file fallback is disabled in production.");
if (kind === "file") console.warn("[store] Using local JSON file (development only).");

// ---- file backend ----
let lock = Promise.resolve();
async function readDb() { try { return JSON.parse(await fs.readFile(FILE, "utf8")); } catch { return { bookings: [], blocks: [] }; } }
async function writeDb(db) { await fs.mkdir(path.dirname(FILE), { recursive: true }); await fs.writeFile(FILE, JSON.stringify(db, null, 2)); }
function withDb(fn) { const run = lock.then(async () => { const db = await readDb(); const r = await fn(db); await writeDb(db); return r; }); lock = run.catch(() => {}); return run; }

// ---- table backend ----
const clients = {};
let credential;
async function table(name) {
  if (!clients[name]) {
    clients[name] = (async () => {
      const { TableClient } = require("@azure/data-tables");
      let c;
      if (ENDPOINT) {
        const { DefaultAzureCredential, ManagedIdentityCredential } = require("@azure/identity");
        credential ||= process.env.WEBSITE_SITE_NAME
          ? new ManagedIdentityCredential(process.env.STORAGE_MANAGED_IDENTITY_CLIENT_ID ? { clientId:process.env.STORAGE_MANAGED_IDENTITY_CLIENT_ID } : {})
          : new DefaultAzureCredential();
        c = new TableClient(ENDPOINT, TABLES[name], credential);
      } else {
        c = TableClient.fromConnectionString(CONN, TABLES[name], { allowInsecureConnection:/UseDevelopmentStorage|127\.0\.0\.1|localhost/.test(CONN) });
      }
      await c.createTable().catch(e => { if (e.statusCode !== 409) throw e; });
      return c;
    })().catch(e => { delete clients[name]; throw e; });
  }
  return clients[name];
}

function collection(name) {
  return {
    async list() {
      if (kind === "file") return (await readDb())[name] || [];
      const c = await table(name), out = [];
      for await (const e of c.listEntities({ queryOptions: { filter: `PartitionKey eq '${PK}'` } })) out.push(JSON.parse(e.data));
      return out;
    },
    async get(id) {
      if (kind === "file") return ((await readDb())[name] || []).find(x => x.id === id) || null;
      try { const e = await (await table(name)).getEntity(PK, id); return JSON.parse(e.data); }
      catch (e) { if (e.statusCode === 404) return null; throw e; }
    },
    async put(obj) {
      if (kind === "file") return withDb(db => { db[name] = (db[name] || []).filter(x => x.id !== obj.id); db[name].push(obj); return obj; });
      await (await table(name)).upsertEntity({ partitionKey: PK, rowKey: obj.id, data: JSON.stringify(obj) }, "Replace");
      return obj;
    },
    async remove(id) {
      if (kind === "file") return withDb(db => { db[name] = (db[name] || []).filter(x => x.id !== id); });
      await (await table(name)).deleteEntity(PK, id).catch(e => { if (e.statusCode !== 404) throw e; });
    },
    // Migration uses create-only semantics: never overwrite an existing record.
    async insert(obj) {
      if (kind === "file") return withDb(db => {
        if ((db[name] || []).some(x => x.id === obj.id)) throw Object.assign(new Error("Record already exists."), { statusCode:409 });
        (db[name] ||= []).push(obj); return obj;
      });
      await (await table(name)).createEntity({ partitionKey:PK, rowKey:obj.id, data:JSON.stringify(obj) });
      return obj;
    }
  };
}

async function checkConnection() {
  if (kind === "file") { await readDb(); return; }
  for (const name of Object.keys(TABLES)) {
    const c = await table(name);
    // Read one matching entity without loading or disclosing booking data.
    await c.listEntities({ queryOptions:{ filter:`PartitionKey eq '${PK}'`, select:["RowKey"] } }).byPage({ maxPageSize:1 }).next();
  }
}
module.exports = { kind, checkConnection, bookings:collection("bookings"), blocks:collection("blocks") };
