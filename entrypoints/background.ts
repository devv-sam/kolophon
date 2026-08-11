import type { FontData, SiteInfo } from "./content/PopupCard";

interface PanelState {
  site: SiteInfo | null;
  font: FontData | null;
}

export default defineBackground(() => {
  const state: PanelState = { site: null, font: null };

  browser.action.onClicked.addListener((tab) => {
    if (tab.id === undefined) return;
    browser.scripting
      .executeScript({
        target: { tabId: tab.id },
        files: ["/content-scripts/content.js"],
      })
      .catch((err) => console.warn("kolophon: cannot inspect this page", err));
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "kolophon:open-sidepanel") {
      if (message.site) state.site = message.site;
      if (message.font) state.font = message.font;
      browser.runtime
        .sendMessage({ type: "kolophon:state", ...state })
        .catch(() => {});
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
