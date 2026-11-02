import type { Motion } from "./motion.js";
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
    notes.push(
      f.webFont
        ? `**${f.name}** failed to load on this page, so ${used} rendered instead. Ship its font files (or the same font service) when you use it, or the result will differ from the declared design.`
        : `**${f.name}** isn't installed on the machine that extracted this, so ${used} rendered instead. It's a system font: keep it in the stack, but the measurements above came from ${used}.`,
    );
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

// ---- Motion ----

type Bezier = [number, number, number, number];

const KEYWORD_EASINGS: Record<string, Bezier> = {
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
};

// Tailwind's built-in curves, so agents can use the class instead of an arbitrary value.
const TAILWIND_EASINGS: [Bezier, string, string][] = [
  [[0.4, 0, 0.2, 1], "standard", "Tailwind `ease-in-out` (also the default for `transition`)"],
  [[0, 0, 0.2, 1], "standard-out", "Tailwind `ease-out`"],
  [[0.4, 0, 1, 1], "standard-in", "Tailwind `ease-in`"],
];

function bezier(easing: string): Bezier | null {
  if (KEYWORD_EASINGS[easing]) return KEYWORD_EASINGS[easing];
  const m = easing.match(/cubic-bezier\(([^)]+)\)/);
  const n = m?.[1].split(",").map(Number);
  return n?.length === 4 && n.every(Number.isFinite) ? (n as Bezier) : null;
}

const sameCurve = (a: Bezier, b: Bezier) => a.every((v, i) => Math.abs(v - b[i]) < 0.001);
const overshoots = (b: Bezier) => b[1] < 0 || b[1] > 1 || b[3] < 0 || b[3] > 1;
const curveText = (b: Bezier) => `cubic-bezier(${b.map(fmt).join(", ")})`;

/** Lists up to `max` names as code, then "and N more". */
function names(list: string[], max = 8): string {
  const shown = list.slice(0, max).map((n) => `\`${n}\``).join(", ");
  return list.length > max ? `${shown} and ${list.length - max} more` : shown;
}

function describeEasing(easing: string): string {
  const b = bezier(easing);
  // Springs converted to linear() carry 15-digit stops; 3 decimals keep the shape.
  if (!b) return easing.replace(/\d+\.\d{4,}/g, (n) => fmt(Number(n)));
  const tw = TAILWIND_EASINGS.find(([curve]) => sameCurve(curve, b));
  if (tw) return `${curveText(b)}, ${tw[2]}`;
  return overshoots(b) ? `${curveText(b)}, overshoots (springy)` : curveText(b);
}

/** First duration in an animation shorthand, in ms. */
function firstDuration(animation: string): number | null {
  const m = animation.match(/(?:^|[\s(])(\d*\.?\d+)(ms|s)(?=$|[\s,)])/);
  return m ? Math.round(parseFloat(m[1]) * (m[2] === "ms" ? 1 : 1000)) : null;
}

function allEasings(m: Motion): string[] {
  const fromUsages = m.keyframes.flatMap((k) =>
    k.usedBy.flatMap((u) => [...(u.resolved ?? u.animation).matchAll(/cubic-bezier\([^)]+\)|\b(?:ease-in-out|ease-in|ease-out|ease|linear)\b/g)].map(([e]) => e)),
  );
  const fromScripts = [...m.scriptAnimations.map((a) => a.easing), ...m.triggered.filter((t) => t.type === "WebAnimation").map((t) => t.easing)];
  return [...m.transitions.map((t) => t.easing), ...m.animations.map((a) => a.easing), ...fromUsages, ...fromScripts];
}

