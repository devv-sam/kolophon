import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { toView } from "../dist/baseline.js";
import { closeBrowser, withPage } from "../dist/browser.js";
import { report } from "../dist/check.js";
import { compare } from "../dist/compare.js";
import { getMotion } from "../dist/motion.js";

const text = { styles: [], families: [], unmeasured: [], hidden: 0 };
const transition = (over = {}) => ({ property: "opacity", duration: 150, easing: "ease", selector: "#a", ...over });
const animation = (over = {}) => ({
  name: "rise_x1", duration: 500, easing: "ease-out", iterations: "1", direction: "normal", keyframes: ["0% opacity 0;", "100% opacity 1;"], selector: "#b", ...over,
});
const set = (transitions = [], animations = []) => ({ transitions, animations });
const motion = (normal, reduced = set()) => ({ ...normal, reduced });
const diff = (from, to) => compare(toView(text, from), text, to);

let http, base;
const measure = (name) => withPage(base + name, getMotion);

before(async () => {
  http = createServer(async (req, res) => {
    try {
      res.end(await readFile(new URL(`./fixtures${req.url}`, import.meta.url)));
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

test("reads transitions from computed styles, without delays, in hidden elements too", async () => {
  const { transitions } = await measure("motion.html");
  assert.deepEqual(
    transitions.map((t) => [t.property, t.duration, t.easing, t.selector]),
    [
      ["opacity", 150, "ease-in", "#buttons > button:nth-of-type(1)"],
      ["transform", 300, "cubic-bezier(0.2, 0.8, 0.2, 1)", "#buttons > button:nth-of-type(1)"],
      ["opacity", 200, "ease", "#menu"],
      ["color", 200, "ease", "#still"],
    ],
  );
});

test("reads animations with the keyframes the browser resolved, even after they end", async () => {
  const { animations } = await measure("motion.html");
  assert.deepEqual(animations.map((a) => a.selector), ["#ended", "#lost"], "not on elements that aren't displayed");
  const [rise, lost] = animations;
  assert.deepEqual([rise.duration, rise.easing, rise.iterations, rise.direction], [10, "ease-out", "1", "normal"]);
  assert.deepEqual(rise.keyframes, ["0% opacity 0; transform matrix(1, 0, 0, 1, 0, 30);", "100% opacity 1; transform none;"]);
  assert.deepEqual(lost.keyframes, [], "there is no such @keyframes");
});

test("reads what still moves in reduced motion", async () => {
  const { reduced } = await measure("motion.html");
  assert.deepEqual(reduced.animations, []);
  assert.deepEqual(reduced.transitions.map((t) => t.selector), ["#still"]);
});

test("measuring motion twice gives the same result and leaves no probe", async () => {
  assert.deepEqual(await measure("motion.html"), await measure("motion.html"));
  const left = await withPage(`${base}motion.html`, async (page) => {
    await getMotion(page);
    return page.evaluate(() => document.body.children.length);
  });
  assert.equal(left, 6);
});

test("no drift when motion is the same, whatever it's called", () => {
  const m = motion(set([transition()], [animation()]), set([transition()]));
  assert.deepEqual(diff(m, m), { drift: [], notes: [], unmeasured: [] });
  assert.deepEqual(diff(motion(set([], [animation()])), motion(set([], [animation({ name: "rise_z9" })]))).drift, []);
});

test("a changed transition names the value, the selector and the baseline", () => {
  const { drift, notes } = diff(motion(set([transition()])), motion(set([transition({ duration: 400 })])));
  assert.equal(drift.length, 1);
  assert.equal(drift[0].found, "Not in the baseline: transition opacity 400ms ease");
  assert.deepEqual([drift[0].where, drift[0].hints], [["#a"], ["baseline for opacity: 150ms ease"]]);
  assert.deepEqual(notes, ["Baseline transition not seen: opacity 150ms ease"]);
});

test("changed keyframes and timing are drift", () => {
  const from = motion(set([], [animation()]));
  for (const over of [{ duration: 900 }, { easing: "linear" }, { iterations: "infinite" }, { direction: "reverse" }, { keyframes: ["0% opacity 0.5;", "100% opacity 1;"] }]) {
    assert.equal(diff(from, motion(set([], [animation(over)]))).drift.length, 1, JSON.stringify(over));
  }
  assert.match(diff(from, motion(set([], [animation({ duration: 900 })]))).drift[0].hints[0], /baseline for the same keyframes: 500ms ease-out/);
});

test("an animation that lost its keyframes says nothing moves", () => {
  const gone = motion(set([], [animation({ keyframes: [] })]));
  const { drift } = diff(motion(set([], [animation()])), gone);
  assert.equal(drift.length, 1);
  assert.match(drift[0].found, /has no @keyframes, so nothing moves/);
  assert.deepEqual(diff(gone, gone).drift, [], "unless the baseline records it");
});

test("motion that starts running in reduced motion is drift", () => {
  const all = set([transition()], [animation()]);
  const { drift } = diff(motion(all), motion(all, all));
  assert.equal(drift.length, 2);
  assert.match(drift[0].found, /Now moves even when the user asks for reduced motion: transition opacity/);
  const { text: out } = report([{ path: "/", viewport: "desktop", drift, notes: [], unmeasured: [] }]);
  assert.match(out, /^1 finding\./m);

  const added = set([transition({ duration: 999 })]);
  assert.equal(diff(motion(set()), motion(added, added)).drift.length, 1, "new motion is reported once");
});

test("one transition declaration is one finding", () => {
  const now = set([transition({ duration: 400 }), transition({ property: "transform", duration: 400 })]);
  const { drift } = diff(motion(set([transition(), transition({ property: "transform" })])), motion(now));
  assert.match(report([{ path: "/", viewport: "desktop", drift, notes: [], unmeasured: [] }]).text, /^1 finding\./m);
});

test("unread motion doesn't look like removed motion", () => {
  assert.deepEqual(compare(toView(text, motion(set([transition()]))), text, null), { drift: [], notes: [], unmeasured: [] });
});

test("the baseline keeps no names, selectors or delays", () => {
  const view = toView(text, motion(set([transition()], [animation(), animation({ name: "other" })])));
  assert.equal(view.motion.animations.length, 1);
  assert.doesNotMatch(JSON.stringify(view), /rise|other|#a|#b|delay/);
});
