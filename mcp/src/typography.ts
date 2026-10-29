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

export interface FontFamily {
  /** First family in the declared stack. */
  name: string;
  stack: string;
  chars: number;
}

export interface Typography {
  families: FontFamily[];
  styles: TextStyle[];
}

/**
 * Runs inside the page via `page.evaluate`, which serializes only this function,
 * so everything it uses must be defined in its body.
 */
export function extractTypography(): Typography {
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
  const families = new Map<string, FontFamily>();
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

  const byChars = (a: { chars: number }, b: { chars: number }) => b.chars - a.chars;
  return { families: [...families.values()].sort(byChars), styles: [...styles.values()].sort(byChars) };
}
