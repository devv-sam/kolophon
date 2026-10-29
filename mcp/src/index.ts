#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closeBrowser, withPage } from "./browser.js";

const server = new McpServer({ name: "kolophon", version: "2.0.0-alpha.0" });

server.registerTool(
  "get_typography",
  {
    description:
      "Extract the typography a live web page actually renders: font families, weights, sizes, fallbacks, and variable font axes.",
    inputSchema: { url: z.string().url().describe("The http(s) page to inspect") },
  },
  async ({ url }) => {
    try {
      // shortcut: returns the page title only; extraction lands in the next step of Phase 1.
      const title = await withPage(url, (page) => page.title());
      return { content: [{ type: "text", text: JSON.stringify({ url, title }, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
    }
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => closeBrowser().finally(() => process.exit(0)));
}
process.stdin.on("close", () => closeBrowser().finally(() => process.exit(0)));

await server.connect(new StdioServerTransport());
