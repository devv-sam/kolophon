import { useEffect } from "react";
import { browser } from "wxt/browser";

function App() {
  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id == null) return;
      // Opening this port activates inspect mode in the content script.
      // When the popup closes, the port disconnects and inspect mode turns off.
      browser.tabs.connect(tab.id, { name: "kolophon-inspect" });
    });
  }, []);

  return (
    <div style={{ padding: "12px 16px", fontFamily: "system-ui, sans-serif" }}>
      <p style={{ margin: 0, fontSize: "13px", color: "#555" }}>inspecting…</p>
    </div>
  );
}

export default App;
