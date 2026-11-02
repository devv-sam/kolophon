import type { FontFamily, TextStyle, Typography } from "./typography.js";

// shortcut: only the 12 most-used styles go into the outputs; raise it if agents miss real styles.
const MAX_STYLES = 12;

const px = (v: string) => parseFloat(v) || 0;
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "font";

/** Gives each item a unique slug, suffixing repeats with -2, -3, … */
function uniqueSlugs<T>(items: T[], base: (item: T) => string): Map<T, string> {
  const used = new Map<string, number>();
  return new Map(
    items.map((item) => {
      const s = base(item);
      const n = (used.get(s) ?? 0) + 1;
      used.set(s, n);
      return [item, n === 1 ? s : `${s}-${n}`];
    }),
  );
}

function prepare(t: Typography) {
  const total = t.families.reduce((sum, f) => sum + f.chars, 0) || 1;
  const styles = t.styles.slice(0, MAX_STYLES);
  const familySlugs = uniqueSlugs(t.families, (f) => slug(f.name));
  const styleSlugs = uniqueSlugs(styles, (s) => `${fmt(px(s.size))}-${s.weight}${s.style === "italic" ? "-italic" : ""}`);
  const familyOf = (s: TextStyle) => t.families.find((f) => f.stack === s.family);
  const share = (chars: number) => `${Math.round((chars / total) * 100)}%`;
  return { styles, familySlugs, styleSlugs, familyOf, share };
}

/** Stack as an array of names, unquoted, for tokens. */
const stackNames = (stack: string) => stack.split(",").map((n) => n.trim().replace(/^['"]|['"]$/g, ""));

const lineHeightRatio = (s: TextStyle) => (s.lineHeight === "normal" ? null : px(s.lineHeight) / px(s.size));

// Nearest Tailwind step; the extension's badge rounds up instead, which maps 510 to semibold.
function tailwindWeight(weight: number): string {
  const names = ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
  return `font-${names[Math.min(8, Math.max(0, Math.round(weight / 100) - 1))]}`;
}

function source(f: FontFamily): string {
  if (f.fallback === null) return f.webFont ? "web font" : "local";
  if (f.webFont) return f.fallback ? "web font, **failed to load**" : "web font";
  return f.fallback ? "local, **not installed**" : "local";
}

function axesText(f: FontFamily): string {
  return f.axes.map((a) => `${a.tag} ${fmt(a.min)}–${fmt(a.max)}`).join(", ") || "—";
}

function guidance(t: Typography, p: ReturnType<typeof prepare>): string[] {
  const notes: string[] = [];
  const primary = t.families[0];
  if (primary) notes.push(`Primary font is **${primary.name}** (${p.share(primary.chars)} of visible text); use the stack \`${primary.stack}\`.`);

  const weights = [...new Set(p.styles.map((s) => Number(s.weight)))].sort((a, b) => a - b);
  if (weights.length) {
    const classes = weights.map((w) => `${w} → ${tailwindWeight(w)}`).join(", ");
    notes.push(`${weights.length} weight step${weights.length === 1 ? "" : "s"} in use: ${weights.join(" / ")} (Tailwind: ${classes}).`);
  }

  const sizes = [...new Set(p.styles.map((s) => px(s.size)))].sort((a, b) => a - b);
  if (sizes.length) notes.push(`Font sizes in use: ${sizes.map((s) => `${fmt(s)}px`).join(", ")}.`);

  for (const f of t.families.filter((f) => f.variable)) {
    const wght = f.axes.find((a) => a.tag === "wght");
    const used = p.styles.filter((s) => s.family === f.stack).map((s) => Number(s.weight));
    const between = used.filter((w) => w % 100 !== 0);
    let note = `**${f.name}** is a variable font (${axesText(f)}).`;
    if (wght) note += ` Any weight from ${fmt(wght.min)} to ${fmt(wght.max)} works`;
    if (wght && between.length) note += `; this page uses in-between weights (${[...new Set(between)].join(", ")}), so use arbitrary values like \`font-[${between[0]}]\` rather than rounding`;
    if (wght) note += ".";
    if (f.axes.some((a) => a.tag === "opsz")) note += " It has an optical size axis, which browsers apply automatically (`font-optical-sizing: auto`).";
    notes.push(note);
  }

  for (const f of t.families.filter((f) => f.fallback)) {
    const used = f.rendered.map((r) => r.name).join(", ") || "a fallback";
    notes.push(`**${f.name}** did not render on this page; ${used} was used instead. Don't copy \`${f.name}\` without its font files, or the result will differ from the declared design.`);
  }

  const tracked = p.styles.filter((s) => s.letterSpacing !== "normal" && px(s.letterSpacing) !== 0);
  if (tracked.length) {
    notes.push(`Letter spacing is tuned per size: ${[...new Set(tracked.map((s) => `${s.letterSpacing} at ${s.size}`))].join(", ")}.`);
  }

  const settings = [...new Set(p.styles.map((s) => s.variationSettings).filter((v) => v !== "normal"))];
  if (settings.length) notes.push(`Custom \`font-variation-settings\` in use: ${settings.map((v) => `\`${v}\``).join("; ")}.`);
  // Pages can declare several stacks that start with the same font (Stripe has two), giving identical notes.
  return [...new Set(notes)];
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The typography section of a DESIGN.md: families, styles, then agent guidance. */
export function toDesignMd(t: Typography, page: { url: string; title: string }): string {
  const p = prepare(t);
  const lines = [
    `# Typography — ${page.title || page.url}`,
    "",
    `Extracted by kolophon from ${page.url}. Values are what Chrome rendered, not what the stylesheets declared.`,
    "",
    "## Font families",
    "",
    "| Family | Usage | Source | Variable axes | Stack |",
    "| --- | --- | --- | --- | --- |",
    ...t.families.map((f) => `| ${cell(f.name)} | ${p.share(f.chars)} | ${source(f)} | ${axesText(f)} | \`${cell(f.stack)}\` |`),
    "",
    "## Text styles",
    "",
    `Most-used first${t.styles.length > p.styles.length ? ` (top ${p.styles.length} of ${t.styles.length})` : ""}.`,
    "",
    "| Token | Family | Size / line height | Weight | Letter spacing | Used on | Sample |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...p.styles.map((s) => {
      const family = p.familyOf(s)?.name ?? s.family;
      const italic = s.style === "italic" ? " italic" : "";
      return `| \`${p.styleSlugs.get(s)}\` | ${cell(family)} | ${s.size} / ${s.lineHeight} | ${s.weight}${italic} | ${s.letterSpacing} | ${s.tags.join(", ")} | ${cell(s.sample)} |`;
    }),
    "",
    "## Agent guidance",
    "",
    ...guidance(t, p).map((n) => `- ${n}`),
    "",
  ];
  return lines.join("\n");
}

