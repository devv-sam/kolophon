export default defineContentScript({
  matches: ["<all_urls>"],

  main() {
    let overlay: HTMLDivElement | null = null;
    let badge: HTMLDivElement | null = null;
    let activeTarget: Element | null = null;
    let active = false;

    function parseFontName(fontFamily: string): string {
      // '"Inter", sans-serif' → 'Inter'
      return fontFamily.split(",")[0].trim().replace(/['"]/g, "");
    }

    function buildOverlay(): HTMLDivElement {
      const el = document.createElement("div");
      el.setAttribute("data-kolophon", "overlay");
      Object.assign(el.style, {
        position: "fixed",
        boxSizing: "border-box",
        pointerEvents: "none", // never block the page's own mouse events
        zIndex: "2147483646",
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
        zIndex: "2147483647",
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

    function mount() {
      overlay = buildOverlay();
      badge = buildBadge();
      document.body.appendChild(overlay);
      document.body.appendChild(badge);
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
        window.getComputedStyle(target).fontFamily
      );
      badge.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 20)}px`;
      badge.style.left = `${rect.left}px`;
      badge.style.display = "block";
    }

    function hide() {
      if (overlay) overlay.style.display = "none";
      if (badge) badge.style.display = "none";
      activeTarget = null;
    }

    function onMouseOver(e: MouseEvent) {
      const target = e.target as Element;
      if (!(target instanceof Element)) return;
      if (target.hasAttribute("data-kolophon")) return;
      activeTarget = target;
      track(target);
    }

    function onScroll() {
      if (activeTarget) track(activeTarget);
    }

    function enable() {
      if (active) return;
      active = true;
      if (!overlay) mount();
      document.addEventListener("mouseover", onMouseOver);
      document.addEventListener("mouseleave", hide);
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    function disable() {
      active = false;
      hide();
      document.removeEventListener("mouseover", onMouseOver);
      document.removeEventListener("mouseleave", hide);
      window.removeEventListener("scroll", onScroll);
    }

    // Popup opens a named port on mount; port disconnects automatically
    // when the popup closes — that's our signal to turn off inspect mode.
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== "kolophon-inspect") return;
      enable();
      port.onDisconnect.addListener(disable);
    });
  },
});
