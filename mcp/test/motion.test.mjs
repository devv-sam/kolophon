import { test } from "node:test";
import assert from "node:assert/strict";
import { hoverTargets, parseMotionCss } from "../dist/motion.js";
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

const empty = {
  transitions: [], animations: [], scriptAnimations: [], keyframes: [], reducedMotion: { reduce: [], noPreference: [] }, viewTransitions: false,
  triggered: [], scriptedStyles: [], interaction: { ran: true, completed: true, scrolledPx: 1200, hovered: 4 },
};
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

test("finds what :hover rules target", () => {
  const css = ".tray:hover .item:hover { transform: scale(1.1) } a:hover, .card:is(.a, .b):hover { color: red } .x::after:hover {} .plain { color: blue } :hover { outline: 0 }";
  assert.deepEqual(hoverTargets([{ text: css }]), [".tray .item", "a", ".card:is(.a, .b)", ".x"]);
});

test("reports interaction motion and says when the pass stopped early", () => {
  const m = {
    ...empty,
    triggered: [
      { trigger: "hover", type: "WebAnimation", name: "", duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)", count: 2 },
      { trigger: "hover", type: "CSSTransition", name: "border-top-color", duration: 150, easing: "ease", count: 4 },
      { trigger: "scroll", type: "CSSAnimation", name: "reveal-rise", duration: 700, easing: "ease-out", count: 3 },
      { trigger: "hover", type: "WebAnimation", name: "", duration: 400, easing: "linear(0, 0.2 10%, 0.9 40%, 1.05 60%, 1)", count: 1 },
    ],
    scriptedStyles: [{ trigger: "continuous", element: "span.glow", properties: ["color"], writes: 240, span: 4000 }],
    interaction: { ran: true, completed: false, note: "the page navigated to https://example.test/next during hovering", scrolledPx: 600, hovered: 2 },
  };
  const md = motionToDesignMd(m, page);
  assert.match(md, /Some motion comes from JavaScript .*180ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(md, /spring converted to CSS/);
  assert.match(md, /On hover, transitions actually animate: border-color\./);
  assert.match(md, /`reveal-rise` plays as elements scroll into view/);
  assert.match(md, /`span\.glow` is animated frame by frame from JavaScript continuously \(color, 240 updates over 4000ms\)/);
  assert.match(md, /stopped early \(the page navigated to https:\/\/example\.test\/next during hovering\)/);
  assert.match(md, /hovered 2 controls before stopping early/);
  assert.deepEqual(Object.keys(motionToTokens(m).duration), ["180", "400"]);
});

test("says when interactions were skipped", () => {
  const md = motionToDesignMd({ ...empty, interaction: { ran: false, completed: false, scrolledPx: 0, hovered: 0 } }, page);
  assert.match(md, /## Triggered by interaction\n\nSkipped\./);
  assert.match(md, /Scrolling and hovering were skipped/);
});
