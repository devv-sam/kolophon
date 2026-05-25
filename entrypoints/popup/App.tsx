import { useEffect } from "react";

function App() {
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id == null) return;
      // Opening this port activates inspect mode in the content script.
      // When the popup closes, the port disconnects and inspect mode turns off.
      chrome.tabs.connect(tab.id, { name: "kolophon-inspect" });
    });
  }, []);

  return (
    <div style={{ padding: "12px 16px", fontFamily: "system-ui, sans-serif" }}>
      <p style={{ margin: 0, fontSize: "13px", color: "#555" }}>inspecting…</p>
    </div>
  );
}

export default App;
