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
  assert.match(styles, /#questions \.q-card\.is-active \{ scale:1\.035/);
  assert.match(styles, /@media \(max-width:640px\) \{ #questions \.q-card\.is-active \{ scale:1\.02/);
  assert.match(styles, /transition:scale \.36s[^;]*filter \.25s ease/);
  assert.match(styles, /:not\(:focus-within\):not\(:hover\):not\(\.invalid\)[^}]*filter:blur\(\.7px\)/);
  assert.match(styles, /prefers-reduced-motion:reduce[\s\S]*#questions:has\(\.is-active\) \.q-card \{ filter:none; \}/);
  assert.match(styles, /prefers-reduced-motion:reduce[\s\S]*#questions \.q-card\.is-active \{ scale:1; \}/);
  assert.doesNotMatch(styles, /opacity:\.65/);
});

test("question styling uses consistent readable typography and input spacing", () => {
  assert.match(styles, /\.hint \{ margin:0 0 12px 42px; line-height:1\.6; \}/);
  assert.match(styles, /\.text-in \{ font-size:16px; padding:12px 14px; \}/);
  assert.match(styles, /textarea\.text-in \{ min-height:112px; \}/);
  assert.match(styles, /:root\[data-density="compact"\] \.tile \{ min-height:64px; \}/);
  assert.match(styles, /\.q-title \{ font-size:17px; \}/);
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
