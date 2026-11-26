import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBaseline, serialize, toView as toFullView } from "../dist/baseline.js";
import { report } from "../dist/check.js";
import { compare as compareAll } from "../dist/compare.js";

const still = { transitions: [], animations: [] };
const noMotion = { ...still, reduced: still };
const compare = (b, t) => compareAll(b, t, noMotion);
const toView = (t) => toFullView(t, noMotion);

const style = (over = {}) => ({
  family: "Inter, sans-serif", weight: "400", size: "16px", lineHeight: "24px", letterSpacing: "normal", style: "normal",
  variationSettings: "normal", elements: 1, chars: 9, tags: ["p"], sample: "x", selector: "#body",
  rendered: [{ name: "Inter", custom: true, glyphs: 10 }], fallbackGlyphs: 0, weightCovered: true, ...over,
});
const axes = [{ tag: "wght", name: "Weight", min: 100, default: 400, max: 900 }];
const family = (over = {}) => ({
  name: "Inter", stack: "Inter, sans-serif", chars: 1, webFont: true, faces: [{ weight: "400", style: "normal", status: "loaded" }], variable: true, axes, ...over,
});
const page = (styles = [style()], families = [family()], unmeasured = []) => ({ styles, families, unmeasured, hidden: 0 });
const heading = style({ size: "28px", lineHeight: "36px", weight: "600", selector: "h2" });
const base = toView(page([style(), heading]));

test("no drift when nothing changed", () => {
  assert.deepEqual(compare(base, page([style(), heading])), { drift: [], notes: [], unmeasured: [] });
});

test("a new style names the value, the selector and the nearest baseline value", () => {
  const { drift } = compare(base, page([style({ size: "15px", selector: "#small" }), heading]));
  assert.equal(drift.length, 1);
  assert.match(drift[0].found, /Inter, sans-serif, 15px\/24px, weight 400/);
  assert.deepEqual(drift[0].where, ["#small"]);
  assert.match(drift[0].hints[0], /font-size: 15px should be 16px$/);
});

test("offers a style the page lost when the nearest one is still in use", () => {
  const label = style({ size: "13px", lineHeight: "16px", weight: "600", letterSpacing: "0.52px", selector: "label" });
  const lost = compare(toView(page([style(), label])), page([style(), style({ family: "Arial", size: "13.3333px", lineHeight: "normal", selector: "input" })]));
  assert.match(lost.drift[0].hints.join("\n"), /nearest is Inter, sans-serif, 16px.*\nor it was one no longer seen: Inter, sans-serif, 13px\/16px/);
});

test("a style no longer seen is a note", () => {
  const { drift, notes } = compare(base, page([style()]));
  assert.deepEqual(drift, []);
  assert.deepEqual(notes, ["Baseline style not seen: Inter, sans-serif, 28px/36px, weight 600"]);
});

test("layout noise isn't drift", () => {
  assert.deepEqual(compare(base, page([style({ size: "15.9999px" }), heading])).drift, []);
});

test("a recorded font problem passes until it gets worse", () => {
  const at = (fallbackGlyphs) => page([style({ fallbackGlyphs, rendered: [{ name: "Menlo", custom: false, glyphs: 10 }] })]);
  const drifts = (from, to) => compare(toView(at(from)), at(to)).drift.length;
  assert.deepEqual([drifts(0, 0), drifts(4, 4), drifts(10, 10), drifts(10, 0), drifts(10, 4)], [0, 0, 0, 0, 0]);
  assert.deepEqual([drifts(0, 4), drifts(0, 10), drifts(4, 10)], [1, 1, 1]);

  const covered = (weightCovered) => page([style({ weightCovered })]);
  assert.equal(compare(toView(covered(false)), covered(false)).drift.length, 0);
  assert.equal(compare(toView(covered(true)), covered(false)).drift.length, 1);
});

test("a new style doesn't report its font's recorded problem again", () => {
  const liberation = { rendered: [{ name: "Liberation Sans", custom: false, glyphs: 10 }], weightCovered: false };
  const at = (size, fallbackGlyphs) => page([style({ ...liberation, size, fallbackGlyphs })]);
  const found = (from, to) => compare(toView(at("16px", from)), at("15px", to)).drift.length;
  assert.equal(found(10, 10), 1, "only the new size");
  assert.equal(found(4, 10), 2, "worse than recorded");
});

test("a font that fell back is one finding for all its styles, saying why", () => {
  const menlo = { fallbackGlyphs: 10, rendered: [{ name: "Menlo", custom: false, glyphs: 10 }], weightCovered: null };
  const faces = (status) => [family({ faces: [{ weight: "400", style: "normal", status }], axes: [] })];
  const now = [style(menlo), { ...heading, ...menlo }];
  const { drift } = compare(base, page(now, faces("error")));
  assert.equal(drift.length, 1, JSON.stringify(drift));
  assert.deepEqual(drift[0].where, ["#body", "h2"]);
  assert.equal(drift[0].found, "Inter didn't draw its text");
  assert.deepEqual(drift[0].hints, ["drawn with Menlo"]);
  assert.match(drift[0].fix, /failed to load/);
  assert.match(compare(base, page(now, [family({ faces: [], webFont: false, axes: [] })])).drift[0].fix, /no @font-face/);
});

