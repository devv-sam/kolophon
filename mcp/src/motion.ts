import type { Page } from "puppeteer-core";
import { readStyleSheets } from "./browser.js";

/** A computed CSS transition, grouped across the elements that share it. */
export interface Transition {
  property: string;
  /** Milliseconds. */
  duration: number;
  easing: string;
  delay: number;
  elements: number;
  tags: string[];
}

/** A CSS animation running at load, from computed styles. */
export interface RunningAnimation {
  name: string;
  duration: number;
  easing: string;
  delay: number;
  iterations: string;
  elements: number;
}

/** An animation started from JavaScript (Web Animations API, e.g. Motion/Framer Motion). */
export interface ScriptAnimation {
  duration: number;
  easing: string;
  properties: string[];
}

/** One selector that applies a keyframes animation, from the stylesheet text. */
export interface KeyframesUsage {
  selector: string;
  /** The `animation` declaration as written, e.g. `reveal-rise 600ms cubic-bezier(.2,.8,.2,1) both`. */
  animation: string;
  /** The same declaration with CSS variables replaced by their values on the page, when it uses any. */
  resolved?: string;
}

export interface Keyframes {
  name: string;
  /** Properties the keyframes change, e.g. opacity, transform, filter. */
  properties: string[];
  /** The keyframes body, whitespace collapsed. */
  css: string;
  usedBy: KeyframesUsage[];
}

export interface Motion {
  transitions: Transition[];
  animations: RunningAnimation[];
  scriptAnimations: ScriptAnimation[];
  keyframes: Keyframes[];
  reducedMotion: {
    /** Selectors restyled under `prefers-reduced-motion: reduce`. */
    reduce: string[];
    /** Selectors whose motion only applies under `prefers-reduced-motion: no-preference`. */
    noPreference: string[];
  };
  viewTransitions: boolean;
}

type PageMotion = Pick<Motion, "transitions" | "animations" | "scriptAnimations">;

/**
 * Runs inside the page via `page.evaluate`, which serializes only this function,
 * so everything it uses must be defined in its body.
 */
export function extractMotion(): PageMotion {
  // shortcut: reads the first 20,000 elements; raise it or sample if real pages get cut off.
  const MAX_ELEMENTS = 20000;
  // Comma lists of timing functions contain commas inside cubic-bezier(…), so split outside parentheses.
  const list = (v: string) => v.split(/,(?![^(]*\))/).map((x) => x.trim());
  const ms = (v: string) => Math.round(parseFloat(v) * (v.endsWith("ms") ? 1 : 1000));

  const transitions = new Map<string, Transition>();
  const animations = new Map<string, RunningAnimation>();
  const elements = document.querySelectorAll("body, body *");
  for (let i = 0; i < Math.min(elements.length, MAX_ELEMENTS); i++) {
    const el = elements[i];
    const s = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();

    const props = list(s.transitionProperty);
    const durations = list(s.transitionDuration);
    const easings = list(s.transitionTimingFunction);
    const delays = list(s.transitionDelay);
    props.forEach((property, j) => {
      // Shorter lists repeat to match the property list, as in the CSS spec.
      const duration = ms(durations[j % durations.length]);
      if (property === "none" || duration === 0) return;
      const easing = easings[j % easings.length];
      const delay = ms(delays[j % delays.length]);
      const key = [property, duration, easing, delay].join("|");
      const t = transitions.get(key) ?? { property, duration, easing, delay, elements: 0, tags: [] };
      transitions.set(key, t);
      t.elements++;
      if (t.tags.length < 5 && !t.tags.includes(tag)) t.tags.push(tag);
    });

    if (s.animationName === "none") continue;
    const durationsA = list(s.animationDuration);
    const easingsA = list(s.animationTimingFunction);
    const delaysA = list(s.animationDelay);
    const iterations = list(s.animationIterationCount);
    list(s.animationName).forEach((name, j) => {
      if (name === "none") return;
      const a = {
        name,
        duration: ms(durationsA[j % durationsA.length]),
        easing: easingsA[j % easingsA.length],
        delay: ms(delaysA[j % delaysA.length]),
        iterations: iterations[j % iterations.length],
      };
      const key = Object.values(a).join("|");
      const seen = animations.get(key) ?? { ...a, elements: 0 };
      animations.set(key, seen);
      seen.elements++;
    });
  }

  const scriptAnimations: ScriptAnimation[] = [];
  for (const a of document.getAnimations()) {
    if (a instanceof CSSAnimation || a instanceof CSSTransition || !(a.effect instanceof KeyframeEffect)) continue;
    const timing = a.effect.getTiming();
    const properties = [
      ...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p)))),
    ];
    scriptAnimations.push({ duration: Number(timing.duration) || 0, easing: timing.easing ?? "linear", properties });
  }

  const byUse = (a: { elements: number }, b: { elements: number }) => b.elements - a.elements;
  return {
    transitions: [...transitions.values()].sort(byUse),
    animations: [...animations.values()].sort(byUse),
    scriptAnimations,
  };
}

