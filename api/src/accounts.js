/* Persisted accounts are the only credential source after create-only bootstrap. */
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);
const store = require("./store");
const LOCAL_ID = "local-admin";
const WINDOW = 15 * 60 * 1000;
const LIMIT = 5;
const options = { N:32768, r:8, p:1, maxmem:64 * 1024 * 1024 };
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
// Only fixed, reviewed user-facing validation errors may cross the API boundary.
const validation = message => Object.assign(fail(message, 400), { expose:true });
const validPasswordInput = p => typeof p === "string" && p.length > 0 && p.length <= 128;
const same = (a, b) => {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function hashPassword(password) {
  if (!validPasswordInput(password)) throw fail("Invalid password length.", 400);
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, options);
  return { algorithm:"scrypt-v1", salt, hash:key.toString("hex") };
}
async function verifyPassword(password, credential) {
  if (!validPasswordInput(password) || credential?.algorithm !== "scrypt-v1" ||
      !/^[a-f0-9]{32}$/.test(credential.salt) || !/^[a-f0-9]{128}$/.test(credential.hash)) return false;
  const key = await scrypt(password, credential.salt, 64, options);
  return same(key.toString("hex"), credential.hash);
}

let bootstrapPending;
async function bootstrap() {
  if (!bootstrapPending) bootstrapPending = (async () => {
    const existing = await store.accounts.get(LOCAL_ID);
    if (existing) return identity(existing);
    const username = process.env.ADMIN_USERNAME || "admin";
    const password = process.env.ADMIN_PASSWORD || "Admin@123";
    if ((process.env.WEBSITE_SITE_NAME || process.env.NODE_ENV === "production") &&
      (!process.env.ADMIN_PASSWORD || password === "Admin@123")) throw fail("Production ADMIN_PASSWORD is required for bootstrap.", 500);
    if (!username || username.length > 256) throw fail("Invalid bootstrap username.", 500);
    const account = { id:LOCAL_ID, username, provider:"local", role:"admin",
      credentialVersion:1, credential:await hashPassword(password),
      profile:{ displayName:username, email:"", phone:"" }, createdAt:new Date().toISOString() };
    try { await store.accounts.insert(account); return identity(account); }
    catch (e) {
      if (e.statusCode !== 409) throw e;
      const winner = await store.accounts.get(LOCAL_ID);
      if (!winner) throw fail("Bootstrap account unavailable.", 503);
      return identity(winner);
    }
  })().finally(() => { bootstrapPending = undefined; });
  return bootstrapPending;
}

