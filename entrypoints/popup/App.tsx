import { useEffect } from "react";
import { browser } from "wxt/browser";

function App() {
  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id == null) return;
      // Open the port to activate inspect mode, then immediately close this
      // popup window. Otherwise Chrome eats the user's first page click on
      // popup-dismiss, and the cursor doesn't re-evaluate until the page gains
      // focus — meaning two clicks were needed to see the first card.
      browser.tabs.connect(tab.id, { name: "kolophon-inspect" });
      window.close();
    });
  }, []);

  return (
    <div style={{ padding: "12px 16px", fontFamily: "system-ui, sans-serif" }}>
      <p style={{ margin: 0, fontSize: "13px", color: "#555" }}>inspecting…</p>
    </div>
  );
}

export default App;
