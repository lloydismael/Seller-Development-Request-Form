const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../../app/admin/reporting-model');
const bookings = [
  { id:'a', status:'Completed', trainingDate:'2026-01-01', facilitator:'A', category:'Skills', topic:'Phone Videography', division:'East', time:'9:00 AM - 12:00 PM' },
  { id:'b', status:'Pending', trainingDate:'2026-03-31', facilitator:'B', category:'Sales', division:'West', time:'1:00 PM - 5:00 PM' },
  { id:'c', status:'Approved', trainingDate:'2026-03-31', facilitator:'A', category:'Skills', division:'East', time:'1:00 PM - 5:00 PM' },
  { id:'d', status:'Cancelled', trainingDate:'', facilitator:'A', time:'9:00 AM - 12:00 PM' },
  { id:'e', status:'Completed', trainingDate:'2026-02-30', facilitator:'A', time:'bad' }
];
const blocks = [{ facilitator:'A', startDate:'2025-12-30', endDate:'2026-01-02' }, { facilitator:'B', startDate:'2026-03-31' }, { facilitator:'A', startDate:'2026-04-01' }];
test('inclusive date filters intersect blocked ranges and preserve historical groups', () => {
  const report = M.summarize(bookings, blocks, { from:'2026-01-01', to:'2026-03-31', category:'Skills' });
  assert.deepEqual(report.rows.map(row => row.id), ['a', 'c']);
  assert.equal(report.blocks.length, 1);
  assert.deepEqual(report.trend, [{name:'2026-01',count:1},{name:'2026-02',count:0},{name:'2026-03',count:1}]);
  assert.equal(report.hours, 7); assert.equal(report.completionRate, 50);
  assert.deepEqual(report.breakdowns.topic, [{name:'Not recorded',count:1},{name:'Phone Videography',count:1}]);
});
test('all dates retain undated records without inventing time-series or reserved hours', () => {
  const report = M.summarize(bookings, blocks);
  assert.equal(report.rows.length, 5); assert.equal(report.missingDates, 2);
  assert.equal(report.hours, 7); assert.equal(report.pending, 1); assert.equal(report.completed, 2);
  assert.equal(report.trend.reduce((n, row) => n + row.count, 0), 3);
  assert.equal(M.validDate('2026-02-30'), false); assert.equal(M.validDate('2024-02-29'), true);
});
test('combined status, facilitator, division and search filters apply to the same records', () => {
  assert.deepEqual(M.summarize(bookings, blocks, {status:'Completed',facilitator:'A',division:'East',q:'VIDEOGRAPHY'}).rows.map(row => row.id), ['a']);
  const empty = M.summarize(bookings, blocks, {q:'no match'});
  assert.equal(empty.rows.length, 0); assert.equal(empty.completionRate, null); assert.equal(empty.blocks.length, 0);
  assert.equal(empty.status.length, 5);
});
test('CSAT weights by response count and reports shared/individual submissions separately', () => {
  const summary = M.csatSummary([
    {attendees:[],responses:[{source:'individual'}],averages:[{id:'quality',title:'Quality',average:1,count:1}]},
    {attendees:[{}],responses:[{source:'shared'},{source:'shared'},{source:'shared'}],averages:[{id:'quality',title:'Quality',average:5,count:3}]},
    {attendees:[],responses:[],averages:[{id:'quality',title:'Quality',average:null,count:0}]}
  ]);
  assert.equal(summary.average, 4); assert.equal(summary.ratings[0].average, 4);
  assert.equal(summary.responses, 4); assert.equal(summary.shared, 3); assert.equal(summary.individual, 1); assert.equal(summary.attendees, 1);
  assert.equal(M.csatSummary([]).average, null);
});
test('CSV protects spreadsheet prefixes, quotes, multiline values and unicode', () => {
  const csv = M.csv(['Value'], [['=1+1'], ['  @SUM(A1)'], ['\tunsafe'], ['"quoted",\nnext'], ['José']]);
  assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'  @SUM(A1)"')); assert.ok(csv.includes('"\'\tunsafe"'));
  assert.ok(csv.includes('"""quoted"",\nnext"')); assert.ok(csv.includes('José'));
});
const source = fs.readFileSync(require.resolve('../../app/admin/reporting.js'), 'utf8');
function harness(store = {}) {
  const nodes = new Map();
  const node = () => ({innerHTML:'',textContent:'',disabled:false,hidden:true,dataset:{},children:[],setAttribute(){},focus(){},append(child){this.children.push(child);},remove(){this.removed=true;},classList:{add(){},remove(){}}});
  const view = node(); view.isConnected = true;
  view.querySelector = selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); };
  view.querySelectorAll = () => [];
  const blobs = [], downloads = [], events = {};
  const context = {window:{ReportingModel:M,addEventListener:(name, callback)=>{events[name]=callback;},print(){}},document:{querySelector:()=>view,body:node(),createElement:tag=>{const el=node();el.click=()=>downloads.push(el.download);return el;}},Intl,Date,Blob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:test';},revokeObjectURL(){}},setTimeout:callback=>callback(),FormData:class { constructor(form) { return Object.entries(form.values); } }};
  vm.runInNewContext(source, context);
  const ctx = {identity:{role:'admin'},mode:'api',bookings,blocks,S:store,toast(){},openBooking(){},updateData(){}};
  context.window.ReportingUI.render(view, ctx);
  return { context, view, ctx, nodes, blobs, downloads, events };
}
test('workspace renders accessible reporting navigation, charts, exact value tables and export actions', () => {
  const h = harness();
  for (const text of ['Report filters','Booking volume over time','Training categories','Sales divisions','Facilitator workload','Booking detail','Training feedback / CSAT']) assert.ok(h.view.innerHTML.includes(text));
  assert.match(h.view.innerHTML, /role="status" id="reportCount"/);
  assert.match(h.view.innerHTML, /role="img" aria-label=/);
  assert.match(h.view.innerHTML, /View all values/);
  assert.match(h.nodes.get('#reportRecords').innerHTML, /aria-sort="ascending"/);
  const html = fs.readFileSync(require.resolve('../../app/admin/index.html'), 'utf8');
  assert.match(html, /data-tab="reporting"[\s\S]*?aria-hidden="true"/);
});
test('filter application rejects reversed dates and produces the matching report', () => {
  const h = harness(); const form = h.nodes.get('#reportFilters');
  form.onsubmit({preventDefault(){},currentTarget:{values:{from:'2026-04-01',to:'2026-01-01'}}});
  assert.equal(h.nodes.get('#reportFilterError').hidden, false);
  form.onsubmit({preventDefault(){},currentTarget:{values:{from:'2026-01-01',to:'2026-01-01'}}});
  assert.match(h.view.innerHTML, /1 of 5 bookings/);
});
test('feedback aggregates safely and shows partial session failures', async () => {
  const h = harness({ trainingSessions:async()=>[{id:'a',topic:'Phone Videography'},{id:'e',topic:'Phone Videography'}], trainingSession:async id=> {
    if(id === 'e') throw Error('Unavailable');
    return {attendees:[],responses:[{source:'shared',answers:{name:'Private respondent'}}],averages:[{id:'q',title:'Quality',average:5,count:1}]};
  } });
  await h.nodes.get('#reportLoadCsat').onclick();
  assert.match(h.nodes.get('#reportCsat').innerHTML, /1 of 2 matching eligible sessions loaded/);
  assert.match(h.nodes.get('#reportCsat').innerHTML, /values are partial/);
  assert.ok(!h.nodes.get('#reportCsat').innerHTML.includes('Private respondent'));
});
test('leaving Reporting prevents delayed feedback replacing the next screen', async () => {
  let finish; const pending = new Promise(resolve=>{finish=resolve;});
  const h = harness({ trainingSessions:()=>pending });
  const task = h.nodes.get('#reportLoadCsat').onclick();
  h.context.window.ReportingUI.deactivate(); h.nodes.get('#reportCsat').innerHTML = 'Next screen';
  finish([{id:'a',topic:'Phone Videography'}]); await task;
  assert.equal(h.nodes.get('#reportCsat').innerHTML, 'Next screen');
});
test('export actions generate downloadable CSVs and print includes every matching row', async () => {
  const h = harness();
  h.nodes.get('#reportExport').onclick(); h.nodes.get('#reportSummary').onclick();
  assert.deepEqual(h.downloads, ['booking-report.csv','reporting-summary.csv']);
  const bookingCsv = await h.blobs[0].text(), summaryCsv = await h.blobs[1].text();
  assert.ok(bookingCsv.includes('"a"')); assert.ok(bookingCsv.includes('"e"'));
  assert.ok(summaryCsv.includes('"Total bookings","5"'));
  h.nodes.get('#reportPrint').onclick();
  const printed = h.nodes.get('#reportRecords').children[0];
  assert.match(printed.innerHTML, /All 5 matching bookings/);
  assert.equal((printed.innerHTML.match(/<tr>/g) || []).length, 6);
  h.events.afterprint(); assert.equal(printed.removed, true);
});
test('reporting does not invoke mutation APIs and print contains all filtered records', () => {
  assert.doesNotMatch(source, /ctx\.S\.(update|remove|saveFacilitator|completeTraining|decideTraining|trainingSharing)\(/);
  assert.match(source, /report\.rows\.map\(row => `<tr>/);
  assert.match(source, /afterprint/);
  const css = fs.readFileSync(require.resolve('../../app/admin/reporting.css'), 'utf8');
  assert.match(css, /@media print/); assert.match(css, /@media \(max-width:650px\)/);
});
