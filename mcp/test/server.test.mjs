import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const fixtures = new URL("./fixtures/", import.meta.url);
const serverEntry = new URL("../dist/index.js", import.meta.url).pathname;

let http, base, client;

async function connect(env) {
  const c = new Client({ name: "kolophon-test", version: "0" });
  await c.connect(
    new StdioClientTransport({ command: process.execPath, args: [serverEntry], env: { ...process.env, ...env } }),
  );
  return c;
}

const typography = (c, url) => c.callTool({ name: "get_typography", arguments: { url } });
// The raw extraction is the last content item, after DESIGN.md, tokens.json and the Tailwind block.
const raw = (res) => JSON.parse(res.content.at(-1).text);

before(async () => {
  http = createServer(async (req, res) => {
    try {
      res.end(await readFile(new URL(req.url.slice(1), fixtures)));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${http.address().port}/`;
  client = await connect();
});

after(async () => {
  await client?.close();
  http?.close();
});

test("lists get_typography", async () => {
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "get_typography"));
});

test("reads a page served locally", async () => {
  const res = await typography(client, `${base}basic.html`);
  assert.ok(!res.isError, res.content[0].text);
  assert.equal(raw(res).title, "Kolophon fixture");
});

test("groups the rendered text styles", async () => {
  const res = await typography(client, `${base}typography.html`);
  assert.ok(!res.isError, res.content[0].text);
  const { styles, families } = raw(res);

  assert.equal(styles.length, 3, "hidden span must not add a style");
  assert.ok(!styles.some((s) => s.size === "50px"));

  const [body, ...rest] = styles;
  assert.deepEqual([body.size, body.weight, body.lineHeight, body.elements], ["16px", "400", "24px", 2]);
  assert.deepEqual(body.tags, ["p"]);
  assert.ok(rest.every((s) => s.chars < body.chars), "ranked by visible text");

  const heading = styles.find((s) => s.tags.includes("h1"));
  assert.deepEqual([heading.size, heading.weight], ["32px", "700"]);
  assert.equal(styles.find((s) => s.tags.includes("button")).letterSpacing, "0.5px");

  assert.deepEqual(families.map((f) => f.name).sort(), ["Arial", "Georgia"]);
});

test("reports which fonts actually rendered", async () => {
  const res = await typography(client, `${base}fonts.html`);
  assert.ok(!res.isError, res.content[0].text);
  const families = Object.fromEntries(raw(res).families.map((f) => [f.name, f]));

  const web = families["Fixture Sans"];
  assert.equal(web.webFont, true);
  assert.deepEqual(web.faces.map((f) => f.status), ["loaded"]);
  assert.equal(web.fallback, false);
  assert.ok(web.rendered.some((f) => f.custom));

  const broken = families["Broken Font"];
  assert.equal(broken.webFont, true);
  assert.deepEqual(broken.faces.map((f) => f.status), ["error"]);
  assert.equal(broken.fallback, true);
  assert.ok(broken.rendered.length > 0 && broken.rendered.every((f) => !f.custom));

  const local = families["Definitely Not Installed"];
  assert.equal(local.webFont, false);
  assert.equal(local.fallback, true);

  assert.equal(families.serif.fallback, false);
  assert.ok(families.serif.rendered.length > 0);
});

test("reports variable font axes", async () => {
  const res = await typography(client, `${base}fonts.html`);
  assert.ok(!res.isError, res.content[0].text);
  const { families, styles } = raw(res);
  const byName = Object.fromEntries(families.map((f) => [f.name, f]));

  const variable = byName["Fixture Variable"];
  assert.equal(variable.variable, true, JSON.stringify(variable));
  assert.deepEqual(variable.axes.find((a) => a.tag === "wght"), { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 });
  assert.match(styles.find((s) => s.family.includes("Fixture Variable")).variationSettings, /"wght" 650/);

  assert.equal(byName["Fixture Sans"].variable, false);
  assert.deepEqual(byName["Fixture Sans"].axes, []);
});

test("returns DESIGN.md, tokens and Tailwind", async () => {
  const res = await typography(client, `${base}typography.html`);
  assert.ok(!res.isError, res.content[0].text);
  const [designMd, tokens, tailwind] = res.content.map((c) => c.text);

  assert.match(designMd, /^# Typography — Typography fixture/);
  // CI's Linux has no Arial and renders Liberation Sans, so it's "local" or "local, **not installed**".
  assert.match(designMd, /\| Arial \| \d+% \| local[ ,]/);
  assert.match(designMd, /## Agent guidance\n\n- Primary font is \*\*Arial\*\*/);

  const { font, typography: styles } = JSON.parse(tokens);
  assert.deepEqual(font.family.georgia, { $type: "fontFamily", $value: ["Georgia", "serif"] });
  assert.deepEqual(styles["16-400"].$value, {
    fontFamily: "{font.family.arial}",
    fontSize: { value: 16, unit: "px" },
    fontWeight: 400,
    letterSpacing: { value: 0, unit: "px" },
    lineHeight: 1.5,
  });

  assert.match(tailwind, /^@theme \{\n {2}--font-arial: Arial, sans-serif;/);
  assert.match(tailwind, /--text-14-500--letter-spacing: 0\.5px;/);
});

test("rejects non-http URLs", async () => {
  const res = await typography(client, "file:///etc/passwd");
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Only http and https/);
});

test("explains a missing Chrome", async () => {
  const noChrome = await connect({ CHROME_PATH: "/nonexistent/chrome" });
  try {
    const res = await typography(noChrome, `${base}basic.html`);
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /could not find Chrome/);
  } finally {
    await noChrome.close();
  }
});
