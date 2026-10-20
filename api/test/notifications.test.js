const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { createNotifications, configuration, message } = require("../src/notifications");

const settings = { EMAIL_NOTIFICATIONS_ENABLED:"true", EMAIL_ENDPOINT:"https://example.communication.azure.com",
  EMAIL_SENDER_ADDRESS:"sender@example.com", EMAIL_PUBLIC_ORIGIN:"https://booking.example.com" };
const booking = { id:"booking-one", status:"Pending", facilitator:"Alex", requesterEmail:"requester@example.com",
  trainingDate:"2099-01-01", time:"10 AM", topic:"Training", venue:"Office", answers:{ email:"arbitrary@example.com" } };
const accounts = [
  { id:"admin", role:"admin", profile:{email:"ADMIN@example.com"} },
  { id:"supervisor", role:"supervisor", profile:{email:"supervisor@example.com"} },
  { id:"disabled", role:"admin", disabled:true, profile:{email:"disabled@example.com"} },
  { id:"alex", role:"facilitator", facilitatorLabel:"Alex", profile:{email:"alex@example.com"} },
  { id:"blair", role:"facilitator", facilitatorLabel:"Blair", profile:{email:"blair@example.com"} }
];
function fixture(options = {}) {
  let clock = Date.parse("2026-10-20T00:00:00.000Z"), sequence = 0;
  const rows = new Map(), versions = new Map(), writes = [], sends = [], polls = [];
  const store = {
    accounts:{ async list() { return options.accounts || structuredClone(accounts); },
      async get() { return options.directory || { labels:{ Alex:"alex", Blair:"blair" } }; } },
    bookings:{
      async getWithVersion(id) { return rows.has(id) ? {value:structuredClone(rows.get(id)),version:String(versions.get(id))} : null; },
      async compareAndSwap(id, value, version) {
        if (version === null ? rows.has(id) : !rows.has(id) || String(versions.get(id)) !== version)
          throw Object.assign(new Error("conflict"),{statusCode:409});
        if (options.failWrite?.(value)) throw new Error("storage write lost");
        rows.set(id,structuredClone(value)); versions.set(id,(versions.get(id)||0)+1); writes.push(structuredClone(value));
      },
      async listNotifications(limit) {
        return [...rows.values()].filter(row => row.recordType === "email-notification" &&
          ["pending","retry","sending","accepted"].includes(row.state) &&
          !(Date.parse(row.leaseUntil) > clock) && !(Date.parse(row.nextAttemptAt) > clock)).slice(0,limit);
      }
    }
  };
  const provider = {
    async send(payload, id) { sends.push({payload,id,time:clock}); return options.send ? options.send(payload,id) : {serialized:"poller",operationId:id,status:"Succeeded"}; },
    async poll(payload, serialized) { polls.push({payload,serialized}); return options.poll ? options.poll() : {serialized,status:"Succeeded"}; }
  };
  const factory = () => createNotifications({store,provider,env:{...settings,...options.env},now:()=>clock,uuid:()=>`id-${++sequence}`});
  const notifications = factory();
  const insert = async operations => { for (const row of operations) await store.bookings.compareAndSwap(row.value.id,row.value,row.version); };
  return { notifications, factory, store, rows, writes, sends, polls, insert,
    advance(ms) { clock += ms; }, async enqueue(value = booking) { const ops = await notifications.operations(null,value,null); await insert(ops); return ops; } };
}
const deliverable = operations => operations.filter(row=>row.value.state === "pending");

