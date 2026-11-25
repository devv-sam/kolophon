import { test } from "node:test";
import assert from "node:assert/strict";
import { serialize, toView } from "../dist/baseline.js";
import { parseUrls } from "../dist/snapshot.js";

const style = (over = {}) => ({
  family: "Inter, sans-serif", weight: "400", size: "16px", lineHeight: "24px", letterSpacing: "normal", style: "normal",
  variationSettings: "normal", elements: 3, chars: 120, tags: ["p"], sample: "Secret copy", selector: "#private",
  rendered: [{ name: "Menlo", custom: false, glyphs: 10 }], fallbackGlyphs: 0, weightCovered: null, ...over,
});
const family = (over = {}) => ({ name: "Inter", stack: "Inter, sans-serif", chars: 1, webFont: true, faces: [], variable: false, axes: [], ...over });
const view = (styles, families = [family()]) => toView({ styles, families, unmeasured: [], hidden: 0 });

test("keeps design values and nothing that varies with content or machine", () => {
  const v = view([style()]);
  assert.deepEqual(v.styles, [
    { family: "Inter, sans-serif", size: "16px", lineHeight: "24px", weight: "400", letterSpacing: "normal", style: "normal", variationSettings: "normal" },
  ]);
  assert.doesNotMatch(JSON.stringify(v), /Secret|private|Menlo|120/);
});

test("rounds layout noise but keeps real differences", () => {
  const sizes = (...s) => view(s.map((size) => style({ size }))).styles.map((x) => x.size);
  assert.deepEqual(sizes("63.9999px", "64px"), ["64px"]);
  assert.deepEqual(sizes("15.2px", "15px"), ["15px", "15.2px"]);
  assert.deepEqual(sizes("100px", "25.6px", "9px"), ["9px", "25.6px", "100px"], "sorted by size");
  assert.equal(view([style({ letterSpacing: "-1.28001px" })]).styles[0].letterSpacing, "-1.28px");
  assert.equal(view([style({ letterSpacing: "-1e-5px" })]).styles[0].letterSpacing, "0px");
});

test("records font problems only when there are any", () => {
  assert.equal(view([style({ fallbackGlyphs: 10 })]).styles[0].fallback, "all");
  assert.equal(view([style({ fallbackGlyphs: 4 })]).styles[0].fallback, "some");
  assert.equal(view([style({ weightCovered: false })]).styles[0].weightCovered, false);
  for (const s of [style(), style({ weightCovered: true }), style({ fallbackGlyphs: null })]) {
    assert.ok(!("fallback" in view([s]).styles[0]) && !("weightCovered" in view([s]).styles[0]));
  }
});

test("styles made equal by rounding keep the problems of both", () => {
  const bad = style({ size: "63.9999px", fallbackGlyphs: 10, weightCovered: false });
  for (const pair of [[bad, style({ size: "64px" })], [style({ size: "64px" }), bad]]) {
    const [merged, ...rest] = view(pair).styles;
    assert.equal(rest.length, 0);
    assert.deepEqual([merged.fallback, merged.weightCovered], ["some", false]);
  }
});

test("lists each font once, with its axes", () => {
  const axes = [{ tag: "wght", name: "Weight", min: 100, default: 400, max: 900 }];
  assert.deepEqual(view([], [family({ axes }), family({ stack: "Inter", axes })]).fonts, [{ family: "Inter", webFont: true, axes: ["wght 100..900"] }]);
});

test("order of measurement doesn't change the text", () => {
  const a = style({ size: "14px" }), b = style({ size: "20px" });
  const text = (styles, paths) => serialize({ version: 1, baseUrl: "http://x", viewports: {}, pages: Object.fromEntries(paths.map((p) => [p, { desktop: view(styles) }])) });
  assert.equal(text([a, b], ["/", "/a"]), text([b, a], ["/a", "/"]));
});

test("takes pages from one origin, without duplicates", () => {
  assert.deepEqual(parseUrls(["http://localhost:3000", "http://localhost:3000/", "http://localhost:3000/a?b=1#c"]), {
    baseUrl: "http://localhost:3000",
    paths: ["/", "/a?b=1#c"],
  });
  assert.throws(() => parseUrls(["http://localhost:3000", "http://localhost:4000"]), /one origin/);
  assert.throws(() => parseUrls(["localhost:3000"]), /isn't an http/);
  assert.throws(() => parseUrls(["file:///etc/passwd"]), /isn't an http/);
  assert.throws(() => parseUrls(["http://me:hunter2@localhost/"]), (err) => /aren't supported/.test(err.message) && !/hunter2/.test(err.message));
});
