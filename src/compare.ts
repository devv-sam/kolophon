import { styleKey, toStyle, toView, type BaselineStyle, type BaselineView } from "./baseline.js";
import type { TextStyle, Typography } from "./typography.js";

export interface Finding {
  /** Findings with the same cause are reported as one, across pages and viewports. */
  cause: string;
  /** What was found. */
  found: string;
  /** Selectors where it appears. */
  where: string[];
  /** What to change. */
  fix: string;
  /** Evidence and guesses that help find the cause. */
  hints: string[];
}

export interface Comparison {
  drift: Finding[];
  /** Differences that don't fail the check. */
  notes: string[];
  /** What couldn't be compared. */
  unmeasured: string[];
}

const PROPS = {
  family: "font-family",
  size: "font-size",
  weight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  style: "font-style",
  variationSettings: "font-variation-settings",
} as const;
const KEYS = Object.keys(PROPS) as (keyof typeof PROPS)[];

const describe = (s: BaselineStyle) =>
  [
    s.family,
    `${s.size}/${s.lineHeight}`,
    `weight ${s.weight}`,
    ...(s.letterSpacing === "normal" ? [] : [`letter-spacing ${s.letterSpacing}`]),
    ...(s.style === "normal" ? [] : [s.style]),
    ...(s.variationSettings === "normal" ? [] : [s.variationSettings]),
  ].join(", ");

/** The baseline style most like `s`: fewest different properties, then the closest size. */
function nearest(s: BaselineStyle, baseline: BaselineStyle[]): BaselineStyle | undefined {
  const score = (b: BaselineStyle) =>
    KEYS.filter((k) => b[k] !== s[k]).length * 1000 + Math.min(999, Math.abs(parseFloat(b.size) - parseFloat(s.size)));
  let best: BaselineStyle | undefined;
  for (const b of baseline) if (!best || score(b) < score(best)) best = b;
  return best;
}

