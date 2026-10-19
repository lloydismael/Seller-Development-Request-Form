const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../../app/admin/admin.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../../app/admin/index.html'), 'utf8');
const css = fs.readFileSync(require.resolve('../../app/admin/admin.css'), 'utf8');

test('desktop menu stays hidden and account actions use equal responsive dimensions', () => {
  assert.match(css, /\.btn\.nav-toggle \{ display:none; \}/);
  assert.match(css, /@media \(max-width:900px\)[\s\S]*\.btn\.nav-toggle \{ display:inline-flex;/);
  assert.match(css, /\.user \.btn \{[^}]*width:100%;[^}]*min-height:44px; height:100%;/);
});

function navigation() {
  const ids = [...html.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
  function element(dataset = {}) {
    const attrs = {}, classes = new Set();
    return { dataset, attrs, hidden:true, focused:false,
      setAttribute:(key, value) => { attrs[key] = value; }, removeAttribute:key => { delete attrs[key]; },
      getAttribute:key => attrs[key], focus() { this.focused = true; },
      classList:{ contains:key => classes.has(key), remove:key => classes.delete(key),
        toggle(key, on) { if (on) classes.add(key); else classes.delete(key); } } };
  }
  const nodes = Object.fromEntries(['.topbar', '#navToggle', '#modal', '#view', '#pageTitle', '#pageDescription'].map(id => [id, element()]));
  nodes['#navToggle'].setAttribute('aria-expanded', 'false');
  const tabs = ids.map(tab => element({ tab }));
  const listeners = {};
  let allowed = true, leaveCalls = 0, renders = 0;
  const context = { document:{ querySelectorAll:() => tabs, addEventListener:(type, handler) => { listeners[type] = handler; } },
    $:selector => nodes[selector], st:{ tab:'dashboard' }, identity:{ role:'admin' }, FACS:[], mode:'local', S:{}, Q:{}, sourceConfig:{}, toast() {}, applyConfig() {}, accessibleActions() {},
    window:{ CsatUI:{ deactivate() {}, render() { renders++; } }, SettingsUI:{ canLeave:() => { leaveCalls++; return allowed; }, deactivate() {}, render() { renders++; } } },
    dashboard() { renders++; }, calendar() { renders++; }, availability() { renders++; }, bookingsView() { renders++; }, blocksView() { renders++; } };
  vm.createContext(context);
  const shell = source.slice(source.indexOf('  const pages ='), source.indexOf('  let user, identity;'));
  const click = source.slice(source.indexOf('  document.querySelectorAll(".tab").forEach(b => (b.onclick'), source.indexOf('  $(".user a").onclick'));
  const render = source.slice(source.indexOf('  function render() {'), source.indexOf('  // ---------- shared fragments'));
  vm.runInContext(shell + click + render, context);
  return { nodes, tabs, listeners, context, deny:() => { allowed = false; }, counts:() => ({ leaveCalls, renders }) };
}

test('admin loads one global shared theme control and preserves all nine destinations', () => {
  assert.equal((html.match(/id="themeToggle"/g) || []).length, 1);
  assert.ok(html.indexOf('id="themeToggle"') < html.indexOf('id="gate"'));
  assert.match(html, /role="switch" aria-checked="false" aria-label="Dark mode"/);
  for (const resource of ['/design-tokens.css', '/ui-controls.css', '/theme.js']) assert.ok(html.includes(resource));
  assert.ok(html.indexOf('/design-tokens.css') < html.indexOf('/admin/admin.css'));
  assert.match(html, /id="navToggle"[^>]*aria-expanded="false"[^>]*aria-controls="adminNav"/);
  assert.deepEqual(navigation().tabs.map(tab => tab.dataset.tab), ['dashboard', 'calendar', 'availability', 'bookings', 'blocks', 'csat', 'facilitators', 'profile', 'builder', 'activity', 'settings']);
});

test('mobile navigation expands, selects every destination and updates current location', () => {
  const n = navigation();
  for (const tab of n.tabs.slice(1)) {
    n.nodes['#navToggle'].onclick();
    assert.equal(n.nodes['#navToggle'].attrs['aria-expanded'], 'true');
    tab.onclick();
    assert.equal(n.context.st.tab, tab.dataset.tab);
    assert.equal(n.nodes['#navToggle'].attrs['aria-expanded'], 'false');
    assert.equal(tab.attrs['aria-current'], 'page');
    assert.equal(n.nodes['#view'].focused, true);
    assert.ok(n.nodes['#pageTitle'].textContent);
    assert.equal(n.tabs.filter(item => item.attrs['aria-current'] === 'page').length, 1);
  }
  assert.deepEqual(n.counts(), { leaveCalls:10, renders:10 });
});

test('facilitator navigation cannot render administrator destinations', () => {
  const n = navigation(); n.context.identity.role = 'facilitator'; n.context.st.tab = 'csat';
  for (const tab of n.tabs.filter(t => !['csat', 'profile'].includes(t.dataset.tab))) {
    tab.onclick(); assert.equal(n.context.st.tab, 'csat');
  }
  assert.match(source, /identity\?\.role === "facilitator"\) \{ render\(\); return; \}/);
});

test('dirty-state cancellation retains the active tab and expanded menu without rendering', () => {
  const n = navigation(); n.deny();
  n.nodes['#navToggle'].onclick(); n.tabs[6].onclick();
  assert.equal(n.context.st.tab, 'dashboard');
  assert.equal(n.nodes['#navToggle'].attrs['aria-expanded'], 'true');
  assert.deepEqual(n.counts(), { leaveCalls:1, renders:0 });
});

test('booking navigation clears draft colors only after the leave guard allows it', () => {
  const link = {};
  let allowed = false, clears = 0, prevented = 0;
  const context = { $:() => link, window:{ SettingsUI:{ canLeave:() => allowed, deactivate:() => { clears++; } } } };
  const handler = source.slice(source.indexOf('  $(".user a").onclick'), source.indexOf('  $("#view").addEventListener("click"'));
  vm.runInNewContext(handler, context);
  link.onclick({ preventDefault:() => { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(clears, 0);
  allowed = true;
  link.onclick({ preventDefault:() => { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(clears, 1);
});

test('Escape and same-tab selection close the non-modal menu and restore toggle focus', () => {
  const n = navigation();
  n.nodes['#navToggle'].onclick(); n.listeners.keydown({ key:'Escape' });
  assert.equal(n.nodes['#navToggle'].attrs['aria-expanded'], 'false');
  assert.equal(n.nodes['#navToggle'].focused, true);
  n.nodes['#navToggle'].onclick(); n.tabs[0].onclick();
  assert.equal(n.nodes['#navToggle'].attrs['aria-expanded'], 'false');
  assert.deepEqual(n.counts(), { leaveCalls:0, renders:0 });
});
