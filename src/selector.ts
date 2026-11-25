/** Finds `el` again. Its source is sent into the page, so it can use nothing but its own body. */
export function selectorOf(el: Element): string {
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
    const same = [...(e.parentElement?.children ?? [])].filter((c) => c.localName === e!.localName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
  }
  return parts.join(" > ");
}
