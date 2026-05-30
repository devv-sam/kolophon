import React, { useState } from "react";

export interface FontData {
  name: string;
  family: string;
  style: string;
  weight: string;
  size: string;
  lineHeight: string;
  colorRgb: string;
  colorHex: string;
}

interface Props {
  data: FontData | null;
  x: number;
  y: number;
  visible: boolean;
  onClose: () => void;
}

type ColorFormat =
  | "hex"
  | "rgb"
  | "hsl"
  | "hwb"
  | "lch"
  | "oklch"
  | "lab"
  | "oklab";

// ─── Color math ─────────────────────────────────────────────────────────────

function buildColorFormats(
  rgb: string,
  hex: string,
): Record<ColorFormat, string> {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) {
    return {
      hex,
      rgb,
      hsl: rgb,
      hwb: rgb,
      lch: rgb,
      oklch: rgb,
      lab: rgb,
      oklab: rgb,
    };
  }
  const r = parseInt(m[0]),
    g = parseInt(m[1]),
    b = parseInt(m[2]);

  const [labL, labA, labB] = rgbToLab(r, g, b);
  const [, lchC, lchH] = toLch(labL, labA, labB);
  const [okL, okA, okB] = rgbToOklab(r, g, b);
  const [, okC, okH] = toLch(okL, okA, okB);

  const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
  const n4 = (v: number) => (Math.round(v * 10000) / 10000).toString();

  return {
    hex,
    rgb,
    hsl: rgbToHsl(rgb),
    hwb: rgbToHwb(rgb),
    lab: `lab(${n2(labL)} ${n2(labA)} ${n2(labB)})`,
    lch: `lch(${n2(labL)} ${n2(lchC)} ${n2(lchH)})`,
    oklab: `oklab(${n2(okL * 100)}% ${n4(okA)} ${n4(okB)})`,
    oklch: `oklch(${n4(okL)} ${n4(okC)} ${n2(okH)})`,
  };
}

// Order shown in dropdown
const FORMAT_ORDER: ColorFormat[] = [
  "hex",
  "rgb",
  "hsl",
  "hwb",
  "lch",
  "oklch",
  "lab",
  "oklab",
];

// ─── Component ──────────────────────────────────────────────────────────────

export function PopupCard({ data, x, y, visible, onClose }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [colorFormat, setColorFormat] = useState<ColorFormat>("hex");

  if (!visible || !data) return null;

  const clampedX = Math.min(x, window.innerWidth - 300);
  const clampedY = Math.min(y, window.innerHeight - 280);

  const colorValues = buildColorFormats(data.colorRgb, data.colorHex);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    if (!data) return;
    navigator.clipboard.writeText(data.family).catch(() => {});
  }

  return (
    <div
      style={styles.card(clampedX, clampedY)}
      onClick={(e) => {
        e.stopPropagation();
        setDropdownOpen(false);
      }}
    >
      <div style={styles.header}>
        <div style={styles.nameGroup}>
          <span
            style={{
              ...styles.fontName,
              fontFamily: `'${data.name}', sans-serif`,
            }}
          >
            {data.name}
          </span>
          <button
            type="button"
            style={styles.iconBtn}
            title="Copy family"
            onClick={handleCopy}
          >
            <CopyIcon />
          </button>
        </div>
        <div style={styles.headerActions}>
          <button style={styles.iconBtn} title="Expand">
            <ExternalLink />
          </button>
          <button style={styles.iconBtn} onClick={onClose} title="Close">
            <X />
          </button>
        </div>
      </div>

      <div style={styles.specs}>
        <SpecRow label="Size" value={data.size} />

        <div style={styles.specRow}>
          <span style={styles.specLabel}>Color:</span>
          <span
            data-clickable
            style={{
              ...styles.specValue,
              cursor: "pointer",
              userSelect: "none",
              position: "relative",
            }}
            onClick={(e) => {
              e.stopPropagation();
              setDropdownOpen((o) => !o);
            }}
          >
            <Swatch color={data.colorRgb} />
            {colorValues[colorFormat]}
            <span
              style={{
                marginLeft: 5,
                opacity: 0.45,
                display: "flex",
                alignItems: "center",
              }}
            >
              <ChevronDown />
            </span>

            {dropdownOpen && (
              <div style={styles.dropdown} onClick={(e) => e.stopPropagation()}>
                {FORMAT_ORDER.map((fmt) => (
                  <div
                    key={fmt}
                    data-clickable
                    style={styles.dropdownOption(fmt === colorFormat)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setColorFormat(fmt);
                      setDropdownOpen(false);
                    }}
                  >
                    {colorValues[fmt]}
                  </div>
                ))}
              </div>
            )}
          </span>
        </div>

        <SpecRow label="Line Height" value={data.lineHeight} />
      </div>

      <div
        style={{ ...styles.specimen, fontFamily: `'${data.name}', sans-serif` }}
      >
        AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwYyZz 0123456789@?!(&)
      </div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.specRow}>
      <span style={styles.specLabel}>{label}:</span>
      <span style={styles.specValue}>{value}</span>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        background: color,
        border: "1px solid rgba(255,255,255,0.2)",
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function ChevronDown() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="13"
      height="13"
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

function ExternalLink() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function X() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

const styles = {
  card: (x: number, y: number): React.CSSProperties => ({
    position: "fixed",
    top: y,
    left: x,
    width: 280,
    background: "rgba(20, 20, 22, 0.55)",
    backdropFilter: "blur(16px) saturate(1.4)",
    WebkitBackdropFilter: "blur(16px) saturate(1.4)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
    padding: "14px 16px",
    pointerEvents: "auto",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#fff",
    zIndex: 2147483647,
    borderRadius: 0,
    overflow: "visible",
  }),

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  } as React.CSSProperties,

  nameGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } as React.CSSProperties,

  fontName: {
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "#fff",
  } as React.CSSProperties,

  headerActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexShrink: 0,
  } as React.CSSProperties,

  iconBtn: {
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.45)",
    cursor: "pointer",
    padding: 0,
    lineHeight: 0,
    display: "flex",
    alignItems: "center",
  } as React.CSSProperties,

  specs: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  } as React.CSSProperties,

  specRow: {
    display: "flex",
    gap: 8,
    fontSize: 13,
    lineHeight: "1.9",
    alignItems: "center",
  } as React.CSSProperties,

  specLabel: {
    color: "rgba(255,255,255,0.4)",
    flexShrink: 0,
  } as React.CSSProperties,

  specValue: {
    color: "#fff",
    display: "flex",
    alignItems: "center",
  } as React.CSSProperties,

  dropdown: {
    position: "absolute",
    top: "calc(100% + 2px)",
    left: 0, // align with the value span's left edge (its containing block)
    zIndex: 1,
    background: "rgba(28, 28, 30, 0.97)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    minWidth: 200,
    padding: "4px 0",
    borderRadius: 0,
  } as React.CSSProperties,

  dropdownOption: (active: boolean): React.CSSProperties => ({
    padding: "5px 14px",
    fontSize: 12,
    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
    color: active ? "#fff" : "rgba(255,255,255,0.55)",
    background: active ? "rgba(255,255,255,0.08)" : "transparent",
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),

  specimen: {
    fontSize: 13,
    lineHeight: 1.65,
    color: "rgba(255,255,255,0.8)",
    overflowWrap: "break-word",
    margin: 0,
  } as React.CSSProperties,
};