const SEVERITY = { none: 0, some: 1, all: 2 };
const firstFamily = (stack: string) => stack.split(",")[0].trim().replace(/['"]/g, "");
const names = (styles: TextStyle[]) => [...new Set(styles.flatMap((s) => s.rendered.map((f) => f.name)))].sort().join(", ");

export const hiddenText = (n: number) => `${n} piece${n === 1 ? "" : "s"} of text`;

/** Compares what one page shows at one viewport with its baseline. A problem the baseline records is accepted until it gets worse. */
export function compare(baseline: BaselineView, t: Typography): Comparison {
  const drift: Finding[] = [];
  const unmeasured = [...t.unmeasured];
  const known = new Map(baseline.styles.map((s) => [styleKey(s), s]));
  const seen = new Set(t.styles.map((s) => styleKey(toStyle(s))));
  const missing = baseline.styles.filter((s) => !seen.has(styleKey(s)));
  const fellBack = new Map<string, TextStyle[]>();
  const uncovered = new Map<string, TextStyle[]>();
  const put = (map: Map<string, TextStyle[]>, key: string, s: TextStyle) => map.set(key, [...(map.get(key) ?? []), s]);

  for (const s of t.styles) {
    const style = toStyle(s);
    const key = styleKey(style);
    const match = known.get(key);
    if (!match) {
      const near = nearest(style, baseline.styles);
      const different = near ? KEYS.filter((k) => near[k] !== style[k]) : [];
      const changes = different.map((k) => `${PROPS[k]}: ${style[k]} should be ${near![k]}`);
      // One wrong declaration gives many new styles. A relative line height only follows the size.
      const root = different.filter((k) => k !== "lineHeight" || !different.includes("size"));
      drift.push({
        cause: `style ${root.map((k) => `${k} ${style[k]}`).join("|") || key}`,
        found: `Text style not in the baseline: ${describe(style)}`,
        where: [s.selector],
        fix: near ? "Use a baseline style. Hints are the nearest by value, so check them against the design." : "Remove this text style.",
        // Nearest is by value only. A style the page lost may be what this text had before.
        hints: [
          ...(near ? [`nearest is ${describe(near)}: ${changes.join("; ")}`] : []),
          ...(near && !missing.includes(near) ? missing.slice(0, 3).map((m) => `or it was one no longer seen: ${describe(m)}`) : []),
        ],
      });
    }
    // A new style is already a finding, so it only adds a font problem its font doesn't have in the baseline.
    const accepted = match ? [match] : baseline.styles.filter((b) => b.family === style.family);
    const worst = Math.max(0, ...accepted.map((b) => SEVERITY[b.fallback ?? "none"]));
    if (SEVERITY[style.fallback ?? "none"] > worst) put(fellBack, s.family, s);
    if (style.weightCovered === false && !accepted.some((b) => b.weight === style.weight && b.weightCovered === false)) put(uncovered, `${s.family}|${s.weight}`, s);
  }

  for (const [stack, styles] of fellBack) {
    const family = firstFamily(stack);
    const faces = t.families.find((f) => f.stack === stack)?.faces ?? [];
    const failed = faces.some((f) => f.status === "error");
    const some = styles.every((s) => toStyle(s).fallback === "some");
    // Looks right on this machine only.
    const installed = faces.length > 0 && styles.some((s) => s.rendered.some((f) => !f.custom && f.name.toLowerCase().startsWith(family.toLowerCase())));
    const reason = failed ? "failed" : some ? "some" : faces.length ? "unused" : "undeclared";
    drift.push({
      cause: `fallback ${family} ${reason}`,
      found: installed ? `The web font ${family} didn't draw ${some ? "some of its" : "its"} text; a copy installed on this machine did, which visitors don't have` : `${family} didn't draw ${some ? "some of its" : "its"} text`,
      where: styles.map((s) => s.selector),
      hints: [`drawn with ${names(styles)}`],
      fix:
        failed ? `A font file of ${family} failed to load. Check the url() in its @font-face.`
        : some ? `Use a font file of ${family} that has these characters, or check its unicode-range.`
        : faces.length ? `${family} is declared but wasn't used. Check that its @font-face covers this text.`
        : `${family} has no @font-face and isn't installed here. Check the name in font-family, or add an @font-face.`,
    });
  }
  for (const styles of uncovered.values()) {
    const { family, weight } = styles[0];
    drift.push({
      cause: `weight ${family} ${weight}`,
      hints: [],
      found: `No loaded face of ${firstFamily(family)} covers weight ${weight}, so the browser drew another weight or faked it`,
      where: styles.map((s) => s.selector),
      fix: `Load a face of ${firstFamily(family)} for weight ${weight}, declare its range in @font-face, or use a weight it has.`,
    });
  }

  const broken = new Set([...fellBack.keys()].map(firstFamily));
  for (const font of toView(t).fonts) {
    const before = baseline.fonts.find((f) => f.family === font.family);
    // A new font shows up as new styles, and one that fell back is already reported.
    if (!before || broken.has(font.family)) continue;
    const selectors = t.styles.filter((s) => firstFamily(s.family) === font.family).slice(0, 1).map((s) => s.selector);
    if (before.webFont !== font.webFont) {
      drift.push({
        cause: `source ${font.family}`,
        hints: [],
        found: `${font.family} is ${font.webFont ? "now a web font; the baseline has an installed font" : "no longer a web font; the baseline has an @font-face for it"}`,
        where: selectors,
        fix: font.webFont ? `Remove the @font-face for ${font.family}.` : `Restore the @font-face for ${font.family}.`,
      });
    } else if (before.axes && !font.axes) {
      unmeasured.push(`A font file of ${font.family} could not be read, so its variable axes couldn't be compared.`);
    } else if (before.axes && font.axes && before.axes.join() !== font.axes.join()) {
      const list = (axes: string[]) => axes.join(", ") || "none";
      drift.push({
        cause: `axes ${font.family} ${list(font.axes)} ${list(before.axes)}`,
        hints: [],
        found: `Variable axes of ${font.family} changed: ${list(font.axes)}`,
        where: selectors,
        fix: `Use the font file with the baseline axes: ${list(before.axes)}.`,
      });
    }
  }

  const notes = missing.map((s) => `Baseline style not seen: ${describe(s)}`);
  if (t.hidden) notes.push(`Hidden at load, so not measured: ${hiddenText(t.hidden)}`);
  return { drift, notes, unmeasured };
}
