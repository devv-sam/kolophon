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
  /** How many identical animations were running. */
  count: number;
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
  /** Animations that started while kolophon scrolled the page and hovered its controls. */
  triggered: TriggeredAnimation[];
  /** Elements whose inline style JavaScript rewrote frame by frame, which no animation API reports. */
  scriptedStyles: ScriptedStyle[];
  interaction: InteractionReport;
}

export type Trigger = "scroll" | "hover";

export interface TriggeredAnimation {
  trigger: Trigger;
  /** CSSTransition, CSSAnimation, or WebAnimation (started from JavaScript, e.g. Motion). */
  type: string;
  /** The transitioned property or keyframes name; empty for unnamed script animations. */
  name: string;
  /** Milliseconds, rounded to 10 so interrupted runs (149ms, 147ms) group with the declared 150ms. */
  duration: number;
  easing: string;
  count: number;
}

export interface ScriptedStyle {
  /** `continuous` when the writes kept going from scrolling into hovering, i.e. a loop that runs on its own. */
  trigger: Trigger | "continuous";
  /** Tag plus id or first classes, e.g. `div.cursor`. */
  element: string;
  properties: string[];
  /** How many times the style attribute was rewritten. */
  writes: number;
  /** Time from the first write to the last, in ms. */
  span: number;
}

export interface InteractionReport {
  /** False when skipped (`interactions: false`). */
  ran: boolean;
  /** False when it stopped early; `note` says why. Whatever was recorded until then is kept. */
  completed: boolean;
  note?: string;
  scrolledPx: number;
  hovered: number;
}

type PageMotion = Pick<Motion, "transitions" | "animations" | "scriptAnimations">;
type StaticMotion = Omit<Motion, "triggered" | "scriptedStyles" | "interaction">;

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

  const scriptAnimations = new Map<string, ScriptAnimation>();
  for (const a of document.getAnimations()) {
    if (a instanceof CSSAnimation || a instanceof CSSTransition || !(a.effect instanceof KeyframeEffect)) continue;
    const timing = a.effect.getTiming();
    const properties = [
      ...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p)))),
    ];
    const entry = { duration: Number(timing.duration) || 0, easing: timing.easing ?? "linear", properties };
    const key = JSON.stringify(entry);
    const seen = scriptAnimations.get(key) ?? { ...entry, count: 0 };
    scriptAnimations.set(key, seen);
    seen.count++;
  }

  // shortcut: keeps the 20 most widespread of each so big apps stay agent-sized; raise if needed.
  const byUse = (a: { elements: number }, b: { elements: number }) => b.elements - a.elements;
  return {
    transitions: [...transitions.values()].sort(byUse).slice(0, 20),
    animations: [...animations.values()].sort(byUse).slice(0, 20),
    scriptAnimations: [...scriptAnimations.values()].sort((a, b) => b.count - a.count).slice(0, 15),
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
export function parseMotionCss(sheets: { text: string }[]): Pick<StaticMotion, "keyframes" | "reducedMotion" | "viewTransitions"> {
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
          if (new RegExp(`(^|[\\s,])${kf.name}($|[\\s,])`).test(value) && kf.usedBy.length < 3) {
            kf.usedBy.push({ selector: squash(selector).slice(0, 120), animation: squash(value) });
          }
        }
      }
    }
  }

  // shortcut: keeps 24 keyframes (used ones first) with 3 example users each, so big apps (Linear has ~150)
  // stay agent-sized; raise if agents miss animations.
  const kept = [...keyframes.values()].sort((a, b) => Number(b.usedBy.length > 0) - Number(a.usedBy.length > 0)).slice(0, 24);
  return { keyframes: kept, reducedMotion: { reduce: [...reduce], noPreference: [...noPreference] }, viewTransitions };
}

/** Selectors of `:hover` rules with the hover part removed, e.g. `.tray:hover .item:hover` → `.tray .item`. */
export function hoverTargets(sheets: { text: string }[]): string[] {
  const targets = new Set<string>();
  for (const { text } of sheets) {
    for (const [, group] of text.matchAll(/([^{}@;]+)\{/g)) {
      for (const sel of group.split(/,(?![^(]*\))/)) {
        if (!sel.includes(":hover")) continue;
        // Drop :hover and any trailing pseudo-element, which querySelectorAll can't match.
        const target = squash(sel.replace(/:hover/g, "").replace(/::[\w-]+(\([^)]*\))?\s*$/, ""));
        if (target && target !== "*") targets.add(target);
      }
    }
  }
  return [...targets];
}

