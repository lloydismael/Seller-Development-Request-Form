const { randomBytes, createHash } = require("node:crypto");
const COOKIE = "sdrf_browser";
const TTL = 31536000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function identity(req) {
  const matches = (req.headers.get("cookie") || "").split(";").map(v => v.trim()).filter(v => v.startsWith(COOKIE + "="));
  const incoming = matches.length === 1 ? matches[0].slice(COOKIE.length + 1) : "";
  const recognized = TOKEN.test(incoming) && Buffer.from(incoming, "base64url").toString("base64url") === incoming;
  const token = recognized ? incoming : randomBytes(32).toString("base64url");
  return { token, recognized, ownerHash:createHash("sha256").update(token).digest("hex") };
}
function cookie(req, token) {
  const secure = !!(process.env.WEBSITE_SITE_NAME || process.env.NODE_ENV === "production") ||
    (req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")) === "https";
  return { name:COOKIE, value:token, maxAge:TTL, path:"/api", httpOnly:true, sameSite:"Strict", secure };
}
const SUMMARY = ["id", "status", "createdAt", "updatedAt", "requestor", "division", "category", "topic", "trainingDate", "facilitator", "time", "venue", "participants"];
function summary(record) { return Object.fromEntries(SUMMARY.filter(k => record[k] !== undefined).map(k => [k, record[k]])); }
function detail(record) {
  return { ...summary(record), answerSnapshot:(record.answerSnapshot || []).map(answer =>
    Object.fromEntries(["id", "title", "type", "value"].filter(k => answer[k] !== undefined).map(k => [k, answer[k]]))) };
}
function withoutOwner(record) { const { ownerHash, ...publicRecord } = record; return publicRecord; }
const invalid = () => Object.assign(new Error("Invalid history pagination."), { statusCode:400, expose:true });
function pagination(query) {
  const size = query.get("limit");
  if (query.getAll("limit").length > 1 || query.getAll("cursor").length > 1 || (size !== null && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(size))) throw invalid();
  const encoded = query.get("cursor");
  let after = null;
  if (encoded !== null) {
    if (!encoded || encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw invalid();
    try {
      const raw = Buffer.from(encoded, "base64url");
      if (raw.toString("base64url") !== encoded) throw invalid();
      after = JSON.parse(raw.toString("utf8"));
      if (!after || Object.keys(after).sort().join(",") !== "createdAt,id" || typeof after.createdAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(after.createdAt) || new Date(after.createdAt).toISOString() !== after.createdAt ||
        typeof after.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(after.id)) throw invalid();
    } catch { throw invalid(); }
  }
  return { limit:size === null ? 25 : Number(size), after };
}
function cursor(record) { return Buffer.from(JSON.stringify({ createdAt:record.createdAt, id:record.id })).toString("base64url"); }
module.exports = { identity, cookie, summary, detail, withoutOwner, pagination, cursor };
