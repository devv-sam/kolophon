import type { Page } from "puppeteer-core";
import { selectorOf } from "./selector.js";

/** A computed CSS transition. Delays are left out: staggered lists derive them from how much content there is. */
export interface Transition {
  property: string;
  /** Milliseconds. */
  duration: number;
  easing: string;
  selector: string;
}

/** A CSS animation on a displayed element. */
export interface Animation {
  /** For findings only: build tools generate names. */
  name: string;
  duration: number;
  easing: string;
  iterations: string;
  direction: string;
  /** One entry per keyframe, as the browser resolved it, e.g. `0% opacity 0`. Empty when there is no such @keyframes. */
  keyframes: string[];
  selector: string;
}

export interface MotionSet {
  transitions: Transition[];
  animations: Animation[];
}

export interface Motion extends MotionSet {
  /** What still moves when the user asks for reduced motion. */
  reduced: MotionSet;
}

/** Runs inside the page, where only this function's source and `selectorOf` are sent. */
// shortcut: reads motion CSS sets at load; skips pseudo-elements, shadow roots, iframes, and motion started by JavaScript, scroll or hover.
function extractMotion(): MotionSet {
  // Lists of timing functions contain commas inside cubic-bezier(…), so split outside parentheses.
  const list = (v: string) => v.split(/,(?![^(]*\))/).map((x) => x.trim());
  // Under 1ms is how stylesheets switch motion off without losing its events.
  const ms = (v: string) => Math.round(parseFloat(v) * (v.endsWith("ms") ? 1 : 1000));

  // Asked of a probe, since an animation that already ended is no longer listed on its element.
  const resolved = new Map<string, string[]>();
  const keyframesOf = (name: string): string[] => {
    const seen = resolved.get(name);
    if (seen) return seen;
    const probe = document.createElement("div");
    const style = { "animation-name": name, "animation-duration": "1s", "animation-timing-function": "linear", "animation-play-state": "paused", display: "block" };
    for (const [property, value] of Object.entries(style)) probe.style.setProperty(property, value, "important");
    document.body.append(probe);
    const effect = probe.getAnimations().find((a) => a instanceof CSSAnimation)?.effect;
    const frames = effect instanceof KeyframeEffect ? effect.getKeyframes() : [];
    probe.remove();
    const text = frames.map(({ offset, computedOffset, easing, composite, ...props }) =>
      [
        `${Math.round(computedOffset * 10000) / 100}%`,
        ...Object.keys(props).sort().map((p) => `${p} ${props[p]};`),
        ...(easing === "linear" ? [] : [`easing ${easing};`]),
      ].join(" "),
    );
    resolved.set(name, text);
    return text;
  };

  const transitions = new Map<string, Transition>();
  const animations = new Map<string, Animation>();
  for (const el of document.querySelectorAll("body, body *")) {
    if (el.matches("script, style, noscript, template")) continue;
    const s = getComputedStyle(el);
    const durations = list(s.transitionDuration);
    const easings = list(s.transitionTimingFunction);
    list(s.transitionProperty).forEach((property, i) => {
      // Shorter lists repeat to match the property list, as in the CSS spec.
      const duration = ms(durations[i % durations.length]);
      if (property === "none" || duration === 0) return;
      const easing = easings[i % easings.length];
      const key = [property, duration, easing].join("|");
      if (!transitions.has(key)) transitions.set(key, { property, duration, easing, selector: selectorOf(el) });
    });

    if (s.animationName === "none" || !el.checkVisibility()) continue;
    const at = (v: string, i: number) => list(v)[i % list(v).length];
    list(s.animationName).forEach((name, i) => {
      const duration = ms(at(s.animationDuration, i));
      if (name === "none" || duration === 0) return;
      const a = {
        name,
        duration,
        easing: at(s.animationTimingFunction, i),
        iterations: at(s.animationIterationCount, i),
        direction: at(s.animationDirection, i),
        keyframes: keyframesOf(name),
      };
      const key = JSON.stringify(a);
      if (!animations.has(key)) animations.set(key, { ...a, selector: selectorOf(el) });
    });
  }
  return { transitions: [...transitions.values()], animations: [...animations.values()] };
}

/** Reads the page's motion twice, the second time with reduced motion asked for. Leaves the page in reduced motion. */
export async function getMotion(page: Page): Promise<Motion> {
  const read = async () => (await page.evaluate(`${selectorOf}; (${extractMotion})()`)) as MotionSet;
  const normal = await read();
  // shortcut: switches the open page over; reload it instead if apps read the preference only once, at load.
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  return { ...normal, reduced: await read() };
}
