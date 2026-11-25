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

// shortcut: shows 5 selectors per finding; raise it if agents need more to find the cause.
const MAX_WHERE = 5;

/** Groups equal items from several viewports, so one mistake is one finding. */
function group<T>(results: PageResult[], pick: (r: PageResult) => T[]): { item: T; place: string }[] {
  const groups = new Map<string, { item: T; path: string; viewports: string[] }>();
  for (const r of results) {
    for (const item of pick(r)) {
      const key = JSON.stringify([r.path, item]);
      const seen = groups.get(key);
      if (seen) seen.viewports.push(r.viewport);
      else groups.set(key, { item, path: r.path, viewports: [r.viewport] });
    }
  }
  return [...groups.values()].map(({ item, path, viewports }) => ({ item, place: `${path} (${[...new Set(viewports)].join(", ")})` }));
}

/** The report and its exit code: 0 no drift, 1 drift, 2 something couldn't be checked and no drift was found. */
export function report(results: PageResult[]): { code: 0 | 1 | 2; text: string } {
  const drift = group(results, (r) => r.drift);
  const notes = group(results, (r) => r.notes);
  const unmeasured = group(results, (r) => r.unmeasured);
  const blocks = drift.map(({ item, place }) => {
    const more = item.where.length - MAX_WHERE;
    const where = item.where.slice(0, MAX_WHERE).map((w) => `  at   ${w}`);
    return [`DRIFT  ${item.found}`, `  page ${place}`, ...where, ...(more > 0 ? [`  and ${more} more`] : []), `  fix  ${item.fix}`].join("\n");
  });
  if (unmeasured.length) blocks.push(["NOT CHECKED", ...unmeasured.map((u) => `  ${u.place}: ${u.item}`)].join("\n"));
  if (notes.length) blocks.push(["Notes (these don't fail the check)", ...notes.map((n) => `  ${n.place}: ${n.item}`)].join("\n"));

  const code = drift.length ? 1 : unmeasured.length ? 2 : 0;
  const summary =
    code === 1 ? `${drift.length} finding${drift.length === 1 ? "" : "s"}. Fix the app. If a change is intended, ask the developer to update the baseline.`
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
        const t = await measurePage(target.baseUrl + path, viewport);
        results.push({ path, viewport, ...compare(views[viewport], t) });
      } catch (err) {
        // The other pages may still show drift.
        results.push({ path, viewport, drift: [], notes: [], unmeasured: [(err as Error).message] });
      }
    }
  }
  return report(results);
}