/** Finds `{…}` blocks after each match of `opener`, honouring nested braces. */
function blocks(text: string, opener: RegExp): { match: RegExpExecArray; start: number; body: string }[] {
  const found = [];
  for (const match of text.matchAll(opener)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const bodyStart = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    found.push({ match: match as RegExpExecArray, start: match.index, body: text.slice(bodyStart, i - 1) });
  }
  return found;
}

const squash = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
// Keyframe stops (50%, from, to) inside a media block aren't selectors.
const selectorsIn = (body: string) =>
  [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(([, sel]) => squash(sel)).filter((sel) => !/^(\d+(\.\d+)?%|from|to)(?=$|[\s,])/.test(sel));

/** Reads @keyframes, the rules that use them, reduced-motion blocks and view transitions from CSS text. */
export function parseMotionCss(sheets: { text: string }[]): Pick<Motion, "keyframes" | "reducedMotion" | "viewTransitions"> {
  const keyframes = new Map<string, Keyframes>();
  const reduce = new Set<string>();
  const noPreference = new Set<string>();
  let viewTransitions = false;

  for (const { text } of sheets) {
    if (/::view-transition|@view-transition/.test(text)) viewTransitions = true;

    for (const { match, body } of blocks(text, /@(?:-webkit-)?keyframes\s+([\w-]+)\s*\{/g)) {
      const name = match[1];
      if (keyframes.has(name)) continue;
      // animation-timing-function inside keyframes sets per-step easing; it isn't an animated property.
      const properties = [...new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map(([, p]) => p))].filter((p) => p !== "animation-timing-function");
      keyframes.set(name, { name, properties, css: squash(body).slice(0, 600), usedBy: [] });
    }

    // Rules under `reduce` switch motion off, so they're recorded there and left out of the usages.
    let usable = text;
    for (const { match, start, body } of blocks(text, /@media[^{]*prefers-reduced-motion\s*:\s*(reduce|no-preference)[^{]*\{/g)) {
      for (const sel of selectorsIn(body)) (match[1] === "reduce" ? reduce : noPreference).add(sel);
      if (match[1] === "reduce") {
        const end = start + match[0].length + body.length + 1;
        usable = usable.replace(text.slice(start, end), "");
      }
    }

    for (const [, selector, decls] of usable.matchAll(/([^{}@;]+)\{([^{}]*\banimation(?:-name)?\s*:[^{}]*)\}/g)) {
      for (const [, value] of decls.matchAll(/\banimation(?:-name)?\s*:\s*([^;]+)/g)) {
        for (const kf of keyframes.values()) {
          if (new RegExp(`(^|[\\s,])${kf.name}($|[\\s,])`).test(value) && kf.usedBy.length < 10) {
            kf.usedBy.push({ selector: squash(selector).slice(0, 120), animation: squash(value) });
          }
        }
      }
    }
  }

  return { keyframes: [...keyframes.values()], reducedMotion: { reduce: [...reduce], noPreference: [...noPreference] }, viewTransitions };
}

/** Extracts the page's transitions, animations and keyframes, plus its reduced-motion handling. */
export async function getMotion(page: Page): Promise<Motion> {
  const live = await page.evaluate(extractMotion);
  const cdp = await page.createCDPSession();
  let css: ReturnType<typeof parseMotionCss>;
  try {
    css = parseMotionCss(await readStyleSheets(cdp, page));
  } finally {
    await cdp.detach();
  }

  // shortcut: variables resolve against :root only; ones set on an element itself fall back to their var() default.
  const usages = css.keyframes.flatMap((k) => k.usedBy);
  const names = [...new Set(usages.flatMap((u) => [...u.animation.matchAll(/var\((--[\w-]+)/g)].map(([, n]) => n)))];
  const values = await page.evaluate(
    (names: string[]) => names.map((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()),
    names,
  );
  const vars = new Map(names.map((n, i) => [n, values[i]]));
  for (const u of usages) {
    if (!u.animation.includes("var(")) continue;
    const resolved = u.animation.replace(/var\((--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name, fallback) => ` ${vars.get(name) || fallback?.trim() || "unset"} `);
    u.resolved = squash(resolved);
  }
  return { ...live, ...css };
}
