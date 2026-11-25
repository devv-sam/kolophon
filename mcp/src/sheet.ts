import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { Page } from "puppeteer-core";
import type { Motion } from "./motion.js";
import {
  bezier,
  describeEasing,
  distinctCurves,
  firstDuration,
  motionGuidance,
  overshoots,
  tailwindWeight,
  typographyGuidance,
} from "./output.js";
import type { FontFamily, TextStyle, Typography } from "./typography.js";

// shortcut: shows the 10 most-used styles, 12 keyframes and 8 curves; raise if sheets feel thin.
const LIMITS = { styles: 10, keyframes: 12, curves: 8 };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const px = (v: string) => parseFloat(v) || 0;
const r = (n: number, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d);
/** Guidance notes use markdown `**bold**` and `code`; this turns them into escaped HTML. */
const md = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");

/** A section title drawn as a selected frame: hairline outline, square corner handles and a tag. */
function frame(title: string, tag: string, note: string): string {
  return `<header class="frame"><i class="h tl"></i><i class="h tr"></i><i class="h bl"></i><i class="h br"></i>
    <h2>${esc(title)}</h2><p>${esc(note)}</p><span class="tag">${esc(tag)}</span></header>`;
}

function familyCard(f: FontFamily, styles: TextStyle[], total: number): string {
  const mine = styles.filter((s) => s.family === f.stack);
  const weight = mine[0]?.weight ?? "400";
  const status = f.fallback
    ? `<span class="badge warn">${f.webFont ? "Failed to load" : "Not installed"} · ${esc(f.rendered.map((x) => x.name).join(", ") || "fallback")} rendered</span>`
    : `<span class="badge">${f.webFont ? "Web font" : "Local font"}</span>`;
  const used = [...new Set(mine.map((s) => Number(s.weight)))];
  const axes = f.axes
    .map((a) => {
      const span = a.max - a.min || 1;
      const at = (v: number) => `${r(((v - a.min) / span) * 100)}%`;
      const ticks = a.tag === "wght" ? used.filter((w) => w >= a.min && w <= a.max).map((w) => `<i class="tick" style="left:${at(w)}" title="${w}"></i>`).join("") : "";
      return `<div class="axis"><span class="mono">${esc(a.tag)}</span><div class="track">${ticks}<i class="dot" style="left:${at(a.default)}"></i></div>
        <span class="mono muted">${r(a.min)}–${r(a.max)}</span></div>`;
    })
    .join("");
  return `<article class="card family">
    <div class="specimen" style="font-family:${esc(f.stack)};font-weight:${esc(weight)}">Aa</div>
    <div class="meta">
      <h3>${esc(f.name)}</h3>
      <div class="row">${status}<span class="muted">${Math.round((f.chars / total) * 100)}% of text</span></div>
      ${axes ? `<div class="axes">${axes}</div>` : `<p class="muted small">Static font${f.variable ? "" : " · no variation axes"}</p>`}
      <p class="mono small muted stack">${esc(f.stack)}</p>
    </div></article>`;
}

function styleRow(s: TextStyle, total: number): string {
  const size = px(s.size);
  const lh = s.lineHeight === "normal" ? "normal" : `${s.lineHeight} (${r(px(s.lineHeight) / size)})`;
  const spec = [
    ["Size", s.size],
    ["Weight", `${s.weight} / ${tailwindWeight(Number(s.weight)).replace("font-", "")}`],
    ["Line height", lh],
    ["Tracking", s.letterSpacing],
    ["Used on", s.tags.join(", ")],
    ["Share", `${Math.round((s.chars / total) * 100)}%`],
  ];
  // Sizes above 72px are shown at 72px so one style can't swallow the page; the spec keeps the real value.
  const shown = Math.min(size, 72);
  const style = `font-family:${esc(s.family)};font-weight:${esc(s.weight)};font-size:${shown}px;line-height:${s.lineHeight === "normal" ? "normal" : r((px(s.lineHeight) / size) * shown) + "px"};letter-spacing:${esc(s.letterSpacing)};font-style:${esc(s.style)};${s.variationSettings !== "normal" ? `font-variation-settings:${esc(s.variationSettings)};` : ""}`;
  return `<div class="style"><div class="sample" style="${style}">${esc(s.sample || "Sample text")}</div>
    <dl>${spec.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>`;
}

