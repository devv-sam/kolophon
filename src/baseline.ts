import type { Typography } from "./typography.js";

export const BASELINE_FILE = "kolophon.json";
export const BASELINE_VERSION = 1;

export interface BaselineFont {
  family: string;
  webFont: boolean;
  /** Variation axes, e.g. `wght 100..900`. */
  axes: string[];
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

export interface BaselineView {
  fonts: BaselineFont[];
  styles: BaselineStyle[];
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
const styleKey = (s: BaselineStyle) =>
  [s.family, parseFloat(s.size).toFixed(2).padStart(10), s.weight.padStart(5), s.lineHeight, s.letterSpacing, s.style, s.variationSettings].join("|");

/** Keeps only design values: no counts, text, selectors or names of installed fonts. */
export function toView(t: Typography): BaselineView {
  const fonts = new Map<string, BaselineFont>();
  for (const f of t.families) {
    const axes = f.axes.map((a) => `${a.tag} ${a.min}..${a.max}`).sort();
    fonts.set(f.name, { family: f.name, webFont: f.webFont, axes });
  }

  const styles = new Map<string, BaselineStyle>();
  for (const s of t.styles) {
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
    // Rounding can make two styles equal; keep the problems of both.
    const key = styleKey(style);
    const seen = styles.get(key);
    if (seen && seen.fallback !== style.fallback) style.fallback = "some";
    if (seen?.weightCovered === false) style.weightCovered = false;
    styles.set(key, style);
  }
  return {
    fonts: [...fonts.values()].sort(byKey((f) => f.family)),
    styles: [...styles.values()].sort(byKey(styleKey)),
  };
}

/** Sorted by page, so the same measurements always give the same text. */
export function serialize(b: Baseline): string {
  const pages = Object.fromEntries(Object.entries(b.pages).sort(byKey(([path]) => path)));
  return `${JSON.stringify({ ...b, pages }, null, 2)}\n`;
}