// One bounded bucket per persisted account and operation. Unknown usernames never
// allocate rows or consume the bootstrap account's allowance. Reserve before KDF.
async function reserve(id, operation) {
  for (let i = 0; i < 8; i++) {
    const current = await store.accounts.getWithVersion(id);
    if (!current) return null;
    const now = Date.now(), previous = current.value.attempts?.[operation];
    const active = previous && previous.startedAt <= now && previous.startedAt + WINDOW > now;
    const bucket = active ? previous : { startedAt:now, count:0 };
    if (bucket.count >= LIMIT) return null;
    const value = { ...current.value, attempts:{ ...current.value.attempts,
      [operation]:{ startedAt:bucket.startedAt, count:bucket.count + 1 } } };
    try { await store.accounts.compareAndSwap(id, value, current.version); return value; }
    catch (e) { if (e.statusCode !== 409) throw e; }
  }
  return null;
}
async function authenticateIdentity(username, password) {
  if (typeof username !== "string" || username.length > 256 || !validPasswordInput(password)) return null;
  const initial = await bootstrap();
  if (username !== initial.user) return null;
  const account = await reserve(LOCAL_ID, "login");
  if (!account || !await verifyPassword(password, account.credential)) return null;
  for (let i = 0; i < 8; i++) {
    const current = await store.accounts.getWithVersion(LOCAL_ID);
    if (!current || current.value.credentialVersion !== account.credentialVersion ||
        current.value.credential.hash !== account.credential.hash || current.value.role !== "admin" ||
        current.value.provider !== "local" || current.value.username !== username) return null;
    const value = { ...current.value, attempts:{ ...current.value.attempts, login:{ startedAt:Date.now(), count:0 } } };
    try { await store.accounts.compareAndSwap(LOCAL_ID, value, current.version); return identity(value); }
    catch (e) { if (e.statusCode !== 409) throw e; }
  }
  return null;
}
async function authenticate(username, password) { return !!await authenticateIdentity(username, password); }
function identity(account) {
  return { id:account.id, user:account.username, provider:account.provider,
    credentialVersion:account.credentialVersion,
    profile:{ displayName:account.profile?.displayName || "", email:account.profile?.email || "", phone:account.profile?.phone || "" } };
}
async function localIdentity(user, version) {
  if (typeof user !== "string" || !Number.isSafeInteger(version) || version < 1) return null;
  const account = await store.accounts.get(LOCAL_ID);
  return account && account.role === "admin" && account.provider === "local" &&
    account.username === user && account.credentialVersion === version ? identity(account) : null;
}
async function swaIdentity(principal) {
  if (!principal || !Array.isArray(principal.userRoles) || !principal.userRoles.includes("admin") ||
      typeof principal.userId !== "string" || !principal.userId || principal.userId.length > 256 ||
      typeof principal.identityProvider !== "string" || !principal.identityProvider || principal.identityProvider.length > 64 ||
      typeof principal.userDetails !== "string" || !principal.userDetails || principal.userDetails.length > 256) return null;
  const provider = `swa:${principal.identityProvider}`;
  const id = `swa-${crypto.createHash("sha256").update(JSON.stringify([provider, principal.userId])).digest("hex")}`;
  let account = await store.accounts.get(id);
  if (!account) {
    const value = { id, username:principal.userDetails, provider, role:"admin", credentialVersion:1,
      profile:{ displayName:principal.userDetails, email:"", phone:"" }, createdAt:new Date().toISOString() };
    try { account = await store.accounts.insert(value); }
    catch (e) { if (e.statusCode !== 409) throw e; account = await store.accounts.get(id); }
  }
  return account?.role === "admin" && account.provider === provider ? identity(account) : null;
}
async function owned(who) {
  if (!who || typeof who.id !== "string") throw fail("Authentication required.", 401);
  const current = await store.accounts.getWithVersion(who.id);
  if (!current || current.value.role !== "admin" || current.value.provider !== who.provider ||
      current.value.credentialVersion !== who.credentialVersion) throw fail("Authentication required.", 401);
  return current;
}
function validateProfile(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
      Object.keys(patch).some(k => !["displayName", "email", "phone"].includes(k))) throw validation("Only displayName, email and phone may be updated.");
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    const max = { displayName:100, email:254, phone:32 }[key];
    if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw validation("Invalid profile field.");
    const v = value.trim();
    if (key === "displayName" && !v || key === "email" && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ||
        key === "phone" && v && !/^[+()\d .-]+$/.test(v)) throw validation("Invalid profile field.");
    out[key] = v;
  }
  return out;
}
async function updateProfile(who, patch) {
  const fields = validateProfile(patch), current = await owned(who);
  const value = { ...current.value, profile:{ ...current.value.profile, ...fields }, updatedAt:new Date().toISOString() };
  await store.accounts.compareAndSwap(who.id, value, current.version);
  return identity(value);
}
async function changePassword(who, input) {
  const initial = await owned(who);
  if (initial.value.provider !== "local") throw validation("Change your password with your identity provider.");
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(k => !["currentPassword", "newPassword", "confirmPassword"].includes(k)) ||
      !validPasswordInput(input.currentPassword) || typeof input.newPassword !== "string" ||
      input.newPassword.length < 12 || input.newPassword.length > 128 || input.newPassword !== input.confirmPassword ||
      input.newPassword === input.currentPassword) throw validation("Passwords must match, differ from the current password, and contain 12–128 characters.");
  const reserved = await reserve(who.id, "password");
  if (!reserved) throw fail("Too many attempts; retry later.", 429);
  if (reserved.credentialVersion !== who.credentialVersion) throw fail("Authentication required.", 401);
  if (!await verifyPassword(input.currentPassword, reserved.credential)) throw validation("Current password is incorrect.");
  const credential = await hashPassword(input.newPassword), current = await owned(who);
  if (current.value.credential.hash !== reserved.credential.hash) throw fail("Record version conflict; reload and retry.", 409);
  if (!Number.isSafeInteger(current.value.credentialVersion + 1)) throw fail("Invalid credential version.", 500);
  const value = { ...current.value, credential, credentialVersion:current.value.credentialVersion + 1,
    attempts:{ login:{ startedAt:Date.now(), count:0 }, password:{ startedAt:Date.now(), count:0 } }, updatedAt:new Date().toISOString() };
  await store.accounts.compareAndSwap(who.id, value, current.version);
  return identity(value); // No hash, salt, password or attempt state crosses this boundary.
}

module.exports = { bootstrap, authenticate, authenticateIdentity, localIdentity, swaIdentity, updateProfile, changePassword };