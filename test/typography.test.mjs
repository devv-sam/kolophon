import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { closeBrowser, VIEWPORTS, withPage } from "../dist/browser.js";
import { getTypography } from "../dist/typography.js";

const fixtures = new URL("./fixtures/", import.meta.url);
let http, base;

const measure = (path, viewport) => withPage(base + path, getTypography, viewport);
const bySelector = (t, selector) => t.styles.find((s) => s.selector === selector);

before(async () => {
  http = createServer(async (req, res) => {
    if (req.url === "/error") return res.writeHead(500).end("<p>Something broke</p>");
    if (req.url === "/private") return res.writeHead(302, { location: "/basic.html" }).end();
    if (req.url === "/slash") return res.writeHead(302, { location: "/slash/?from=slash" }).end();
    if (req.url.startsWith("/slash/")) return res.end("<p>Same page</p>");
    try {
      res.end(await readFile(new URL(req.url.slice(1), fixtures)));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${http.address().port}/`;
});

after(() => {
  closeBrowser();
  http?.closeAllConnections();
  http?.close();
});

test("groups the rendered text styles", async () => {
  const { styles, families, unmeasured } = await measure("typography.html");
  assert.deepEqual(unmeasured, []);
  assert.equal(styles.length, 3, "hidden span must not add a style");

  const [body, ...rest] = styles;
  assert.deepEqual([body.size, body.weight, body.lineHeight, body.elements], ["16px", "400", "24px", 2]);
  assert.deepEqual(body.tags, ["p"]);
  assert.ok(rest.every((s) => s.chars < body.chars), "ranked by visible text");

  const heading = styles.find((s) => s.tags.includes("h1"));
  assert.deepEqual([heading.size, heading.weight, heading.selector], ["32px", "700", "body > h1"]);
  assert.equal(styles.find((s) => s.tags.includes("button")).letterSpacing, "0.5px");
  assert.deepEqual(families.map((f) => f.name).sort(), ["Arial", "Georgia"]);
});

test("reports which fonts actually rendered", async () => {
  const { families, styles } = await measure("fonts.html");
  const byName = Object.fromEntries(families.map((f) => [f.name, f]));
  const style = (name) => styles.find((s) => s.family === byName[name].stack);

  assert.equal(byName["Fixture Sans"].webFont, true);
  assert.deepEqual(byName["Fixture Sans"].faces.map((f) => f.status), ["loaded"]);
  assert.equal(style("Fixture Sans").fallbackGlyphs, 0);

  assert.deepEqual(byName["Broken Font"].faces.map((f) => f.status), ["error"]);
  assert.ok(style("Broken Font").fallbackGlyphs > 0);

  assert.equal(byName["Definitely Not Installed"].webFont, false);
  assert.ok(style("Definitely Not Installed").fallbackGlyphs > 0);
  assert.equal(style("serif").fallbackGlyphs, 0);
  assert.ok(style("serif").rendered.length > 0);
});

test("reports variable font axes", async () => {
  const { families, styles } = await measure("fonts.html");
  const byName = Object.fromEntries(families.map((f) => [f.name, f]));
  const variable = byName["Fixture Variable"];
  assert.deepEqual(variable.axes.find((a) => a.tag === "wght"), { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 });
  assert.match(styles.find((s) => s.family.includes("Fixture Variable")).variationSettings, /"wght" 650/);
  assert.equal(byName["Fixture Sans"].variable, false);
});

test("finds a style that falls back while its family loads elsewhere", async () => {
  const t = await measure("fallback.html");
  assert.equal(bySelector(t, "#regular").fallbackGlyphs, 0);
  const bold = bySelector(t, "#bold");
  assert.ok(t.families.find((f) => f.name === "Half Loaded").faces.some((f) => f.weight === "700" && f.status === "error"));
  assert.ok(bold.fallbackGlyphs > 0, JSON.stringify(bold));
});

test("a second web font in the stack doesn't hide a failed first one", async () => {
  const second = bySelector(await measure("fallback.html"), "#second");
  assert.ok(second.rendered.every((f) => f.custom));
  assert.ok(second.fallbackGlyphs > 0, JSON.stringify(second));
});

test("judges a style by its own text, not its children's", async () => {
  const parent = bySelector(await measure("fallback.html"), "#parent");
  assert.equal(parent.fallbackGlyphs, 0, JSON.stringify(parent));
});

test("counts fallback glyphs in any element of a style, not just the first", async () => {
  const late = bySelector(await measure("fallback.html"), "#late");
  assert.equal(late.elements, 2);
  assert.equal(late.fallbackGlyphs, 2, JSON.stringify(late));
});

test("measures at the fixed viewport and locates each style", async () => {
  const { styles } = await measure("responsive.html");
  assert.equal(parseFloat(styles[0].size), VIEWPORTS.desktop.width * 0.02);
  assert.equal(styles[0].selector, "body > main > p:nth-of-type(1)");
});

test("measures at the mobile viewport when asked", async () => {
  const [desktop] = (await measure("responsive.html")).styles;
  const [mobile] = (await measure("responsive.html", VIEWPORTS.mobile)).styles;
  assert.equal(parseFloat(mobile.size), VIEWPORTS.mobile.width * 0.02);
  assert.deepEqual([desktop.letterSpacing, mobile.letterSpacing], ["normal", "3px"]);
  assert.deepEqual([desktop.weight, mobile.weight], ["400", "700"], "mobile has no hover");
});

test("doesn't depend on the machine's mouse or display settings", async () => {
  const media = (viewport) =>
    withPage(
      `${base}basic.html`,
      (page) => page.evaluate(() => ["(hover: hover)", "(pointer: fine)", "(prefers-color-scheme: light)", "(prefers-reduced-motion: no-preference)"].map((q) => matchMedia(q).matches)),
      viewport,
    );
  assert.deepEqual(await media(VIEWPORTS.desktop), [true, true, true, true]);
  assert.deepEqual(await media(VIEWPORTS.mobile), [false, false, true, true]);
});

test("measures the text in form fields", async () => {
  const t = await measure("forms.html");
  assert.deepEqual(t.unmeasured, []);
  const got = Object.fromEntries(t.styles.map((s) => [s.selector, s]));
  assert.deepEqual(Object.keys(got).sort(), ["#area", "#broken", "#date", "#empty::placeholder", "#select", "#send", "#value"]);
  assert.deepEqual([got["#empty::placeholder"].size, got["#empty::placeholder"].weight], ["13px", "700"]);
  for (const id of ["#area", "#date", "#empty::placeholder", "#select", "#send", "#value"]) {
    assert.ok(got[id].rendered.length, `${id} has rendered fonts`);
    assert.equal(got[id].fallbackGlyphs, 0, `${id} ${JSON.stringify(got[id].rendered)}`);
  }
  assert.ok(got["#broken"].fallbackGlyphs > 0);
});

test("keeps no typed value, and reads no password", async () => {
  assert.doesNotMatch(JSON.stringify(await measure("forms.html")), /private@example|secret|Default text/);
});

test("finds weights no loaded face covers", async () => {
  const t = await measure("weights.html");
  const covered = Object.fromEntries(t.styles.map((s) => [s.selector, s.weightCovered]));
  assert.deepEqual(covered, {
    "#regular": true, "#faked": false, "#range": true, "#lost": false,
    "#bold": true, "#italic": true, "#system": null, "#broken": null,
  });
});

test("emoji don't count as fallback", async (t) => {
  const [s] = (await measure("emoji.html")).styles;
  if (!s.rendered.some((f) => /emoji/i.test(f.name))) return t.skip("no emoji font on this machine");
  assert.equal(s.fallbackGlyphs, 0, JSON.stringify(s.rendered));
});

test("measuring twice gives the same result", async () => {
  assert.deepEqual(await measure("fallback.html"), await measure("fallback.html"));
});

test("refuses an error page", async () => {
  await assert.rejects(measure("error"), /answered 500/);
  await assert.rejects(measure("nope.html"), /answered 404/);
});

test("refuses a redirect to another page", async () => {
  await assert.rejects(measure("private"), /redirected to .*basic\.html/);
  await assert.rejects(measure("client-redirect.html"), /redirected to .*basic\.html/);
});

test("allows a redirect that only changes the trailing slash or query", async () => {
  assert.equal((await measure("slash")).styles.length, 1);
});

test("refuses non-http URLs", async () => {
  await assert.rejects(withPage("file:///etc/passwd", getTypography), /Only http and https/);
});

test("explains a missing Chrome", async () => {
  closeBrowser();
  const { CHROME_PATH } = process.env;
  process.env.CHROME_PATH = "/nonexistent/chrome";
  try {
    await assert.rejects(measure("basic.html"), /could not find Chrome/);
  } finally {
    if (CHROME_PATH === undefined) delete process.env.CHROME_PATH;
    else process.env.CHROME_PATH = CHROME_PATH;
  }
  assert.equal((await measure("basic.html")).styles.length, 2, "recovers once Chrome is found");
});
