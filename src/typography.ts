import type { CDPSession, Page, Protocol } from "puppeteer-core";
import { readStyleSheets } from "./browser.js";
import { readFontFile, type FontAxis } from "./fontfile.js";

/** A font Chrome actually drew glyphs with. Names of installed fonts differ between machines. */
export interface RenderedFont {
  name: string;
  /** True for a web font, false for a font installed on the machine. */
  custom: boolean;
  glyphs: number;
}

export interface TextStyle {
  family: string;
  weight: string;
  size: string;
  lineHeight: string;
  letterSpacing: string;
  style: string;
  /** Computed `font-variation-settings`, e.g. `"wght" 650`; `normal` when unset. */
  variationSettings: string;
  /** Visible elements rendered in this style. */
  elements: number;
  /** Visible characters rendered in this style; the ranking weight. */
  chars: number;
  tags: string[];
  sample: string;
  /** Finds the first element in this style. */
  selector: string;
  rendered: RenderedFont[];
  /** Glyphs drawn by something other than the first family in the stack; null when Chrome reported no fonts. */
  fallbackGlyphs: number | null;
  /**
   * False when no loaded face of the web font declares this weight, so Chrome drew another weight or faked it.
   * Null when the first family isn't a web font or none of it loaded.
   */
  weightCovered: boolean | null;
}

/** One `@font-face` from `document.fonts`. `unloaded` means declared but never used. */
export interface FontFaceInfo {
  weight: string;
  style: string;
  status: "unloaded" | "loading" | "loaded" | "error";
}

export interface FontFamily {
  /** First family in the declared stack. */
  name: string;
  stack: string;
  chars: number;
  /** The first family has `@font-face` rules. */
  webFont: boolean;
  faces: FontFaceInfo[];
  /** One of the family's font files has variation axes. */
  variable: boolean;
  /** Axes across the family's font files, ranges widened to cover all of them; null when a file couldn't be read. */
  axes: FontAxis[] | null;
}

export interface Typography {
  families: FontFamily[];
  styles: TextStyle[];
  /** Text nodes that weren't visible at load (closed menus, scroll reveals), so weren't measured. */
  hidden: number;
  /** What could not be measured, one sentence each; empty when everything was. */
  unmeasured: string[];
}

type PageFamily = Pick<FontFamily, "name" | "stack" | "chars">;
type PageStyle = Omit<TextStyle, "rendered" | "fallbackGlyphs" | "weightCovered">;
type PageTypography = {
  families: PageFamily[];
  styles: PageStyle[];
  faces: Record<string, FontFaceInfo[]>;
  /** For each collected text node or form control, the index of its style. */
  nodeStyles: number[];
  hidden: number;
};

/**
 * Runs inside the page, where only this function's source is sent,
 * so everything it uses must be defined in its body.
 */
