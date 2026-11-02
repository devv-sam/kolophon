import { test } from "node:test";
import assert from "node:assert/strict";
import { toDesignMd, toTailwind, toTokens } from "../dist/output.js";

const style = (family, size, weight, extra = {}) => ({
  family, size, weight, lineHeight: "24px", letterSpacing: "normal", style: "normal",
  variationSettings: "normal", elements: 1, chars: 10, tags: ["p"], sample: "Sample", ...extra,
});
const family = (name, stack, extra = {}) => ({
  name, stack, chars: 10, webFont: true, faces: [], rendered: [], fallback: false, variable: false, axes: [], ...extra,
});

const inter = family("Inter Variable", '"Inter Variable", sans-serif', {
  chars: 80,
  variable: true,
  axes: [
    { tag: "opsz", name: "Optical size", min: 14, default: 14, max: 32 },
    { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 },
  ],
});
const broken = family("Brand Serif", '"Brand Serif", serif', { fallback: true, rendered: [{ name: "Times", custom: false, glyphs: 5 }] });
const fixture = {
  families: [inter, broken],
  styles: [
    style(inter.stack, "15px", "400", { chars: 50, letterSpacing: "-0.165px" }),
    style(inter.stack, "13px", "510", { lineHeight: "normal", chars: 30 }),
    style(broken.stack, "32px", "700", { tags: ["h1"] }),
  ],
};
const page = { url: "https://example.test", title: "Example" };

test("guidance covers variable fonts, fallbacks and tracking", () => {
  const md = toDesignMd(fixture, page);
  assert.match(md, /Primary font is \*\*Inter Variable\*\* \(89% of visible text\)/);
  assert.match(md, /3 weight steps in use: 400 \/ 510 \/ 700 \(Tailwind: 400 → font-normal, 510 → font-medium, 700 → font-bold\)/);
  assert.match(md, /Any weight from 100 to 900 works; this page uses in-between weights \(510\), so use arbitrary values like `font-\[510\]`/);
  assert.match(md, /optical size axis/);
  assert.match(md, /\*\*Brand Serif\*\* did not render on this page; Times was used instead/);
  assert.match(md, /\| Brand Serif \| 11% \| web font, \*\*failed to load\*\* \|/);
  assert.match(md, /Letter spacing is tuned per size: -0.165px at 15px/);
});

test("tokens reference families and omit unknown line heights", () => {
  const { font, typography } = toTokens(fixture);
  assert.deepEqual(Object.keys(font.family), ["inter-variable", "brand-serif"]);
  assert.equal(typography["15-400"].$value.fontFamily, "{font.family.inter-variable}");
  assert.equal(typography["15-400"].$value.lineHeight, 1.6);
  assert.deepEqual(typography["15-400"].$value.letterSpacing, { value: -0.165, unit: "px" });
  assert.equal("lineHeight" in typography["13-510"].$value, false);
});

test("repeated names get unique slugs", () => {
  const twice = {
    families: [family("sohne-var", "sohne-var, sans-serif"), family("sohne-var", '"sohne-var", "SF Pro Display", sans-serif')],
    styles: [style("sohne-var, sans-serif", "16px", "300"), style("sohne-var, sans-serif", "16px", "300", { style: "italic" })],
  };
  assert.deepEqual(Object.keys(toTokens(twice).font.family), ["sohne-var", "sohne-var-2"]);
  assert.deepEqual(Object.keys(toTokens(twice).typography), ["16-300", "16-300-italic"]);
  assert.match(toTailwind(twice), /--font-sohne-var-2: "sohne-var", "SF Pro Display", sans-serif;/);
});

test("guidance lists each note and spacing once", () => {
  const axes = [{ tag: "wght", name: "Weight", min: 1, default: 400, max: 1000 }];
  const tracked = { letterSpacing: "-0.13px" };
  const md = toDesignMd({
    families: [family("sohne-var", "sohne-var, a", { variable: true, axes }), family("sohne-var", "sohne-var, b", { variable: true, axes })],
    styles: [style("sohne-var, a", "13px", "400", tracked), style("sohne-var, a", "13px", "400", { ...tracked, lineHeight: "20px" })],
  }, page);
  assert.equal(md.match(/is a variable font/g).length, 1);
  assert.match(md, /Letter spacing is tuned per size: -0.13px at 13px\.\n/);
});

test("handles a page with no text", () => {
  const empty = { families: [], styles: [] };
  assert.match(toDesignMd(empty, page), /## Agent guidance/);
  assert.deepEqual(toTokens(empty), { font: { family: {} }, typography: {} });
  assert.equal(toTailwind(empty), "@theme {\n}");
});
