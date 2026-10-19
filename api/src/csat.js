const crypto = require("crypto");
const store = require("./store");
const accounts = require("./accounts");
const { csatConfig:config, csatSchema:schema } = require("./form-assets-loader");
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode, expose:true });
const eligible = b => b.topic === "Phone Videography";
const open = b => eligible(b) && b.status === "Completed" && !!b.csatActivatedAt;
const validId = id => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const secret = process.env.SESSION_SECRET || "sdrf-dev-secret-change-me";
const signingKey = process.env.CSAT_SIGNING_KEY;
if (signingKey !== undefined && (signingKey.length < 32 || signingKey === secret)) throw new Error("CSAT signing key must be strong and separate from session signing.");
const sharedProduction = require("./shared-production");
const publicOrigin = process.env.CSAT_PUBLIC_ORIGIN;
if (publicOrigin && publicOrigin !== sharedProduction.origin) throw new Error("Invalid public survey origin.");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function initializeSharing(booking) {
  if (eligible(booking) && !booking.csatSharing) booking.csatSharing = { nonce:crypto.randomBytes(24).toString("base64url"), revoked:false };
  return booking;
}
const shareSignature = (id, nonce, version = "s") => crypto.createHmac("sha256", version === "s2" ? signingKey : secret).update(JSON.stringify([version === "s2" ? "csat-session-v2" : "csat-session-v1", id, nonce])).digest("base64url");
function sharingInfo(booking) {
  const state = booking.csatSharing, version = signingKey ? "s2" : "s";
  return { state:state?.revoked ? "revoked" : open(booking) ? "open" : "closed",
    ...(state && !state.revoked ? { link:`${publicOrigin || ""}/csat/#${version}.${booking.id}.${state.nonce}.${shareSignature(booking.id, state.nonce, version)}` } : {}) };
}
async function ensureSharing(id) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await store.bookings.getWithVersion(id);
    if (!row || row.value.recordType || !eligible(row.value)) return null;
    if (row.value.csatSharing) return row;
    try { const next = initializeSharing({ ...row.value }); await store.bookings.compareAndSwap(id, next, row.version); }
    catch (e) { if (e.statusCode !== 409) throw e; }
  }
  throw fail(409, "Session changed. Refresh and retry.");
}
async function sharing(id, who, action) {
  await session(id, who);
  const row = await ensureSharing(id);
  if (!row || !await accounts.assigned(who, row.value)) throw fail(404, "Session not found.");
  if (action !== undefined) {
    if (!["rotate", "revoke", "reactivate"].includes(action)) throw fail(400, "Invalid sharing action.");
    const next = { ...row.value, csatSharing:{ ...row.value.csatSharing, revoked:action === "revoke" } };
    if (action !== "revoke") next.csatSharing.nonce = crypto.randomBytes(24).toString("base64url");
    await store.bookings.compareAndSwap(id, next, row.version);
    return sharingInfo(next);
  }
  return sharingInfo(row.value);
}
async function ownedSharing(record) {
  if (!open(record)) return null;
  const row = await ensureSharing(record.id);
  if (!row || row.value.ownerHash !== record.ownerHash || !open(row.value) || row.value.csatSharing.revoked) return null;
  return sharingInfo(row.value);
}
async function sharedResolve(token) {
  if (typeof token !== "string" || token.length > 260) throw fail(404, "Sharing link not found.");
  const parts = token.split(".");
  if (parts.length !== 4 || !["s", "s2"].includes(parts[0]) || (parts[0] === "s2" && !signingKey) || (parts[0] === "s" && sharedProduction.enabled) || !validId(parts[1]) || !/^[A-Za-z0-9_-]{32}$/.test(parts[2]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[3])) throw fail(404, "Sharing link not found.");
  const row = await store.bookings.getWithVersion(parts[1]);
  if (!row || row.value.recordType || !eligible(row.value) || row.value.csatSharing?.revoked || row.value.csatSharing?.nonce !== parts[2] ||
      !crypto.timingSafeEqual(Buffer.from(parts[3]), Buffer.from(shareSignature(parts[1], parts[2], parts[0])))) throw fail(404, "Sharing link not found.");
  return row;
}
function responseId(sessionId, attemptId) {
  if (typeof attemptId !== "string" || !/^[a-f0-9-]{36}$/.test(attemptId)) throw fail(400, "A valid submission ID is required.");
  return `csat-r-${crypto.createHash("sha256").update(JSON.stringify([sessionId, attemptId])).digest("hex")}`;
}
async function sharedSurvey(token, attemptId) {
  const row = await sharedResolve(token);
  const saved = attemptId ? await store.bookings.get(responseId(row.value.id, attemptId)) : null;
  return { mode:"shared", state:saved ? "answered" : open(row.value) ? "open" : "closed",
    session:{ topic:row.value.topic, trainingDate:row.value.trainingDate, facilitator:row.value.facilitator }, config };
}
async function sharedSubmit(token, input, attemptId) {
  const response = { ...schema.validate(input), submittedAt:new Date().toISOString(), source:"shared" };
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await sharedResolve(token), id = responseId(row.value.id, attemptId);
    if (await store.bookings.get(id)) return { submitted:true, alreadySubmitted:true, mode:"shared" };
    if (!open(row.value)) throw fail(400, "This survey is not accepting responses.");
    const now = Date.now(), previous = row.value.csatSharing.rate;
    const rate = previous && previous.startedAt + 60000 > now ? previous : { startedAt:now, count:0 };
    if (rate.count >= 300) throw fail(429, "Survey is busy. Retry shortly.");
    const next = { ...row.value, csatSharing:{ ...row.value.csatSharing, rate:{ startedAt:rate.startedAt, count:rate.count + 1 } } };
    const value = { id, recordType:"csat-response", csatSession:row.value.id, ...response };
    try { await store.bookings.transact([{ value:next, version:row.version }, { value, version:null }]); return { submitted:true, mode:"shared" }; }
    catch (e) { if (e.statusCode !== 409) throw e; await delay(Math.min(20 * (attempt + 1), 120)); }
  }
  throw fail(409, "Concurrent responses. Retry this same submission.");
}
async function session(id, who) {
  if (!who) throw fail(401, "Sign-in required.");
  if (!validId(id)) throw fail(404, "Session not found.");
  const row = await store.bookings.getWithVersion(id);
  if (!row || row.value.recordType || !await accounts.assigned(who, row.value)) throw fail(404, "Session not found.");
  return row;
}
function transition(existing, next, who, activateLegacy = false) {
  if (eligible(next) && next.status === "Completed" && (!existing.csatActivatedAt || existing.status !== "Completed")) {
    if (existing.status !== "Approved" && !(activateLegacy && who.role === "admin" && existing.status === "Completed")) throw fail(400, "Approve Phone Videography before completing it.");
    if (!existing.csatActivatedAt) { next.csatActivatedAt = new Date().toISOString(); next.csatCompletedBy = who.id; }
  }
  return next;
}
async function decide(id, who, action) {
  const row = await session(id, who);
  if (!["accept", "decline"].includes(action)) throw fail(400, "Choose accept or decline.");
  if (row.value.status !== "Pending") throw fail(409, "Only Pending requests can be accepted or declined.");
  const next = { ...row.value, status:action === "accept" ? "Approved" : "Rejected", updatedAt:new Date().toISOString(), updatedBy:who.user,
    decidedAt:new Date().toISOString(), decidedBy:who.id };
  if (action === "accept") {
    const { findConflicts } = require("./rules");
    const conflicts = findConflicts(await store.bookings.list(), await store.blocks.list(), next, id);
    if (conflicts.length) throw fail(409, "Scheduling conflict. Ask an administrator to review this request.");
  }
  await store.bookings.compareAndSwap(id, next, row.version);
  return safeSession(next);
}
async function complete(id, who, activateLegacy = false) {
  const row = await session(id, who);
  if (!eligible(row.value)) throw fail(400, "CSAT is only available for Phone Videography.");
  if (row.value.status === "Completed" && row.value.csatActivatedAt) return safeSession(row.value);
  const next = transition(row.value, { ...row.value, status:"Completed", updatedAt:new Date().toISOString(), updatedBy:who.user }, who, activateLegacy);
  await store.bookings.compareAndSwap(id, next, row.version);
  return safeSession(next);
}
function safeSession(b) {
  return { id:b.id, requestor:b.requestor, division:b.division, category:b.category, topic:b.topic,
    trainingDate:b.trainingDate, facilitator:b.facilitator, time:b.time, venue:b.venue, participants:b.participants,
    status:b.status, csatActivatedAt:b.csatActivatedAt || null, csatOpen:open(b) };
}
async function list(who) {
  if (!who) throw fail(401, "Sign-in required.");
  const all = await store.bookings.list(), out = [];
  for (const b of all) if (await accounts.assigned(who, b)) out.push(safeSession(b));
  return out;
}
const attendeeSafe = a => ({ id:a.id, name:a.name, email:a.email, createdAt:a.createdAt,
  invitationState:a.response ? "answered" : a.tokenHash ? "issued" : a.revokedAt ? "revoked" : "not-issued",
  submittedAt:a.response?.submittedAt || null });
