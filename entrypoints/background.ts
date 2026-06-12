import type { SiteInfo } from "./content/PopupCard";

export default defineBackground(() => {
  // Latest site the user expanded from. The panel asks for it on load;
  // if the panel is already open it hears the broadcast instead.
  let siteInfo: SiteInfo | null = null;

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "kolophon:open-sidepanel") {
      if (message.site) {
        siteInfo = message.site;
        browser.runtime
          .sendMessage({ type: "kolophon:site-info", site: message.site })
          .catch(() => {}); // no panel listening yet — fine
      }
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      // Must be called synchronously here — an await before open() drops the
      // user-gesture token and Chrome rejects the call.
      browser.sidePanel.open({ tabId }).catch(console.error);
      return;
    }

    if (message?.type === "kolophon:get-site-info") {
      sendResponse(siteInfo);
    }
  });
});
