import React, { useEffect, useRef, useState } from "react";

export interface FontData {
  name: string;
  family: string;
  style: string;
  weight: string;
  size: string;
  lineHeight: string;
  letterSpacing: string;
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

export type ColorFormat =
  | "hex"
  | "rgb"
  | "hsl"
  | "hwb"
  | "lch"
  | "oklch"
  | "lab"
  | "oklab";

// ─── Color math ─────────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgbToHsl(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return rgb;
  const r = parseInt(m[0]) / 255,
    g = parseInt(m[1]) / 255,
    b = parseInt(m[2]) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

function rgbToHwb(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return rgb;
  const r = parseInt(m[0]) / 255,
    g = parseInt(m[1]) / 255,
    b = parseInt(m[2]) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h = Math.round(h * 60);
  }
  return `hwb(${h} ${Math.round(min * 100)}% ${Math.round((1 - max) * 100)}%)`;
}

// sRGB -> CIE Lab (D50). Path: sRGB -> linear -> XYZ(D65) -> XYZ(D50) -> Lab.
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r),
    gl = srgbToLinear(g),
    bl = srgbToLinear(b);

  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;

  // Bradford chromatic adaptation D65 -> D50
  const xd =
    1.0479298208405488 * x + 0.022946793341019088 * y - 0.05019222954313557 * z;
  const yd =
    0.029627815688159344 * x + 0.990434484573249 * y - 0.01707382502938514 * z;
  const zd =
    -0.009243058152591783 * x +
    0.015055144896577895 * y +
    0.7518742899580008 * z;

  const xn = 0.96422,
    yn = 1.0,
    zn = 0.82521; // D50 reference white
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  const fx = f(xd / xn),
    fy = f(yd / yn),
    fz = f(zd / zn);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// sRGB -> OKLab (Björn Ottosson). Path: sRGB -> linear -> LMS -> OKLab.
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r),
    gl = srgbToLinear(g),
    bl = srgbToLinear(b);

  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;

  const lp = Math.cbrt(l),
    mp = Math.cbrt(m),
    sp = Math.cbrt(s);

  return [
    0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp,
    1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp,
    0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp,
  ];
}

// Rectangular -> polar (Lab/OKLab -> LCh/OKLCh)
function toLch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

export function buildColorFormats(
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

// ─── Site info ──────────────────────────────────────────────────────────────
// Shown in the side panel header in place of extension branding. Gathered
// here (in the content script) so we don't need the broad "tabs" permission.

export interface SiteInfo {
  host: string;
  favicon: string;
}

function readSiteInfo(): SiteInfo {
  // href resolves relative paths against the page; sizes/shortcut variants
  // all match rel~="icon"
  const iconLink = document.querySelector<HTMLLinkElement>(
    'link[rel~="icon" i]',
  );
  return {
    host: location.hostname.replace(/^www\./, ""),
    favicon: iconLink?.href || `${location.origin}/favicon.ico`,
  };
}

// Order shown in dropdown
export const FORMAT_ORDER: ColorFormat[] = [
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
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  if (!visible || !data) return null;

  const clampedX = Math.min(x, window.innerWidth - 300);
  const clampedY = Math.min(y, window.innerHeight - 280);

  const colorValues = buildColorFormats(data.colorRgb, data.colorHex);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    if (!data) return;
    navigator.clipboard
      .writeText(data.family)
      .then(() => {
        setCopied(true);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
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
            style={
              copied ? { ...styles.iconBtn, color: "#4ade80" } : styles.iconBtn
            }
            title={copied ? "Copied!" : "Copy family"}
            onClick={handleCopy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        <div style={styles.headerActions}>
          <button
            style={styles.iconBtn}
            title="Expand"
            onClick={(e) => {
              e.stopPropagation();
              browser.runtime
                .sendMessage({
                  type: "kolophon:open-sidepanel",
                  site: readSiteInfo(),
                  font: data,
                })
                .catch(() => {});
            }}
          >
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
            onMouseEnter={() => setDropdownOpen(true)}
            onMouseLeave={() => setDropdownOpen(false)}
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

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
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
    // Flush with the trigger — any gap would fire mouseleave mid-travel
    // and close the hover dropdown before the pointer reaches it.
    top: "100%",
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
