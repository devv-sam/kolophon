import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BASELINE_FILE, BASELINE_VERSION, serialize, toView, type Baseline } from "./baseline.js";
import { VIEWPORTS, withPage } from "./browser.js";
import { hiddenText } from "./compare.js";
import { getMotion, type Motion } from "./motion.js";
import { getTypography, type Typography } from "./typography.js";

/** Splits the pages to measure into one origin and their paths. Throws on anything that can't be a baseline. */
export function parseUrls(urls: string[]): { baseUrl: string; paths: string[] } {
  const parsed = urls.map((url) => {
    if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
      throw new Error(`${url} isn't an http or https URL. Include the scheme, e.g. http://localhost:3000/`);
    }
    const u = new URL(url);
    // The baseline is committed, so it must not hold credentials.
    if (u.username || u.password) throw new Error("URLs with a username or password aren't supported.");
    return u;
  });
  const origins = new Set(parsed.map((u) => u.origin));
  if (origins.size > 1) throw new Error(`All pages must be on one origin, got ${[...origins].join(" and ")}`);
  return { baseUrl: parsed[0].origin, paths: [...new Set(parsed.map((u) => u.pathname + u.search + u.hash))] };
}

/** Measures one page. A page without text is an error: it's more likely broken than empty by design. */
export async function measurePage(url: string, name: string): Promise<{ t: Typography; m: Motion | null }> {
  const { t, m } = await withPage(
    url,
    async (page) => {
      const t = await getTypography(page);
      try {
        return { t, m: await getMotion(page) };
      } catch (err) {
        // Keeps the typography.
        t.unmeasured.push(`Motion could not be read: ${(err as Error).message}`);
        return { t, m: null };
      }
    },
    VIEWPORTS[name as keyof typeof VIEWPORTS],
  );
  if (!t.styles.length) throw new Error(`${url} shows no text at the ${name} viewport, so there is nothing to measure.`);
  return { t, m };
}

/** What a person should look at before committing, one line each. */
function concerns(where: string, t: Typography, m: Motion): string[] {
  const lines: string[] = [];
  for (const s of t.styles) {
    const label = `${s.family} ${s.size} weight ${s.weight} at ${s.selector}`;
    if (s.fallbackGlyphs) {
      const glyphs = s.rendered.reduce((sum, f) => sum + f.glyphs, 0);
      const drawn = s.rendered.map((f) => f.name).join(", ");
      lines.push(`${where}: ${s.fallbackGlyphs} of ${glyphs} glyphs fell back (drawn with ${drawn}): ${label}`);
    }
    if (s.weightCovered === false) lines.push(`${where}: no loaded font face covers the weight: ${label}`);
  }
  for (const f of t.families) {
    if (!f.axes) lines.push(`${where}: a font file of ${f.name} could not be read, so its variable axes are unknown`);
    for (const face of f.faces) if (face.status === "error") lines.push(`${where}: font face failed to load: ${f.name} ${face.weight} ${face.style}`);
  }
  for (const a of m.animations) if (!a.keyframes.length) lines.push(`${where}: animation ${a.name} has no @keyframes, so nothing moves: at ${a.selector}`);
  const still = m.reduced.transitions.length + m.reduced.animations.filter((a) => a.keyframes.length).length;
  if (still) lines.push(`${where}: ${still} of ${m.transitions.length + m.animations.length} transitions and animations still run when the user asks for reduced motion`);
  if (t.hidden) lines.push(`${where}: hidden at load, so not measured: ${hiddenText(t.hidden)}`);
  return [...lines, ...t.unmeasured.map((u) => `${where}: not measured: ${u}`)];
}

const exists = (file: string) =>
  stat(file).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return false;
      throw err;
    },
  );

/** Measures every page at every viewport and writes the baseline into `dir`. Writes nothing if any page fails. */
export async function snapshot(urls: string[], { dir, update }: { dir: string; update: boolean }): Promise<string> {
  const { baseUrl, paths } = parseUrls(urls);
  const file = join(dir, BASELINE_FILE);
  const refusal = `${BASELINE_FILE} already exists, and replacing it is the developer's decision. Don't replace it to make a check pass. If the developer asked for a new baseline, use --update.`;
  const replacing = await exists(file);
  if (replacing && !update) throw new Error(refusal);

  const baseline: Baseline = { version: BASELINE_VERSION, baseUrl, viewports: VIEWPORTS, pages: {} };
  const look: string[] = [];
  const measured: string[] = [];
  for (const path of paths) {
    baseline.pages[path] = {};
    for (const name of Object.keys(VIEWPORTS)) {
      const { t, m } = await measurePage(baseUrl + path, name);
      if (!m) throw new Error(`${baseUrl + path} (${name}): ${t.unmeasured.at(-1)}`);
      const view = toView(t, m);
      baseline.pages[path][name] = view;
      measured.push(`${path} (${name}): ${view.styles.length} text styles, ${view.fonts.length} fonts, ${view.motion.transitions.length} transitions, ${view.motion.animations.length} animations`);
      look.push(...concerns(`${path} (${name})`, t, m));
    }
  }

  let dropped: string[] = [];
  if (replacing) {
    try {
      dropped = Object.keys((JSON.parse(await readFile(file, "utf8")) as Baseline).pages).filter((p) => !(p in baseline.pages));
    } catch {
      dropped = []; // An unreadable baseline is what --update replaces.
    }
  }

  if (update) {
    // Written beside the file and moved over it, so a crash can't leave half a baseline.
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, serialize(baseline), { flag: "wx" });
      await rename(temp, file);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  } else {
    // wx: another run may have written one while this one measured.
    await writeFile(file, serialize(baseline), { flag: "wx" }).catch((err: NodeJS.ErrnoException) => {
      throw err.code === "EEXIST" ? new Error(refusal) : err;
    });
  }

  return [
    `${replacing ? "Replaced" : "Wrote"} ${BASELINE_FILE}`,
    ...measured.map((m) => `  ${m}`),
    ...(dropped.length ? ["", "No longer in the baseline:", ...dropped.map((p) => `  ${p}`)] : []),
    ...(look.length ? ["", "Look at these before committing, since the baseline records them as they are:", ...look.map((l) => `  ${l}`)] : []),
    "",
    `Next: a person reviews ${BASELINE_FILE} and commits it.`,
  ].join("\n");
}