/** Distinct curves in use, keyed by their numbers so `cubic-bezier(.4,0,.2,1)` and `(0.4, 0, 0.2, 1)` merge. */
function distinctCurves(m: Motion): { curve: Bezier; easing: string; slug: string }[] {
  const curves: { curve: Bezier; easing: string; slug: string }[] = [];
  let custom = 0;
  let springy = 0;
  for (const easing of allEasings(m)) {
    const curve = bezier(easing);
    if (!curve || curves.some((c) => sameCurve(c.curve, curve))) continue;
    const keyword = Object.entries(KEYWORD_EASINGS).find(([, b]) => sameCurve(b, curve))?.[0];
    const tw = TAILWIND_EASINGS.find(([b]) => sameCurve(b, curve));
    // CSS keywords get a prefix: Tailwind's own `ease-in-out` etc. are different curves.
    const slug = (keyword && `css-${keyword}`) ?? tw?.[1] ?? (overshoots(curve) ? `spring-${++springy}` : `curve-${++custom}`);
    curves.push({ curve, easing, slug });
  }
  return curves;
}

const ms = (n: number) => `${n}ms`;

function motionGuidance(m: Motion): string[] {
  const notes: string[] = [];
  const durations = [
    ...new Set([
      ...m.transitions.map((t) => t.duration),
      ...m.keyframes.flatMap((k) => k.usedBy.map((u) => firstDuration(u.resolved ?? u.animation) ?? 0)),
      ...m.triggered.filter((t) => t.type === "WebAnimation").map((t) => t.duration),
    ]),
  ]
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  if (durations.length) notes.push(`Durations in use: ${durations.map(ms).join(", ")}.`);

  const main = m.transitions[0];
  if (main) {
    notes.push(`The default UI transition is \`${main.property}\` over ${ms(main.duration)} with ${describeEasing(main.easing)}, on ${main.elements} element${main.elements === 1 ? "" : "s"}. Use it for hover and state changes.`);
  }

  const springy = m.keyframes.filter((k) =>
    k.usedBy.some((u) => {
      const curve = bezier((u.resolved ?? u.animation).match(/cubic-bezier\([^)]+\)/)?.[0] ?? "");
      return curve !== null && overshoots(curve);
    }),
  );
  if (springy.length) notes.push(`Overshooting (springy) curves give ${names(springy.map((k) => k.name))} a bounce; keep that curve rather than a plain ease-out.`);

  const entrances = m.keyframes.filter((k) => k.properties.includes("opacity") && k.usedBy.length && k.usedBy.every((u) => !/infinite/.test(u.animation)));
  const staggered = entrances.filter((k) => k.usedBy.some((u) => /calc\([^)]*\*/.test(u.resolved ?? u.animation)));
  if (entrances.length) {
    const others = [...new Set(entrances.flatMap((k) => k.properties.filter((p) => p !== "opacity")))];
    let note = `Enter and exit animations (${names(entrances.map((k) => k.name))}) animate opacity${others.length ? ` together with ${others.join(", ")}` : ""}.`;
    if (staggered.length) note += ` ${names(staggered.map((k) => k.name))} stagger${staggered.length === 1 ? "s" : ""} items with a per-index delay (\`calc(… * step)\`).`;
    notes.push(note);
  }

  const loops = m.keyframes.filter((k) => k.usedBy.some((u) => /\binfinite\b/.test(u.animation)));
  if (loops.length) notes.push(`Looping animations: ${names(loops.map((k) => k.name))}.`);

  if (m.viewTransitions) notes.push("Page navigations use the View Transitions API (`::view-transition-old/new`); replicate them with `document.startViewTransition` or your framework's view transitions.");

  if (m.reducedMotion.reduce.length) {
    notes.push(`Under \`prefers-reduced-motion: reduce\` the site switches off motion for ${m.reducedMotion.reduce.slice(0, 6).map((s) => `\`${s}\``).join(", ")}${m.reducedMotion.reduce.length > 6 ? ", …" : ""}. Do the same for every animation you add.`);
  } else if (m.keyframes.length || m.transitions.length) {
    notes.push("No `prefers-reduced-motion` handling was found. Add it anyway: make animations instant under `reduce`.");
  }

  const scripted = [...m.scriptAnimations.map((a) => ({ duration: a.duration, easing: a.easing })), ...m.triggered.filter((t) => t.type === "WebAnimation")];
  if (scripted.length) {
    const timings = [...new Set(scripted.map((a) => `${ms(Math.round(a.duration))} ${describeEasing(a.easing)}`))];
    notes.push(`Some motion comes from JavaScript (Web Animations API, e.g. Motion), not CSS: ${timings.slice(0, 5).join("; ")}. Match these timings in whatever animation library you use.`);
  }
  if (m.triggered.some((t) => /^linear\(.+,.+,.+\)/.test(t.easing))) {
    notes.push("A `linear(…)` easing with many stops is usually a spring converted to CSS; keep it as is, or use a spring with a similar feel.");
  }

  const hoverProps = [...new Set(m.triggered.filter((t) => t.trigger === "hover" && t.type === "CSSTransition").map((t) => t.name.replace(/-(top|right|bottom|left)-/, "-")))];
  if (hoverProps.length) notes.push(`On hover, transitions actually animate: ${hoverProps.join(", ")}.`);
  const onScroll = [...new Set(m.triggered.filter((t) => t.trigger === "scroll" && t.type === "CSSAnimation").map((t) => t.name))];
  if (onScroll.length) notes.push(`${names(onScroll)} play${onScroll.length === 1 ? "s" : ""} as elements scroll into view.`);

  for (const st of m.scriptedStyles.slice(0, 3)) {
    const when = st.trigger === "continuous" ? "continuously" : `on ${st.trigger}`;
    notes.push(`\`${st.element}\` is animated frame by frame from JavaScript ${when} (${st.properties.join(", ")}, ${st.writes} updates over ${ms(st.span)}). Its curve isn't in the CSS; recreate it with a JS animation or a CSS transition of similar length.`);
  }

  if (m.interaction.ran && !m.interaction.completed) {
    notes.push(`The scroll-and-hover pass stopped early (${m.interaction.note}), so motion triggered by interaction may be incomplete. Everything visible at load is still included.`);
  } else if (!m.interaction.ran) {
    notes.push("Scrolling and hovering were skipped, so motion that only starts on interaction isn't included.");
  }
  return [...new Set(notes)];
}

