import React, { useEffect, useRef, useState } from "react";
import {
  buildColorFormats,
  FORMAT_ORDER,
  type ColorFormat,
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
        <ColorRow font={font} />
      </section>
    </div>
  );
}

function useCopyFlash(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function copy(value: string) {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  }

  return [copied, copy];
}

// Every value copies on click.
function SpecRow({ label, value }: { label: string; value: string }) {
  const [copied, copy] = useCopyFlash();

  return (
    <button
      type="button"
      className={`spec-row${copied ? " copied" : ""}`}
      onClick={() => copy(value)}
      title="Copy value"
    >
      <span className="spec-label">{label}</span>
      <span className="spec-value">{copied ? "copied" : value}</span>
    </button>
  );
}

// Color row: hover reveals the format variants (same gesture as the popup
// card's dropdown); clicking one copies it and makes it the displayed format.
function ColorRow({ font }: { font: FontData }) {
  const colors = buildColorFormats(font.colorRgb, font.colorHex);
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopyFlash();

  return (
    <div
      className={`spec-row color-row${copied ? " copied" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => copy(colors[format])}
      title="Copy value"
    >
      <span className="spec-label">Color</span>
      <span className="spec-value color-value">
        <span className="color-chip" style={{ background: font.colorRgb }} />
        {copied ? "copied" : colors[format]}
      </span>

      {open && (
        <div className="color-dropdown">
          {FORMAT_ORDER.map((fmt) => (
            <button
              key={fmt}
              type="button"
              className={`color-option${fmt === format ? " active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setFormat(fmt);
                copy(colors[fmt]);
                setOpen(false);
              }}
            >
              {colors[fmt]}
            </button>
          ))}
        </div>
      )}
    </div>
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