/** Extracts motion visible at load from computed styles and the stylesheets. */
async function getStaticMotion(page: Page): Promise<{ motion: StaticMotion; hover: string[] }> {
  const live = await page.evaluate(extractMotion);
  const cdp = await page.createCDPSession();
  let css: ReturnType<typeof parseMotionCss>;
  let hover: string[];
  try {
    const sheets = await readStyleSheets(cdp, page);
    css = parseMotionCss(sheets);
    hover = hoverTargets(sheets);
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
  return { motion: { ...live, ...css }, hover };
}

// shortcut: scrolls at most 30 screens and hovers 20 distinct controls in a 12s budget; raise if pages need more.
const INTERACTION = { budgetMs: 12_000, maxScrollSteps: 30, scrollStepPx: 600, maxHovers: 20, settleMs: 150 };

/**
 * Scrolls the page and hovers its controls while recording every animation that starts (CDP Animation
 * domain) and every frame-by-frame inline-style write (a MutationObserver). Never throws: on a timeout,
 * navigation or error it stops and returns what it recorded, with `completed: false` and a note.
 */
async function recordInteractions(page: Page, hoverSelectors: string[]): Promise<Pick<Motion, "triggered" | "scriptedStyles" | "interaction">> {
  const report: InteractionReport = { ran: true, completed: false, scrolledPx: 0, hovered: 0 };
  const deadline = Date.now() + INTERACTION.budgetMs;
  const startUrl = page.url();
  let phase: Trigger = "scroll";
  // Animation.enable also reports animations already running; only ones starting after setup count.
  let recording = false;
  const triggered = new Map<string, TriggeredAnimation>();
  let scriptedStyles: ScriptedStyle[] = [];

  // A hover can open alert()/confirm(), which would block every later step.
  const onDialog = (d: { dismiss: () => Promise<void> }) => void d.dismiss().catch(() => {});
  page.on("dialog", onDialog);
  const cdp = await page.createCDPSession();
  cdp.on("Animation.animationStarted", ({ animation: a }) => {
    const duration = Math.round((a.source?.duration ?? 0) / 10) * 10;
    if (!recording || duration === 0) return;
    const name = a.type === "CSSTransition" || a.type === "CSSAnimation" ? a.name : "";
    // A CSS animation's curve is its animation-timing-function, which CDP reports per keyframe.
    const easing = (a.type === "CSSAnimation" && a.source?.keyframesRule?.keyframes?.[0]?.easing) || a.source?.easing || "linear";
    const key = [phase, a.type, name, duration, easing].join("|");
    const t = triggered.get(key) ?? { trigger: phase, type: a.type, name, duration, easing, count: 0 };
    triggered.set(key, t);
    t.count++;
  });

  const step = async (label: string, fn: () => Promise<unknown>) => {
    if (Date.now() > deadline) throw new Error(`stopped at the ${INTERACTION.budgetMs / 1000}s budget during ${label}`);
    // The hard timeout covers a single step that hangs (e.g. a page that never settles).
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} took too long`)), Math.max(1000, deadline - Date.now()));
      }),
    ]).finally(() => clearTimeout(timer));
    if (page.url() !== startUrl) throw new Error(`the page navigated to ${page.url()} during ${label}`);
  };
  const settle = () => new Promise((r) => setTimeout(r, INTERACTION.settleMs));

  try {
    await step("setup", async () => {
      await cdp.send("Animation.enable");
      await page.evaluate(() => {
        const w = window as unknown as { __kolophon: { phase: string; writes: Map<Element, { phase: string; lastPhase: string; props: Set<string>; n: number; first: number; last: number }> } };
        w.__kolophon = { phase: "scroll", writes: new Map() };
        const decls = (style: string | null) =>
          new Map((style ?? "").split(";").map((d) => d.split(":").map((x) => x.trim()) as [string, string]).filter(([k]) => k));
        new MutationObserver((records) => {
          for (const r of records) {
            const el = r.target as Element;
            const before = decls(r.oldValue);
            const after = decls(el.getAttribute("style"));
            const changed = [...new Set([...before.keys(), ...after.keys()])].filter((k) => before.get(k) !== after.get(k));
            if (!changed.length) continue;
            const now = performance.now();
            const entry = w.__kolophon.writes.get(el) ?? { phase: w.__kolophon.phase, lastPhase: "", props: new Set<string>(), n: 0, first: now, last: now };
            w.__kolophon.writes.set(el, entry);
            changed.forEach((p) => entry.props.add(p));
            entry.n++;
            entry.last = now;
            entry.lastPhase = w.__kolophon.phase;
          }
        }).observe(document.body, { attributes: true, attributeFilter: ["style"], attributeOldValue: true, subtree: true });
      });
      await settle();
      recording = true;
    });

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let i = 1; i <= INTERACTION.maxScrollSteps && i * INTERACTION.scrollStepPx < height + INTERACTION.scrollStepPx; i++) {
      await step("scrolling", async () => {
        await page.evaluate((y) => window.scrollTo(0, y), i * INTERACTION.scrollStepPx);
        await settle();
      });
      report.scrolledPx = Math.min(i * INTERACTION.scrollStepPx, height);
    }

    phase = "hover";
    await step("hover setup", async () => {
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        (window as unknown as { __kolophon: { phase: string } }).__kolophon.phase = "hover";
      });
    });
    // Targets of :hover rules first, then controls. One element per tag-and-class signature,
    // so 20 identical nav links count once.
    const count = await page.evaluate((max: number, hoverSelectors: string[]) => {
      const seen = new Set<string>();
      let n = 0;
      const fromRules = hoverSelectors.flatMap((sel) => {
        try {
          return [...document.querySelectorAll(sel)];
        } catch {
          return []; // Selectors this browser can't parse.
        }
      });
      for (const el of [...fromRules, ...document.querySelectorAll("body *")]) {
        if (n >= max) break;
        const interactive =
          fromRules.includes(el) ||
          el.matches("a[href], button, [role=button], summary, [onmouseenter], [onmouseover]") ||
          getComputedStyle(el).cursor === "pointer";
        if (!interactive || !el.checkVisibility()) continue;
        const sig = el.tagName + "." + [...el.classList].sort().join(".");
        if (seen.has(sig)) continue;
        seen.add(sig);
        el.setAttribute("data-kolophon-hover", String(n++));
      }
      return n;
    }, INTERACTION.maxHovers, hoverSelectors);
    for (let i = 0; i < count; i++) {
      await step("hovering", async () => {
        const el = await page.$(`[data-kolophon-hover="${i}"]`);
        await el?.hover().catch(() => {}); // Covered or detached elements just get skipped.
        await settle();
      });
      report.hovered++;
    }
    await step("hover end", () => page.mouse.move(0, 0));
    await settle();
    report.completed = true;
  } catch (err) {
    report.note = (err as Error).message;
  } finally {
    page.off("dialog", onDialog);
    try {
      scriptedStyles = await page.evaluate(() => {
        const w = window as unknown as { __kolophon?: { writes: Map<Element, { phase: string; lastPhase: string; props: Set<string>; n: number; first: number; last: number }> } };
        const describe = (el: Element) =>
          el.tagName.toLowerCase() + (el.id ? `#${el.id}` : [...el.classList].slice(0, 2).map((c) => `.${c}`).join(""));
        // Five or more rewrites means frame-by-frame animation rather than a one-off style change.
        return [...(w.__kolophon?.writes ?? [])]
          .filter(([, e]) => e.n >= 5)
          .map(([el, e]) => ({ trigger: (e.phase === e.lastPhase ? e.phase : "continuous") as ScriptedStyle["trigger"], element: describe(el), properties: [...e.props], writes: e.n, span: Math.round(e.last - e.first) }))
          .sort((a, b) => b.writes - a.writes)
          .slice(0, 15);
      });
    } catch {
      // The page navigated away; its style writes are gone, the animations are kept.
    }
    await cdp.detach().catch(() => {});
  }

  return { triggered: [...triggered.values()].sort((a, b) => b.count - a.count), scriptedStyles, interaction: report };
}

/** Extracts the page's motion: what's visible at load, then what scrolling and hovering trigger. */
export async function getMotion(page: Page, { interactions = true } = {}): Promise<Motion> {
  // Static extraction first, so the interaction pass can only add to it, never lose it.
  const { motion, hover } = await getStaticMotion(page);
  const recorded = interactions
    ? await recordInteractions(page, hover)
    : { triggered: [], scriptedStyles: [], interaction: { ran: false, completed: false, scrolledPx: 0, hovered: 0 } };
  return { ...motion, ...recorded };
}
