import { isDeepStrictEqual } from "node:util";
import type { Animation, Motion, MotionSet, Transition } from "./motion.js";
import type { TextStyle, Typography } from "./typography.js";

export const BASELINE_FILE = "kolophon.json";
export const BASELINE_VERSION = 2;

export interface BaselineFont {
  family: string;
  webFont: boolean;
  /** Variation axes, e.g. `wght 100..900`; null when a font file couldn't be read. */
  axes: string[] | null;
}

export interface BaselineStyle {
  family: string;
  size: string;
  lineHeight: string;
  weight: string;
  letterSpacing: string;
  style: string;
  variationSettings: string;
  /** Present when the first family didn't draw all of the text. Depends on the machine's installed fonts. */
  fallback?: "all" | "some";
  /** Present when no loaded face covers the weight. */
  weightCovered?: false;
}

export interface BaselineTransition {
  property: string;
  duration: string;
  easing: string;
}

export interface BaselineAnimation {
  duration: string;
  easing: string;
  iterations: string;
  direction: string;
  /** Empty when the animation has no @keyframes, so nothing moves. */
  keyframes: string[];
}

export interface BaselineMotion {
  transitions: BaselineTransition[];
  animations: BaselineAnimation[];
}

export interface BaselineView {
  fonts: BaselineFont[];
  styles: BaselineStyle[];
  motion: BaselineMotion;
  /** What still moves when the user asks for reduced motion. */
  reducedMotion: BaselineMotion;
}

export interface Baseline {
  version: number;
  baseUrl: string;
  /** Viewport name → its settings. */
  viewports: Record<string, object>;
  /** Page path → viewport name → what was measured there. */
  pages: Record<string, Record<string, BaselineView>>;
}

// Layout math leaves values like 63.9999px, which would read as drift from 64px.
const round = (v: string) => v.replace(/^(-?[\d.]+(?:e-?\d+)?)px$/, (_, n) => `${Math.round(Number(n) * 100) / 100 || 0}px`);

const byKey = <T>(key: (item: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

/** The design values of a style, without what varies with content. */
export const styleKey = (s: BaselineStyle) =>
  [s.family, parseFloat(s.size).toFixed(2).padStart(10), s.weight.padStart(5), s.lineHeight, s.letterSpacing, s.style, s.variationSettings].join("|");

/** A measured style as the baseline stores it. */
export function toStyle(s: TextStyle): BaselineStyle {
  const glyphs = s.rendered.reduce((sum, f) => sum + f.glyphs, 0);
  const style: BaselineStyle = {
    family: s.family,
    size: round(s.size),
    lineHeight: round(s.lineHeight),
    weight: s.weight,
    letterSpacing: round(s.letterSpacing),
    style: s.style,
    variationSettings: s.variationSettings,
  };
  if (s.fallbackGlyphs) style.fallback = s.fallbackGlyphs === glyphs ? "all" : "some";
  if (s.weightCovered === false) style.weightCovered = false;
  return style;
}

export const toTransition = (t: Transition): BaselineTransition => ({ property: t.property, duration: `${t.duration}ms`, easing: t.easing });

export const toAnimation = (a: Animation): BaselineAnimation => ({
  duration: `${a.duration}ms`,
  easing: a.easing,
  iterations: a.iterations,
  direction: a.direction,
  keyframes: a.keyframes,
});

export const transitionKey = (t: BaselineTransition) => [t.property, t.duration.padStart(10), t.easing].join("|");
export const animationKey = (a: BaselineAnimation) => JSON.stringify([a.keyframes, a.duration.padStart(10), a.easing, a.iterations, a.direction]);

function toMotion(m: MotionSet): BaselineMotion {
  // Two names for the same keyframes are one animation.
  const distinct = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map((i) => [key(i), i])).values()].sort(byKey(key));
  return { transitions: distinct(m.transitions.map(toTransition), transitionKey), animations: distinct(m.animations.map(toAnimation), animationKey) };
}

export function toFonts(t: Typography): BaselineFont[] {
  const fonts = new Map<string, BaselineFont>();
  for (const f of t.families) {
    const axes = f.axes && f.axes.map((a) => `${a.tag} ${a.min}..${a.max}`).sort();
    fonts.set(f.name, { family: f.name, webFont: f.webFont, axes });
  }
  return [...fonts.values()].sort(byKey((f) => f.family));
}

