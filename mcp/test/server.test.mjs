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
  assert.equal(JSON.parse(res.content[0].text).title, "Kolophon fixture");
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