/** The motion section of a DESIGN.md: transitions, keyframes, reduced motion, then agent guidance. */
export function motionToDesignMd(m: Motion, page: { url: string; title: string }): string {
  const lines = [
    `# Motion — ${page.title || page.url}`,
    "",
    `Extracted by kolophon from ${page.url}. Transitions are computed values; keyframes and their timing come from the stylesheets, with CSS variables resolved.`,
    "",
    "## Transitions",
    "",
  ];
  if (m.transitions.length) {
    lines.push("| Property | Duration | Easing | Delay | Elements | Used on |", "| --- | --- | --- | --- | --- | --- |");
    for (const t of m.transitions.slice(0, MAX_STYLES)) {
      lines.push(`| ${cell(t.property)} | ${ms(t.duration)} | ${cell(describeEasing(t.easing))} | ${ms(t.delay)} | ${t.elements} | ${t.tags.join(", ")} |`);
    }
  } else lines.push("None found at load.");

  lines.push("", "## Keyframe animations", "");
  if (m.keyframes.length) {
    lines.push("| Name | Animates | Used by | Timing |", "| --- | --- | --- | --- |");
    for (const k of m.keyframes) {
      const used = k.usedBy[0];
      const more = k.usedBy.length > 1 ? ` (+${k.usedBy.length - 1})` : "";
      lines.push(`| \`${k.name}\` | ${k.properties.join(", ")} | ${used ? `\`${cell(used.selector)}\`${more}` : "—"} | ${used ? `\`${cell(used.resolved ?? used.animation)}\`` : "—"} |`);
    }
  } else lines.push("None found.");

  lines.push("", "## Triggered by interaction", "");
  if (!m.interaction.ran) lines.push("Skipped.");
  else {
    lines.push(
      `Kolophon scrolled ${m.interaction.scrolledPx}px and hovered ${m.interaction.hovered} controls${m.interaction.completed ? "" : ` before stopping early: ${m.interaction.note}`}.`,
      "",
    );
    if (m.triggered.length) {
      lines.push("| Trigger | Type | Animation | Duration | Easing | Count |", "| --- | --- | --- | --- | --- | --- |");
      for (const t of m.triggered.slice(0, MAX_STYLES)) {
        lines.push(`| ${t.trigger} | ${t.type} | ${t.name ? `\`${cell(t.name)}\`` : "—"} | ${ms(t.duration)} | ${cell(describeEasing(t.easing)).slice(0, 160)} | ${t.count} |`);
      }
    } else lines.push("No animations started.");
    if (m.scriptedStyles.length) {
      lines.push("", "Animated frame by frame from JavaScript:", "", "| Element | Trigger | Properties | Updates | Over |", "| --- | --- | --- | --- | --- |");
      for (const st of m.scriptedStyles) lines.push(`| \`${cell(st.element)}\` | ${st.trigger} | ${st.properties.join(", ")} | ${st.writes} | ${ms(st.span)} |`);
    }
  }

  lines.push("", "## Reduced motion", "");
  lines.push(
    m.reducedMotion.reduce.length
      ? `Restyled under \`prefers-reduced-motion: reduce\`: ${m.reducedMotion.reduce.map((s) => `\`${cell(s)}\``).join(", ")}.`
      : "No `prefers-reduced-motion: reduce` rules found.",
  );
  if (m.reducedMotion.noPreference.length) {
    lines.push("", `Only animated under \`no-preference\`: ${m.reducedMotion.noPreference.map((s) => `\`${cell(s)}\``).join(", ")}.`);
  }

  lines.push("", "## Agent guidance", "", ...motionGuidance(m).map((n) => `- ${n}`), "");
  return lines.join("\n");
}

/** W3C Design Tokens (DTCG): durations, easing curves and the main transitions. */
export function motionToTokens(m: Motion): object {
  const curves = distinctCurves(m);
  const durationTokens = Object.fromEntries(
    [...new Set([...m.transitions.map((t) => t.duration), ...m.triggered.filter((t) => t.type === "WebAnimation").map((t) => t.duration)])].sort((a, b) => a - b).map((d) => [String(d), { $type: "duration", $value: { value: d, unit: "ms" } }]),
  );
  const easing = Object.fromEntries(curves.map((c) => [c.slug, { $type: "cubicBezier", $value: c.curve }]));
  const transitionSlugs = uniqueSlugs(m.transitions.slice(0, MAX_STYLES), (t) => `${slug(t.property)}-${t.duration}`);
  const transition = Object.fromEntries(
    [...transitionSlugs].map(([t, s]) => {
      const curve = curves.find((c) => bezier(t.easing) && sameCurve(c.curve, bezier(t.easing)!));
      return [
        s,
        {
          $type: "transition",
          $value: {
            duration: { value: t.duration, unit: "ms" },
            delay: { value: t.delay, unit: "ms" },
            timingFunction: curve ? `{easing.${curve.slug}}` : [0, 0, 1, 1],
          },
        },
      ];
    }),
  );
  return { duration: durationTokens, easing, transition };
}

/** Tailwind v4 `@theme` block: easing curves, then each keyframes animation with its timing. */
export function motionToTailwind(m: Motion): string {
  const lines = ["@theme {"];
  // Tailwind already ships `ease-linear`.
  for (const c of distinctCurves(m).filter((c) => c.slug !== "css-linear")) lines.push(`  --ease-${c.slug}: ${curveText(c.curve)};`);
  const used = m.keyframes.filter((k) => k.usedBy.length).slice(0, MAX_STYLES);
  for (const k of used) lines.push(`  --animate-${slug(k.name)}: ${k.usedBy[0].resolved ?? k.usedBy[0].animation};`);
  for (const k of used) lines.push("", `  @keyframes ${k.name} {`, `    ${k.css}`, "  }");
  lines.push("}");
  return lines.join("\n");
}
