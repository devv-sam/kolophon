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

interface CollectionEntry {
  font: FontData;
  site: SiteInfo | null;
  savedAt: number;
}

export default function App() {
  const [state, setState] = useState<PanelState>({ site: null, font: null });
  const [tab, setTab] = useState<"inspect" | "collection">("inspect");

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
      <nav className="tabs">
        <button
          type="button"
          className={`tab${tab === "inspect" ? " active" : ""}`}
          onClick={() => setTab("inspect")}
        >
          Inspect
        </button>
        <button
          type="button"
          className={`tab${tab === "collection" ? " active" : ""}`}
          onClick={() => setTab("collection")}
        >
          Collection
        </button>
      </nav>

      {tab === "inspect" ? (
        <>
          {state.site && (
            <header className="site-header">
              <SiteFavicon src={state.site.favicon} />
              <span className="site-host">{state.site.host}</span>
              {state.font && (
                <AddToCollection font={state.font} site={state.site} />
              )}
            </header>
          )}
          {state.font ? <SpecSheet font={state.font} /> : <EmptyState />}
        </>
      ) : (
        <CollectionView />
      )}
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
        <div
          className="specimen-display"
          style={{ fontFamily: specimenFamily }}
        >
          Ag
        </div>
        <p className="specimen-alphabet" style={{ fontFamily: specimenFamily }}>
          AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwYyZz
          0123456789@?!(&amp;)
        </p>
      </section>

      <section className="reveal" style={{ animationDelay: "120ms" }}>
        <div className="section-head">
          <span className="section-label">Properties</span>
          <CopyAll font={font} />
        </div>
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

// ─── Actions ─────────────────────────────────────────────────────────────────

function entryKey(font: FontData, site: SiteInfo | null): string {
  return [
    font.family,
    font.style,
    font.weight,
    font.size,
    font.lineHeight,
    font.letterSpacing,
    font.colorHex,
    site?.host ?? "",
  ].join("|");
}

// "Added" is derived from storage, not component state, so it survives
// tab switches and panel reloads, and blocks duplicate adds.
function AddToCollection({
  font,
  site,
}: {
  font: FontData;
  site: SiteInfo | null;
}) {
  const [added, setAdded] = useState(false);
  const key = entryKey(font, site);

  useEffect(() => {
    let stale = false;
    const check = (entries: unknown) => {
      const list = Array.isArray(entries) ? (entries as CollectionEntry[]) : [];
      if (!stale) setAdded(list.some((e) => entryKey(e.font, e.site) === key));
    };

    browser.storage.local
      .get("collection")
      .then(({ collection }) => check(collection))
      .catch(() => {});

    const onChanged = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ) => {
      if (area === "local" && changes.collection) {
        check(changes.collection.newValue);
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      stale = true;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [key]);

  function save() {
    if (added) return;
    browser.storage.local
      .get("collection")
      .then(({ collection }) => {
        const entries = Array.isArray(collection) ? collection : [];
        // Re-check inside the write in case another panel added it meanwhile
        if (
          entries.some((e: CollectionEntry) => entryKey(e.font, e.site) === key)
        ) {
          return;
        }
        entries.push({ font, site, savedAt: Date.now() });
        return browser.storage.local.set({ collection: entries });
      })
      .catch(() => {});
    // Button state flips via the storage.onChanged listener above
  }

  return (
    <button
      type="button"
      className="add-collection"
      onClick={save}
      disabled={added}
    >
      {added ? "✓ Added to collection" : "+ Add to collection"}
    </button>
  );
}

// ─── Collection ──────────────────────────────────────────────────────────────

// Best-effort preview fonts: one Google Fonts request for every collected
// family, each with the weights actually collected. Local/custom fonts fall
// back to sans-serif, same as the spec sheet specimen.
function useCollectionFonts(entries: CollectionEntry[]) {
  const byFamily = new Map<string, Set<number>>();
  for (const { font } of entries) {
    const weights = byFamily.get(font.name) ?? new Set<number>();
    const w = parseInt(font.weight, 10);
    if (!Number.isNaN(w)) weights.add(w);
    byFamily.set(font.name, weights);
  }
  const query = [...byFamily.entries()]
    .map(([name, weights]) => {
      const family = `family=${name.trim().replace(/\s+/g, "+")}`;
      const sorted = [...weights].sort((a, b) => a - b);
      return sorted.length ? `${family}:wght@${sorted.join(";")}` : family;
    })
    .join("&");

  useEffect(() => {
    const id = "kolophon-collection-fonts";
    document.getElementById(id)?.remove();
    if (!query) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
    document.head.appendChild(link);
  }, [query]);
}

function CollectionView() {
  const [entries, setEntries] = useState<CollectionEntry[]>([]);

  useEffect(() => {
    browser.storage.local
      .get("collection")
      .then(({ collection }) => {
        if (Array.isArray(collection)) setEntries(collection);
      })
      .catch(() => {});

    const onChanged = (
      changes: Record<string, { newValue?: unknown }>,
      area: string,
    ) => {
      if (area !== "local" || !changes.collection) return;
      const next = changes.collection.newValue;
      setEntries(Array.isArray(next) ? next : []);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, []);

  useCollectionFonts(entries);

  function remove(entry: CollectionEntry) {
    const key = entryKey(entry.font, entry.site);
    browser.storage.local
      .get("collection")
      .then(({ collection }) => {
        const list = Array.isArray(collection)
          ? (collection as CollectionEntry[])
          : [];
        return browser.storage.local.set({
          collection: list.filter((e) => entryKey(e.font, e.site) !== key),
        });
      })
      .catch(() => {});
  }

  if (entries.length === 0) {
    return (
      <div className="empty">
        <span className="empty-glyph">+</span>
        <p className="empty-text">
          Nothing collected yet.
          <br />
          Inspect a font and hit “+ Add to collection”.
        </p>
      </div>
    );
  }

  return (
    <div className="collection">
      {entries
        .slice()
        .reverse()
        .map((entry, i) => (
          <CollectionItem
            key={`${entry.savedAt}-${i}`}
            entry={entry}
            onRemove={() => remove(entry)}
          />
        ))}
    </div>
  );
}

function CollectionItem({
  entry,
  onRemove,
}: {
  entry: CollectionEntry;
  onRemove: () => void;
}) {
  const [copied, copy] = useCopyFlash();
  const { font, site } = entry;

  return (
    <article className="coll-item">
      <span className="coll-badge">{site?.host ?? "unknown"}</span>
      <button
        type="button"
        className="coll-remove"
        onClick={onRemove}
        title="Remove from collection"
      >
        ×
      </button>

      <div
        className="coll-specimen"
        style={{
          fontFamily: `'${font.name}', sans-serif`,
          fontWeight: font.weight as React.CSSProperties["fontWeight"],
          fontStyle: font.style,
        }}
      >
        Aa 123
      </div>

      <div className="coll-foot">
        <div className="coll-id">
          <span className="coll-name">{font.name}</span>
          <span className="coll-meta">
            {font.weight} · {font.size} ·
            <span
              className="color-chip"
              style={{ background: font.colorRgb }}
            />
            {font.colorHex}
          </span>
        </div>
        <button
          type="button"
          className={`copy-all coll-copy${copied ? " copied" : ""}`}
          onClick={() => copy(fontCss(font))}
          title="Copy properties as CSS"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy CSS"}
        </button>
      </div>
    </article>
  );
}

function CopyIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 11 11"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 4H10V10H4V4Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M1 7V1H7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function fontCss(font: FontData): string {
  return [
    `font-family: ${font.family};`,
    `font-style: ${font.style};`,
    `font-weight: ${font.weight};`,
    `font-size: ${font.size};`,
    `line-height: ${font.lineHeight};`,
    `letter-spacing: ${font.letterSpacing};`,
    `color: ${font.colorHex};`,
  ].join("\n");
}

function CopyAll({ font }: { font: FontData }) {
  const [copied, copy] = useCopyFlash();

  return (
    <button
      type="button"
      className={`copy-all${copied ? " copied" : ""}`}
      onClick={() => copy(fontCss(font))}
      title="Copy all properties as CSS"
    >
      {copied ? "Copied" : "Copy all"}
    </button>
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
        No font yet. Click the kolophon icon in your toolbar, then click any
        text on the page. Hit the expand button on the card to send it here.
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
