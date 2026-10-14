const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const tokens = fs.readFileSync(require.resolve("../../app/design-tokens.css"), "utf8");
const styles = fs.readFileSync(require.resolve("../../app/styles.css"), "utf8");
const html = fs.readFileSync(require.resolve("../../app/index.html"), "utf8");
const schema = require("../../app/form-schema");
const defaults = require("../../app/form-config");
function luminance(hex) {
  const c = hex.match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}

test("shared light and dark semantic text colors meet contrast targets", () => {
  for (const block of tokens.split(":root[data-color-mode")) {
    const values = Object.fromEntries([...block.matchAll(/--ui-([a-z-]+):#([0-9a-f]{6});/g)].map(m => [m[1], m[2]]));
    for (const [foreground, background] of [["text", "surface"], ["muted", "surface"], ["muted", "raised"], ["primary-ink", "primary"], ["success", "success-bg"], ["warning", "warning-bg"], ["danger", "danger-bg"], ["info", "info-bg"]]) {
      const a = luminance(values[foreground]), b = luminance(values[background]);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${foreground}/${background}`);
    }
  }
});

test("public redesign keeps hidden legends and accessible progress while preserving motion preferences", () => {
  assert.match(html, /id="progressText" hidden/);
  assert.doesNotMatch(html, /class="required-note"/);
  assert.match(html, /aria-describedby="progressText"/);
  assert.ok(html.indexOf("/design-tokens.css") < html.indexOf("/styles.css"));
  assert.match(styles, /#questions \.q-card\.is-active \{ scale:1\.06/);
  assert.match(styles, /@media \(min-width:641px\) \{ \.wrap \{ padding-left:40px; padding-right:40px; \}/);
  assert.match(styles, /@media \(max-width:640px\) \{\s*\.wrap \{ padding-left:20px; padding-right:20px; \}\s*#questions \.q-card\.is-active \{ scale:1\.03/);
  assert.match(styles, /transform-origin:center; transition:scale \.36s cubic-bezier\(\.22,1,\.36,1\)/);
  assert.match(styles, /transition:scale \.36s[^;]*filter \.25s ease/);
  assert.match(styles, /:not\(:focus-within\):not\(:hover\):not\(\.invalid\)[^}]*filter:blur\(\.7px\)/);
  assert.match(styles, /prefers-reduced-motion:reduce[\s\S]*#questions:has\(\.is-active\) \.q-card \{ filter:none; \}/);
  assert.match(styles, /prefers-reduced-motion:reduce[\s\S]*#questions \.q-card\.is-active \{ scale:1; \}/);
  assert.doesNotMatch(styles, /opacity:\.65/);
});

test("My Request is the rightmost header action and opens the history dialog", () => {
  const actions = html.match(/<div class="hero-actions">([\s\S]*?)<\/div>/)[1];
  assert.equal((actions.match(/id="historyBtn"/g) || []).length, 1);
  assert.match(actions, /<button class="btn" id="historyBtn" type="button" aria-haspopup="dialog" aria-controls="requestHistory">My Request<\/button>\s*$/);
  assert.ok(actions.indexOf('class="admin-btn"') < actions.indexOf('id="themeToggle"'));
  assert.ok(actions.indexOf('id="themeToggle"') < actions.indexOf('id="historyBtn"'));
  assert.match(styles, /\.hero-actions \{ position:absolute; top:16px; right:20px; display:flex;/);
  assert.match(styles, /\.hero-actions \{ left:12px; justify-content:flex-end; flex-wrap:wrap; \}/);
});

test("initial name section is centered in the available viewport without a blank submit bar", () => {
  assert.match(styles, /body\.form-start \{[^}]*min-height:100dvh;[^}]*display:flex;[^}]*flex-direction:column;/);
  assert.match(styles, /\.form-start \.wrap \{[^}]*flex:1;[^}]*width:100%;[^}]*justify-content:center;/);
  assert.match(styles, /\.form-start \.submit-bar:has\(#submitBtn\[hidden\]\) \{ display:none; \}/);
});

test("question styling uses consistent readable typography and input spacing", () => {
  assert.match(styles, /\.hint \{ margin:0 0 12px 42px; line-height:1\.6; \}/);
  assert.match(styles, /\.text-in \{ font-size:16px; padding:12px 14px; \}/);
  assert.match(styles, /textarea\.text-in \{ min-height:112px; \}/);
  assert.match(styles, /:root\[data-density="compact"\] \.tile \{ min-height:64px; \}/);
  assert.match(styles, /\.q-title \{ font-size:17px; \}/);
});

test("option tiles share equal columns and content-safe equal row heights", () => {
  assert.match(styles, /\.tiles,\.tiles\.sm,\.tiles\.md,\.tiles\.wide,\.tiles\.people \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);[^}]*grid-auto-rows:1fr;[^}]*align-items:stretch;/);
  assert.match(styles, /\.tiles > \.tile \{ width:100%; height:100%; \}/);
  assert.match(styles, /\.t-label,\.t-sub \{ overflow-wrap:anywhere; \}/);
  assert.match(styles, /@media \(max-width:640px\)[\s\S]*\.tiles,\.tiles\.sm,\.tiles\.md,\.tiles\.wide,\.tiles\.people \{ grid-template-columns:minmax\(0,1fr\); \}/);
  assert.doesNotMatch(styles, /\.tiles[^}]*grid-template-columns:repeat\(auto-fill/);
});

test("venue tiles use a compact layout with viewport-bounded scrolling", () => {
  assert.match(styles, /\.q-card\[data-id="venue"\] \.tiles \{[^}]*gap:8px;[^}]*max-height:max\(160px,calc\(94dvh - 180px\)\);[^}]*overflow-y:auto;[^}]*padding:4px;/);
  assert.match(styles, /\.q-card\[data-id="venue"\] \.tile \{ min-height:64px; padding:8px 36px 8px 10px; gap:8px; \}/);
  assert.match(styles, /\.q-card\[data-id="venue"\] \.t-icon \{ width:28px; height:28px;/);
  assert.match(styles, /\.q-card\[data-id="venue"\] \.tile\.other \.t-body \{ flex-direction:row; align-items:center;/);
  assert.match(styles, /\.q-card\[data-id="venue"\] \.other-in \{ min-width:0; min-height:40px;/);
});

test("new default palette never replaces an explicit saved form theme", () => {
  const source = schema.validate(defaults);
  source.theme.primary = "#123456";
  source.theme.background = "#eeeeee";
  const saved = schema.validate(source);
  assert.equal(saved.theme.primary, "#123456");
  assert.equal(saved.theme.background, "#eeeeee");
  const bootstrap = { ...defaults };
  delete bootstrap.theme;
  assert.equal(schema.validate(bootstrap).theme.primary, "#0f766e");
});
