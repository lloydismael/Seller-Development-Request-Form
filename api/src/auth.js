/*
 * Admin authentication (username/password + signed HttpOnly session cookie).
 * Configure via app settings / local.settings.json:
 *   ADMIN_USERNAME  (default: admin)
 *   ADMIN_PASSWORD  (default: Admin@123)  <-- CHANGE BEFORE PRODUCTION
 *   SESSION_SECRET  (default: dev value)  <-- set a long random string in production
 */
const crypto = require("crypto");
const USER = process.env.ADMIN_USERNAME || "admin";
const PASS = process.env.ADMIN_PASSWORD || "Admin@123";
const SECRET = process.env.SESSION_SECRET || "sdrf-dev-secret-change-me";
const COOKIE = "sdrf_admin";
const TTL = 8 * 60 * 60; // 8 hours

if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET)
  console.warn("[auth] Using DEFAULT admin credentials/secret – set ADMIN_PASSWORD and SESSION_SECRET for production.");

const sign = s => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
const eq = (a, b) => { const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? "")); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function checkCredentials(u, p) { const okU = eq(u, USER), okP = eq(p, PASS); return okU && okP; }

function issueToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Math.floor(Date.now() / 1000) + TTL })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function session(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [p, s] = m[1].split(".");
  if (!p || !s || !eq(sign(p), s)) return null;
  try { const d = JSON.parse(Buffer.from(p, "base64url").toString("utf8")); return d.exp > Date.now() / 1000 ? d : null; }
  catch { return null; }
}

// Also accept the built-in SWA identity with an "admin" role (optional, if you add Entra ID later).
function swaPrincipal(req) {
  const h = req.headers.get("x-ms-client-principal");
  if (!h) return null;
  try { return JSON.parse(Buffer.from(h, "base64").toString("utf8")); } catch { return null; }
}

function adminUser(req) {
  const s = session(req);
  if (s) return s.u;
  const p = swaPrincipal(req);
  return p && (p.userRoles || []).includes("admin") ? p.userDetails : null;
}
const isAdmin = req => !!adminUser(req);

function isHttps(req) {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try { return new URL(req.url).protocol === "https:"; } catch { return false; }
}
const sessionCookie = (req, value, maxAge) =>
  ({ name: COOKIE, value, maxAge, path: "/", httpOnly: true, sameSite: "Strict", secure: isHttps(req) });

module.exports = { checkCredentials, issueToken, adminUser, isAdmin, sessionCookie, TTL };
