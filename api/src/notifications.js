const crypto = require("node:crypto");

const RECORD_TYPE = "email-notification";
const THROTTLE_ID = "email-notification-throttle";
const ACTIVE_STATES = new Set(["pending", "retry", "sending", "accepted"]);
const conflict = error => [409, 412].includes(error?.statusCode);
const email = value => typeof value === "string" && value.length <= 254 &&
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value.trim())
  ? value.trim().toLowerCase() : null;
const text = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500) : "";
const integer = (env, key, fallback, max) => {
  if (env[key] === undefined || env[key] === "") return fallback;
  const value = Number(env[key]);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${key}.`);
  return value;
};
function httpsUrl(value, key) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${key}.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error(`Invalid ${key}.`);
  return url.toString().replace(/\/$/, "");
}
function configuration(env) {
  const sender = email(env.EMAIL_SENDER_ADDRESS);
  if (!sender) throw new Error("Invalid EMAIL_SENDER_ADDRESS.");
  return {
    endpoint:httpsUrl(env.EMAIL_ENDPOINT, "EMAIL_ENDPOINT"), sender,
    origin:httpsUrl(env.EMAIL_PUBLIC_ORIGIN, "EMAIL_PUBLIC_ORIGIN"),
    maxPerMinute:integer(env, "EMAIL_MAX_PER_MINUTE", 10, 30),
    maxPerHour:integer(env, "EMAIL_MAX_PER_HOUR", 50, 100),
    maxPollsPerMinute:integer(env, "EMAIL_MAX_POLLS_PER_MINUTE", 20, 60),
    maxPollsPerHour:integer(env, "EMAIL_MAX_POLLS_PER_HOUR", 100, 200),
    batchSize:integer(env, "EMAIL_WORKER_BATCH_SIZE", 10, 50),
    maxAttempts:integer(env, "EMAIL_MAX_ATTEMPTS", 5, 10),
    leaseMs:90000, requestTimeoutMs:15000, budgetMs:20000, pollDelayMs:60000
  };
}
function message(row, config) {
  const events = row.events;
  let subject = "Booking notification";
  if (events.includes("approved") && events.includes("assigned")) subject = "Booking approved and assigned";
  else if (events.includes("approved")) subject = "Booking approved";
  else if (events.includes("rejected")) subject = "Booking rejected";
  else if (events.includes("created")) subject = "New booking request";
  else if (events.includes("assigned")) subject = "Booking assigned";
  const snapshot = row.booking;
  return { senderAddress:config.sender, recipients:{ to:[{ address:row.recipient }] },
    headers:{ Importance:"high", "X-Priority":"1", "X-MSMail-Priority":"High" },
    content:{ subject, plainText:[subject, `Reference: ${text(row.bookingId)}`,
      `Status: ${snapshot.status}`, `Date: ${snapshot.trainingDate}`, `Time: ${snapshot.time}`,
      `Topic: ${snapshot.topic}`, `Venue: ${snapshot.venue}`,
      "Open the booking app and sign in or use your saved request access link to view details.", config.origin].join("\n") } };
}

// SDK retries are disabled: a lost send response cannot safely be treated as a failed send.
function createProvider(config, env) {
  const { EmailClient } = require("@azure/communication-email");
  const { ManagedIdentityCredential, DefaultAzureCredential } = require("@azure/identity");
  const credential = env.WEBSITE_SITE_NAME
    ? new ManagedIdentityCredential(env.EMAIL_MANAGED_IDENTITY_CLIENT_ID ? { clientId:env.EMAIL_MANAGED_IDENTITY_CLIENT_ID } : {})
    : new DefaultAzureCredential();
  const client = new EmailClient(config.endpoint, credential, { retryOptions:{ maxRetries:0 } });
  function snapshot(poller) {
    const result = poller.getResult();
    const state = poller.getOperationState();
    return { serialized:poller.toString(), operationId:result?.id,
      status:result?.status || ({ succeeded:"Succeeded", failed:"Failed", canceled:"Canceled" }[state.status] || "Running") };
  }
  return {
    async send(payload, operationId) {
      let accepted = false, providerFailed = false;
      try {
        const poller = await client.beginSend(payload, { operationId,
          abortSignal:AbortSignal.timeout(config.requestTimeoutMs),
          onResponse:(response, result) => {
            if (response.status === 202) accepted = true;
            if (["Failed", "Canceled"].includes(result?.status)) providerFailed = true;
          } });
        return snapshot(poller);
      } catch (error) {
        // A 429 before any acceptance is a definitive refusal. Other uncertain
        // outcomes (including a failure of beginSend's initial GET) need review.
        throw { statusCode:error.statusCode, accepted, providerFailed,
          retryAfterMs:Number(error.response?.headers?.get?.("retry-after")) * 1000 };
      }
    },
    async poll(payload, serialized) {
      let providerFailed = false;
      try {
        const poller = await client.beginSend(payload, { resumeFrom:serialized,
          abortSignal:AbortSignal.timeout(config.requestTimeoutMs),
          onResponse:(_response, result) => { if (["Failed", "Canceled"].includes(result?.status)) providerFailed = true; } });
        return snapshot(poller);
      } catch (error) { throw { statusCode:error.statusCode, providerFailed }; }
    }
  };
}

function createNotifications({ store, provider, env = process.env, now = Date.now, uuid = crypto.randomUUID } = {}) {
  const getStore = () => store || require("./store");
  const enabled = () => env.EMAIL_NOTIFICATIONS_ENABLED === "true";
  let cachedProvider;
  const getProvider = config => provider || (cachedProvider ||= createProvider(config, env));

  async function operations(before, after, actor) {
    if (!enabled()) return [];
    if (!after || after.recordType || !after.id) throw new TypeError("A booking is required.");
    const created = !before;
    const assigned = !!after.facilitator && (created || before.facilitator !== after.facilitator);
    const approved = !!before && before.status !== after.status && after.status === "Approved";
    const rejected = !!before && before.status !== after.status && after.status === "Rejected";
    const managerApproval = approved && ["admin", "supervisor"].includes(actor?.role);
    if (!created && !assigned && !approved && !rejected) return [];
    const recipients = new Map();
    const skipped = {};
    const add = (address, event) => {
      const normalized = email(address);
      if (!normalized) { skipped[event] = (skipped[event] || 0) + 1; return; }
      if (!recipients.has(normalized)) recipients.set(normalized, new Set());
      recipients.get(normalized).add(event);
    };
    if (created || assigned || managerApproval) {
      const db = getStore();
      const [accounts, directory] = await Promise.all([db.accounts.list(), db.accounts.get("facilitator-directory")]);
      if (created) for (const account of accounts) {
        if (!account.disabled && ["admin", "supervisor"].includes(account.role)) add(account.profile?.email, "created");
      }
      if (assigned || managerApproval) {
        const accountId = directory?.labels && Object.hasOwn(directory.labels, after.facilitator)
          ? directory.labels[after.facilitator] : null;
        const account = accounts.find(value => value.id === accountId && value.role === "facilitator" &&
          !value.disabled && value.facilitatorLabel === after.facilitator);
        if (assigned) add(account?.profile?.email, "assigned");
        if (managerApproval) add(account?.profile?.email, "approved");
      }
    }
    if (approved || rejected) add(after.requesterEmail, approved ? "approved" : "rejected");
    const createdAt = new Date(now()).toISOString();
    const booking = Object.fromEntries(["status", "trainingDate", "time", "topic", "venue"].map(key => [key, text(after[key])]));
    const rows = [...recipients].map(([recipient, events]) => ({ value:{ id:`email-${uuid()}`, recordType:RECORD_TYPE,
      bookingId:after.id, booking, recipient, events:[...events].sort(), state:"pending", attempts:0,
      createdAt, nextAttemptAt:createdAt }, version:null }));
    if (Object.keys(skipped).length) rows.push({ value:{ id:`email-${uuid()}`, recordType:RECORD_TYPE,
      bookingId:after.id, state:"skipped", reason:"missing-or-invalid-recipient", skipped, createdAt }, version:null });
    // Leave capacity for the booking, schedule guard and other transaction rows.
    if (rows.length > 90) throw Object.assign(new Error("Notification recipient capacity exceeded."), { statusCode:503 });
    return rows;
  }

  async function reserve(config, send) {
    const db = getStore().bookings;
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await db.getWithVersion(THROTTLE_ID);
      const time = now();
      const sends = (current?.value.sends || []).filter(value => value > time - 3600000);
      const polls = (current?.value.polls || []).filter(value => value > time - 3600000);
      const full = (values, minute, hour) => values.length >= hour || values.filter(value => value > time - 60000).length >= minute;
      if (full(polls, config.maxPollsPerMinute, config.maxPollsPerHour) ||
          send && (full(sends, config.maxPerMinute, config.maxPerHour) ||
            sends.length && time - sends[sends.length - 1] < Math.ceil(60000 / config.maxPerMinute))) return false;
      try {
        await db.compareAndSwap(THROTTLE_ID, { id:THROTTLE_ID, recordType:"email-throttle",
          sends:send ? [...sends, time] : sends, polls:[...polls, time] }, current?.version ?? null);
        return true;
      } catch (error) { if (!conflict(error)) throw error; }
    }
    return false;
  }

  async function runWorker() {
    const counts = { processed:0, sent:0, accepted:0, retry:0, failed:0, ambiguous:0 };
    if (!enabled()) return counts;
    const config = configuration(env);
    const db = getStore().bookings;
    const start = now();
    const candidates = await db.listNotifications(config.batchSize);
    for (const candidate of candidates.slice(0, config.batchSize)) {
      if (now() - start >= config.budgetMs) break;
      const current = await db.getWithVersion(candidate.id);
      if (!current || current.value.recordType !== RECORD_TYPE || !ACTIVE_STATES.has(current.value.state)) continue;
      let row = current.value;
      if (Date.parse(row.leaseUntil) > now() || Date.parse(row.nextAttemptAt) > now()) continue;
      // A process died after marking its intent to send. Never resend without
      // proof of a provider operation: the original request may have succeeded.
      if (row.state === "sending") {
        try {
          await db.compareAndSwap(row.id, { ...row, state:"ambiguous", reason:"send-outcome-unknown", leaseUntil:null,
            updatedAt:new Date(now()).toISOString() }, current.version);
          counts.ambiguous++; counts.processed++;
        } catch (error) { if (!conflict(error)) throw error; }
        continue;
      }
      if (row.state === "accepted" && !row.providerPoller) {
        try {
          await db.compareAndSwap(row.id, { ...row, state:"ambiguous", reason:"missing-provider-operation", leaseUntil:null }, current.version);
          counts.ambiguous++; counts.processed++;
        } catch (error) { if (!conflict(error)) throw error; }
        continue;
      }
      const leaseOwner = uuid();
      const sending = row.state !== "accepted";
      const claim = { ...row, leaseOwner, leaseUntil:new Date(now() + config.leaseMs).toISOString(),
        updatedAt:new Date(now()).toISOString() };
      try { await db.compareAndSwap(row.id, claim, current.version); }
      catch (error) { if (conflict(error)) continue; throw error; }
      let owned = await db.getWithVersion(row.id);
      if (!owned || owned.value.leaseOwner !== leaseOwner) continue;
      if (!await reserve(config, sending)) continue;
      row = owned.value;
      if (sending) {
        row = { ...row, state:"sending", attempts:row.attempts + 1, providerOperationId:uuid() };
        try { await db.compareAndSwap(row.id, row, owned.version); }
        catch (error) { if (conflict(error)) continue; throw error; }
        owned = await db.getWithVersion(row.id);
        if (!owned || owned.value.leaseOwner !== leaseOwner || owned.value.state !== "sending") continue;
      }
      let outcome;
      try {
        const transport = getProvider(config);
        const result = sending ? await transport.send(message(row, config), row.providerOperationId)
          : await transport.poll(message(row, config), row.providerPoller);
        if (!result?.serialized || !["Succeeded", "Failed", "Canceled", "Running", "NotStarted"].includes(result.status))
          throw new Error("Invalid provider result.");
        outcome = { ...row, providerPoller:result.serialized, providerOperationId:result.operationId || row.providerOperationId,
          state:result.status === "Succeeded" ? "sent" : ["Failed", "Canceled"].includes(result.status) ? "failed" : "accepted",
          reason:["Failed", "Canceled"].includes(result.status) ? "provider-operation-failed" : null,
          nextAttemptAt:new Date(now() + config.pollDelayMs).toISOString() };
      } catch (error) {
        if (error.providerFailed) {
          outcome = { ...row, state:"failed", reason:"provider-operation-failed" };
        } else if (!sending) {
          outcome = { ...row, state:"accepted", reason:"provider-status-unavailable", nextAttemptAt:new Date(now() + config.pollDelayMs).toISOString() };
        } else if (!error.accepted && error.statusCode === 429) {
          const delay = Math.max(60000, Math.min(3600000, Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0),
            Math.min(3600000, 60000 * 2 ** (row.attempts - 1)));
          outcome = { ...row, state:row.attempts >= config.maxAttempts ? "failed" : "retry", reason:"provider-throttled",
            nextAttemptAt:new Date(now() + delay).toISOString() };
        } else if (!error.accepted && [400, 401, 403, 404, 413, 422].includes(error.statusCode)) {
          outcome = { ...row, state:"failed", reason:"provider-rejected" };
        } else {
          outcome = { ...row, state:"ambiguous", reason:"send-outcome-unknown" };
        }
      }
      // Preserve the claimed version, not a newly fetched version: a stale
      // worker must not overwrite recovery performed after its lease expired.
      try {
        await db.compareAndSwap(row.id, { ...outcome, leaseUntil:null, leaseOwner:null,
          updatedAt:new Date(now()).toISOString() }, owned.version);
        counts.processed++; counts[outcome.state]++;
      } catch (error) { if (!conflict(error)) throw error; }
    }
    return counts;
  }
  return { operations, runWorker };
}

const notifications = createNotifications();
module.exports = { ...notifications, createNotifications, configuration, message, RECORD_TYPE };