test("importing the module does not register functions or construct SDK clients", () => {
  const original = Module._load;
  Module._load = function(name,...args) {
    if (["@azure/functions","@azure/communication-email","@azure/identity","./store"].includes(name)) throw new Error("eager dependency");
    return original.call(this,name,...args);
  };
  try { delete require.cache[require.resolve("../src/notifications")]; assert.equal(typeof require("../src/notifications").operations,"function"); }
  finally { Module._load = original; }
});
test("disabled feature is a cheap no-op without store/config/provider access", async () => {
  const notification = createNotifications({env:{}});
  assert.deepEqual(await notification.operations(null,null,null),[]);
  assert.equal((await notification.runWorker()).processed,0);
});
test("creation snapshots enabled managers and mapped facilitator, not requester", async () => {
  const f = fixture(), ops = await f.notifications.operations(null,booking,null);
  assert.deepEqual(deliverable(ops).map(row=>row.value.recipient).sort(),["admin@example.com","alex@example.com","supervisor@example.com"]);
  for (const row of ops) { assert.equal(row.version,null); assert.equal(row.value.recordType,"email-notification"); assert.equal(row.value.bookingId,booking.id); }
  assert.equal(JSON.stringify(ops).includes("arbitrary@example.com"),false);
  assert.equal(JSON.stringify(ops).includes("answers"),false);
});
test("reassignment alerts new facilitator and consolidates simultaneous manager approval", async () => {
  const f = fixture();
  const ops = deliverable(await f.notifications.operations(booking,{...booking,facilitator:"Blair",status:"Approved"},{role:"supervisor"}));
  assert.equal(ops.length,2);
  const assigned = ops.find(row=>row.value.recipient === "blair@example.com");
  assert.deepEqual(assigned.value.events,["approved","assigned"]);
  assert.equal(message(assigned.value,configuration(settings)).content.subject,"Booking approved and assigned");
  assert.equal(ops.some(row=>row.value.recipient === "alex@example.com"),false);
});
test("requester decisions, manager approval, and facilitator self-approval rules", async () => {
  const f = fixture();
  for (const status of ["Approved","Rejected"]) {
    const self = deliverable(await f.notifications.operations(booking,{...booking,status},{role:"facilitator",id:"alex"}));
    assert.deepEqual(self.map(row=>row.value.recipient),["requester@example.com"]);
  }
  const approved = {...booking,status:"Approved"};
  assert.equal(deliverable(await f.notifications.operations(booking,approved,{role:"admin"})).length,2);
  assert.deepEqual(await f.notifications.operations(approved,{...approved,topic:"Updated"},{role:"admin"}),[]);
  assert.deepEqual(await f.notifications.operations(booking,{...booking,status:"Cancelled"},{role:"admin"}),[]);
});
test("recipient dedupe and invalid/missing emails are operationally recorded without inferred answers", async () => {
  const directoryAccounts = structuredClone(accounts);
  directoryAccounts[1].profile.email = "admin@example.com";
  directoryAccounts[3].profile.email = "bad\naddress@example.com";
  const f = fixture({accounts:directoryAccounts});
  const ops = await f.notifications.operations(null,booking,null);
  assert.equal(deliverable(ops).length,1);
  assert.deepEqual(ops.find(row=>row.value.state === "skipped").value.skipped,{assigned:1});
  const statusOps = await f.notifications.operations(booking,{...booking,status:"Rejected",requesterEmail:undefined},null);
  assert.equal(deliverable(statusOps).length,0);
  assert.equal(statusOps[0].value.reason,"missing-or-invalid-recipient");
});
test("facilitator lookup requires both directory assignment and exact account label", async () => {
  const f = fixture({directory:{labels:{Alex:"blair"}}});
  const rows = await f.notifications.operations(booking,{...booking,status:"Approved"},{role:"admin"});
  assert.deepEqual(deliverable(rows).map(row=>row.value.recipient),["requester@example.com"]);
  assert.equal(rows.some(row=>row.value.state === "skipped"),true);
});
test("all notification messages request high importance without changing recipients or subjects", () => {
  for (const events of [["created"], ["assigned"], ["approved"], ["rejected"], ["approved", "assigned"]]) {
    const payload = message({ bookingId:booking.id, booking, recipient:"recipient@example.com", events }, configuration(settings));
    assert.deepEqual(payload.headers, { Importance:"high", "X-Priority":"1", "X-MSMail-Priority":"High" });
    assert.deepEqual(payload.recipients, { to:[{ address:"recipient@example.com" }] });
    assert.ok(payload.content.subject.startsWith("Booking") || payload.content.subject === "New booking request");
  }
});
test("worker only mutates internal rows, uses single-recipient messages and durable attempt state", async () => {
  const f = fixture(); await f.enqueue();
  f.rows.set(booking.id,structuredClone(booking)); f.rows.set("guard",{id:"guard",recordType:"schedule-guard"});
  const result = await f.notifications.runWorker();
  assert.equal(result.sent,1); assert.equal(f.sends.length,1);
  assert.deepEqual(f.rows.get(booking.id),booking);
  assert.equal(f.writes.some(row=>row.id === booking.id || row.id === "guard"),false);
  const sent = [...f.rows.values()].find(row=>row.state === "sent");
  assert.equal(sent.attempts,1); assert.equal(sent.leaseUntil,null);
  assert.equal(f.sends[0].payload.recipients.to.length,1);
  assert.equal(f.sends[0].payload.content.plainText.includes("arbitrary@example.com"),false);
  assert.ok(sent.providerOperationId);
});
test("concurrent worker instances claim through ETags and globally share send limits", async () => {
  const f = fixture(); await f.enqueue();
  await Promise.all([f.notifications.runWorker(),f.factory().runWorker(),f.factory().runWorker()]);
  assert.equal(f.sends.length,1);
  f.advance(91000); await f.factory().runWorker();
  assert.equal(f.sends.length,2);
});
test("persisted sliding-hour budget survives worker recreation and repeated callbacks", async () => {
  const f = fixture({env:{EMAIL_MAX_PER_MINUTE:"30",EMAIL_MAX_PER_HOUR:"3"}});
  for(let i=0;i<5;i++) await f.enqueue({...booking,id:`book-${i}`});
  for(let i=0;i<8;i++) { await f.factory().runWorker(); f.advance(91000); }
  assert.equal(f.sends.length,3);
  f.advance(3600000); await f.factory().runWorker(); assert.equal(f.sends.length,4);
});
test("accepted operations resume polling without another send; polling faults do not resend", async () => {
  let fail = true;
  const f = fixture({send:async()=>({serialized:"serialized-operation",operationId:"acs-op",status:"Running"}),
    poll:async()=> { if(fail) throw new Error("transient"); return {serialized:"serialized-operation",status:"Succeeded"}; }});
  await f.enqueue(); await f.notifications.runWorker();
  const row = [...f.rows.values()].find(row=>row.state === "accepted");
  assert.equal(row.providerOperationId,"acs-op");
  // Remove other waiting rows to isolate provider operation recovery.
  for(const [id,value] of f.rows) if(value.state === "pending") f.rows.delete(id);
  f.advance(61000); await f.factory().runWorker(); assert.equal(f.rows.get(row.id).state,"accepted");
  fail = false; f.advance(61000); await f.factory().runWorker();
  assert.equal(f.sends.length,1); assert.equal(f.polls.length,2); assert.equal(f.rows.get(row.id).state,"sent");
  assert.equal(f.polls[0].serialized,"serialized-operation");
});
test("definite 429 retries durably with bounded attempts", async () => {
  const f = fixture({env:{EMAIL_MAX_ATTEMPTS:"2"},send:async()=>{throw {statusCode:429,retryAfterMs:120000};}});
  await f.enqueue(); await f.notifications.runWorker();
  const retry = [...f.rows.values()].find(row=>row.state === "retry");
  for(const [id,value] of f.rows) if(value.state === "pending") f.rows.delete(id);
  f.advance(61000); await f.factory().runWorker(); assert.equal(f.sends.length,1);
  f.advance(60000); await f.factory().runWorker();
  assert.equal(f.rows.get(retry.id).state,"failed"); assert.equal(f.rows.get(retry.id).attempts,2);
});
test("ambiguous response or acceptance followed by 429 is never automatically resent", async () => {
  for(const error of [new Error("timeout"),{statusCode:503},{statusCode:429,accepted:true}]) {
    const f = fixture({send:async()=>{throw error;}}); await f.enqueue(); await f.notifications.runWorker();
    const ambiguous = [...f.rows.values()].find(row=>row.state === "ambiguous");
    assert.ok(ambiguous);
    for(const [id,value] of f.rows) if(value.state === "pending") f.rows.delete(id);
    f.advance(3600000); await f.factory().runWorker(); assert.equal(f.sends.length,1);
  }
});
test("crash after send acceptance leaves intent and recovers to manual review, no duplicate send", async () => {
  const f = fixture({failWrite:row=>row.state === "sent"}); await f.enqueue();
  await assert.rejects(f.notifications.runWorker(),/storage write lost/);
  const intent = [...f.rows.values()].find(row=>row.state === "sending"); assert.ok(intent);
  for(const [id,value] of f.rows) if(value.state === "pending") f.rows.delete(id);
  f.advance(91000); await f.factory().runWorker();
  assert.equal(f.rows.get(intent.id).state,"ambiguous"); assert.equal(f.sends.length,1);
});
test("permanent provider rejection and completed failed provider operation are terminal", async () => {
  for(const error of [{statusCode:400},{providerFailed:true,accepted:true}]) {
    const f = fixture({send:async()=>{throw error;}}); await f.enqueue(); await f.notifications.runWorker();
    assert.equal([...f.rows.values()].some(row=>row.state === "failed"),true);
  }
});
test("batch and invocation time bounds stop work", async () => {
  let f;
  f = fixture({env:{EMAIL_WORKER_BATCH_SIZE:"1"},send:async()=>{f.advance(21000);return {serialized:"p",status:"Succeeded"};}});
  await f.enqueue(); assert.equal((await f.notifications.runWorker()).processed,1); assert.equal(f.sends.length,1);
});
test("oversized recipient directory fails explicitly before returning partial transaction operations", async () => {
  const profiles = Array.from({length:91},(_,index)=>({id:`admin-${index}`,role:"admin",profile:{email:`admin${index}@example.com`}}));
  const f = fixture({accounts:profiles});
  await assert.rejects(f.notifications.operations(null,{...booking,facilitator:""},null),error=>error.statusCode === 503 && /capacity/.test(error.message));
  assert.equal(f.rows.size,0);
});
test("recipient snapshots survive subsequent directory profile changes", async () => {
  const profiles = structuredClone(accounts), f = fixture({accounts:profiles});
  await f.enqueue(); profiles[0].profile.email = "new@example.com";
  await f.notifications.runWorker();
  assert.equal(f.sends[0].payload.recipients.to[0].address,"admin@example.com");
});
test("expired intent and incomplete accepted operation require review without provider calls", async () => {
  for(const state of ["sending","accepted"]) {
    const f = fixture(); const ops = await f.enqueue();
    const id = deliverable(ops)[0].value.id;
    for(const [key,row] of f.rows) if(row.state === "pending" && key !== id) f.rows.delete(key);
    f.rows.set(id,{...f.rows.get(id),state,leaseUntil:"2020-01-01T00:00:00.000Z"});
    await f.notifications.runWorker();
    assert.equal(f.rows.get(id).state,"ambiguous"); assert.equal(f.sends.length,0); assert.equal(f.polls.length,0);
  }
});
test("polling quota is shared across instances and does not reset per callback", async () => {
  const f = fixture({env:{EMAIL_MAX_POLLS_PER_HOUR:"2"},send:async()=>({serialized:"op",status:"Running"}),
    poll:async()=>({serialized:"op",status:"Running"})});
  const ops = await f.enqueue(), id = deliverable(ops)[0].value.id;
  for(const [key,row] of f.rows) if(row.state === "pending" && key !== id) f.rows.delete(key);
  await f.notifications.runWorker(); f.advance(61000); await f.factory().runWorker();
  f.advance(61000); await f.factory().runWorker();
  assert.equal(f.sends.length,1); assert.equal(f.polls.length,1);
});
test("configuration rejects secrets in URLs and unsafe quotas; default custom-domain quotas are conservative", () => {
  assert.equal(configuration(settings).maxPerHour,50); assert.equal(configuration(settings).maxPerMinute,10);
  for(const patch of [{EMAIL_ENDPOINT:"https://user:pass@example.com"},{EMAIL_PUBLIC_ORIGIN:"https://app.example.com/?secret=x"},
    {EMAIL_MAX_PER_MINUTE:"31"},{EMAIL_MAX_PER_HOUR:"101"},{EMAIL_MAX_POLLS_PER_HOUR:"201"},{EMAIL_SENDER_ADDRESS:"bad"}])
    assert.throws(()=>configuration({...settings,...patch}));
});
