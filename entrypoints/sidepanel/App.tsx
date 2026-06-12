import React, { useEffect, useState } from "react";
import type { SiteInfo } from "../content/PopupCard";

// Header shows the site the user expanded from; body is intentionally
// empty for now — collection management lands here later.
export default function App() {
  const [site, setSite] = useState<SiteInfo | null>(null);

  useEffect(() => {
    browser.runtime
      .sendMessage({ type: "kolophon:get-site-info" })
      .then((info: SiteInfo | null) => info && setSite(info))
      .catch(() => {});

    const onMessage = (message: { type?: string; site?: SiteInfo }) => {
      if (message?.type === "kolophon:site-info" && message.site) {
        setSite(message.site);
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  return (
    <div className="panel">
      {site && (
        <header className="site-header">
          <SiteFavicon src={site.favicon} />
          <span className="site-host">{site.host}</span>
        </header>
      )}
    </div>
  );
}

function SiteFavicon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className="site-favicon-fallback" />;
  return (
    <img
      className="site-favicon"
      src={src}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}
