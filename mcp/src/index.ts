#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closeBrowser, withPage } from "./browser.js";
import { getMotion } from "./motion.js";
import { motionToDesignMd, motionToTailwind, motionToTokens, toDesignMd, toTailwind, toTokens } from "./output.js";
import { captureSheet, renderSheet } from "./sheet.js";
import { getTypography } from "./typography.js";

const server = new McpServer({ name: "kolophon", version: "2.0.0-alpha.0" });

server.registerTool(
  "get_typography",
  {
    description:
      "Extract the typography a live web page actually renders: font families (with whether each web or local font actually loaded, or a fallback silently rendered instead, and the variation axes and ranges of variable fonts) and every distinct text style (family, weight, size, line height, letter spacing, font-variation-settings), ranked by how much visible text uses it. Returns four text items in order: a DESIGN.md typography section ending with agent guidance, W3C design tokens (tokens.json), a Tailwind v4 @theme block, and the raw extraction as JSON.",
    inputSchema: { url: z.string().url().describe("The http(s) page to inspect") },
  },
  async ({ url }) => {
    try {
      const result = await withPage(url, async (page) => ({
        url,
        title: await page.title(),
        ...(await getTypography(page)),
      }));
      return {
        content: [
          { type: "text", text: toDesignMd(result, result) },
          { type: "text", text: JSON.stringify(toTokens(result), null, 2) },
          { type: "text", text: toTailwind(result) },
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
    }
  },
);

server.registerTool(
  "get_motion",
  {
    description:
      "Extract the motion of a live web page: computed transitions (property, duration, easing), @keyframes with the selectors that use them and their timing (CSS variables resolved), animations running at load, prefers-reduced-motion handling, and View Transitions. Returns four text items in order: a DESIGN.md motion section ending with agent guidance, W3C design tokens (tokens.json), a Tailwind v4 @theme block with easings, animations and keyframes, and the raw extraction as JSON. By default it also scrolls the page and hovers its controls (up to about 12s) to catch motion that only starts on interaction, including JavaScript animations.",
    inputSchema: {
      url: z.string().url().describe("The http(s) page to inspect"),
      interactions: z
        .boolean()
        .default(true)
        .describe("Scroll and hover to record motion triggered by interaction. Set false for a faster, load-only read."),
    },
  },
  async ({ url, interactions }) => {
    try {
      const result = await withPage(url, async (page) => ({ url, title: await page.title(), ...(await getMotion(page, { interactions })) }));
      return {
        content: [
          { type: "text", text: motionToDesignMd(result, result) },
          { type: "text", text: JSON.stringify(motionToTokens(result), null, 2) },
          { type: "text", text: motionToTailwind(result) },
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
    }
  },
);

server.registerTool(
  "get_design_sheet",
  {
    description:
      "Render a visual design sheet of a live web page's typography and motion: font specimens in the page's real fonts, variable axes, the type scale with specs, easing curves, durations, keyframes and agent notes. Returns it as a PNG image, and also saves a PDF when pdf_path is given. Runs the same extraction as get_typography and get_motion, so it takes 10-20s.",
    inputSchema: {
      url: z.string().url().describe("The http(s) page to inspect"),
      pdf_path: z.string().optional().describe("Absolute path ending in .pdf to also save the sheet as a PDF"),
      interactions: z.boolean().default(true).describe("Scroll and hover to include motion triggered by interaction"),
    },
  },
  async ({ url, pdf_path, interactions }) => {
    try {
      const { png, title } = await withPage(url, async (page) => {
        const title = await page.title();
        const typography = await getTypography(page);
        const motion = await getMotion(page, { interactions });
        return { title, ...(await captureSheet(page, renderSheet(typography, motion, { url, title }), pdf_path)) };
      });
      const note = `Design sheet for ${title || url}.${pdf_path ? ` PDF saved to ${pdf_path}.` : ""}`;
      return { content: [{ type: "image", data: png, mimeType: "image/png" }, { type: "text", text: note }] };
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