async function detail(id, who) {
  const row = await session(id, who);
  const attendees = await store.bookings.listRelated(id);
  const shared = await store.bookings.listRelated(id, "csat-response");
  const responses = [...attendees.filter(a => a.response).map(a => ({ attendeeId:a.id, attendeeName:a.name, source:"individual", ...a.response })),
    ...shared.map(r => ({ id:r.id, source:"shared", version:r.version, answers:r.answers, answerSnapshot:r.answerSnapshot, submittedAt:r.submittedAt }))];
  const averages = config.ratings.map(q => ({ id:q.id, title:q.title, count:responses.length,
    average:responses.length ? responses.reduce((n, r) => n + r.answers[q.id], 0) / responses.length : null }));
  return { session:safeSession(row.value), attendees:attendees.map(attendeeSafe), responses, averages };
}
async function addAttendee(id, who, input) {
  const row = await session(id, who);
  if (!eligible(row.value)) throw fail(400, "CSAT is only available for Phone Videography.");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["name", "email"].includes(k)) ||
      typeof input.name !== "string" || !input.name.trim() || input.name.length > 200 || /[\u0000-\u001f\u007f]/.test(input.name) ||
      (input.email !== undefined && (typeof input.email !== "string" || input.email.length > 254 || (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))))) throw fail(400, "Attendee name and optional valid email are required.");
  const count = row.value.csatAttendeeCount || 0;
  if (count >= 2000) throw fail(400, "Maximum 2000 registered attendees per session.");
  const value = { id:`csat-a-${crypto.randomUUID()}`, recordType:"csat-attendee", csatSession:id,
    name:input.name.trim(), email:(input.email || "").trim(), createdAt:new Date().toISOString() };
  await store.bookings.transact([{ value:{ ...row.value, csatAttendeeCount:count + 1 }, version:row.version }, { value, version:null }]);
  return attendeeSafe(value);
}
async function invitation(id, attendeeId, who, action) {
  const row = await session(id, who);
  if (!validId(attendeeId)) throw fail(404, "Attendee not found.");
  const a = await store.bookings.getWithVersion(attendeeId);
  if (!a || a.value.recordType !== "csat-attendee" || a.value.csatSession !== id) throw fail(404, "Attendee not found.");
  if (a.value.response) throw fail(400, "An answered invitation cannot be reset.");
  if (!["issue", "revoke"].includes(action)) throw fail(400, "Invalid invitation action.");
  if (action === "issue" && !open(row.value)) throw fail(400, "Complete this session before issuing invitations.");
  const value = { ...a.value }, secret = action === "issue" ? crypto.randomBytes(32).toString("base64url") : null;
  value.tokenHash = secret ? hash(secret) : null;
  value.revokedAt = secret ? null : new Date().toISOString();
  await store.bookings.transact([{ value:row.value, version:row.version }, { value, version:a.version }]);
  return { ...attendeeSafe(value), ...(secret ? { link:`/csat/#${attendeeId}.${secret}` } : {}) };
}
const hash = token => crypto.createHash("sha256").update(token).digest("hex");
async function resolve(token) {
  if (typeof token !== "string" || token.length > 200) throw fail(404, "Invitation not found.");
  const parts = token.split(".");
  if (parts.length !== 2 || !/^csat-a-[a-f0-9-]{36}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw fail(404, "Invitation not found.");
  const attendee = await store.bookings.getWithVersion(parts[0]);
  if (!attendee || attendee.value.recordType !== "csat-attendee" || !attendee.value.tokenHash ||
      !crypto.timingSafeEqual(Buffer.from(hash(parts[1]), "hex"), Buffer.from(attendee.value.tokenHash, "hex"))) throw fail(404, "Invitation not found.");
  const booking = await store.bookings.getWithVersion(attendee.value.csatSession);
  if (!booking || booking.value.recordType) throw fail(404, "Session not found.");
  return { attendee, booking };
}
async function survey(token, attemptId) {
  if (typeof token === "string" && /^(s|s2)\./.test(token)) return sharedSurvey(token, attemptId);
  const { attendee, booking } = await resolve(token);
  return { mode:"individual", state:attendee.value.response ? "answered" : open(booking.value) ? "open" : "closed",
    session:{ topic:booking.value.topic, trainingDate:booking.value.trainingDate, facilitator:booking.value.facilitator }, config };
}
async function submit(token, input, attemptId) {
  if (typeof token === "string" && /^(s|s2)\./.test(token)) return sharedSubmit(token, input, attemptId);
  const { attendee, booking } = await resolve(token);
  if (attendee.value.response) return { submitted:true, alreadySubmitted:true };
  if (!open(booking.value)) throw fail(400, "This survey is not accepting responses.");
  const response = { ...schema.validate(input), submittedAt:new Date().toISOString() };
  await store.bookings.transact([{ value:booking.value, version:booking.version }, { value:{ ...attendee.value, response }, version:attendee.version }]);
  return { submitted:true };
}
module.exports = { eligible, open, initializeSharing, sharing, ownedSharing, transition, decide, complete, list, detail, addAttendee, invitation, survey, submit };
