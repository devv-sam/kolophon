import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BASELINE_FILE, parseBaseline } from "./baseline.js";
import { VIEWPORTS } from "./browser.js";
import { compare, type Finding } from "./compare.js";
import { measurePage, parseUrls } from "./snapshot.js";

export interface PageResult {
  path: string;
  viewport: string;
  drift: Finding[];
  notes: string[];
  unmeasured: string[];
}

// shortcut: shows 5 places and 5 of each other list per finding; raise it if agents need more to find the cause.
const MAX_ITEMS = 5;

/** Lists things seen on several pages and viewports once each, with where they were seen. */
function places(items: { path: string; viewport: string; text: string }[]): string[] {
  const seen = new Map<string, { path: string; text: string; viewports: Set<string> }>();
  for (const { path, viewport, text } of items) {
    const key = JSON.stringify([path, text]);
    const place = seen.get(key) ?? { path, text, viewports: new Set<string>() };
    seen.set(key, place);
    place.viewports.add(viewport);
  }
  return [...seen.values()].map((p) => `${p.path} (${[...p.viewports].join(", ")}): ${p.text}`);
}

const limit = (lines: string[]) => (lines.length > MAX_ITEMS ? [...lines.slice(0, MAX_ITEMS), `and ${lines.length - MAX_ITEMS} more`] : lines);
const unique = (lines: string[]) => [...new Set(lines)];

/** The report and its exit code: 0 no drift, 1 drift, 2 something couldn't be checked and no drift was found. */
export function report(results: PageResult[]): { code: 0 | 1 | 2; text: string } {
  const causes = new Map<string, { path: string; viewport: string; finding: Finding }[]>();
  for (const { path, viewport, drift } of results) {
    for (const finding of drift) causes.set(finding.cause, [...(causes.get(finding.cause) ?? []), { path, viewport, finding }]);
  }
  const blocks = [...causes.values()].map((group) => {
    const where = places(group.flatMap(({ path, viewport, finding }) => finding.where.map((text) => ({ path, viewport, text }))));
    return [
      ...limit(unique(group.map((g) => g.finding.found))).map((f, i) => `${i ? "  also" : "DRIFT "} ${f}`),
      ...limit(where).map((w) => `  at   ${w}`),
      ...limit(unique(group.flatMap((g) => g.finding.hints))).map((h) => `  hint ${h}`),
      ...unique(group.map((g) => g.finding.fix)).map((f) => `  fix  ${f}`),
    ].join("\n");
  });
  const list = (pick: (r: PageResult) => string[]) => places(results.flatMap((r) => pick(r).map((text) => ({ path: r.path, viewport: r.viewport, text }))));
  const unmeasured = list((r) => r.unmeasured);
  const notes = list((r) => r.notes);
  if (unmeasured.length) blocks.push(["NOT CHECKED", ...unmeasured.map((u) => `  ${u}`)].join("\n"));
  if (notes.length) blocks.push(["Notes (these don't fail the check)", ...notes.map((n) => `  ${n}`)].join("\n"));

  const code = causes.size ? 1 : unmeasured.length ? 2 : 0;
  const summary =
    code === 1 ? `${causes.size} finding${causes.size === 1 ? "" : "s"}. Fix the app. If a change is intended, ask the developer to update the baseline.`
    : code === 2 ? "No drift found, but the check is incomplete, so this isn't a pass."
    : "No drift.";
  return { code, text: [...blocks, summary].join("\n\n") };
}

/** Measures the baseline's pages and compares them. Never writes. */
export async function check({ dir, baseUrl }: { dir: string; baseUrl?: string }): Promise<{ code: 0 | 1 | 2; text: string }> {
  const text = await readFile(join(dir, BASELINE_FILE), "utf8").catch((err: NodeJS.ErrnoException) => {
    throw err.code === "ENOENT" ? new Error(`No ${BASELINE_FILE} here. The developer makes one with kolophon snapshot <url...>`) : err;
  });
  const baseline = parseBaseline(text, VIEWPORTS);
  const target = parseUrls([baseUrl ?? baseline.baseUrl]);
  if (target.paths[0] !== "/") throw new Error(`--base-url takes an origin only, e.g. ${target.baseUrl}`);

  const results: PageResult[] = [];
  for (const [path, views] of Object.entries(baseline.pages)) {
    for (const viewport of Object.keys(VIEWPORTS)) {
      try {
        const { t, m } = await measurePage(target.baseUrl + path, viewport);
        results.push({ path, viewport, ...compare(views[viewport], t, m) });
      } catch (err) {
        // The other pages may still show drift.
        results.push({ path, viewport, drift: [], notes: [], unmeasured: [(err as Error).message] });
      }
    }
  }
  return report(results);
}