const dimension = (v: string) => ({ value: Math.round(px(v) * 1000) / 1000, unit: "px" });

/** W3C Design Tokens (DTCG) JSON: font families, then one typography token per style. */
export function toTokens(t: Typography): object {
  const p = prepare(t);
  const family = Object.fromEntries(
    t.families.map((f) => [p.familySlugs.get(f), { $type: "fontFamily", $value: stackNames(f.stack) }]),
  );
  const typography = Object.fromEntries(
    p.styles.map((s) => {
      const f = p.familyOf(s);
      const ratio = lineHeightRatio(s);
      return [
        p.styleSlugs.get(s),
        {
          $type: "typography",
          $value: {
            fontFamily: f ? `{font.family.${p.familySlugs.get(f)}}` : stackNames(s.family),
            fontSize: dimension(s.size),
            fontWeight: Number(s.weight),
            letterSpacing: dimension(s.letterSpacing),
            ...(ratio === null ? {} : { lineHeight: Math.round(ratio * 1000) / 1000 }),
          },
        },
      ];
    }),
  );
  return { font: { family }, typography };
}

/** Tailwind v4 `@theme` block: font families and the extracted text sizes. */
export function toTailwind(t: Typography): string {
  const p = prepare(t);
  const lines = ["@theme {"];
  for (const f of t.families) lines.push(`  --font-${p.familySlugs.get(f)}: ${f.stack};`);
  for (const s of p.styles) {
    const name = `--text-${p.styleSlugs.get(s)}`;
    lines.push(`  ${name}: ${s.size};`);
    if (s.lineHeight !== "normal") lines.push(`  ${name}--line-height: ${s.lineHeight};`);
    if (s.letterSpacing !== "normal") lines.push(`  ${name}--letter-spacing: ${s.letterSpacing};`);
    lines.push(`  ${name}--font-weight: ${s.weight};`);
  }
  lines.push("}");
  return lines.join("\n");
}
