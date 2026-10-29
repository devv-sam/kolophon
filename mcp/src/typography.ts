export interface TextStyle {
  family: string;
  weight: string;
  size: string;
  lineHeight: string;
  letterSpacing: string;
  style: string;
  /** Visible elements rendered in this style. */
  elements: number;
  /** Visible characters rendered in this style; the ranking weight. */
  chars: number;
  tags: string[];
  sample: string;
}

import type { Page } from "puppeteer-core";

/** One `@font-face` from `document.fonts`. `unloaded` means declared but never used. */
export interface FontFaceInfo {
  weight: string;
  style: string;
  status: "unloaded" | "loading" | "loaded" | "error";
}

/** A font Chrome actually drew glyphs with, from `CSS.getPlatformFontsForNode`. */
export interface RenderedFont {
  name: string;
  /** True for a web font, false for a font installed on the machine. */
  custom: boolean;
  glyphs: number;
}

export interface FontFamily {
  /** First family in the declared stack. */
  name: string;
  stack: string;
  chars: number;
  /** The first family has `@font-face` rules. */
  webFont: boolean;
  faces: FontFaceInfo[];
  rendered: RenderedFont[];
  /** The first family did not render and something else stood in; null when Chrome reported no fonts. */
  fallback: boolean | null;
}

export interface Typography {
  families: FontFamily[];
  styles: TextStyle[];
}

type PageFamily = Pick<FontFamily, "name" | "stack" | "chars">;
type PageTypography = { families: PageFamily[]; styles: TextStyle[]; faces: Record<string, FontFaceInfo[]> };

/**
 * Runs inside the page via `page.evaluate`, which serializes only this function,
 * so everything it uses must be defined in its body.
 */
export function extractTypography(): PageTypography {
  // shortcut: stops after 5,000 text elements; raise it or sample if real pages get cut off.
  const MAX_ELEMENTS = 5000;

  // Characters of direct text per element, so nested elements aren't counted twice.
  const textByElement = new Map<Element, string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const el = node.parentElement;
    if (!text || !el) continue;
    if (!textByElement.has(el) && textByElement.size >= MAX_ELEMENTS) break;
    const prev = textByElement.get(el);
    textByElement.set(el, prev ? `${prev} ${text}` : text);
  }

  const styles = new Map<string, TextStyle>();
  const samples = new Map<TextStyle, Element>();
  const families = new Map<string, PageFamily>();
  for (const [el, text] of textByElement) {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    if (el.closest("script, style, noscript, template")) continue;
    const s = getComputedStyle(el);
    const key = [s.fontFamily, s.fontWeight, s.fontSize, s.lineHeight, s.letterSpacing, s.fontStyle].join("|");
    let group = styles.get(key);
    if (!group) {
      group = {
        family: s.fontFamily,
        weight: s.fontWeight,
        size: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        style: s.fontStyle,
        elements: 0,
        chars: 0,
        tags: [],
        sample: text.slice(0, 40),
      };
      styles.set(key, group);
      samples.set(group, el);
    }
    const tag = el.tagName.toLowerCase();
    group.elements++;
    group.chars += text.length;
    if (group.tags.length < 5 && !group.tags.includes(tag)) group.tags.push(tag);

    let family = families.get(s.fontFamily);
    if (!family) {
      family = { name: s.fontFamily.split(",")[0].trim().replace(/['"]/g, ""), stack: s.fontFamily, chars: 0 };
      families.set(s.fontFamily, family);
    }
    family.chars += text.length;
  }

  const faces: Record<string, FontFaceInfo[]> = {};
  for (const face of document.fonts) {
    const family = face.family.replace(/['"]/g, "").toLowerCase();
    (faces[family] ??= []).push({ weight: face.weight, style: face.style, status: face.status });
  }

  const byChars = (a: { chars: number }, b: { chars: number }) => b.chars - a.chars;
  const sorted = [...styles.values()].sort(byChars);
  // Lets the Node side find each style's sample element over CDP. The tab is thrown away after.
  sorted.forEach((style, i) => samples.get(style)!.setAttribute("data-kolophon-style", String(i)));
  return { families: [...families.values()].sort(byChars), styles: sorted, faces };
}

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "math", "emoji", "fangsong",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "-apple-system", "blinkmacsystemfont",
]);

/** Extracts the page's typography and checks which fonts Chrome actually rendered. */
export async function getTypography(page: Page): Promise<Typography> {
  const { families, styles, faces } = await page.evaluate(extractTypography);

  const renderedByStack = new Map<string, Map<string, RenderedFont>>();
  const cdp = await page.createCDPSession();
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    for (const [i, style] of styles.entries()) {
      try {
        const { nodeId } = await cdp.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector: `[data-kolophon-style="${i}"]`,
        });
        const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
        const rendered = renderedByStack.get(style.family) ?? new Map<string, RenderedFont>();
        renderedByStack.set(style.family, rendered);
        for (const f of fonts) {
          const seen = rendered.get(f.familyName);
          if (seen) seen.glyphs += f.glyphCount;
          else rendered.set(f.familyName, { name: f.familyName, custom: f.isCustomFont, glyphs: f.glyphCount });
        }
      } catch {
        // The sample element went away (e.g. the page re-rendered); this style just has no render data.
      }
    }
  } finally {
    await cdp.detach();
  }

  return {
    styles,
    families: families.map((family) => {
      const key = family.name.toLowerCase();
      const familyFaces = faces[key] ?? [];
      const rendered = [...(renderedByStack.get(family.stack)?.values() ?? [])];
      const webFont = familyFaces.length > 0;
      // Web fonts are judged by isCustomFont, since their internal name can differ from the CSS name.
      const fallback =
        rendered.length === 0 ? null
        : GENERIC_FAMILIES.has(key) ? false
        : webFont ? !rendered.some((f) => f.custom)
        : !rendered.some((f) => f.name.toLowerCase() === key);
      return { ...family, webFont, faces: familyFaces, rendered, fallback };
    }),
  };
}
