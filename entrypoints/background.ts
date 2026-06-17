import type { FontData, SiteInfo } from "./content/PopupCard";

interface PanelState {
  site: SiteInfo | null;
  font: FontData | null;
}

export default defineBackground(() => {
  // Latest inspection the user expanded from. The panel asks for it on load;
  // if the panel is already open it hears the broadcast instead.
  const state: PanelState = { site: null, font: null };

  // Toolbar click → inject the inspector into the active tab. activeTab grants
  // the host permission for this gesture, so no broad host permission is needed
  // and the script never loads on pages the user doesn't inspect. Re-clicking
  // the same page re-runs the script, which toggles inspect mode off (see the
  // __kolophon guard in content/index.tsx).
  browser.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    browser.scripting
      .executeScript({
        target: { tabId: tab.id },
        files: ["/content-scripts/content.js"],
      })
      // Restricted pages (chrome://, the Web Store, PDF viewer) reject injection.
      .catch((err) => console.warn("kolophon: cannot inspect this page", err));
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "kolophon:open-sidepanel") {
      if (message.site) state.site = message.site;
      if (message.font) state.font = message.font;
      browser.runtime
        .sendMessage({ type: "kolophon:state", ...state })
        .catch(() => {}); // no panel listening yet — fine
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      // Must be called synchronously here — an await before open() drops the
      // user-gesture token and Chrome rejects the call.
      browser.sidePanel.open({ tabId }).catch(console.error);
      return;
    }

    if (message?.type === "kolophon:get-state") {
      sendResponse(state);
    }
  });
});
