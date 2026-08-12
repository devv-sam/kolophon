import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { PopupCard, type FontData, type EditField } from "./PopupCard";

export default defineContentScript({
  matches: ["<all_urls>"],

  registration: "runtime",

  main() {
    const w = window as unknown as { __kolophon?: { toggle: () => void } };
    if (w.__kolophon) {
      w.__kolophon.toggle();
      return;
    }

    let overlay: HTMLDivElement | null = null;
    let badge: HTMLDivElement | null = null;
    let toolbar: HTMLDivElement | null = null;
    let cursorStyle: HTMLStyleElement | null = null;
    let activeTarget: Element | null = null;
    let active = false;
    let popupOpen = false;
    let activeMode: "inspect" | "edit" | "collection" = "inspect";
    let draggingToolbar = false;

    let reactRoot: Root | null = null;
    let popupTarget: Element | null = null;
    const editedStyles = new Map<HTMLElement, string>();
    let popupState = {
      data: null as FontData | null,
      editFields: [] as EditField[],
      x: 0,
      y: 0,
      visible: false,
      confirmDiscard: false,
    };

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
          round(
            s.lineHeight === "normal" ? 1.2 : px(s.lineHeight) / fontSize,
            2,
          ),
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
        value: String(
          round(s.letterSpacing === "normal" ? 0 : px(s.letterSpacing), 1),
        ),
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
          options: [
            "block",
            "inline",
            "inline-block",
            "flex",
            "inline-flex",
            "grid",
            "none",
          ],
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
          options: [
            "flex-start",
            "center",
            "flex-end",
            "space-between",
            "space-around",
            "space-evenly",
          ],
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

    let toolbarPosition: "bottom" | "top" = "bottom";
    const TOOLBAR_EDGE = 24;
    const SNAP_EASE = "linear";
    const SNAP_DURATION = "0.3s";

    function snapTop(bar: HTMLDivElement): number {
      return toolbarPosition === "top"
        ? TOOLBAR_EDGE
        : window.innerHeight - bar.offsetHeight - TOOLBAR_EDGE;
    }

    function buildToolbar(): HTMLDivElement {
      const bar = document.createElement("div");
      bar.setAttribute("data-kolophon", "toolbar");
      Object.assign(bar.style, {
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%) scale(0.92)",
        transformOrigin: "center center",
        zIndex: "2147483646",
        display: "flex",
        alignItems: "center",
        gap: "0",
        background: "#ffffff",
        borderRadius: "7px",
        padding: "6px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "14px",
        fontWeight: "500",
        lineHeight: "1",
        userSelect: "none",
        opacity: "0",
        transition: "none",
      });

      const grip = document.createElement("div");
      grip.setAttribute("data-kolophon", "toolbar-grip");
      grip.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>';
      Object.assign(grip.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "7px 3px",
        color: "rgba(0,0,0,0.3)",
        cursor: "grab",
        lineHeight: "0",
        flexShrink: "0",
      });

      let dragStartX = 0;
      let dragStartY = 0;
      let barStartTop = 0;
      let barStartLeft = 0;

      grip.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        draggingToolbar = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const rect = bar.getBoundingClientRect();
        barStartTop = rect.top;
        barStartLeft = rect.left;
        grip.style.cursor = "grabbing";
        bar.style.transition = "none";
        bar.style.transform = "none";
        bar.style.left = `${barStartLeft}px`;
        hide();

        function onMove(ev: MouseEvent) {
          bar.style.top = `${barStartTop + (ev.clientY - dragStartY)}px`;
          bar.style.left = `${barStartLeft + (ev.clientX - dragStartX)}px`;
        }

        function onUp() {
          grip.style.cursor = "grab";
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);

          const barMidY =
            bar.getBoundingClientRect().top + bar.offsetHeight / 2;
          const vpMid = window.innerHeight / 2;
          toolbarPosition = barMidY < vpMid ? "top" : "bottom";

          bar.style.transition = `top ${SNAP_DURATION} ${SNAP_EASE}, left ${SNAP_DURATION} ${SNAP_EASE}, transform ${SNAP_DURATION} ${SNAP_EASE}`;
          bar.style.top = `${snapTop(bar)}px`;
          bar.style.left = "50%";
          bar.style.transform = "translateX(-50%) scale(1)";

          setTimeout(() => {
            draggingToolbar = false;
          }, 50);
        }

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });

      bar.appendChild(grip);

      const modes: {
        id: "inspect" | "edit" | "collection";
        label: string;
        icon: string;
      }[] = [
        {
          id: "inspect",
          label: "Inspect",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/></svg>',
        },
        {
          id: "edit",
          label: "Edit",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
        },
        {
          id: "collection",
          label: "Collection",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/></svg>',
        },
      ];

      const modeGroup = document.createElement("div");
      modeGroup.setAttribute("data-kolophon", "toolbar-modes");
      Object.assign(modeGroup.style, {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "0 5px",
        position: "relative",
      });

      const highlight = document.createElement("div");
      highlight.setAttribute("data-kolophon", "toolbar-highlight");
      Object.assign(highlight.style, {
        position: "absolute",
        top: "0",
        left: "0",
        height: "100%",
        borderRadius: "6px",
        background: "rgba(0,0,0,0.06)",
        transition: "left 0.25s linear, width 0.25s linear",
        pointerEvents: "none",
      });
      modeGroup.appendChild(highlight);

      const buttons: HTMLButtonElement[] = [];

      function moveHighlight() {
        const activeBtn = buttons.find(
          (b) => b.getAttribute("data-mode") === activeMode,
        );
        if (!activeBtn) return;
        highlight.style.left = `${activeBtn.offsetLeft}px`;
        highlight.style.width = `${activeBtn.offsetWidth}px`;
      }

      for (const mode of modes) {
        const btn = document.createElement("button");
        btn.setAttribute("data-kolophon", "toolbar-btn");
        btn.setAttribute("data-mode", mode.id);
        btn.innerHTML = `${mode.icon}<span>${mode.label}</span>`;
        Object.assign(btn.style, {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "7px 5px",
          border: "none",
          borderRadius: "6px",
          background: "transparent",
          color: "#000000",
          fontFamily: "inherit",
          fontSize: "14px",
          fontWeight: "500",
          lineHeight: "1",
          cursor: "pointer",
          whiteSpace: "nowrap",
          position: "relative",
        });
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          activeMode = mode.id;
          moveHighlight();
        });
        buttons.push(btn);
        modeGroup.appendChild(btn);
      }
      bar.appendChild(modeGroup);

      requestAnimationFrame(() => {
        highlight.style.transition = "none";
        moveHighlight();
        requestAnimationFrame(() => {
          highlight.style.transition =
            "left 0.25s linear, width 0.25s linear";
        });
      });

      const divider = document.createElement("div");
      divider.setAttribute("data-kolophon", "toolbar-divider");
      Object.assign(divider.style, {
        width: "1px",
        height: "16px",
        background: "rgba(0,0,0,0.12)",
        margin: "0 4px",
        flexShrink: "0",
      });
      bar.appendChild(divider);

      const closeBtn = document.createElement("button");
      closeBtn.setAttribute("data-kolophon", "toolbar-close");
      closeBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      Object.assign(closeBtn.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "7px 5px",
        border: "none",
        borderRadius: "6px",
        background: "transparent",
        color: "#000000",
        cursor: "pointer",
        lineHeight: "0",
      });
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        disable();
      });
      bar.appendChild(closeBtn);

      return bar;
    }

    function mountReact() {
      const container = document.createElement("div");
      container.setAttribute("data-kolophon", "popup-host");
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

    function applyStyle(prop: string, value: string) {
      if (!popupTarget) return;
      const el = popupTarget as HTMLElement;
      if (!editedStyles.has(el)) editedStyles.set(el, el.style.cssText);
      el.style.setProperty(prop, value);
      track(popupTarget);
    }

    function discardEdits() {
      for (const [el, css] of editedStyles) el.style.cssText = css;
      editedStyles.clear();
      disable();
    }

    function cancelDiscard() {
      popupState = { ...popupState, confirmDiscard: false };
      syncPopup();
    }

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

    function onMouseOver(e: MouseEvent) {
      if (draggingToolbar) return;
      const target = e.target as Element;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-kolophon]")) return;
      activeTarget = target;
      track(target);
    }

    function onScroll() {
      if (activeTarget) track(activeTarget);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (popupState.confirmDiscard) return;
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
      if (draggingToolbar) return;
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
        [data-kolophon="toolbar"],
        [data-kolophon="toolbar"] * { cursor: default !important; }
        [data-kolophon="toolbar-btn"],
        [data-kolophon="toolbar-close"] { cursor: pointer !important; }
        [data-kolophon="toolbar-grip"] { cursor: grab !important; }
        [data-kolophon="toolbar-grip"]:active { cursor: grabbing !important; }

        [data-kolophon="toolbar"] *::before,
        [data-kolophon="toolbar"] *::after {
          content: none !important;
          display: none !important;
        }
        [data-kolophon="toolbar"] button,
        [data-kolophon="toolbar"] svg {
          box-shadow: none !important;
          filter: none !important;
          animation: none !important;
          transition: none !important;
        }
        [data-kolophon="toolbar"] svg {
          width: revert !important;
          height: revert !important;
          max-width: none !important;
        }

        [data-kolophon="popup-host"] *::before,
        [data-kolophon="popup-host"] *::after {
          content: none !important;
          display: none !important;
        }
        [data-kolophon="popup-host"] button,
        [data-kolophon="popup-host"] [data-drag],
        [data-kolophon="popup-host"] svg {
          box-shadow: none !important;
          filter: none !important;
          animation: none !important;
          transition: none !important;
        }
        [data-kolophon="popup-host"] svg {
          width: revert !important;
          height: 12;
          max-width: none !important;
        }
      `;
      document.documentElement.appendChild(cursorStyle);
      toolbar = buildToolbar();
      document.body.appendChild(toolbar);
      toolbar.style.top = `${snapTop(toolbar)}px`;
      requestAnimationFrame(() => {
        if (!toolbar) return;
        toolbar.style.transition = `top ${SNAP_DURATION} ${SNAP_EASE}, opacity 0.2s linear, transform 0.2s linear`;
        toolbar.style.opacity = "1";
        toolbar.style.transform = "translateX(-50%) scale(1)";
      });
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
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("click", onClick);
      document.removeEventListener("mouseleave", hide);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll);

      if (toolbar) {
        const bar = toolbar;
        toolbar = null;
        bar.style.transition = "opacity 0.2s linear, transform 0.2s linear";
        bar.style.opacity = "0";
        bar.style.transform = "translateX(-50%) scale(0.92)";
        bar.addEventListener("transitionend", () => bar.remove(), {
          once: true,
        });
        setTimeout(() => bar.remove(), 250);
      }
    }

    w.__kolophon = { toggle: () => (active ? disable() : enable()) };
    enable();
  },
});
