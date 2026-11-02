import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSheet } from "../dist/sheet.js";

const page = { url: "https://example.test", title: 'Shop <script>alert("x")</script>' };
const typography = {
  families: [
    {
      name: "Inter Variable", stack: '"Inter Variable", sans-serif', chars: 90, webFont: true, faces: [], rendered: [], fallback: false,
      variable: true, axes: [{ tag: "wght", name: "Weight", min: 100, default: 400, max: 900 }],
    },
  ],
  styles: [
    { family: '"Inter Variable", sans-serif', weight: "400", size: "16px", lineHeight: "24px", letterSpacing: "normal", style: "normal", variationSettings: "normal", elements: 9, chars: 80, tags: ["p"], sample: "Body <b>copy</b>" },
    { family: '"Inter Variable", sans-serif', weight: "510", size: "40px", lineHeight: "44px", letterSpacing: "-0.88px", style: "normal", variationSettings: "normal", elements: 1, chars: 10, tags: ["h1"], sample: "Heading" },
  ],
};
const kf = (name) => ({ name, properties: ["transform"], css: "to{transform:none}", usedBy: [{ selector: `.${name}`, animation: `${name} 1s linear infinite` }] });
const motion = {
  transitions: [{ property: "opacity", duration: 150, easing: "cubic-bezier(0.4, 0, 0.2, 1)", delay: 0, elements: 4, tags: ["a"] }],
  animations: [],
  scriptAnimations: [],
  keyframes: [kf("dot-0-0"), kf("dot-0-1"), kf("dot-1-0"), { ...kf("pop"), usedBy: [{ selector: ".pop", animation: "pop .45s cubic-bezier(.34,1.56,.64,1)" }] }],
  reducedMotion: { reduce: [".pop"], noPreference: [] },
  viewTransitions: false,
  triggered: [
    { trigger: "hover", type: "CSSTransition", name: "border-top-color", duration: 150, easing: "ease", count: 4 },
    { trigger: "hover", type: "CSSTransition", name: "border-left-color", duration: 150, easing: "ease", count: 4 },
    { trigger: "scroll", type: "WebAnimation", name: "", duration: 300, easing: "linear(0, 0.5 20%, 1.08 50%, 1)", count: 2 },
  ],
  scriptedStyles: [],
  interaction: { ran: true, completed: true, scrolledPx: 900, hovered: 3 },
};

test("escapes page text", () => {
  const html = renderSheet(typography, motion, page);
  assert.doesNotMatch(html, /<script>|<b>copy/);
  assert.match(html, /Shop &lt;script&gt;/);
  assert.match(html, /Body &lt;b&gt;copy&lt;\/b&gt;/);
  assert.match(html, /font-family:&quot;Inter Variable&quot;, sans-serif/);
});

test("draws the type scale largest first, with axes and weight ticks", () => {
  const html = renderSheet(typography, motion, page);
  assert.ok(html.indexOf(">Heading<") < html.indexOf(">Body &lt;b&gt;"), "40px before 16px");
  assert.match(html, /<i class="tick" style="left:51.25%" title="510">/);
  assert.match(html, /<dd>510 \/ medium<\/dd>/);
});

test("plots bezier and linear() curves, flags springs, folds generated keyframes", () => {
  const html = renderSheet(typography, motion, page);
  assert.match(html, /<path d="M20 100 C52 100 36 20 100 20"/, "cubic-bezier(0.4, 0, 0.2, 1)");
  assert.match(html, /class="curve springy"[\s\S]*cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/);
  assert.match(html, /linear\(…\) spring[\s\S]*spring, converted to CSS/);
  assert.match(html, /@dot-#-# ×3/);
  assert.equal(html.match(/>border-color</g)?.length, 1, "border sides fold into one row");
  assert.match(html, />JS animation</);
  assert.match(html, /Respects reduced motion · 1 rule/);
});