test("finds changed axes and a web font replaced by an installed one", () => {
  const drift = (over) => compare(base, page([style(), heading], [family(over)])).drift.map((d) => d.found);
  assert.match(drift({ axes: [] })[0], /Variable axes of Inter changed: none/);
  assert.match(drift({ webFont: false, faces: [], axes: [] })[0], /no longer a web font/);
});

test("an unreadable font file matters only if the baseline could read it", () => {
  const unreadable = page([style(), heading], [family({ axes: null })]);
  assert.equal(compare(base, unreadable).unmeasured.length, 1);
  assert.deepEqual(compare(toView(unreadable), unreadable), { drift: [], notes: [], unmeasured: [] });
});

test("exit codes: drift beats incomplete, and incomplete is never a pass", () => {
  const result = (over) => ({ path: "/", viewport: "desktop", drift: [], notes: [], unmeasured: [], ...over });
  const drift = [{ cause: "c", found: "x", where: ["#a"], fix: "y", hints: [] }];
  assert.equal(report([result()]).code, 0);
  assert.equal(report([result({ notes: ["n"] })]).code, 0);
  assert.equal(report([result(), result({ unmeasured: ["u"] })]).code, 2);
  assert.doesNotMatch(report([result({ unmeasured: ["u"] })]).text, /^No drift\.$/m);
  assert.equal(report([result({ drift }), result({ unmeasured: ["u"] })]).code, 1);
});

test("says when an installed copy hides a failed web font", () => {
  const local = { fallbackGlyphs: 10, rendered: [{ name: "Inter Medium", custom: false, glyphs: 10 }], weightCovered: null };
  const { drift } = compare(base, page([style(local)], [family({ faces: [{ weight: "400", style: "normal", status: "error" }], axes: [] })]));
  assert.match(drift[0].found, /The web font Inter didn't draw its text; a copy installed on this machine did/);
});

test("one wrong declaration is one finding, whatever styles it touches", () => {
  const spaced = (s) => ({ ...s, letterSpacing: "0.3px" });
  const result = (path, styles) => ({ path, viewport: "desktop", ...compare(base, page(styles)) });
  const { text } = report([result("/", [spaced(style()), spaced(heading)]), result("/b", [spaced(style())])]);
  assert.match(text, /^1 finding\./m, text);
  assert.match(text, /DRIFT {2}Text style not in the baseline: .*16px[^\n]*\n {2}also Text style not in the baseline: .*28px/);
  assert.match(text, /at {3}\/ \(desktop\): #body\n {2}at {3}\/ \(desktop\): h2\n {2}at {3}\/b \(desktop\): #body/);

  const resized = [style({ size: "15.5px", lineHeight: "23.25px" }), style({ size: "15.5px", lineHeight: "22.48px" })];
  assert.match(report([result("/", resized)]).text, /^1 finding\./m, "the line height only follows the size");
  const unrelated = [style({ size: "15px" }), style({ weight: "300" })];
  assert.match(report([result("/", unrelated)]).text, /^2 findings\./m, "different causes stay apart");
});

test("text hidden at load is a note", () => {
  const { drift, notes } = compare(base, { ...page([style(), heading]), hidden: 3 });
  assert.deepEqual([drift, notes], [[], ["Hidden at load, so not measured: 3 pieces of text"]]);
});

test("the report merges viewports and limits lists", () => {
  const drift = [{ cause: "c", found: "Odd size", where: ["#1", "#2", "#3", "#4", "#5", "#6", "#7"], fix: "Use 16px", hints: ["guess"] }];
  const { text } = report(["desktop", "mobile"].map((viewport) => ({ path: "/", viewport, drift, notes: [], unmeasured: [] })));
  assert.equal(
    text,
    "DRIFT  Odd size\n" +
      [1, 2, 3, 4, 5].map((n) => `  at   / (desktop, mobile): #${n}\n`).join("") +
      "  at   and 2 more\n  hint guess\n  fix  Use 16px\n\n" +
      "1 finding. Fix the app. If a change is intended, ask the developer to update the baseline.",
  );
});

test("reads back what it writes, and refuses anything else", () => {
  const viewports = { desktop: { width: 1 } };
  const good = { version: 3, baseUrl: "http://localhost:3000", viewports, pages: { "/": { desktop: base } } };
  assert.deepEqual(parseBaseline(serialize(good), viewports), good);

  const bad = (over) => () => parseBaseline(JSON.stringify({ ...good, ...over }), viewports);
  assert.throws(() => parseBaseline("{", viewports), /isn't valid JSON/);
  assert.throws(() => parseBaseline("null", viewports), /isn't a kolophon baseline/);
  assert.throws(bad({ version: 2 }), /format version 2.*snapshot <url\.\.\.> --update/);
  assert.throws(bad({ viewports: { desktop: { width: 2 } } }), /different viewports/);
  assert.throws(bad({ pages: {} }), /no pages/);
  assert.throws(bad({ pages: { "/": {} } }), /incomplete for \/ \(desktop\)/);
  assert.throws(bad({ pages: { "/": { desktop: { ...base, styles: [{}] } } } }), /incomplete/);
  assert.throws(bad({ pages: { "/": { desktop: { ...base, reducedMotion: undefined } } } }), /incomplete/);
  assert.throws(bad({ pages: { "@evil.example/": { desktop: base } } }), /isn't a path/);
});