/** Keeps only design values: no counts, text, selectors or names of installed fonts. */
export function toView(t: Typography, m: Motion): BaselineView {
  const styles = new Map<string, BaselineStyle>();
  for (const s of t.styles) {
    const style = toStyle(s);
    // Rounding can make two styles equal; keep the problems of both.
    const key = styleKey(style);
    const seen = styles.get(key);
    if (seen && seen.fallback !== style.fallback) style.fallback = "some";
    if (seen?.weightCovered === false) style.weightCovered = false;
    styles.set(key, style);
  }
  return {
    fonts: toFonts(t),
    styles: [...styles.values()].sort(byKey(styleKey)),
    motion: toMotion(m),
    reducedMotion: toMotion(m.reduced),
  };
}

/** Sorted by page, so the same measurements always give the same text. */
export function serialize(b: Baseline): string {
  const pages = Object.fromEntries(Object.entries(b.pages).sort(byKey(([path]) => path)));
  return `${JSON.stringify({ ...b, pages }, null, 2)}\n`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const STYLE_FIELDS = ["family", "size", "lineHeight", "weight", "letterSpacing", "style", "variationSettings"] as const;

const hasStrings = (v: unknown, fields: readonly string[]) => isObject(v) && fields.every((k) => typeof v[k] === "string");
const isStrings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");
const isMotion = (v: unknown) =>
  isObject(v) &&
  Array.isArray(v.transitions) &&
  v.transitions.every((t) => hasStrings(t, ["property", "duration", "easing"])) &&
  Array.isArray(v.animations) &&
  v.animations.every((a) => hasStrings(a, ["duration", "easing", "iterations", "direction"]) && isStrings(a.keyframes));

function isView(v: unknown): v is BaselineView {
  return (
    isObject(v) &&
    Array.isArray(v.fonts) &&
    v.fonts.every((f) => isObject(f) && typeof f.family === "string" && typeof f.webFont === "boolean" && (f.axes === null || isStrings(f.axes))) &&
    Array.isArray(v.styles) &&
    v.styles.every(
      (s) =>
        hasStrings(s, STYLE_FIELDS) &&
        [undefined, "all", "some"].includes(s.fallback as string | undefined) &&
        [undefined, false].includes(s.weightCovered as false | undefined),
    ) &&
    isMotion(v.motion) &&
    isMotion(v.reducedMotion)
  );
}

/** Reads a baseline's text. Throws on anything that can't be compared against, so it's never mistaken for a pass. */
export function parseBaseline(text: string, viewports: Record<string, object>): Baseline {
  let b: unknown;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error(`${BASELINE_FILE} isn't valid JSON.`);
  }
  if (!isObject(b)) throw new Error(`${BASELINE_FILE} isn't a kolophon baseline.`);
  if (b.version !== BASELINE_VERSION) {
    throw new Error(`${BASELINE_FILE} has format version ${String(b.version)}; this kolophon reads version ${BASELINE_VERSION}. The developer needs to make a new baseline: kolophon snapshot <url...> --update`);
  }
  if (!isDeepStrictEqual(b.viewports, viewports)) {
    throw new Error(`${BASELINE_FILE} was measured at different viewports. The developer needs to make a new baseline.`);
  }
  const { pages } = b;
  if (typeof b.baseUrl !== "string" || !isObject(pages)) throw new Error(`${BASELINE_FILE} isn't a kolophon baseline.`);
  if (!Object.keys(pages).length) throw new Error(`${BASELINE_FILE} has no pages to check.`);
  for (const [path, views] of Object.entries(pages)) {
    // Joined to the base URL, so anything else could point at another host.
    if (!path.startsWith("/")) throw new Error(`${BASELINE_FILE} has a page that isn't a path: ${path}`);
    for (const name of Object.keys(viewports)) {
      if (!isObject(views) || !isView(views[name])) throw new Error(`${BASELINE_FILE} is incomplete for ${path} (${name}).`);
    }
  }
  return b as unknown as Baseline;
}
