const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../../app/history.js"), "utf8");
function harness(store, search = "") {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.hidden = false; this.textContent = ""; this.attrs = {}; }
    append(...els) { this.children.push(...els); }
    replaceChildren() { this.children = []; }
    setAttribute(k,v) { this.attrs[k] = v; }
    addEventListener(k,fn) { this.events[k] = fn; }
    focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; this.events.close?.(); }
  }
  const ids = ["requestHistory", "historyContent", "historyMessage", "historyMoreBtn", "historyRetryBtn", "historyBackBtn", "historyBtn", "thanksHistoryBtn", "historyTitle", "closeHistoryBtn", "saveWarning"];
  const els = Object.fromEntries(ids.map(id => [id,new Element("div")]));
  const window = { BookingStore:store };
  vm.runInNewContext(source, { window, location:{search}, URLSearchParams, document:{ getElementById:id => els[id], createElement:tag => new Element(tag) } });
  return { window, els, click:id => els[id].events.click() };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test("history initializes, paginates, renders text-only answers, and returns focus", async () => {
  const calls = [], pages = [{items:[{id:"one",status:"Pending",createdAt:"2026-01-01",category:"<script>"}],nextCursor:"next"}, {items:[{id:"two",status:"Approved"}],nextCursor:null}];
  const b = harness({ myRequests:async cursor => { calls.push(cursor); return cursor ? pages[1] : pages[0]; }, myRequest:async id => ({id,status:"Approved",answerSnapshot:[{title:"<img>",value:["<script>","Answer"]}]}) });
  await b.window.RequestHistory.ready;
  b.click("historyBtn"); await settle();
  assert.equal(b.els.requestHistory.open,true); assert.equal(b.els.historyContent.children.length,1);
  assert.equal(b.els.historyContent.children[0].children[0].textContent,"<script>");
  b.click("historyMoreBtn"); await settle(); assert.equal(calls.at(-1),"next");
  assert.equal(b.els.historyContent.children.length,2); assert.equal(b.els.historyMoreBtn.hidden,true);
  b.els.historyContent.children[0].children.at(-1).events.click(); await settle();
  const table = b.els.historyContent.children.at(-1), row = table.children[0].children[0];
  assert.equal(row.children[0].textContent,"<img>"); assert.equal(row.children[1].textContent,"<script>; Answer");
  assert.equal(b.els.historyBackBtn.hidden,false);
  b.click("closeHistoryBtn"); assert.equal(b.els.historyBtn.focused,true);
});
test("history handles empty results and retry without changing saved requests", async () => {
  let fail = true;
  const b = harness({myRequests:async () => { if (fail) throw new Error("Offline"); return {items:[],nextCursor:null}; }});
  await b.window.RequestHistory.ready; b.click("historyBtn"); await settle();
  assert.equal(b.els.historyRetryBtn.hidden,false); assert.match(b.els.historyMessage.textContent,/Offline/);
  fail = false; b.click("historyRetryBtn"); await settle(); assert.match(b.els.historyMessage.textContent,/No requests/);
  assert.equal(b.els.historyContent.attrs["aria-busy"],"false");
});
test("late history verification cannot change a reset confirmation", async () => {
  let reject, current = true;
  const b = harness({myRequests:async () => ({items:[]}),myRequest:() => new Promise((_,fail) => { reject = fail; })});
  const pending = b.window.RequestHistory.verifySaved("saved", () => current);
  current = false; b.els.saveWarning.textContent = "Next request warning.";
  reject(new Error("Offline")); await pending;
  assert.equal(b.els.saveWarning.textContent,"Next request warning.");
});
test("blocked-cookie verification preserves committed warning and preview makes no requests", async () => {
  const b = harness({myRequests:async () => ({items:[]}),myRequest:async () => { throw new Error("Not found"); }});
  b.els.saveWarning.textContent = "Audit warning.";
  await b.window.RequestHistory.verifySaved("saved");
  assert.match(b.els.saveWarning.textContent,/Audit warning/); assert.match(b.els.saveWarning.textContent,/request was saved/);
  assert.match(b.els.saveWarning.textContent,/Do not resubmit/); assert.equal(b.els.saveWarning.hidden,false);
  let calls = 0; const preview = harness({myRequests:async () => { calls++; }},"?preview=draft");
  await preview.window.RequestHistory.ready; assert.equal(calls,0); assert.equal(preview.els.historyBtn.hidden,true);
});
