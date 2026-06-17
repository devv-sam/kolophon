import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "kolophon",
    description:
      "Inspect, copy, and tweak the fonts on any web page. Hover to reveal type, copy CSS, edit live, and save fonts you love.",
    version: "1.0.0",
    permissions: [
      "activeTab",
      "scripting",
      "storage",
      "clipboardWrite",
      "sidePanel",
    ],
    // Declare the toolbar button explicitly. Removing the popup entrypoint
    // dropped the auto-generated "action" key, and without it Chrome never
    // fires action.onClicked (it just shows the extension management menu).
    // No default_popup → a click fires onClicked, which injects the inspector.
    action: { default_title: "kolophon" },
  },
  // The runtime-registered content script's <all_urls> match makes WXT add a
  // matching host_permission, but we never call registerContentScripts — we
  // inject on demand with scripting.executeScript, authorized by activeTab.
  // Strip it from the final manifest so install asks for nothing beyond the
  // active tab (a static `host_permissions: []` only unions, it can't remove).
  hooks: {
    "build:manifestGenerated"(_wxt, manifest) {
      delete manifest.host_permissions;
    },
  },
  webExt: {
    binaries: {
      // macOS example path for Chrome
      chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
  },
});