// shortcut: skips shadow roots, iframes, ::before/::after text and typed passwords; add them when apps rely on them.
function extractTypography(): { data: PageTypography; nodes: (Text | Element)[] } {
  const clean = (name: string) => name.trim().replace(/['"]/g, "");

  const textByElement = new Map<Element, Text[]>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const el = node.parentElement;
    if (!el || !node.data.trim()) continue;
    const nodes = textByElement.get(el);
    if (nodes) nodes.push(node);
    else textByElement.set(el, [node]);
  }

  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      if (e.id && document.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(e.id)}`);
        break;
      }
      const tag = CSS.escape(e.localName);
      if (e === document.body) {
        parts.unshift(tag);
        break;
      }
      const same = [...(e.parentElement?.children ?? [])].filter((c) => c.localName === e.localName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
    }
    return parts.join(" > ");
  };

  const styles = new Map<string, PageStyle & { nodes: (Text | Element)[] }>();
  const families = new Map<string, PageFamily>();
  const add = (el: Element, pseudo: string, chars: number, sample: string, nodes: (Text | Element)[]) => {
    const s = getComputedStyle(el, pseudo || null);
    const key = [s.fontFamily, s.fontWeight, s.fontSize, s.lineHeight, s.letterSpacing, s.fontStyle, s.fontVariationSettings].join("|");
    let group = styles.get(key);
    if (!group) {
      group = {
        family: s.fontFamily,
        weight: s.fontWeight,
        size: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        style: s.fontStyle,
        variationSettings: s.fontVariationSettings,
        elements: 0,
        chars: 0,
        tags: [],
        sample: sample.slice(0, 40),
        selector: selectorOf(el) + pseudo,
        nodes: [],
      };
      styles.set(key, group);
    }
    const tag = el.tagName.toLowerCase() + pseudo;
    group.elements++;
    group.chars += chars;
    group.nodes.push(...nodes);
    if (group.tags.length < 5 && !group.tags.includes(tag)) group.tags.push(tag);

    let family = families.get(s.fontFamily);
    if (!family) {
      family = { name: clean(s.fontFamily.split(",")[0]), stack: s.fontFamily, chars: 0 };
      families.set(s.fontFamily, family);
    }
    family.chars += chars;
  };

  let hidden = 0;
  const visible = (el: Element) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  for (const [el, nodes] of textByElement) {
    // A textarea's child text is only its default value; the control itself is read below.
    if (el.closest("script, style, noscript, template, textarea")) continue;
    if (!visible(el)) {
      // A closed select's options show up one at a time, in the select itself.
      if (!el.closest("option")) hidden += nodes.length;
      continue;
    }
    const text = nodes.map((n) => n.data.trim()).join(" ");
    add(el, "", text.length, text, nodes);
  }

  // Types that paint no text of their own, or (file) text in two fonts.
  const TEXTLESS = new Set(["hidden", "checkbox", "radio", "range", "color", "file", "image"]);
  // Types that paint text even when their value is empty.
  const ALWAYS_PAINTED = new Set(["submit", "reset", "date", "time", "datetime-local", "month", "week"]);
  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (!visible(el)) continue;
    if (el instanceof HTMLSelectElement) {
      const label = el.selectedOptions[0]?.label ?? "";
      // Options of a list box are text nodes, already read above.
      if (label && !el.multiple && el.size <= 1) add(el, "", label.length, label, [el]);
      continue;
    }
    const field = el as HTMLInputElement | HTMLTextAreaElement;
    if (TEXTLESS.has(field.type)) continue;
    if (!field.value && field.placeholder) add(el, "::placeholder", field.placeholder.length, field.placeholder, [el]);
    else if (field.type !== "password" && (field.value || ALWAYS_PAINTED.has(field.type))) {
      // What someone typed is never kept as a sample.
      const isButton = ["button", "submit", "reset"].includes(field.type);
      add(el, "", field.value.length, isButton ? field.value : "", [el]);
    }
  }

  const faces: Record<string, FontFaceInfo[]> = {};
  for (const face of document.fonts) {
    (faces[clean(face.family).toLowerCase()] ??= []).push({ weight: face.weight, style: face.style, status: face.status });
  }

  const byChars = (a: { chars: number }, b: { chars: number }) => b.chars - a.chars;
  const sorted = [...styles.values()].sort(byChars);
  return {
    data: {
      families: [...families.values()].sort(byChars),
      styles: sorted.map(({ nodes: _, ...style }) => style),
      faces,
      nodeStyles: sorted.flatMap((style, i) => style.nodes.map(() => i)),
      hidden,
    },
    nodes: sorted.flatMap((style) => style.nodes),
  };
}

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "math", "emoji", "fangsong",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "-apple-system", "blinkmacsystemfont",
]);

// shortcut: stops asking Chrome about text after 30s; raise it if real pages get cut off.
const RENDERED_FONTS_BUDGET_MS = 30_000;
const BATCH = 200;

/**
 * Text nodes Chrome generates inside a form control, whose shadow tree the page can't reach.
 * Asking about the control instead misses text that sits deeper, as in a textarea.
 */
async function controlTextNodes(cdp: CDPSession, objectId: string): Promise<number[]> {
  const { node } = await cdp.send("DOM.describeNode", { objectId, depth: -1, pierce: true });
  const ids: number[] = [];
  const walk = (n: Protocol.DOM.Node) => {
    if (n.nodeType === 3) ids.push(n.backendNodeId);
    [...(n.shadowRoots ?? []), ...(n.children ?? [])].forEach(walk);
  };
  (node.shadowRoots ?? []).forEach(walk);
  if (!ids.length) return [];
  return (await cdp.send("DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds: ids })).nodeIds;
}

/**
 * Fonts Chrome drew each style's text with. Asks about text nodes, since for an element
 * Chrome also counts text in child elements, which may be in another font.
 */
async function readRenderedFonts(cdp: CDPSession, nodeIds: { objectId: string; text: boolean }[], nodeStyles: number[], styleCount: number) {
  const rendered = Array.from({ length: styleCount }, () => new Map<string, RenderedFont>());
  const deadline = Date.now() + RENDERED_FONTS_BUDGET_MS;
  let missed = 0;
  for (let i = 0; i < nodeIds.length; i += BATCH) {
    const batch = nodeIds.slice(i, i + BATCH);
    if (Date.now() > deadline) {
      missed += nodeIds.length - i;
      break;
    }
    await Promise.all(
      batch.map(async ({ objectId, text }, j) => {
        try {
          const { nodeId } = await cdp.send("DOM.requestNode", { objectId });
          const targets = text ? [nodeId] : await controlTextNodes(cdp, objectId);
          const fonts = (await Promise.all(targets.map((id) => cdp.send("CSS.getPlatformFontsForNode", { nodeId: id })))).flatMap((r) => r.fonts);
          const seen = rendered[nodeStyles[i + j]];
          for (const f of fonts) {
            const key = `${f.familyName}|${f.isCustomFont}`;
            const font = seen.get(key);
            if (font) font.glyphs += f.glyphCount;
            else seen.set(key, { name: f.familyName, custom: f.isCustomFont, glyphs: f.glyphCount });
          }
        } catch {
          missed++; // The text went away (e.g. the page re-rendered).
        }
      }),
    );
  }
  return { rendered: rendered.map((m) => [...m.values()]), missed };
}

/** Extracts the page's typography and checks which fonts Chrome actually rendered. */
export async function getTypography(page: Page): Promise<Typography> {
  const unmeasured: string[] = [];
  let data: PageTypography;
  let rendered: RenderedFont[][];
  let fontFiles: { url: string; info: ReturnType<typeof readFontFile> }[];
  // Font file URL → lowercased CSS families, from every stylesheet's @font-face rules.
  const fileFamilies = new Map<string, Set<string>>();
  // Lowercased CSS family → lowercased names of the installed fonts its local() sources accept.
  const localNames = new Map<string, Set<string>>();
  const cdp = await page.createCDPSession();
  try {
    for (const sheet of await readStyleSheets(cdp, page)) {
      for (const [block] of sheet.text.matchAll(/@font-face\s*\{[^}]*\}/g)) {
        const family = block.match(/font-family\s*:\s*['"]?([^'";}]+)/)?.[1].trim().toLowerCase();
        if (!family) continue;
        for (const [, url] of block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
          if (!URL.canParse(url, sheet.url)) continue;
          const { href } = new URL(url, sheet.url);
          fileFamilies.set(href, (fileFamilies.get(href) ?? new Set()).add(family));
        }
        for (const [, name] of block.matchAll(/local\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
          localNames.set(family, (localNames.get(family) ?? new Set()).add(name.trim().toLowerCase()));
        }
      }
    }

    const { result } = await cdp.send("Runtime.evaluate", { expression: `(${extractTypography})()` });
    if (!result.objectId) throw new Error(`could not read the page's text: ${result.description ?? "no result"}`);
    const call = (fn: string, returnByValue: boolean) =>
      cdp.send("Runtime.callFunctionOn", { objectId: result.objectId, functionDeclaration: fn, returnByValue });
    data = (await call("function () { return this.data }", true)).result.value as PageTypography;
    const nodes = (await call("function () { return this.nodes }", false)).result;
    const { result: props } = await cdp.send("Runtime.getProperties", { objectId: nodes.objectId!, ownProperties: true });
    const nodeIds = props.filter((p) => /^\d+$/.test(p.name)).map((p) => ({ objectId: p.value!.objectId!, text: p.value!.className === "Text" }));
    await cdp.send("DOM.getDocument", { depth: 0 }); // DOM.requestNode requires it.
    const fonts = await readRenderedFonts(cdp, nodeIds, data.nodeStyles, data.styles.length);
    rendered = fonts.rendered;
    if (fonts.missed) unmeasured.push(`The rendered font of ${fonts.missed} of ${nodeIds.length} text nodes and form controls could not be read.`);

    const { frameTree } = await cdp.send("Page.getResourceTree");
    const urls = frameTree.resources.filter((r) => r.type === "Font" && !r.failed && !r.canceled).map((r) => r.url);
    // Re-fetched in the page so they come from Chrome's cache; CDP keeps no bodies loaded before it was enabled.
    const files = await page.evaluate(async (urls: string[]) => {
      return Promise.all(
        urls.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "force-cache", signal: AbortSignal.timeout(10_000) });
            const bytes = new Uint8Array(await res.arrayBuffer());
            // shortcut: skips font files over 10MB; raise if real pages need more.
            if (!res.ok || bytes.length > 10_000_000) return null;
            let binary = "";
            for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return btoa(binary);
          } catch {
            return null;
          }
        }),
      );
    }, urls);
    fontFiles = urls.map((url, i) => ({ url, info: files[i] ? readFontFile(Buffer.from(files[i], "base64")) : null }));
  } finally {
    await cdp.detach().catch(() => {}); // The tab may already be gone; keep the original error.
  }

  const loadedFamilies = new Set(Object.entries(data.faces).filter(([, f]) => f.some((x) => x.status === "loaded")).map(([name]) => name));

  /** Names inside the font files declared for a CSS family. */
  const fileNames = (key: string) =>
    new Set(fontFiles.flatMap(({ url, info }) => (info && fileFamilies.get(url)?.has(key) ? [info.family.toLowerCase()] : [])));
  const allFileNames = new Set(fontFiles.flatMap(({ info }) => (info ? [info.family.toLowerCase()] : [])));

  const isFirstFamily = (key: string, f: RenderedFont): boolean => {
    const name = f.name.toLowerCase();
    // Emoji come from the system's emoji font by design.
    if (!f.custom && name.includes("emoji")) return true;
    if (GENERIC_FAMILIES.has(key)) return true;
    if (!data.faces[key]) return !f.custom && name === key;
    if (!f.custom) return localNames.get(key)?.has(name) ?? false;
    if (!loadedFamilies.has(key)) return false;
    // A web font's internal name can differ from its CSS name, so only a name known to belong to another family counts against it.
    return fileNames(key).has(name) || !allFileNames.has(name);
  };

  // shortcut: trusts the weights @font-face declares; read OS/2 from the font file if fonts are found mislabelled.
  const weightCovered = (key: string, style: PageStyle): boolean | null => {
    const loaded = (data.faces[key] ?? []).filter((f) => f.status === "loaded");
    if (!loaded.length) return null;
    const upright = (s: string) => s === "normal";
    const sameSlope = loaded.filter((f) => upright(f.style) === upright(style.style));
    return (sameSlope.length ? sameSlope : loaded).some((f) => {
      const [min, max = min] = f.weight.split(" ").map((w) => (w === "normal" ? 400 : w === "bold" ? 700 : Number(w)));
      return Number(style.weight) >= min && Number(style.weight) <= max;
    });
  };

  return {
    unmeasured,
    hidden: data.hidden,
    styles: data.styles.map((style, i) => {
      const key = data.families.find((f) => f.stack === style.family)!.name.toLowerCase();
      const fallbackGlyphs = rendered[i].filter((f) => !isFirstFamily(key, f)).reduce((sum, f) => sum + f.glyphs, 0);
      return { ...style, rendered: rendered[i], fallbackGlyphs: rendered[i].length ? fallbackGlyphs : null, weightCovered: weightCovered(key, style) };
    }),
    families: data.families.map((family) => {
      const key = family.name.toLowerCase();
      const faces = data.faces[key] ?? [];
      const names = new Set([key, ...data.styles.flatMap((s, i) => (s.family === family.stack ? rendered[i].map((f) => f.name.toLowerCase()) : []))]);
      const axes = new Map<string, FontAxis>();
      const unreadable = loadedFamilies.has(key) && fontFiles.some(({ url, info }) => !info && fileFamilies.get(url)?.has(key));
      for (const { url, info } of fontFiles) {
        // A file belongs to this family by its @font-face URL, or else by the name inside the file.
        const owners = fileFamilies.get(url);
        if (!info || (owners ? !owners.has(key) : !names.has(info.family.toLowerCase()))) continue;
        for (const axis of info.axes) {
          const seen = axes.get(axis.tag);
          if (seen) {
            seen.min = Math.min(seen.min, axis.min);
            seen.max = Math.max(seen.max, axis.max);
          } else axes.set(axis.tag, { ...axis });
        }
      }
      return { ...family, webFont: faces.length > 0, faces, variable: axes.size > 0, axes: unreadable ? null : [...axes.values()] };
    }),
  };
}
