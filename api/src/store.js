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

function entity(name, obj) {
  return { partitionKey:PK, rowKey:obj.id, data:JSON.stringify(obj),
    ...(name === "bookings" && obj.ownerHash ? { ownerHash:obj.ownerHash, createdAt:obj.createdAt } : {}),
    ...(obj.recordType ? { recordType:obj.recordType } : {}),
    ...(obj.csatSession ? { csatSession:obj.csatSession } : {}) };
}
const newestFirst = (a, b) => a.createdAt === b.createdAt ? (a.id === b.id ? 0 : a.id > b.id ? -1 : 1) : a.createdAt > b.createdAt ? -1 : 1;

function collection(name) {
  return {
    // Table properties are server-filtered, not indexed. Keep only limit+1
    // matches in memory; Azure Tables cannot ORDER BY createdAt or ownerHash.
    async listOwned(ownerHash, { limit, after }) {
      if (name !== "bookings" || !/^[a-f0-9]{64}$/.test(ownerHash) || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
        (after && (typeof after.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(after.createdAt) || !/^[A-Za-z0-9_-]{1,128}$/.test(after.id))))
        throw new TypeError("Invalid owner query.");
      const out = [];
      const add = record => {
        if (record.ownerHash !== ownerHash || typeof record.createdAt !== "string" || (after && newestFirst(record, after) <= 0)) return;
        out.push(record); out.sort(newestFirst); if (out.length > limit + 1) out.pop();
      };
      if (kind === "file") {
        for (const record of (await readDb()).bookings || []) add(record);
      } else {
        let filter = `PartitionKey eq '${PK}' and ownerHash eq '${ownerHash}'`;
        if (after) filter += ` and (createdAt lt '${after.createdAt}' or (createdAt eq '${after.createdAt}' and RowKey lt '${after.id}'))`;
        for await (const e of (await table(name)).listEntities({ queryOptions:{ filter } })) add(JSON.parse(e.data));
      }
      return { items:out.slice(0, limit), hasMore:out.length > limit };
    },
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
        await (await table(name)).updateEntity(entity(name, obj), "Replace", { etag:version });
        return obj;
      } catch (e) { if (e.statusCode === 412 || e.statusCode === 404) throw conflict(); throw e; }
    },
    async list() {
          if (kind === "file") return ((await readDb())[name] || []).filter(x => !x.recordType);
      const c = await table(name), out = [];
          for await (const e of c.listEntities({ queryOptions: { filter: `PartitionKey eq '${PK}'` } })) {
            const value = JSON.parse(e.data);
            if (!value.recordType) out.push(value);
          }
          return out;
        },
        async listRelated(sessionId, recordType = "csat-attendee") {
          if (name !== "bookings" || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId) || !["csat-attendee", "csat-response"].includes(recordType)) throw new TypeError("Invalid session query.");
          if (kind === "file") return ((await readDb())[name] || []).filter(x => x.csatSession === sessionId && x.recordType === recordType);
          const out = [];
          for await (const e of (await table(name)).listEntities({ queryOptions:{ filter:`PartitionKey eq '${PK}' and csatSession eq '${sessionId}' and recordType eq '${recordType}'` } })) out.push(JSON.parse(e.data));
          return out;
        },
        // One partition transaction coordinates booking state and invitation consumption.
        async transact(operations) {
          if (!Array.isArray(operations) || !operations.length || operations.length > 100 ||
              new Set(operations.map(o => o.value?.id)).size !== operations.length ||
              operations.some(o => !o.value?.id || (o.version !== null && (typeof o.version !== "string" || !o.version || o.version === "*")))) throw new TypeError("Invalid transaction.");
          if (kind === "file") return withDb(db => {
            for (const o of operations) {
              const found = (db[name] || []).some(x => x.id === o.value.id);
              if (o.version === null ? found : !found || fileVersion(db, name, o.value.id) !== o.version) throw conflict();
            }
            for (const o of operations) {
              db[name] = (db[name] || []).filter(x => x.id !== o.value.id);
              db[name].push(o.value); bumpVersion(db, name, o.value.id);
            }
          });
          try {
            await (await table(name)).submitTransaction(operations.map(o => o.version === null
              ? ["create", entity(name, o.value)] : ["update", entity(name, o.value), "Replace", { etag:o.version }]));
          } catch (e) { if ([404, 409, 412].includes(e.statusCode)) throw conflict(); throw e; }
        },
    async get(id) {
      if (kind === "file") return ((await readDb())[name] || []).find(x => x.id === id) || null;
      try { const e = await (await table(name)).getEntity(PK, id); return JSON.parse(e.data); }
      catch (e) { if (e.statusCode === 404) return null; throw e; }
    },
    async put(obj) {
      if (kind === "file") return withDb(db => { db[name] = (db[name] || []).filter(x => x.id !== obj.id); db[name].push(obj); bumpVersion(db, name, obj.id); return obj; });
      await (await table(name)).upsertEntity(entity(name, obj), "Replace");
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
      await (await table(name)).createEntity(entity(name, obj));
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
