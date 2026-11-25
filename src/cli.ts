#!/usr/bin/env node
import { parseArgs } from "node:util";
import { closeBrowser } from "./browser.js";
import { snapshot } from "./snapshot.js";

const USAGE = `Usage: kolophon snapshot <url...> [--update]

  snapshot   measure the pages and write kolophon.json
  --update   replace an existing kolophon.json

Exit codes: 0 done, 2 could not run.`;

async function main(): Promise<string> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { update: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } },
  });
  if (values.help) return USAGE;
  const [command, ...urls] = positionals;
  if (command !== "snapshot") throw new Error(`${command ? `Unknown command: ${command}` : "No command given."}\n\n${USAGE}`);
  if (!urls.length) throw new Error(`snapshot needs at least one URL.\n\n${USAGE}`);
  return snapshot(urls, { dir: process.cwd(), update: values.update });
}

try {
  console.log(await main());
} catch (err) {
  console.error(`kolophon: ${(err as Error).message}`);
  process.exitCode = 2; // 1 is reserved for drift.
} finally {
  closeBrowser();
}