/** An easing curve plotted inside a faint dashed square; overshooting curves leave the square. */
function curveCard(easing: string, uses: string[]): string {
  const b = bezier(easing);
  // The square spans 20..100 so overshoot (y > 1 or < 0) has room above and below.
  const X = (x: number) => Number(r(20 + x * 80));
  const Y = (y: number) => Number(r(100 - y * 80));
  let path: string;
  let handles = "";
  if (b) {
    path = `M${X(0)} ${Y(0)} C${X(b[0])} ${Y(b[1])} ${X(b[2])} ${Y(b[3])} ${X(1)} ${Y(1)}`;
    handles = `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(b[0])}" y2="${Y(b[1])}" class="handle"/><line x1="${X(1)}" y1="${Y(1)}" x2="${X(b[2])}" y2="${Y(b[3])}" class="handle"/>
      <rect x="${X(b[0]) - 2}" y="${Y(b[1]) - 2}" width="4" height="4" class="knob"/><rect x="${X(b[2]) - 2}" y="${Y(b[3]) - 2}" width="4" height="4" class="knob"/>`;
  } else {
    // linear(…) stops: "value position%" pairs; stops without a position are spread evenly.
    const stops = (easing.match(/linear\((.*)\)/)?.[1] ?? "0, 1").split(",").map((s) => s.trim().split(/\s+/));
    path = stops
      .map(([v, pos], i) => `${i ? "L" : "M"}${r(X(pos ? parseFloat(pos) / 100 : i / (stops.length - 1)))} ${r(Y(parseFloat(v)))}`)
      .join(" ");
  }
  // A linear() spring's stops are plotted; spelling them out under the curve would be a wall of numbers.
  const label = b ? describeEasing(easing).replace(/^cubic-bezier\(([^)]+)\)(, )?/, "") : "spring, converted to CSS";
  const springy = (b && overshoots(b)) || /linear\(/.test(easing);
  return `<figure class="curve${springy ? " springy" : ""}">
    <svg viewBox="0 0 120 120"><rect x="20" y="20" width="80" height="80" class="proto"/>${handles}<path d="${path}" class="line"/>
      <circle cx="${X(0)}" cy="${Y(0)}" r="2.2" class="end"/><circle cx="${X(1)}" cy="${Y(1)}" r="2.2" class="end"/></svg>
    <figcaption><span class="mono small">${esc(b ? `cubic-bezier(${b.map((n) => r(n, 3)).join(", ")})` : "linear(…) spring")}</span>
      ${label ? `<span class="small">${md(label)}</span>` : ""}<span class="muted small">${esc(uses.slice(0, 3).join(", "))}</span></figcaption></figure>`;
}

function durationBars(m: Motion): string {
  const entries = new Map<number, Set<string>>();
  const add = (ms: number, what: string) => ms > 0 && (entries.get(ms) ?? entries.set(ms, new Set()).get(ms)!).add(what);
  m.transitions.forEach((t) => add(t.duration, `${t.property} transition`));
  m.keyframes.forEach((k) => k.usedBy.forEach((u) => add(firstDuration(u.resolved ?? u.animation) ?? 0, k.name)));
  m.triggered.filter((t) => t.type === "WebAnimation").forEach((t) => add(t.duration, "JS animation"));
  const sorted = [...entries].sort(([a], [b]) => a - b).slice(0, 12);
  if (!sorted.length) return "";
  const max = Math.log(Math.max(...sorted.map(([d]) => d)) + 1);
  return `<div class="durations">${sorted
    .map(([d, uses]) => `<div class="dur"><span class="mono">${d}ms</span><div class="bar"><i style="width:${(Math.log(d + 1) / max) * 100}%"></i></div>
      <span class="muted small">${esc([...uses].slice(0, 3).join(", "))}</span></div>`)
    .join("")}</div>`;
}

