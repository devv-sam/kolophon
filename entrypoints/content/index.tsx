import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { PopupCard, type FontData } from "./PopupCard";

export default defineContentScript({
  matches: ["<all_urls>"],

  main() {
    // ─── State ────────────────────────────────────────────────────────────────

    let overlay: HTMLDivElement | null = null;
    let badge: HTMLDivElement | null = null;
    let exitButton: HTMLButtonElement | null = null;
    let cursorStyle: HTMLStyleElement | null = null;
    let activeTarget: Element | null = null;
    let active = false;
    let popupOpen = false;

    let reactRoot: Root | null = null;
    let popupState = {
      data: null as FontData | null,
      x: 0,
      y: 0,
      visible: false,
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

    function readFontData(target: Element): FontData {
      const s = window.getComputedStyle(target);
      return {
        name: parseFontName(s.fontFamily),
        family: s.fontFamily,
        style: s.fontStyle,
        weight: s.fontWeight,
        size: s.fontSize,
        lineHeight: s.lineHeight,
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
          x={popupState.x}
          y={popupState.y}
          visible={popupState.visible}
          onClose={closePopup}
        />,
      );
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
      if (e.key === "Escape") disable();
    }

    function closePopup() {
      popupOpen = false;
      popupState = { ...popupState, visible: false };
      syncPopup();
    }

    function onClick(e: MouseEvent) {
      const target = e.target as Element;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-kolophon]")) return;

      e.preventDefault();
      e.stopPropagation();

      popupOpen = true;

      const x = Math.min(e.clientX + 12, window.innerWidth - 300);
      const y = Math.min(e.clientY + 12, window.innerHeight - 300);

      popupState = { data: readFontData(target), x, y, visible: true };
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

    browser.runtime.onConnect.addListener((port) => {
      if (port.name !== "kolophon-inspect") return;
      enable();
    });
  },
});
