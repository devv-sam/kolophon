import React, { useEffect, useRef, useState } from "react";
import {
  buildColorFormats,
  FORMAT_ORDER,
  type FontData,
  type SiteInfo,
} from "../content/PopupCard";

interface PanelState {
  site: SiteInfo | null;
  font: FontData | null;
}

// Best-effort: try Google Fonts so the specimen renders in the real face.
// Local/custom fonts 404 silently and the specimen falls back to sans-serif.
function useGoogleFont(name: string | undefined) {
  useEffect(() => {
    if (!name) return;
    const id = "kolophon-specimen-font";
    document.getElementById(id)?.remove();
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${name.trim().replace(/\s+/g, "+")}&display=swap`;
    document.head.appendChild(link);
  }, [name]);
}

export default function App() {
  const [state, setState] = useState<PanelState>({ site: null, font: null });

  useEffect(() => {
    browser.runtime
      .sendMessage({ type: "kolophon:get-state" })
      .then((s: PanelState | null) => s && setState(s))
      .catch(() => {});

    const onMessage = (message: PanelState & { type?: string }) => {
      if (message?.type === "kolophon:state") {
        setState({ site: message.site, font: message.font });
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  useGoogleFont(state.font?.name);

  return (
    <div className="panel">
      {state.site && (
        <header className="site-header">
          <SiteFavicon src={state.site.favicon} />
          <span className="site-host">{state.site.host}</span>
        </header>
      )}
      {state.font ? <SpecSheet font={state.font} /> : <EmptyState />}
    </div>
  );
}

// ─── Spec sheet ──────────────────────────────────────────────────────────────

function SpecSheet({ font }: { font: FontData }) {
  const specimenFamily = `'${font.name}', sans-serif`;
  const colors = buildColorFormats(font.colorRgb, font.colorHex);

  return (
    <div className="sheet" key={font.name + font.size + font.colorHex}>
      <section className="hero reveal" style={{ animationDelay: "0ms" }}>
        <span className="eyebrow">Spec sheet</span>
        <h1 className="font-title" style={{ fontFamily: specimenFamily }}>
          {font.name}
        </h1>
        <p className="font-meta">
          {font.weight} · {font.style} · {font.size}
        </p>
      </section>

      <section className="specimen reveal" style={{ animationDelay: "60ms" }}>
        <div className="specimen-display" style={{ fontFamily: specimenFamily }}>
          Ag
        </div>
        <p className="specimen-alphabet" style={{ fontFamily: specimenFamily }}>
          AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwYyZz 0123456789@?!(&amp;)
        </p>
      </section>

      <section className="reveal" style={{ animationDelay: "120ms" }}>
        <span className="section-label">Properties</span>
        <SpecRow label="Family" value={font.family} />
        <SpecRow label="Style" value={font.style} />
        <SpecRow label="Weight" value={font.weight} />
        <SpecRow label="Size" value={font.size} />
        <SpecRow label="Line height" value={font.lineHeight} />
        <SpecRow label="Letter spacing" value={font.letterSpacing} />
      </section>

      <section className="reveal" style={{ animationDelay: "180ms" }}>
        <span className="section-label">Color</span>
        <div className="color-hero">
          <span className="color-swatch" style={{ background: font.colorRgb }} />
          <span className="color-hex">{colors.hex}</span>
        </div>
        {FORMAT_ORDER.map((fmt) => (
          <SpecRow key={fmt} label={fmt} value={colors[fmt]} copyable />
        ))}
      </section>
    </div>
  );
}

// Every value copies on click; copyable just adds the affordance styling
// for rows where copying is the point (color formats).
function SpecRow({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function copy() {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  }

  return (
    <button
      type="button"
      className={`spec-row${copied ? " copied" : ""}`}
      onClick={copy}
      title="Copy value"
    >
      <span className="spec-label">{label}</span>
      <span className="spec-value">{copied ? "copied" : value}</span>
      {copyable && <span className="spec-copy-hint" aria-hidden="true" />}
    </button>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="empty">
      <span className="empty-glyph">Aa</span>
      <p className="empty-text">
        Inspect an element on the page,
        <br />
        then hit expand.
      </p>
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
