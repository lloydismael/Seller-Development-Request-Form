/*
 * Admin authentication (username/password + signed HttpOnly session cookie).
 * Configure via app settings / local.settings.json:
 *   ADMIN_USERNAME  (default: admin)
 *   ADMIN_PASSWORD  (default: Admin@123)  <-- CHANGE BEFORE PRODUCTION
 *   SESSION_SECRET  (default: dev value)  <-- set a long random string in production
 */
const crypto = require("crypto");
const PASS = process.env.ADMIN_PASSWORD || "Admin@123";
const SECRET = process.env.SESSION_SECRET || "sdrf-dev-secret-change-me";
const COOKIE = "sdrf_admin";
const TTL = 8 * 60 * 60; // 8 hours

if ((process.env.WEBSITE_SITE_NAME || process.env.NODE_ENV === "production") &&
    (!process.env.ADMIN_PASSWORD || PASS === "Admin@123" || !process.env.SESSION_SECRET || SECRET === "sdrf-dev-secret-change-me" || SECRET.length < 32))
  throw new Error("Production ADMIN_PASSWORD and a SESSION_SECRET of at least 32 characters are required.");

if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET)
  console.warn("[auth] Using DEFAULT admin credentials/secret – set ADMIN_PASSWORD and SESSION_SECRET for production.");

const sign = s => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
const eq = (a, b) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? "")); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const accounts = require("./accounts");
async function checkCredentials(u, p) { return accounts.authenticate(u, p); }
// Login handlers should use this snapshot for issueToken(who.user, who.credentialVersion).
// Re-reading a version after a boolean password check can race a password change.
const authenticateIdentity = (u, p) => accounts.authenticateIdentity(u, p);

function issueToken(user, version) {
  if (typeof user !== "string" || !user || user.length > 256 || !Number.isSafeInteger(version) || version < 1)
    throw new TypeError("A username and persisted credential version are required.");
  const payload = Buffer.from(JSON.stringify({ u: user, v:version, exp: Math.floor(Date.now() / 1000) + TTL })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function session(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  if (m[1].split(".").length !== 2) return null;
  const [p, s] = m[1].split(".");
  if (!p || !s || !eq(sign(p), s)) return null;
  try { const d = JSON.parse(Buffer.from(p, "base64url").toString("utf8")); return d && typeof d.u === "string" &&
    Number.isSafeInteger(d.v) && d.v > 0 && Number.isSafeInteger(d.exp) && d.exp > Date.now() / 1000 ? d : null; }
  catch { return null; }
}

// Also accept the built-in SWA identity with an "admin" role (optional, if you add Entra ID later).
function swaPrincipal(req) {
  const h = req.headers.get("x-ms-client-principal");
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch { return null; }
}

async function getIdentity(req) {
  const s = session(req);
  if (s) {
    const who = await accounts.localIdentity(s.u, s.v);
    if (who) return who;
  }
  return accounts.swaIdentity(swaPrincipal(req));
}
async function adminUser(req) { const who = await getIdentity(req); return who?.role === "admin" ? who.user : null; }
const isAdmin = async req => (await getIdentity(req))?.role === "admin";
const isManagement = async req => accounts.isManagement(await getIdentity(req));
const getProfile = async req => getIdentity(req);
const updateProfile = async (req, patch) => accounts.updateProfile(await getIdentity(req), patch);
const changePassword = async (req, input) => accounts.changePassword(await getIdentity(req), input);

function isHttps(req) {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try { return new URL(req.url).protocol === "https:"; } catch { return false; }
}
const sessionCookie = (req, value, maxAge) =>
  ({ name: COOKIE, value, maxAge, path: "/", httpOnly: true, sameSite: "Strict", secure: isHttps(req) });

module.exports = { checkCredentials, authenticateIdentity, issueToken, adminUser, isAdmin, isManagement, getIdentity, getProfile, updateProfile, changePassword, sessionCookie, TTL };
