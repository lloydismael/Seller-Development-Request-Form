/*
 * Storage:
 *  - STORAGE_TABLE_ENDPOINT set     -> Azure Table Storage using Azure Identity
 *  - STORAGE_CONNECTION_STRING set  -> Table Storage / Azurite compatibility
 *  - neither set                    -> local JSON only, never on a cloud host
 */
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const CONN = process.env.STORAGE_CONNECTION_STRING;
const ENDPOINT = process.env.STORAGE_TABLE_ENDPOINT;
const production = !!(process.env.WEBSITE_SITE_NAME || process.env.NODE_ENV === "production");
if (production && process.env.STORAGE_TEST_FILE)
  throw new Error("STORAGE_TEST_FILE is forbidden in production.");
const FILE = process.env.STORAGE_TEST_FILE || path.join(__dirname, "..", ".data", "db.json");
const TABLES = { bookings: "SdrfBookings", blocks: "SdrfBlocks", accounts: "SdrfAccounts", settings: "SdrfSettings", activity: "SdrfActivity" };
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
async function readDb() {
  try {
    const db = JSON.parse(await fs.readFile(FILE, "utf8"));
    if (!db || typeof db !== "object" || Array.isArray(db)) throw new Error("Invalid storage file.");
    return db;
  } catch (e) {
    if (e.code === "ENOENT") return { bookings: [], blocks: [] };
    throw e; // Corrupt or inaccessible storage must never re-bootstrap credentials.
  }
}
async function writeDb(db) {
  const temporary = `${FILE}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(db, null, 2), { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, FILE);
  } finally { await fs.unlink(temporary).catch(e => { if (e.code !== "ENOENT") throw e; }); }
}
function withDb(fn) {
  const run = lock.then(async () => {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    const deadline = Date.now() + 5000;
    // Also serialize independently loaded modules/processes; a crashed writer fails
    // closed with a bounded timeout rather than stealing an active writer's lock.
    for (;;) {
      try { await fs.mkdir(`${FILE}.lock`); break; }
      catch (e) {
        if (e.code !== "EEXIST" || Date.now() >= deadline) throw e;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    try { const db = await readDb(); const r = await fn(db); await writeDb(db); return r; }
    finally { await fs.rmdir(`${FILE}.lock`); }
  });
  lock = run.catch(() => {}); return run;
}
const conflict = () => Object.assign(new Error("Record version conflict; reload and retry."), { statusCode:409 });
function fileVersion(db, name, id) { return db.__versions?.[name]?.[id] || "legacy"; }
function bumpVersion(db, name, id) {
  const versions = (db.__versions ||= {});
  (versions[name] ||= {})[id] = crypto.randomUUID();
}

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
    // Missing records return null; versions are opaque and must not be interpreted.
    async getWithVersion(id) {
      if (kind === "file") {
        const db = await readDb(), value = (db[name] || []).find(x => x.id === id);
        return value ? { value, version:fileVersion(db, name, id) } : null;
      }
      try {
        const e = await (await table(name)).getEntity(PK, id);
        return { value:JSON.parse(e.data), version:e.etag };
      } catch (e) { if (e.statusCode === 404) return null; throw e; }
    },
    async compareAndSwap(id, obj, version) {
      if (!obj || obj.id !== id) throw new TypeError("Record ID must match.");
      if (version === null) return this.insert(obj);
      if (typeof version !== "string" || !version || version === "*") throw new TypeError("An explicit record version is required.");
      if (kind === "file") return withDb(db => {
        const index = (db[name] || []).findIndex(x => x.id === id);
        if (index < 0 || fileVersion(db, name, id) !== version) throw conflict();
        db[name][index] = obj; bumpVersion(db, name, id); return obj;
      });
      try {
        await (await table(name)).updateEntity({ partitionKey:PK, rowKey:id, data:JSON.stringify(obj) }, "Replace", { etag:version });
        return obj;
      } catch (e) { if (e.statusCode === 412 || e.statusCode === 404) throw conflict(); throw e; }
    },
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
      if (kind === "file") return withDb(db => { db[name] = (db[name] || []).filter(x => x.id !== obj.id); db[name].push(obj); bumpVersion(db, name, obj.id); return obj; });
      await (await table(name)).upsertEntity({ partitionKey: PK, rowKey: obj.id, data: JSON.stringify(obj) }, "Replace");
      return obj;
    },
    async remove(id) {
      if (kind === "file") return withDb(db => { db[name] = (db[name] || []).filter(x => x.id !== id); if (db.__versions?.[name]) delete db.__versions[name][id]; });
      await (await table(name)).deleteEntity(PK, id).catch(e => { if (e.statusCode !== 404) throw e; });
    },
    // Migration uses create-only semantics: never overwrite an existing record.
    async insert(obj) {
      if (kind === "file") return withDb(db => {
        if ((db[name] || []).some(x => x.id === obj.id)) throw Object.assign(new Error("Record already exists."), { statusCode:409 });
        (db[name] ||= []).push(obj); bumpVersion(db, name, obj.id); return obj;
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
module.exports = { kind, checkConnection, bookings:collection("bookings"), blocks:collection("blocks"),
  accounts:collection("accounts"), settings:collection("settings"), activity:collection("activity") };
