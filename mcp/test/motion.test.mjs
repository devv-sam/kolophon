import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMotionCss } from "../dist/motion.js";
import { motionToDesignMd, motionToTailwind, motionToTokens } from "../dist/output.js";

test("parses keyframes, their users and reduced-motion blocks from CSS text", () => {
  const css = `
    @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
    @-webkit-keyframes fade { from { opacity: 1 } }
    .a, .b { animation: fade .3s ease-out; }
    .tomato { animation-name: fade; }
    @media (prefers-reduced-motion: reduce) { .a { animation: none } }
    @media (prefers-reduced-motion: no-preference) {
      @keyframes pulse { 50% { opacity: .5 } }
      .dot { animation: pulse 2s infinite; }
    }
    ::view-transition-old(root) { animation-duration: .2s; }`;
  const m = parseMotionCss([{ text: css }]);
  assert.deepEqual(m.keyframes.map((k) => k.name), ["fade", "pulse"], "first definition wins");
  assert.deepEqual(m.keyframes[0].usedBy.map((u) => u.selector), [".a, .b", ".tomato"], "rules under reduce are not usages");
  assert.deepEqual(m.keyframes[1].usedBy, [{ selector: ".dot", animation: "pulse 2s infinite" }]);
  assert.deepEqual(m.reducedMotion, { reduce: [".a"], noPreference: [".dot"] }, "keyframe stops aren't selectors");
  assert.equal(m.viewTransitions, true);
  assert.equal(parseMotionCss([{ text: ".x { color: red }" }]).viewTransitions, false);
});

const empty = { transitions: [], animations: [], scriptAnimations: [], keyframes: [], reducedMotion: { reduce: [], noPreference: [] }, viewTransitions: false };
const page = { url: "https://example.test", title: "Example" };

test("warns when nothing handles reduced motion", () => {
  const m = { ...empty, transitions: [{ property: "opacity", duration: 200, easing: "ease", delay: 0, elements: 3, tags: ["a"] }] };
  const md = motionToDesignMd(m, page);
  assert.match(md, /No `prefers-reduced-motion` handling was found/);
  assert.match(md, /The default UI transition is `opacity` over 200ms with cubic-bezier\(0\.25, 0\.1, 0\.25, 1\)/);
});

test("CSS keyword curves are prefixed and linear is left to Tailwind", () => {
  const m = {
    ...empty,
    transitions: [
      { property: "opacity", duration: 200, easing: "ease-in-out", delay: 0, elements: 1, tags: ["a"] },
      { property: "color", duration: 100, easing: "linear", delay: 0, elements: 1, tags: ["a"] },
    ],
  };
  assert.deepEqual(Object.keys(motionToTokens(m).easing), ["css-ease-in-out", "css-linear"]);
  assert.equal(motionToTokens(m).transition["opacity-200"].$value.timingFunction, "{easing.css-ease-in-out}");
  assert.doesNotMatch(motionToTailwind(m), /linear/);
});

test("handles a page with no motion", () => {
  assert.match(motionToDesignMd(empty, page), /None found at load\.[\s\S]*None found\./);
  assert.deepEqual(motionToTokens(empty), { duration: {}, easing: {}, transition: {} });
  assert.equal(motionToTailwind(empty), "@theme {\n}");
});
