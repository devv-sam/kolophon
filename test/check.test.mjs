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
// Applied to pages as they are served, to change the app between snapshot and check.
let change;

const run = (args, env = {}) =>
  new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { cwd: dir, env: { ...process.env, ...env }, timeout: 60_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, stdout, stderr }),
    );
  });
const file = () => join(dir, "kolophon.json");
const snapshot = async (...pages) => {
  const res = await run(["snapshot", ...pages.map((p) => base + p)]);
  assert.equal(res.code, 0, res.stderr);
};

before(async () => {
  http = createServer(async (req, res) => {
    try {
      const body = await readFile(new URL(req.url.slice(1), fixtures));
      const changed = req.url.endsWith(".html") ? change(body.toString()) : body;
      if (changed === null) res.writeHead(500).end();
      else res.end(changed);
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
  change = (html) => html;
  dir = await mkdtemp(join(tmpdir(), "kolophon-"));
  const made = dir;
  t.after?.(() => rm(made, { recursive: true, force: true }));
});

test("an unchanged app passes and nothing is written", async () => {
  await snapshot("typography.html", "fonts.html", "forms.html", "fallback.html");
  const before = await readFile(file(), "utf8");
  const res = await run(["check"]);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /^No drift\.$/m);
  assert.equal(await readFile(file(), "utf8"), before);
  assert.deepEqual(await readdir(dir), ["kolophon.json"]);
});

test("one changed font size fails, naming the value and the selector", async () => {
  await snapshot("typography.html");
  change = (html) => html.replace("700 32px/40px", "700 31px/40px");
  const res = await run(["check"]);
  assert.equal(res.code, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /DRIFT .*31px\/40px/);
  assert.match(res.stdout, /page \/typography\.html \(desktop, mobile\)/);
  assert.match(res.stdout, /at {3}body > h1/);
  assert.match(res.stdout, /font-size: 31px should be 32px/);
  assert.match(res.stdout, /^1 finding\. Fix the app/m);
});

test("a font that stops loading fails", async () => {
  await snapshot("weights.html");
  change = (html) => html.replace("fonts/InterVariable.woff2", "fonts/gone.woff2");
  const res = await run(["check"]);
  assert.equal(res.code, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /Range didn't draw its text[\s\S]*at {3}#range\n {2}fix {2}A font file of Range failed to load/);
});

test("a weight the font no longer covers fails", async () => {
  await snapshot("weights.html");
  change = (html) => html.replace("font-weight: 100 900", "font-weight: 400");
  const res = await run(["check"]);
  assert.equal(res.code, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /No loaded face of Range covers weight 450/);
});

test("a mobile-only change names only the mobile viewport", async () => {
  await snapshot("responsive.html");
  change = (html) => html.replace("letter-spacing: 3px", "letter-spacing: 4px");
  const res = await run(["check"]);
  assert.equal(res.code, 1, res.stdout + res.stderr);
  assert.match(res.stdout, /page \/responsive\.html \(mobile\)/);
});

test("removed text is a note, not drift", async () => {
  await snapshot("typography.html");
  change = (html) => html.replace("<button>Action</button>", "");
  const res = await run(["check"]);
  assert.equal(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /Baseline style not seen/);
});

test("a page that can't be read isn't a pass, and doesn't hide drift elsewhere", async () => {
  await snapshot("typography.html", "responsive.html");
  change = (html) => (html.includes("Responsive") ? null : html);
  const incomplete = await run(["check"]);
  assert.equal(incomplete.code, 2, incomplete.stdout);
  assert.match(incomplete.stdout, /NOT CHECKED[\s\S]*answered 500[\s\S]*isn't a pass/);

  change = (html) => (html.includes("Responsive") ? null : html.replace("700 32px", "700 31px"));
  const drifted = await run(["check"]);
  assert.equal(drifted.code, 1, drifted.stdout);
  assert.match(drifted.stdout, /DRIFT[\s\S]*NOT CHECKED/);
});

test("a page that went blank isn't a pass", async () => {
  await snapshot("typography.html");
  change = () => "<!doctype html><title>Blank</title>";
  assert.equal((await run(["check"])).code, 2);
});

test("--base-url checks the same pages elsewhere", async () => {
  await snapshot("typography.html");
  const text = (await readFile(file(), "utf8")).replace(/"baseUrl": ".*"/, '"baseUrl": "http://127.0.0.1:9"');
  await writeFile(file(), text);
  assert.equal((await run(["check"])).code, 2);
  const res = await run(["check", "--base-url", base]);
  assert.equal(res.code, 0, res.stdout + res.stderr);
});

test("exits 2 when it can't check", async () => {
  const none = await run(["check"]);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /No kolophon\.json here.*snapshot/);

  await writeFile(file(), "{ nope");
  assert.match((await run(["check"])).stderr, /isn't valid JSON/);
  await rm(file());

  await snapshot("typography.html");
  for (const [args, message] of [
    [["check", "http://localhost/"], /takes no URLs/],
    [["check", "--update"], /--update is for snapshot/],
    [["check", "--base-url", `${base}app`], /origin only/],
    [["check", "--base-url", "file:///etc"], /isn't an http/],
  ]) {
    const res = await run(args);
    assert.equal(res.code, 2, args.join(" "));
    assert.match(res.stderr, message);
  }
  const noChrome = await run(["check"], { CHROME_PATH: "/nonexistent/chrome" });
  assert.equal(noChrome.code, 2);
  assert.match(noChrome.stdout, /CHROME_PATH/);
});