function keyframeCard(k: Motion["keyframes"][number], similar: number): string {
  const u = k.usedBy[0];
  const name = similar > 1 ? `${k.name.replace(/\d+/g, "#")} ×${similar}` : k.name;
  return `<article class="card kf"><div class="row"><h4 class="mono">@${esc(name)}</h4>${k.usedBy.length ? "" : `<span class="badge">unused here</span>`}</div>
    <div class="chips">${k.properties.map((p) => `<span class="chip">${esc(p)}</span>`).join("")}</div>
    ${u ? `<p class="mono small">${esc(u.resolved ?? u.animation)}</p><p class="muted small">on <code>${esc(u.selector)}</code></p>` : ""}</article>`;
}

/** The design sheet as a standalone HTML fragment with its own styles, ready for a shadow root. */
export function renderSheet(t: Typography, m: Motion, page: { url: string; title: string }): string {
  const total = t.families.reduce((sum, f) => sum + f.chars, 0) || 1;
  // The most-used styles, shown largest first so the list reads as a type scale.
  const styles = t.styles.slice(0, LIMITS.styles).sort((a, b) => px(b.size) - px(a.size) || Number(b.weight) - Number(a.weight));
  const curves = distinctCurves(m).slice(0, LIMITS.curves);
  const curveUses = (easing: string) => {
    const b = bezier(easing);
    const sameAs = (e: string) => e === easing || (b !== null && bezier(e)?.every((v, i) => Math.abs(v - b[i]) < 0.001));
    return [
      ...m.transitions.filter((x) => sameAs(x.easing)).map((x) => `${x.property} ${x.duration}ms`),
      ...m.keyframes.filter((k) => k.usedBy.some((u) => (u.resolved ?? u.animation).includes(easing.replace(/\s/g, "")) || (u.resolved ?? u.animation).includes(easing))).map((k) => k.name),
    ];
  };
  // Generated families like grid-dot-0-0-upDown … grid-dot-4-4-upDown fold into one card with a count.
  const groups = new Map<string, [Motion["keyframes"][number], number]>();
  for (const k of m.keyframes) {
    const key = k.name.replace(/\d+/g, "#");
    const seen = groups.get(key);
    if (seen) seen[1]++;
    else groups.set(key, [k, 1]);
  }
  const keyframeGroups = [...groups.values()];
  const springs = [...new Set(m.triggered.map((x) => x.easing).filter((e) => /^linear\(.+,.+,.+\)/.test(e)))].slice(0, 2);
  const reduced = m.reducedMotion.reduce.length
    ? `<span class="badge ok">Respects reduced motion · ${m.reducedMotion.reduce.length} rule${m.reducedMotion.reduce.length === 1 ? "" : "s"}</span>`
    : `<span class="badge warn">No reduced-motion handling found</span>`;
  // One row per animation, with border-top/right/bottom/left-color folded into border-color.
  const rows = new Map<string, Motion["triggered"][number]>();
  for (const x of m.triggered) {
    const name = x.type === "WebAnimation" ? "JS animation" : x.name.replace(/-(top|right|bottom|left)-/, "-");
    const key = [x.trigger, name, x.duration, x.easing].join("|");
    const seen = rows.get(key);
    if (seen) seen.count = Math.max(seen.count, x.count);
    else rows.set(key, { ...x, name });
  }
  const triggered = [...rows.values()].slice(0, 8);
  const curveOnly = (e: string) => {
    const b = bezier(e);
    return b ? `cubic-bezier(${b.map((n) => r(n, 3)).join(", ")})` : /^linear\(/.test(e) ? "linear(…) spring" : e;
  };
  const summary = [
    `${t.families.length} famil${t.families.length === 1 ? "y" : "ies"}`,
    `${t.styles.length} text styles`,
    `${m.transitions.length} transitions`,
    `${m.keyframes.length} keyframes`,
    m.interaction.ran ? `${m.triggered.length} triggered on interaction` : "interactions skipped",
  ];

  return `<style>${SHEET_CSS}</style><main class="sheet">
  <header class="cover">
    <div class="mark">kolophon <span class="muted">design sheet</span></div>
    <h1>${esc(page.title || page.url)}</h1>
    <p class="mono muted">${esc(page.url)} · ${new Date().toISOString().slice(0, 10)}</p>
    <div class="chips">${summary.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>
  </header>

  <section>
    ${frame("Type", "Typography", "What Chrome rendered, in the page's own fonts. Variable axes show their range, the default (dot) and the weights in use (ticks).")}
    <div class="grid families">${t.families.slice(0, 4).map((f) => familyCard(f, t.styles, total)).join("")}</div>
    <h3 class="sub">Type scale <span class="muted">· the ${styles.length} most-used styles, largest first</span></h3>
    <div class="styles">${styles.map((s) => styleRow(s, total)).join("")}</div>
  </section>

  <section>
    ${frame("Motion", "Motion", "Easing curves sit in a dashed unit square: springy curves break out of it. Durations are on a log scale.")}
    ${curves.length || springs.length ? `<h3 class="sub">Easing</h3><div class="grid curves">${[...curves.map((c) => curveCard(c.easing, curveUses(c.easing))), ...springs.map((e) => curveCard(e, ["JS animation"]))].join("")}</div>` : ""}
    ${durationBars(m) ? `<h3 class="sub">Durations</h3>${durationBars(m)}` : ""}
    ${keyframeGroups.length ? `<h3 class="sub">Keyframes</h3><div class="grid kfs">${keyframeGroups.slice(0, LIMITS.keyframes).map(([k, n]) => keyframeCard(k, n)).join("")}</div>` : ""}
    ${triggered.length || m.scriptedStyles.length ? `<h3 class="sub">On scroll and hover</h3><div class="triggered">${triggered
      .map((x) => `<div class="trig"><span class="chip">${x.trigger}</span><span class="mono">${esc(x.name)}</span><span class="mono muted">${x.duration}ms · ${esc(curveOnly(x.easing))}</span><span class="muted">×${x.count}</span></div>`)
      .join("")}${m.scriptedStyles
      .slice(0, 4)
      .map((st) => `<div class="trig"><span class="chip">${st.trigger}</span><span class="mono">${esc(st.element)}</span><span class="mono muted">JS frame by frame · ${esc(st.properties.slice(0, 3).join(", "))} · ${st.span}ms</span><span class="muted">${st.writes} updates</span></div>`)
      .join("")}</div>` : ""}
    <div class="row status">${reduced}${m.viewTransitions ? `<span class="badge">View Transitions</span>` : ""}${m.interaction.ran && !m.interaction.completed ? `<span class="badge warn">Interaction pass stopped early</span>` : ""}</div>
  </section>

  <section>
    ${frame("Notes", "For agents", "Deterministic guidance derived from the values above.")}
    <div class="grid notes"><div><h3 class="sub">Typography</h3><ul>${typographyGuidance(t).map((n) => `<li>${md(n)}</li>`).join("")}</ul></div>
      <div><h3 class="sub">Motion</h3><ul>${motionGuidance(m).map((n) => `<li>${md(n)}</li>`).join("")}</ul></div></div>
  </section>
  <footer class="muted small">Generated by kolophon from ${esc(page.url)}. Values are what Chrome rendered, not what the stylesheets declared.</footer>
</main>`;
}

const SHEET_CSS = `
:host { all: initial; }
.sheet { --paper:#fafaf7; --ink:#141414; --muted:#6e6e6a; --line:#e3e2dc; --accent:#ff4d2e; --ok:#1d7a46; --warn:#b4471b;
  width:1200px; box-sizing:border-box; padding:64px; background:var(--paper); color:var(--ink);
  font:14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing:antialiased; }
.sheet * { box-sizing:border-box; }
.mono, code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size:12px; }
code { background:#efeee8; padding:1px 4px; border-radius:3px; }
.muted { color:var(--muted); } .small { font-size:12px; }
h1,h2,h3,h4,p { margin:0; }
.cover { padding-bottom:40px; border-bottom:1px solid var(--line); margin-bottom:56px; }
.mark { font-weight:600; letter-spacing:-0.01em; margin-bottom:48px; }
.cover h1 { font-size:56px; line-height:1.05; letter-spacing:-0.03em; font-weight:700; margin-bottom:12px; }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:16px; }
.chip { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 10px; font-size:12px; background:#fff; }
section { margin-bottom:72px; break-inside:auto; }
.frame { position:relative; border:1px solid var(--accent); padding:20px 24px; margin-bottom:32px; }
.frame h2 { font-size:32px; letter-spacing:-0.02em; } .frame p { color:var(--muted); max-width:640px; margin-top:4px; }
.frame .h { position:absolute; width:7px; height:7px; background:#fff; border:1px solid var(--accent); }
.tl{left:-4px;top:-4px}.tr{right:-4px;top:-4px}.bl{left:-4px;bottom:-4px}.br{right:-4px;bottom:-4px}
.frame .tag { position:absolute; right:-1px; top:-24px; background:var(--accent); color:#fff; font-size:11px; padding:2px 8px; }
.sub { font-size:13px; text-transform:uppercase; letter-spacing:0.06em; margin:40px 0 16px; font-weight:600; }
.grid { display:grid; gap:16px; } .families { grid-template-columns:1fr 1fr; } .curves { grid-template-columns:repeat(4, minmax(0, 1fr)); }
.kfs { grid-template-columns:repeat(3, minmax(0, 1fr)); } .kf p { overflow-wrap:anywhere; } .notes { grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); gap:40px; }
.card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:20px; break-inside:avoid; }
.family { display:flex; gap:24px; align-items:flex-start; }
.specimen { font-size:96px; line-height:1; min-width:140px; letter-spacing:-0.02em; }
.meta { flex:1; display:flex; flex-direction:column; gap:8px; min-width:0; } .meta h3 { font-size:20px; letter-spacing:-0.01em; }
.row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.badge { font-size:11px; border-radius:4px; padding:2px 8px; background:#efeee8; } .badge.warn { background:#fde8de; color:var(--warn); } .badge.ok { background:#dff2e6; color:var(--ok); }
.stack { overflow-wrap:anywhere; }
.axes { display:flex; flex-direction:column; gap:6px; }
.axis { display:grid; grid-template-columns:40px 1fr 80px; gap:10px; align-items:center; }
.track { position:relative; height:2px; background:var(--line); }
.track .dot { position:absolute; top:-4px; width:10px; height:10px; margin-left:-5px; border-radius:50%; background:var(--ink); }
.track .tick { position:absolute; top:-6px; width:2px; height:14px; margin-left:-1px; background:var(--accent); }
.styles { border-top:1px solid var(--line); }
.style { padding:20px 0; border-bottom:1px solid var(--line); break-inside:avoid; }
.sample { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:10px; }
dl { display:flex; flex-wrap:wrap; gap:4px 24px; margin:0; font-size:12px; }
dl div { display:flex; gap:6px; } dt { color:var(--muted); } dd { margin:0; font-family:ui-monospace, Menlo, monospace; }
.curve { margin:0; background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px; break-inside:avoid; }
.curve svg { width:100%; display:block; overflow:visible; }
.proto { fill:none; stroke:#c9c8c0; stroke-dasharray:3 3; stroke-width:0.8; }
.handle { stroke:#b5b4ac; stroke-width:0.6; } .knob { fill:#fff; stroke:var(--accent); stroke-width:0.8; }
.line { fill:none; stroke:var(--ink); stroke-width:1.8; stroke-linecap:round; } .springy .line { stroke:var(--accent); }
.end { fill:var(--ink); }
.curve figcaption { display:flex; flex-direction:column; gap:2px; margin-top:8px; }
.durations { display:flex; flex-direction:column; gap:8px; }
.dur { display:grid; grid-template-columns:70px 1fr 280px; gap:12px; align-items:center; }
.bar { height:8px; background:#efeee8; border-radius:4px; overflow:hidden; } .bar i { display:block; height:100%; background:var(--ink); border-radius:4px; }
.kf h4 { font-size:13px; } .kf { display:flex; flex-direction:column; gap:8px; } .kf .chips { margin:0; }
.triggered { display:flex; flex-direction:column; border-top:1px solid var(--line); }
.trig { display:grid; grid-template-columns:90px 260px 1fr 90px; gap:12px; align-items:center; padding:10px 0; border-bottom:1px solid var(--line); }
.trig > * { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.status { margin-top:24px; }
ul { margin:0; padding-left:18px; display:flex; flex-direction:column; gap:8px; } li { line-height:1.5; overflow-wrap:anywhere; }
footer { border-top:1px solid var(--line); padding-top:16px; }
@media print { .sheet { padding:40px; } }
`;

/**
 * Shows the sheet in place of the page (so the page's @font-face fonts render the specimens), then
 * screenshots it as a PNG and, when asked, prints a PDF to `pdfPath`.
 */
export async function captureSheet(page: Page, html: string, pdfPath?: string): Promise<{ png: string; pdfPath?: string }> {
  if (pdfPath !== undefined && (!isAbsolute(pdfPath) || !pdfPath.toLowerCase().endsWith(".pdf"))) {
    throw new Error(`pdf_path must be an absolute path ending in .pdf, got ${pdfPath}`);
  }
  await page.setViewport({ width: 1200, height: 900 });
  await page.evaluate((html: string) => {
    // A shadow root keeps the page's styles out while its @font-face rules (document-wide) still apply.
    for (const el of document.body.children) (el as HTMLElement).style.setProperty("display", "none", "important");
    document.documentElement.style.setProperty("scrollbar-width", "none", "important"); // Keeps the full 1200px.
    for (const el of [document.documentElement, document.body]) {
      el.style.setProperty("overflow", "visible", "important");
      el.style.setProperty("height", "auto", "important");
      el.style.setProperty("margin", "0", "important");
      el.style.setProperty("background", "#fafaf7", "important");
    }
    const host = document.createElement("div");
    host.id = "kolophon-sheet";
    host.style.cssText = "all: initial; display: block !important; position: relative; z-index: 2147483647;";
    host.attachShadow({ mode: "open" }).innerHTML = html;
    document.body.append(host);
    window.scrollTo(0, 0);
  }, html);
  await page.evaluate(() => document.fonts.ready);
  const host = await page.$("#kolophon-sheet");
  if (!host) throw new Error("the design sheet could not be added to the page");
  const png = (await host.screenshot({ type: "png", encoding: "base64" })) as string;

  if (pdfPath) {
    const height = await page.evaluate(() => document.getElementById("kolophon-sheet")!.getBoundingClientRect().height);
    // One tall page keeps the layout exactly as on screen, with no awkward breaks mid-section.
    const pdf = await page.pdf({ width: "1200px", height: `${Math.ceil(height) + 2}px`, printBackground: true, pageRanges: "1" });
    await writeFile(pdfPath, pdf);
  }
  return { png, pdfPath };
}
