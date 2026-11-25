import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = new URL("./fixtures/", import.meta.url);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
let http, base, dir;

const run = (args, env = {}) =>
  new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, ...env }, timeout: 60_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
const read = () => readFile(join(dir, "kolophon.json"), "utf8");

before(async () => {
  http = createServer(async (req, res) => {
    if (req.url === "/empty") return res.end("<!doctype html><title>Empty</title>");
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
  http?.closeAllConnections();
  http?.close();
});

beforeEach(async (t) => {
  dir = await mkdtemp(join(tmpdir(), "kolophon-"));
  const made = dir;
  t.after?.(() => rm(made, { recursive: true, force: true }));
});

test("writes a baseline for every page and viewport, the same way twice", async () => {
  const urls = [`${base}typography.html`, `${base}responsive.html`];
  const first = await run(["snapshot", ...urls]);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /Wrote kolophon\.json/);
  assert.match(first.stdout, /a person reviews kolophon\.json/);
  const text = await read();

  const baseline = JSON.parse(text);
  assert.equal(baseline.version, 2);
  assert.equal(baseline.baseUrl + "/", base);
  assert.deepEqual(Object.keys(baseline.viewports), ["desktop", "mobile"]);
  assert.deepEqual(Object.keys(baseline.pages), ["/responsive.html", "/typography.html"]);
  const size = (view) => baseline.pages["/responsive.html"][view].styles[0].size;
  assert.deepEqual([size("desktop"), size("mobile")], ["25.6px", "7.8px"]);

  assert.equal((await run(["snapshot", ...urls, "--update"])).code, 0);
  assert.equal(await read(), text);
  assert.deepEqual(await readdir(dir), ["kolophon.json"], "leaves no temp file");
});

test("doesn't replace a baseline without --update", async () => {
  await writeFile(join(dir, "kolophon.json"), "mine");
  const res = await run(["snapshot", `${base}typography.html`]);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /already exists.*--update/s);
  assert.equal(await read(), "mine");
});

test("--update replaces it and says which pages are gone", async () => {
  await writeFile(join(dir, "kolophon.json"), JSON.stringify({ pages: { "/old": {}, "/typography.html": {} } }));
  const res = await run(["snapshot", `${base}typography.html`, "--update"]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /Replaced kolophon\.json[\s\S]*No longer in the baseline:\n {2}\/old\n/);
});

test("a failed page writes nothing and keeps the old baseline", async () => {
  const bad = [`${base}typography.html`, `${base}nope.html`];
  const fresh = await run(["snapshot", ...bad]);
  assert.equal(fresh.code, 2);
  assert.match(fresh.stderr, /nope\.html answered 404/);
  assert.deepEqual(await readdir(dir), []);

  await writeFile(join(dir, "kolophon.json"), "mine");
  assert.equal((await run(["snapshot", ...bad, "--update"])).code, 2);
  assert.equal(await read(), "mine");
});

test("refuses a page with no text", async () => {
  const res = await run(["snapshot", `${base}empty`]);
  assert.equal(res.code, 2);
  assert.match(res.stderr, /shows no text/);
  assert.deepEqual(await readdir(dir), []);
});

test("points out font problems the baseline would accept", async () => {
  const res = await run(["snapshot", `${base}weights.html`]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /Look at these before committing/);
  assert.match(res.stdout, /\(mobile\): no loaded font face covers the weight: .*at #faked/);
  assert.match(res.stdout, /glyphs fell back .*at #broken/);
  assert.match(res.stdout, /font face failed to load: Broken Font/);
});

test("points out motion problems the baseline would accept", async () => {
  const res = await run(["snapshot", `${base}motion.html`]);
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /\(desktop\): .*4 transitions, 2 animations/);
  assert.match(res.stdout, /animation missing has no @keyframes, so nothing moves: at #lost/);
  assert.match(res.stdout, /1 of 6 transitions and animations still run when the user asks for reduced motion/);
});

test("exits 2 when it can't run", async () => {
  for (const [args, message] of [
    [[], /No command given/],
    [["snapshot"], /needs at least one URL/],
    [["frobnicate"], /Unknown command/],
    [["snapshot", "--nope"], /nope/],
    [["snapshot", "file:///etc/passwd"], /isn't an http/],
  ]) {
    const res = await run(args);
    assert.equal(res.code, 2, args.join(" "));
    assert.match(res.stderr, message);
  }
  const noChrome = await run(["snapshot", `${base}typography.html`], { CHROME_PATH: "/nonexistent/chrome" });
  assert.equal(noChrome.code, 2);
  assert.match(noChrome.stderr, /CHROME_PATH/);
  assert.equal((await run(["--help"])).code, 0);
});
