#!/usr/bin/env node
import { parseArgs } from "node:util";
import { closeBrowser } from "./browser.js";
import { check } from "./check.js";
import { snapshot } from "./snapshot.js";

const USAGE = `Usage: kolophon snapshot <url...> [--update]
       kolophon check [--base-url <origin>]

  snapshot     measure the pages and write kolophon.json
  --update     replace an existing kolophon.json

  check        measure the pages in kolophon.json and report drift
  --base-url   check the same pages on another origin

Exit codes: 0 done or no drift, 1 drift, 2 could not run or could not check everything.`;

async function main(): Promise<{ code: number; text: string }> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { update: { type: "boolean" }, "base-url": { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) return { code: 0, text: USAGE };
  const [command, ...args] = positionals;
  const usage = (problem: string) => new Error(`${problem}\n\n${USAGE}`);
  if (command === "snapshot") {
    if (!args.length) throw usage("snapshot needs at least one URL.");
    if (values["base-url"] !== undefined) throw usage("--base-url is for check.");
    return { code: 0, text: await snapshot(args, { dir: process.cwd(), update: values.update ?? false }) };
  }
  if (command === "check") {
    if (args.length) throw usage("check takes no URLs; its pages come from kolophon.json.");
    if (values.update !== undefined) throw usage("--update is for snapshot.");
    return check({ dir: process.cwd(), baseUrl: values["base-url"] });
  }
  throw usage(command ? `Unknown command: ${command}` : "No command given.");
}

try {
  const { code, text } = await main();
  console.log(text);
  process.exitCode = code;
} catch (err) {
  console.error(`kolophon: ${(err as Error).message}`);
  process.exitCode = 2; // 1 means drift.
} finally {
  closeBrowser();
}
