import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { PopupCard, type FontData, type EditField } from "./PopupCard";

export default defineContentScript({
  matches: ["<all_urls>"],
  // Not injected on page load. The background service worker injects this
  // script into the active tab only when the user clicks the toolbar icon
  // (see background.ts), so no code runs on pages the user never inspects.
  registration: "runtime",

  main() {
    // Re-injection (a second toolbar click on the same page) re-runs this file
    // in the same isolated world, so the previous instance's globals persist.
    // Toggle the existing instance off instead of stacking a second one.
    const w = window as unknown as { __kolophon?: { toggle: () => void } };
    if (w.__kolophon) {
      w.__kolophon.toggle();
      return;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    let overlay: HTMLDivElement | null = null;
    let badge: HTMLDivElement | null = null;
    let exitButton: HTMLButtonElement | null = null;
    let cursorStyle: HTMLStyleElement | null = null;
    let activeTarget: Element | null = null;
    let active = false;
    let popupOpen = false;

    let reactRoot: Root | null = null;
    // The element the popup is currently describing. Held so the edit view can
    // mutate its inline styles in real time (popupState.data is only a snapshot).
    let popupTarget: Element | null = null;
    // Every element we've live-edited → its original inline cssText, so edits
    // can be fully reverted if the user discards on quit.
    const editedStyles = new Map<HTMLElement, string>();
    let popupState = {
      data: null as FontData | null,
      editFields: [] as EditField[],
      x: 0,
      y: 0,
      visible: false,
      confirmDiscard: false,
    };

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function parseFontName(fontFamily: string): string {
      return fontFamily.split(",")[0].trim().replace(/['"]/g, "");
    }

    function rgbToHex(rgb: string): string {
      const m = rgb.match(/\d+/g);
      if (!m || m.length < 3) return rgb;
      return (
        "#" +
        m
          .slice(0, 3)
          .map((n) => parseInt(n).toString(16).padStart(2, "0"))
          .join("")
      );
    }

    // ─── Contextual edit fields ───────────────────────────────────────────────
    // The edit view only shows properties that are actually meaningful on the
    // clicked element: typography is always relevant for a font tool, the rest
    // appear only when set (a flex container gets gap/align, a card gets radius,
    // etc.). Mirrors how the element is really styled rather than a fixed form.

    function px(v: string): number {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    }

    function round(v: number, d = 0): number {
      const f = 10 ** d;
      return Math.round(v * f) / f;
    }

    function isTransparent(c: string): boolean {
      if (!c || c === "transparent") return true;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return false;
      const p = m[1].split(",").map((s) => parseFloat(s));
      return p.length === 4 && p[3] === 0;
    }

    function buildEditFields(el: Element): EditField[] {
      const s = window.getComputedStyle(el);
      const fields: EditField[] = [];
      const fontSize = px(s.fontSize) || 16;

      // Typography — always relevant
      fields.push({
        prop: "font-size",
        label: "Size",
        kind: "length",
        unit: "px",
        value: String(round(fontSize)),
        min: 6,
        max: 200,
        step: 1,
      });
      fields.push({
        prop: "line-height",
        label: "Line height",
        kind: "number",
        value: String(
          round(s.lineHeight === "normal" ? 1.2 : px(s.lineHeight) / fontSize, 2),
        ),
        min: 0.8,
        max: 3,
        step: 0.05,
      });
      fields.push({
        prop: "letter-spacing",
        label: "Letter spacing",
        kind: "length",
        unit: "px",
        value: String(round(s.letterSpacing === "normal" ? 0 : px(s.letterSpacing), 1)),
        min: -5,
        max: 20,
        step: 0.1,
      });
      fields.push({
        prop: "font-weight",
        label: "Weight",
        kind: "number",
        value: String(px(s.fontWeight) || 400),
        min: 100,
        max: 900,
        step: 100,
      });
      fields.push({
        prop: "color",
        label: "Text color",
        kind: "color",
        value: rgbToHex(s.color),
      });

      // Contextual — only when set on this element
      if (!isTransparent(s.backgroundColor)) {
        fields.push({
          prop: "background-color",
          label: "Background",
          kind: "color",
          value: rgbToHex(s.backgroundColor),
        });
      }
      if (px(s.opacity) < 1) {
        fields.push({
          prop: "opacity",
          label: "Opacity",
          kind: "number",
          value: String(round(px(s.opacity), 2)),
          min: 0,
          max: 1,
          step: 0.05,
        });
      }
      if (px(s.borderTopLeftRadius) > 0) {
        fields.push({
          prop: "border-radius",
          label: "Radius",
          kind: "length",
          unit: "px",
          value: String(round(px(s.borderTopLeftRadius))),
          min: 0,
          max: 80,
          step: 1,
        });
      }
      if (px(s.paddingTop) > 0) {
        fields.push({
          prop: "padding",
          label: "Padding",
          kind: "length",
          unit: "px",
          value: String(round(px(s.paddingTop))),
          min: 0,
          max: 96,
          step: 1,
        });
      }

      const display = s.display;
      const isFlexGrid = /^(inline-)?(flex|grid)$/.test(display);
      if (display && display !== "block" && display !== "inline") {
        fields.push({
          prop: "display",
          label: "Display",
          kind: "select",
          value: display,
          options: ["block", "inline", "inline-block", "flex", "inline-flex", "grid", "none"],
        });
      }
      if (isFlexGrid) {
        if (px(s.gap) > 0) {
          fields.push({
            prop: "gap",
            label: "Gap",
            kind: "length",
            unit: "px",
            value: String(round(px(s.gap))),
            min: 0,
            max: 64,
            step: 1,
          });
        }
        fields.push({
          prop: "align-items",
          label: "Align items",
          kind: "select",
          value: s.alignItems,
          options: ["stretch", "flex-start", "center", "flex-end", "baseline"],
        });
        fields.push({
          prop: "justify-content",
          label: "Justify",
          kind: "select",
          value: s.justifyContent,
          options: ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"],
        });
      }
      if (s.textAlign && s.textAlign !== "start" && s.textAlign !== "left") {
        fields.push({
          prop: "text-align",
          label: "Text align",
          kind: "select",
          value: s.textAlign,
          options: ["left", "center", "right", "justify"],
        });
      }

      return fields;
    }

    function readFontData(target: Element): FontData {
      const s = window.getComputedStyle(target);
      return {
        name: parseFontName(s.fontFamily),
        tag: target.tagName.toLowerCase() || "element",
        family: s.fontFamily,
        style: s.fontStyle,
        weight: s.fontWeight,
        size: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: s.letterSpacing,
        colorRgb: s.color,
        colorHex: rgbToHex(s.color),
      };
    }

    // ─── Builders ─────────────────────────────────────────────────────────────

    function buildOverlay(): HTMLDivElement {
      const el = document.createElement("div");
      el.setAttribute("data-kolophon", "overlay");
      Object.assign(el.style, {
        position: "fixed",
        boxSizing: "border-box",
        pointerEvents: "none",
        zIndex: "2147483644",
        background: "#BBCAFF40",
        border: "1px solid #2252FE",
        display: "none",
      });
      return el;
    }

    function buildBadge(): HTMLDivElement {
      const el = document.createElement("div");
      el.setAttribute("data-kolophon", "badge");
      Object.assign(el.style, {
        position: "fixed",
        pointerEvents: "none",
        zIndex: "2147483645",
        background: "#2252FE",
        color: "#ffffff",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "11px",
        fontWeight: "500",
        lineHeight: "1",
        letterSpacing: "0.02em",
        padding: "4px 8px",
        display: "none",
      });
      return el;
    }

    function buildExitButton(): HTMLButtonElement {
      const el = document.createElement("button");
      el.setAttribute("data-kolophon", "exit");
      el.textContent = "Exit Kolophon";
      Object.assign(el.style, {
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: "2147483646",
        background: "rgba(20, 20, 22, 0.55)",
        backdropFilter: "blur(16px) saturate(1.4)",
        WebkitBackdropFilter: "blur(16px) saturate(1.4)",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "#ffffff",
        borderRadius: "5px",
        padding: "10px 16px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "14px",
        fontWeight: "500",
        lineHeight: "1",
        letterSpacing: "0.01em",
        cursor: "pointer",
      });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        disable();
      });
      return el;
    }

    function mountReact() {
      const container = document.createElement("div");
      container.setAttribute("data-kolophon", "popup-host");
      // No shadow DOM — a position:fixed shadow host gets its own GPU compositing
      // layer, which means backdrop-filter on children only sees that layer
      // (transparent), not the actual page content behind it.
      // Direct injection lets the popup card's backdrop-filter sample real page layers.
      Object.assign(container.style, { pointerEvents: "none" });
      document.body.appendChild(container);
      reactRoot = createRoot(container);
      syncPopup();
    }

    function mount() {
      overlay = buildOverlay();
      badge = buildBadge();
      document.body.append(overlay, badge);
      mountReact();
    }

    // ─── Popup rendering ──────────────────────────────────────────────────────
    // Re-render the React component whenever popupState changes.
    // React diffs and only updates what actually changed.

    function syncPopup() {
      reactRoot?.render(
        <PopupCard
          data={popupState.data}
          editFields={popupState.editFields}
          x={popupState.x}
          y={popupState.y}
          visible={popupState.visible}
          confirmDiscard={popupState.confirmDiscard}
          onClose={closePopup}
          onStyleChange={applyStyle}
          onConfirmDiscard={discardEdits}
          onCancelDiscard={cancelDiscard}
        />,
      );
    }

    // Live-edit the inspected element's inline styles from the edit view, then
    // keep the highlight overlay glued to it as its box changes.
    function applyStyle(prop: string, value: string) {
      if (!popupTarget) return;
      const el = popupTarget as HTMLElement;
      // Snapshot the untouched inline style the first time we edit this element.
      if (!editedStyles.has(el)) editedStyles.set(el, el.style.cssText);
      el.style.setProperty(prop, value);
      track(popupTarget);
    }

    // Yes → roll every edited element back to its original inline style, then quit.
    function discardEdits() {
      for (const [el, css] of editedStyles) el.style.cssText = css;
      editedStyles.clear();
      disable();
    }

    // No → dismiss the prompt and keep editing.
    function cancelDiscard() {
      popupState = { ...popupState, confirmDiscard: false };
      syncPopup();
    }

    // ─── Tracking ─────────────────────────────────────────────────────────────

    function track(target: Element) {
      if (!overlay || !badge) return;
      const rect = target.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      Object.assign(overlay.style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        display: "block",
      });

      badge.textContent = parseFontName(
        window.getComputedStyle(target).fontFamily,
      );
      badge.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 20)}px`;
      badge.style.left = `${rect.left}px`;
      badge.style.display = "block";
    }

    function hide() {
      if (overlay) overlay.style.display = "none";
      if (badge) badge.style.display = "none";
      if (!popupOpen) {
        popupState = { ...popupState, visible: false };
        syncPopup();
      }
      activeTarget = null;
    }

    // ─── Event handlers ───────────────────────────────────────────────────────

    function onMouseOver(e: MouseEvent) {
      const target = e.target as Element;
      if (!(target instanceof Element)) return;
      // closest() walks ancestors, so we skip anything inside our popup host —
      // not just elements that directly carry the data attribute.
      if (target.closest("[data-kolophon]")) return;
      activeTarget = target;
      track(target);
    }

    function onScroll() {
      if (activeTarget) track(activeTarget);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Already asking — wait for an explicit No/Yes rather than quitting.
      if (popupState.confirmDiscard) return;
      // Unsaved edits → surface the discard prompt in the card instead of quitting.
      if (editedStyles.size > 0) {
        popupOpen = true;
        popupState = { ...popupState, visible: true, confirmDiscard: true };
        syncPopup();
        return;
      }
      disable();
    }

    function closePopup() {
      popupOpen = false;
      popupTarget = null;
      popupState = { ...popupState, visible: false, confirmDiscard: false };
      syncPopup();
    }

    function onClick(e: MouseEvent) {
      const target = e.target as Element;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-kolophon]")) return;

      e.preventDefault();
      e.stopPropagation();

      popupOpen = true;
      popupTarget = target;

      const x = Math.min(e.clientX + 12, window.innerWidth - 300);
      const y = Math.min(e.clientY + 12, window.innerHeight - 300);

      popupState = {
        data: readFontData(target),
        editFields: buildEditFields(target),
        x,
        y,
        visible: true,
        confirmDiscard: false,
      };
      syncPopup();
    }

    // ─── Enable / disable ─────────────────────────────────────────────────────

    function enable() {
      if (active) return;
      active = true;
      if (!overlay) mount();
      cursorStyle = document.createElement("style");
      cursorStyle.setAttribute("data-kolophon", "cursor");
      cursorStyle.textContent = `
        * { cursor: crosshair !important; }
        [data-kolophon="popup-host"],
        [data-kolophon="popup-host"] * { cursor: default !important; }
        [data-kolophon="popup-host"] button,
        [data-kolophon="popup-host"] button *,
        [data-kolophon="popup-host"] [data-clickable],
        [data-kolophon="popup-host"] [data-clickable] * { cursor: pointer !important; }
        [data-kolophon="popup-host"] input[type="number"] {
          cursor: text !important;
          -moz-appearance: textfield;
          appearance: textfield;
        }
        [data-kolophon="popup-host"] input[type="number"]::-webkit-inner-spin-button,
        [data-kolophon="popup-host"] input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        [data-kolophon="popup-host"] input[type="number"]:focus {
          background: rgba(255,255,255,0.08) !important;
        }
        [data-kolophon="popup-host"] [data-drag] { cursor: grab !important; }
        html[data-kolophon-dragging],
        html[data-kolophon-dragging] * { cursor: grabbing !important; user-select: none !important; }
        [data-kolophon="exit"] { cursor: pointer !important; }
      `;
      document.documentElement.appendChild(cursorStyle);
      exitButton = buildExitButton();
      document.body.appendChild(exitButton);
      document.addEventListener("mouseover", onMouseOver);
      document.addEventListener("mouseleave", hide);
      document.addEventListener("click", onClick);
      document.addEventListener("keydown", onKeyDown);
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    function disable() {
      active = false;
      popupOpen = false;
      editedStyles.clear();
      popupState = { ...popupState, confirmDiscard: false };
      hide();
      cursorStyle?.remove();
      cursorStyle = null;
      exitButton?.remove();
      exitButton = null;
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("click", onClick);
      document.removeEventListener("mouseleave", hide);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll);
    }

    // Expose a toggle for subsequent injections, then turn inspect mode on for
    // this first one.
    w.__kolophon = { toggle: () => (active ? disable() : enable()) };
    enable();
  },
});
