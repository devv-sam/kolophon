#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closeBrowser, withPage } from "./browser.js";
import { extractTypography } from "./typography.js";

const server = new McpServer({ name: "kolophon", version: "2.0.0-alpha.0" });

server.registerTool(
  "get_typography",
  {
    description:
      "Extract the typography a live web page actually renders: font families and every distinct text style (family, weight, size, line height, letter spacing), ranked by how much visible text uses it.",
    inputSchema: { url: z.string().url().describe("The http(s) page to inspect") },
  },
  async ({ url }) => {
    try {
      const result = await withPage(url, async (page) => ({
        url,
        title: await page.title(),
        ...(await page.evaluate(extractTypography)),
      }));
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
    }
  },
);

function shutdown() {
  closeBrowser();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
